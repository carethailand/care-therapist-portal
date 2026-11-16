// Reads for the logged-in person. Row Level Security on the server decides
// what each person may see — these queries never try to filter by role.
import { supa } from './supabase.js';

export async function loadMe(authUserId) {
  const { data, error } = await supa
    .from('therapists')
    .select('*')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error) throw error;
  return data; // null = login not linked to a staff record (or exited)
}

export async function loadRoles(therapistId) {
  const { data, error } = await supa
    .from('staff_roles')
    .select('role')
    .eq('therapist_id', therapistId);
  if (error) throw error;
  return data.map((r) => r.role);
}

export async function loadModules() {
  const { data, error } = await supa
    .from('app_modules')
    .select('key,label,description,sort_order,enabled,roles,phase')
    .order('sort_order');
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Admin → Staff (RLS lets only admin/HR see everyone and make changes)
// ---------------------------------------------------------------------------
const ROLES_JOIN = 'staff_roles!staff_roles_therapist_id_fkey(role)';

export async function listStaff() {
  const { data, error } = await supa
    .from('therapists')
    .select(`id,auth_user_id,email,full_name,nickname,employee_no,department,track,stage,status,accepted_on,start_date,probation_end_date,exited_on,legacy_training,binder_user_id,created_at,updated_at,${ROLES_JOIN}`)
    .order('full_name');
  if (error) throw error;
  return data.map((p) => ({ ...p, roles: p.staff_roles.map((r) => r.role) }));
}

export async function addPerson(fields) {
  const { data, error } = await supa.from('therapists').insert(fields).select('id').single();
  if (error) throw friendlyDbError(error);
  return data.id;
}

export async function updatePerson(id, fields) {
  const { error } = await supa.from('therapists').update(fields).eq('id', id);
  if (error) throw friendlyDbError(error);
}

// Make the person's roles exactly `wanted`. Adds first, then removes, so a
// failed removal (e.g. the last-admin guard) never leaves someone with no roles.
export async function setRoles(therapistId, current, wanted, grantedBy) {
  const toAdd = wanted.filter((r) => !current.includes(r));
  const toRemove = current.filter((r) => !wanted.includes(r));
  for (const role of toAdd) {
    const { error } = await supa
      .from('staff_roles')
      .insert({ therapist_id: therapistId, role, granted_by: grantedBy });
    // 23505 = they already have it (e.g. the database just made them a
    // therapist when they moved to Probation). That's fine.
    if (error && error.code !== '23505') throw friendlyDbError(error);
  }
  for (const role of toRemove) {
    const { error } = await supa.from('staff_roles').delete().eq('therapist_id', therapistId).eq('role', role);
    if (error) throw friendlyDbError(error);
  }
}

// Calls the staff-admin Edge Function: action = 'create_login' | 'reset_password'.
export async function staffLogin(action, therapistId) {
  const { data, error } = await supa.functions.invoke('staff-admin', {
    body: { action, therapist_id: therapistId },
  });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* keep msg */ }
    if (/failed to send|fetch/i.test(msg)) msg = 'Could not reach the login helper. Is the staff-admin function deployed?';
    throw new Error(msg);
  }
  return data; // { email, temp_password }
}

function friendlyDbError(error) {
  const msg = error?.message || String(error);
  if (/therapists_email_key|duplicate key.*email/i.test(msg)) return new Error('Someone with this email is already in the list.');
  if (/row-level security|permission denied/i.test(msg)) return new Error("You don't have permission for this change.");
  return new Error(msg);
}

// Timeline entries for one person, or for everyone (therapistId = null).
// Reads in pages of 1000, the most the server returns at once.
export async function loadEvents(therapistId = null) {
  const PAGE = 1000;
  const all = [];
  for (let from = 0; ; from += PAGE) {
    let q = supa
      .from('journey_events')
      .select('id,therapist_id,stage,event_type,title,details,occurred_on,recorded_by,created_at')
      .order('occurred_on', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (therapistId) q = q.eq('therapist_id', therapistId);
    const { data, error } = await q;
    if (error) throw error;
    all.push(...data);
    if (data.length < PAGE) return all;
  }
}

export async function loadJourney(therapistId) {
  const { data, error } = await supa
    .from('journey_events')
    .select('id,stage,event_type,title,details,occurred_on,created_at')
    .eq('therapist_id', therapistId)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
