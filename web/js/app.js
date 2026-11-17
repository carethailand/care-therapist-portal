// App shell: decides which screen to show, builds the tab bar, routes tabs.
import { rolesText } from './labels.js';
import { APP_VERSION, isConfigured } from './config.js';
import { supa, arrivedVia, signinLink, linkError } from './supabase.js';
import { signIn, signOut, sendPasswordReset, setPassword, currentUser } from './auth.js';
import { loadMe, loadRoles, loadModules } from './data.js';
import { $, esc, showView, setMessage } from './ui.js';
import { icon } from './icons.js';
import * as theme from './theme.js';

// Built tabs. Anything not listed here renders the "coming soon" card.
// ?v=<version> makes the browser fetch a page's new code after each update
// (otherwise it can keep an old saved copy even after a hard refresh).
const TABS = {
  home: () => import(`./tabs/home.js?v=${APP_VERSION}`),
  journey: () => import(`./tabs/journey.js?v=${APP_VERSION}`),
  training: () => import(`./tabs/training.js?v=${APP_VERSION}`),
  leave: () => import(`./tabs/leave.js?v=${APP_VERSION}`),
  connect: () => import(`./tabs/connect.js?v=${APP_VERSION}`),
  team: () => import(`./tabs/team.js?v=${APP_VERSION}`),
  learning: () => import(`./tabs/learning.js?v=${APP_VERSION}`),
};
const comingSoon = () => import(`./tabs/coming-soon.js?v=${APP_VERSION}`);

// Icon per tab (see js/icons.js).
const TAB_ICON = {
  home: 'home', journey: 'route', team: 'users', training: 'school', connect: 'message-heart', learning: 'book', resources: 'link',
  journals: 'books', leave: 'beach', hours: 'clock', supervision: 'user-check', documents: 'file-text',
};
// Home is built in: everyone signed in has it, first in the list.
const HOME = { key: 'home', label: 'Home', enabled: true };

// Admin pages: reached from the ⚙️ button, not the tab bar.
const ADMIN_PAGES = {
  staff: { label: 'People', load: () => import(`./admin/staff.js?v=${APP_VERSION}`), roles: ['admin', 'hr'] },
  training: { label: 'Training content', load: () => import(`./admin/training.js?v=${APP_VERSION}`), roles: ['admin'] },
};
const canAdmin = () => state.roles.some((r) => r === 'admin' || r === 'hr');

const state = { me: null, roles: [], modules: [], visible: [] };

// After an update, a page's new code can meet an OLD saved copy of a shared
// file (browsers keep them up to 10 minutes) and fail to load. So when the
// version changes we refresh the saved copies of every shared file, and if a
// page still fails to load we refresh them again and reload once.
const SHARED = ['auth', 'config', 'connect-data', 'data', 'doc-text', 'icons', 'labels', 'learning-data', 'leave-data',
  'milestones', 'stickers', 'supabase', 'team-card', 'team-data', 'theme', 'training-data', 'training-export',
  'tree-art', 'tree', 'ui'].map((n) => `js/${n}.js`);
async function freshenCode(force = false) {
  let seen = null;
  try { seen = localStorage.getItem('care_portal_code'); } catch { /* storage blocked */ }
  if (!force && seen === APP_VERSION) return;
  await Promise.all(SHARED.map((f) => fetch(f, { cache: 'reload' }).catch(() => null)));
  try { localStorage.setItem('care_portal_code', APP_VERSION); } catch { /* storage blocked */ }
}
async function loadPage(load) {
  try {
    return await load();
  } catch (e) {
    let tried = null;
    try { tried = sessionStorage.getItem('care_portal_reloaded'); } catch { /* storage blocked */ }
    if (tried !== APP_VERSION) {
      try { sessionStorage.setItem('care_portal_reloaded', APP_VERSION); } catch { /* storage blocked */ }
      await freshenCode(true);
      window.location.reload();
      return new Promise(() => {});   // the page is reloading
    }
    throw e;
  }
}

for (const el of document.querySelectorAll('.app-version')) el.textContent = APP_VERSION;

