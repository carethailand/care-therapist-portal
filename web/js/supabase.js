// The one Supabase client for the whole app.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_STORAGE_KEY, isConfigured } from './config.js';

// Read the link type BEFORE the client consumes the URL. Invite and
// password-reset links arrive as #...&type=invite / type=recovery.
const hashParams = new URLSearchParams(window.location.hash.slice(1));
export const arrivedVia = hashParams.get('type'); // 'invite' | 'recovery' | null

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
