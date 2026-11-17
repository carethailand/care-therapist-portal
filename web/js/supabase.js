// The one Supabase client for the whole app.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_STORAGE_KEY, isConfigured } from './config.js';

// Read the link type BEFORE the client consumes the URL. Invite and
// password-reset links arrive as #...&type=invite / type=recovery.
const hashParams = new URLSearchParams(window.location.hash.slice(1));
export const arrivedVia = hashParams.get('type'); // 'invite' | 'recovery' | null

// Sign-in links made on the People screen look like  …/#signin=<token>&kind=invite.
// The token sits after "#", so link previews (Slack, LINE…) never send it
// anywhere and can't use it up; the person taps Continue to use it.
export const signinLink = hashParams.get('signin')
  ? { token: hashParams.get('signin'), kind: hashParams.get('kind') === 'recovery' ? 'recovery' : 'invite' }
  : null;
// An old-style or expired link comes back as  #error=…&error_code=otp_expired
export const linkError = hashParams.get('error_code') || hashParams.get('error') || null;
if (signinLink || linkError) history.replaceState(null, '', window.location.pathname + window.location.search);

export const supa = isConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: AUTH_STORAGE_KEY,
      },
    })
  : null;