// Colour mode button(s): Auto → Light → Dark.
function drawThemeButtons() {
  const c = theme.getChoice();
  for (const b of document.querySelectorAll('.theme-btn')) {
    b.innerHTML = `${icon(theme.iconName(c))}<span>${theme.label(c)}</span>`;
    b.title = `Colour mode: ${theme.label(c)}. Tap to change.`;
  }
}
theme.apply();
drawThemeButtons();
for (const b of document.querySelectorAll('.theme-btn')) {
  b.addEventListener('click', () => { theme.setChoice(theme.next(theme.getChoice())); drawThemeButtons(); });
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------
async function boot() {
  if (!isConfigured()) return showView('view-setup');
  await freshenCode();

  supa.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') showSetPassword('Choose a new password');
    if (event === 'SIGNED_OUT') showView('view-login');
  });

  if (signinLink) return showLinkView();

  const user = await currentUser();
  if (!user) {
    if (linkError) setMessage($('#login-msg'), 'That sign-in link has expired or was already used. Please ask your admin for a new one.', 'error');
    return showView('view-login');
  }

  if (arrivedVia === 'invite') return showSetPassword('Welcome! Choose your password');
  if (arrivedVia === 'recovery') return showSetPassword('Choose a new password');

  await enterApp(user);
}

async function enterApp(user) {
  // Logins made by an admin start with a temporary password.
  if (user.user_metadata?.must_change_password) return showSetPassword('Welcome! Please choose your own password');

  showView('view-loading');
  try {
    state.me = await loadMe(user.id);
    if (!state.me) {
      $('#unlinked-email').textContent = user.email;
      return showView('view-unlinked');
    }
    [state.roles, state.modules] = await Promise.all([loadRoles(state.me.id), loadModules()]);
  } catch (e) {
    $('#load-error').textContent = e.message || String(e);
    return showView('view-error');
  }

  const isAdmin = state.roles.includes('admin');
  state.visible = state.modules.filter(
    (m) => (m.enabled && m.roles.some((r) => state.roles.includes(r))) || isAdmin,
  );

  $('#who').textContent = state.me.nickname || state.me.full_name;
  $('#who-roles').textContent = rolesText(state.roles);
  $('#admin-btn').hidden = !canAdmin();
  renderNav();
  showView('view-app');
  route();
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function renderNav() {
  $('#tabs').innerHTML = [HOME, ...state.visible]
    .map((m) => `<a href="#/${esc(m.key)}" data-key="${esc(m.key)}"${m.enabled ? '' : ' class="preview" title="Hidden from staff (admin preview)"'}>${icon(TAB_ICON[m.key] ?? 'sparkles')}<span>${esc(m.label)}</span>${m.enabled ? '' : ' <small>hidden</small>'}</a>`)
    .join('');
}

async function route() {
  if (!state.me) return;
  const want = window.location.hash.startsWith('#/') ? window.location.hash.slice(2) : '';
  const panel = $('#panel');

  if (want.startsWith('admin/')) {
    const page = ADMIN_PAGES[want.slice(6)];
    if (page && state.roles.some((r) => page.roles.includes(r))) {
      for (const a of document.querySelectorAll('#tabs a')) a.removeAttribute('aria-current');
      $('#admin-btn').setAttribute('aria-current', 'page');
      const key = want.slice(6);
      const mine = Object.entries(ADMIN_PAGES).filter(([, pg]) => state.roles.some((r) => pg.roles.includes(r)));
      panel.innerHTML = `${mine.length > 1 ? `<nav class="subnav" aria-label="Admin pages">${mine.map(([k, pg]) =>
        `<a href="#/admin/${k}"${k === key ? ' aria-current="page"' : ''}>${esc(pg.label)}</a>`).join('')}</nav>` : ''}
        <div id="admin-page"><p class="muted">Loading…</p></div>`;
      try {
        const mod = await loadPage(page.load);
        await mod.render(panel.querySelector('#admin-page'), { me: state.me, roles: state.roles });
      } catch (e) {
        panel.querySelector('#admin-page').innerHTML = `<p class="error">This page didn't load. Please refresh (Cmd+Shift+R). ${esc(e.message)}</p>`;
      }
      return;
    }
  }
  $('#admin-btn').removeAttribute('aria-current');

  const module = want === 'home' || !want ? HOME : (state.visible.find((m) => m.key === want) || HOME);
  for (const a of document.querySelectorAll('#tabs a')) {
    a.toggleAttribute('aria-current', a.dataset.key === module.key);
  }
  panel.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const mod = await loadPage(TABS[module.key] || comingSoon);
    await mod.render(panel, { me: state.me, roles: state.roles, module, visible: state.visible, canAdmin: canAdmin() });
  } catch (e) {
    panel.innerHTML = `<section class="card"><p class="error">This page didn't load. Please refresh (Cmd+Shift+R).</p><p class="muted small">${esc(e.message)}</p></section>`;
  }
}

