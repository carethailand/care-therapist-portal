// CARE Therapist Portal — staff-admin Edge Function
//
// Creates a login for a staff record, gives someone a new temporary
// password, or makes a one-time "set your password" sign-in link (to send on
// Slack). It runs on Supabase's servers because it needs the SECRET key,
// which must never be in the web page.
//
// Who may call it:
//   - admin or Portal manager: anyone
//   - hr:    only people whose roles are just 'applicant' / 'therapist' (or none yet).
//            HR can't create or reset a login for a senior/qcd/supervisor/hr/admin,
//            otherwise HR could sign in as someone with more access.
//
// Deploy with "Verify JWT" OFF. This function checks the caller itself
// (below), which also works with Supabase's new key types.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const ALLOWED_ORIGINS = [
  'http://127.0.0.1:8766',
  'http://localhost:8766',
  'https://carethailand.github.io', // GitHub Pages (the Portal lives at /care-therapist-portal/)
];

function cors(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function reply(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json' },
  });
}

// Prefer the service_role key (works with every client version); fall back to
// the newer secret key if the legacy keys are ever switched off.
function secretKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try { return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default; } catch { return ''; }
}

// Easy to read aloud / type: no 0/O, 1/l/I.
function tempPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `care-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

const SIMPLE_ROLES = new Set(['applicant', 'therapist']);
const PORTAL_URL = 'https://carethailand.github.io/care-therapist-portal/';

// Where a sign-in link sends people back to: the page that asked (if it is one
// of ours), otherwise the live Portal.
function redirectFor(req: Request, asked?: string): string {
  try {
    const u = new URL(asked ?? '');
    if (ALLOWED_ORIGINS.includes(u.origin)) return `${u.origin}${u.pathname}`;
  } catch { /* fall through */ }
  return PORTAL_URL;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return reply(req, 405, { error: 'POST only' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Who is calling? -------------------------------------------------------
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return reply(req, 401, { error: 'Please sign in again.' });

  const { data: caller } = await admin
    .from('therapists')
    .select('id, status, staff_roles!staff_roles_therapist_id_fkey(role)')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle();
  const callerRoles: string[] = (caller?.staff_roles ?? []).map((r: { role: string }) => r.role);
  const isAdmin = callerRoles.includes('admin') || callerRoles.includes('manager');   // Portal manager = admin here
  const isHR = callerRoles.includes('hr');
  if (!caller || caller.status === 'exited' || (!isAdmin && !isHR)) {
    return reply(req, 403, { error: 'Only admin or HR can do this.' });
  }

  // 2. What do they want? ----------------------------------------------------
  let body: { action?: string; therapist_id?: string; redirect_to?: string };
  try { body = await req.json(); } catch { return reply(req, 400, { error: 'Bad request.' }); }
  const { action, therapist_id } = body;
  if (!therapist_id || !['create_login', 'reset_password', 'signin_link'].includes(action ?? '')) {
    return reply(req, 400, { error: 'Bad request.' });
  }

  const { data: target } = await admin
    .from('therapists')
    .select('id, email, full_name, status, auth_user_id, staff_roles!staff_roles_therapist_id_fkey(role)')
    .eq('id', therapist_id)
    .maybeSingle();
  if (!target) return reply(req, 404, { error: 'Staff record not found.' });
  if (target.status === 'exited') return reply(req, 400, { error: 'This person is marked as left.' });

  const targetRoles: string[] = (target.staff_roles ?? []).map((r: { role: string }) => r.role);
  if (!isAdmin && targetRoles.some((r) => !SIMPLE_ROLES.has(r))) {
    return reply(req, 403, { error: 'Only an admin can manage logins for seniors, QCD, supervisors, HR or admins.' });
  }

  // 3. One-time sign-in link (no password is ever shown) ---------------------
  //    (v5: the link opens the Portal itself; the old Supabase /verify link was
  //    used up by Slack's link preview before people could tap it)
  // New person → "invite" link (creates the login; they choose a password).
  // Has a login → "recovery" link (they choose a new password).
  // The link works once and expires after the Email OTP time set in Supabase.
  if (action === 'signin_link') {
    const redirectTo = redirectFor(req, body.redirect_to);
    let kind: 'invite' | 'recovery' = target.auth_user_id ? 'recovery' : 'invite';
    let res = await admin.auth.admin.generateLink({
      type: kind, email: target.email,
      options: { redirectTo, ...(kind === 'invite' ? { data: { full_name: target.full_name } } : {}) },
    });
    if (res.error && kind === 'invite' && /already.*registered|exists/i.test(res.error.message)) {
      kind = 'recovery';   // a login already exists for this email but isn't linked yet: it links on sign-in
      res = await admin.auth.admin.generateLink({ type: 'recovery', email: target.email, options: { redirectTo } });
    }
    const hashed = res.data?.properties?.hashed_token;
    if (res.error || !hashed) return reply(req, 400, { error: res.error?.message ?? 'Could not make a link.' });
    // A Portal link with the token after "#": link previews (Slack etc.) never send
    // it to a server, so they can't use it up. The person taps Continue to use it.
    const link = `${redirectTo}#signin=${encodeURIComponent(hashed)}&kind=${kind}`;
    return reply(req, 200, { ok: true, email: target.email, kind, link });
  }

  const password = tempPassword();

  // 3a. Create the login -----------------------------------------------------
  if (action === 'create_login') {
    if (target.auth_user_id) return reply(req, 409, { error: 'This person already has a login.' });
    const { error } = await admin.auth.admin.createUser({
      email: target.email,
      password,
      email_confirm: true,
      user_metadata: { must_change_password: true, full_name: target.full_name },
    });
    if (error) {
      const msg = /already.*registered|exists/i.test(error.message)
        ? 'A login with this email already exists. It will link automatically. Refresh the page.'
        : error.message;
      return reply(req, 400, { error: msg });
    }
    // The database trigger links the new login to the staff record by email.
    return reply(req, 200, { ok: true, email: target.email, temp_password: password });
  }

  // 3b. New temporary password ----------------------------------------------
  if (!target.auth_user_id) return reply(req, 400, { error: 'This person has no login yet.' });
  const { error } = await admin.auth.admin.updateUserById(target.auth_user_id, {
    password,
    user_metadata: { must_change_password: true },
  });
  if (error) return reply(req, 400, { error: error.message });
  return reply(req, 200, { ok: true, email: target.email, temp_password: password });
});
