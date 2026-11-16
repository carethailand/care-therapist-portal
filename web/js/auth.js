// Sign-in, sign-out, password set / reset.
import { supa } from './supabase.js';
import { AUTH_STORAGE_KEY } from './config.js';

const redirectUrl = () => window.location.origin + window.location.pathname;

export async function signIn(email, password) {
  const { error } = await supa.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw friendly(error);
}

// Always ends on the sign-in screen, even if Supabase can't be reached or the
// session had already expired (then signOut() returns an error and keeps the
// stored login, which used to leave the button doing nothing).
export async function signOut() {
  for (const b of document.querySelectorAll('.signout-btn')) { b.disabled = true; b.textContent = 'Signing out…'; }
  try {
    await Promise.race([supa.auth.signOut({ scope: 'local' }), new Promise((r) => setTimeout(r, 4000))]);
  } catch { /* carry on */ }
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(AUTH_STORAGE_KEY) || /^sb-.*-auth-token/.test(k)) localStorage.removeItem(k);
  } catch { /* storage blocked: nothing stored */ }
  window.location.replace(window.location.pathname);
}

export async function sendPasswordReset(email) {
  const { error } = await supa.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectUrl() });
  if (error) throw friendly(error);
}

export async function setPassword(password) {
  if (password.length < 10) throw new Error('Please use at least 10 characters.');
  const { data, error } = await supa.auth.updateUser({ password, data: { must_change_password: false } });
  if (error) throw friendly(error);
  return data.user;
}

export async function currentUser() {
  const { data } = await supa.auth.getSession();
  return data?.session?.user ?? null;
}

function friendly(error) {
  const msg = error?.message || String(error);
  if (/invalid login credentials/i.test(msg)) return new Error('Email or password is not right. Please try again.');
  if (/email address not authorized/i.test(msg))
    return new Error('Email sending is not set up for this address yet. Please ask an admin to reset your password.');
  if (/rate limit/i.test(msg)) return new Error('Too many emails sent just now. Please wait an hour and try again.');
  return new Error(msg);
}