window.addEventListener('hashchange', route);

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------
$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = $('#login-msg');
  const btn = ev.submitter;
  btn.disabled = true;
  setMessage(msg, '');
  try {
    await signIn($('#login-email').value, $('#login-password').value);
    await enterApp(await currentUser());
  } catch (e) {
    setMessage(msg, e.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

$('#forgot-btn').addEventListener('click', async () => {
  const msg = $('#login-msg');
  const email = $('#login-email').value;
  if (!email) return setMessage(msg, 'Type your email above first, then tap "Forgot password".', 'error');
  try {
    await sendPasswordReset(email);
    setMessage(msg, 'If that email has an account, a reset link is on its way.', 'ok');
  } catch (e) {
    setMessage(msg, e.message, 'error');
  }
});

// A sign-in link from an admin: one tap on Continue uses it (only once), then
// the person chooses their password. The screen is built here (not in
// index.html) so an old saved copy of index.html can't break it.
function showLinkView() {
  let view = document.getElementById('view-link');
  if (!view) {
    view = document.createElement('main');
    view.id = 'view-link';
    view.className = 'center';
    view.setAttribute('data-view', '');
    view.innerHTML = `
      <section class="card narrow login-card">
        <img src="assets/care-logo.png" alt="CARE" class="login-logo">
        <h1 id="link-heading"></h1>
        <p class="muted" id="link-text"></p>
        <button type="button" id="link-go" class="primary">Continue</button>
        <p id="link-msg" class="msg" role="status" hidden></p>
      </section>`;
    document.body.prepend(view);
    view.querySelector('#link-go').addEventListener('click', useLink);
  }
  const invite = signinLink.kind === 'invite';
  $('#link-heading').textContent = invite ? 'Welcome to the CARE Portal' : 'Choose a new password';
  $('#link-text').textContent = invite ? 'Tap Continue to choose your password.' : 'Tap Continue to set a new password for your account.';
  setMessage($('#link-msg'), '');
  showView('view-link');
}
async function useLink(ev) {
  const btn = ev.currentTarget;
  btn.disabled = true;
  const { error } = await supa.auth.verifyOtp({ token_hash: signinLink.token, type: signinLink.kind });
  if (error) {
    btn.disabled = false;
    return setMessage($('#link-msg'), 'This link has expired or was already used. Please ask your admin for a new one.', 'error');
  }
  showSetPassword(signinLink.kind === 'invite' ? 'Welcome! Choose your password' : 'Choose a new password');
}

function showSetPassword(heading) {
  $('#setpw-heading').textContent = heading;
  $('#setpw-form').reset();
  setMessage($('#setpw-msg'), '');
  showView('view-set-password');
}

$('#setpw-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = $('#setpw-msg');
  const pw = $('#setpw-password').value;
  if (pw !== $('#setpw-confirm').value) return setMessage(msg, 'The two passwords do not match.', 'error');
  try {
    const user = await setPassword(pw);
    history.replaceState(null, '', window.location.pathname);
    await enterApp(user);
  } catch (e) {
    setMessage(msg, e.message, 'error');
  }
});

$('#change-pw-btn').addEventListener('click', () => showSetPassword('Change your password'));
// Cancel goes back to the app if it's loaded; otherwise (first sign-in) it signs out.
$('#setpw-cancel').addEventListener('click', () => (state.me && $('#tabs').childElementCount ? showView('view-app') : signOut()));
for (const b of document.querySelectorAll('.signout-btn')) b.addEventListener('click', signOut);
$('#retry-btn').addEventListener('click', boot);

boot();
