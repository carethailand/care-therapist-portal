// CARE Therapist Portal — public settings.
//
// Only the PUBLIC "anon / publishable" key belongs here. This repo is public.
// Never put the service_role key, a database password, or any answer key in this folder.
//
// Fill these in from Supabase → Project Settings → API (Portal project, NOT the Binder).

export const SUPABASE_URL = 'https://slokwrjyizqqcbxcrnbh.supabase.co'; // Portal project (care-therapist-portal)
export const SUPABASE_ANON_KEY = 'sb_publishable_6B2Mgs05Hxe29-dqVz7h1w_wj59BmzD'; // publishable = public, safe to commit

export const APP_VERSION = 'v2026-11-19-P9w';

// Kept different from the Binder's key ('care_auth'): both apps live on the same
// github.io address, so they share browser storage. Distinct keys keep the two
// logins from overwriting each other.
export const AUTH_STORAGE_KEY = 'care_portal_auth';

export const isConfigured = () =>
  SUPABASE_URL.startsWith('https://') && !SUPABASE_ANON_KEY.startsWith('REPLACE');
