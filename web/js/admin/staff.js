// Admin → Staff: list, add, edit people; create logins; temporary passwords.
// Visible to admin and HR. The database (RLS) enforces who may change what;
// this page only hides controls a person can't use.
import { listStaff, addPerson, updatePerson, setRoles, staffLogin } from '../data.js';
import { esc, titleCase, todayLocal } from '../ui.js';
import { stageLabel, TRACK_LABEL, roleLabel, displayRoles, RANKS, OFFICE_ROLES, RANK_LABEL, rankOf } from '../labels.js';
import { openRecord, exportEveryone } from './export.js';

// Each track has its own steps. CARE new hires become Therapist at Probation
// (after field overlap session 8 + contract); the database switches the role.
const TRACK_STAGES = {
  care_hire: ['interview', 'online_course', 'roleplay_orientation', 'field_overlap', 'probation', 'active', 'exited'],
  abat: ['online_course', 'certified', 'exited'],
};
const STAGES = [...new Set([...TRACK_STAGES.care_hire, ...TRACK_STAGES.abat])];
const THERAPIST_STAGES = ['probation', 'active'];
const HR_RANKS = ['applicant', 'therapist']; // ranks HR may give; higher ranks and office roles are admin-only
const STATUSES = ['active', 'on_leave', 'exited'];
const RANK_HELP = {
  applicant: 'New hire in training, or ABAT learner. Sees only their own journey and the course',
  therapist: 'Covers their own cases',
  senior: 'Can cover any case. New hires observe and do field overlap with them',
  qcd: 'Quality Control Department: role-play training, overlap forms, QCD evaluations',
  supervisor: 'Supervises therapists: sees everyone, adds timeline notes',
};
const OFFICE_HELP = {
  hr: 'Adds and edits staff records',
  admin: 'Full control, including ranks and tab switches',
};

let ctx; // { me, roles }
let people = [];
let panelEl;

export async function render(panel, context) {
  ctx = context;
  panelEl = panel;
  panel.innerHTML = `
    <section class="card">
      <div class="page-head">
        <h2>People</h2>
        <span class="spacer"></span>
        ${ctx.roles.includes('admin') ? '<button type="button" id="staff-export" title="Download everyone and every timeline as one Excel file (backup)">⬇︎ Export everyone</button>' : ''}
        <button type="button" class="primary" id="staff-add">+ Add person</button>
      </div>
      <div class="filters">
        <input type="search" id="staff-q" placeholder="Search name or email" aria-label="Search people">
        <select id="staff-who" aria-label="Who">
          <option value="">Everyone</option>
          <option value="staff">CARE staff</option>
          <option value="newhire">New hires (applicants)</option>
          <option value="abat">ABAT learners</option>
        </select>
        <select id="staff-status" aria-label="Show">
          <option value="current">Current</option>
          <option value="exited">Left</option>
          <option value="all">Current + left</option>
        </select>
        <select id="staff-stage" aria-label="Stage">
          <option value="">All stages</option>
          ${STAGES.filter((s) => s !== 'exited').map((s) => `<option value="${s}">${esc(stageLabel(s))}</option>`).join('')}
        </select>
      </div>
      <div id="staff-list" aria-live="polite"><p class="muted">Loading…</p></div>
    </section>
    <dialog id="person-dlg" class="dlg"></dialog>
    <dialog id="pw-dlg" class="dlg"></dialog>`;

  panel.querySelector('#staff-add').addEventListener('click', () => openPerson(null));
  panel.querySelector('#staff-export')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    try {
      const n = await exportEveryone(people, ctx.me);
      btn.textContent = `✓ Exported ${n.people} people`;
    } catch (e) {
      alert(`Export failed: ${e.message}`);
      btn.textContent = '⬇︎ Export everyone';
    } finally {
      btn.disabled = false;
    }
  });
  for (const id of ['#staff-q', '#staff-who', '#staff-status', '#staff-stage']) {
    panel.querySelector(id).addEventListener('input', drawList);
  }
  await reload();
}

const isAdmin = () => ctx.roles.includes('admin');

async function reload() {
  const list = panelEl.querySelector('#staff-list');
  try {
    people = await listStaff();
    drawList();
  } catch (e) {
    list.innerHTML = `<p class="error">Could not load staff: ${esc(e.message)}</p>`;
  }
}

function drawList() {
  const q = panelEl.querySelector('#staff-q').value.trim().toLowerCase();
  const show = panelEl.querySelector('#staff-status').value;
  const stage = panelEl.querySelector('#staff-stage').value;
  const who = panelEl.querySelector('#staff-who').value;
  const rows = people.filter((p) =>
    (!who || personGroup(p) === who) &&
    (show === 'all' || (show === 'exited' ? p.status === 'exited' : p.status !== 'exited')) &&
    (!stage || p.stage === stage) &&
    (!q || `${p.full_name} ${p.nickname ?? ''} ${p.email}`.toLowerCase().includes(q)));

  const list = panelEl.querySelector('#staff-list');
  if (!rows.length) {
    list.innerHTML = '<p class="muted">No one matches.</p>';
    return;
  }
  list.innerHTML = `
    <p class="muted small">${rows.length} ${rows.length === 1 ? 'person' : 'people'}</p>
    <ul class="staff-list">${rows.map(row).join('')}</ul>`;

  for (const b of list.querySelectorAll('[data-edit]')) {
    b.addEventListener('click', () => openPerson(people.find((p) => p.id === b.dataset.edit)));
  }
  for (const b of list.querySelectorAll('[data-login]')) {
    b.addEventListener('click', () => doLogin('create_login', people.find((p) => p.id === b.dataset.login), b));
  }
}

function personGroup(p) {
  if (p.track === 'abat') return 'abat';
  return p.roles.includes('applicant') ? 'newhire' : 'staff';
}

function row(p) {
  const login = p.auth_user_id
    ? '<span class="ok-text small">✓ Has login</span>'
    : p.status === 'exited'
      ? '<span class="muted small">No login</span>'
      : `<button type="button" class="small-btn" data-login="${esc(p.id)}">Create login</button>`;
  return `<li>
    <div class="who">
      <strong>${esc(p.nickname || p.full_name)}</strong>
      ${p.nickname ? `<span class="muted">${esc(p.full_name)}</span>` : ''}
      <div class="muted small">${esc(p.email)}</div>
    </div>
    <div class="chips">
      ${p.track === 'abat' ? '<span class="chip track-abat">ABAT</span>' : ''}
      <span class="chip stage">${esc(stageLabel(p.stage))}</span>
      ${p.status === 'on_leave' ? '<span class="chip warn">On leave</span>' : ''}
      ${displayRoles(p.roles).map((r) => `<span class="chip role-${esc(r.key)}">${esc(r.label)}</span>`).join('')}
    </div>
    <div class="login">${login}</div>
    <button type="button" class="small-btn" data-edit="${esc(p.id)}">Edit</button>
  </li>`;
}

// ---------------------------------------------------------------------------
// Add / edit dialog
// ---------------------------------------------------------------------------
function openPerson(p) {
  const isNew = !p;
  const roles = isNew ? ['applicant'] : p.roles;
  const track = p?.track ?? 'care_hire';
  const rank = rankOf(roles);
  // HR can't move someone who is already above Junior (that's admin-only).
  const rankLocked = !isAdmin() && rank !== null && !HR_RANKS.includes(rank);
  const v = (k) => esc(p?.[k] ?? '');
  const dlg = panelEl.querySelector('#person-dlg');
  dlg.innerHTML = `
    <form method="dialog" class="person-form">
      <h2>${isNew ? 'Add person' : 'Edit ' + esc(p.nickname || p.full_name)}</h2>

      <div class="grid2">
        <label>Full name <input name="full_name" required value="${v('full_name')}"></label>
        <label>Nickname <input name="nickname" value="${v('nickname')}"></label>
      </div>
      <label>Email (they sign in with this)
        <input name="email" type="email" required value="${v('email')}" ${p?.auth_user_id ? 'readonly title="Has a login. The email can\'t be changed here."' : ''}>
      </label>

      <label>Who is this?
        <select name="track">${Object.entries(TRACK_LABEL).map(([k, label]) => `<option value="${k}"${track === k ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>
      </label>

      <div class="grid2">
        <label>Stage
          <select name="stage"></select>
        </label>
        <label>Status
          <select name="status">${STATUSES.map((s) => `<option value="${s}"${(p?.status ?? 'active') === s ? ' selected' : ''}>${s === 'exited' ? 'Left CARE' : esc(titleCase(s))}</option>`).join('')}</select>
        </label>
      </div>
      <p class="hint muted small" id="stage-hint" hidden></p>

      <div class="grid2">
        <label>Accepted on <input name="accepted_on" type="date" value="${isNew ? todayLocal() : v('accepted_on')}"></label>
        <label>Start date <input name="start_date" type="date" value="${v('start_date')}"></label>
        <label>Probation ends <input name="probation_end_date" type="date" value="${v('probation_end_date')}"></label>
        <label>Left on <input name="exited_on" type="date" value="${v('exited_on')}"></label>
      </div>

      <fieldset>
        <legend>Rank <span class="muted small">(each rank includes the ones above it in this list)</span></legend>
        ${[...RANKS, ''].map((r) => {
          const locked = rankLocked || (!isAdmin() && !HR_RANKS.includes(r));
          return `<label class="check${locked ? ' locked' : ''}">
            <input type="radio" name="rank" value="${r}"${rank === (r || null) ? ' checked' : ''}${locked ? ' disabled data-fixed' : ''}>
            <span><strong>${esc(r ? RANK_LABEL[r] : 'None')}</strong> <span class="muted small">${esc(r ? RANK_HELP[r] : 'Office staff only, not a therapist')}${locked ? ' · admin only' : ''}</span></span>
          </label>`;
        }).join('')}
      </fieldset>

      <fieldset>
        <legend>Office roles <span class="muted small">(optional, on top of the rank)</span></legend>
        ${OFFICE_ROLES.map((r) => {
          const locked = !isAdmin();
          const self = !isNew && p.id === ctx.me.id && r === 'admin';
          return `<label class="check${locked ? ' locked' : ''}">
            <input type="checkbox" name="office" value="${r}"${roles.includes(r) ? ' checked' : ''}${locked || self ? ' disabled data-fixed' : ''}>
            <span><strong>${esc(roleLabel(r))}</strong> <span class="muted small">${esc(OFFICE_HELP[r])}${locked ? ' · admin only' : ''}${self ? " · you can't remove your own admin" : ''}</span></span>
          </label>`;
        }).join('')}
      </fieldset>

      ${isNew ? `<label class="check"><input type="checkbox" name="make_login" checked>
        <span>Create their login now <span class="muted small">(you'll get a temporary password to give them)</span></span></label>` : ''}

      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions">
        ${!isNew ? '<button type="button" class="link" data-act="record">Download record</button>' : ''}
        ${!isNew && p.auth_user_id && p.status !== 'exited' ? '<button type="button" class="link" data-act="reset">New temporary password</button>' : ''}
        <span class="spacer"></span>
        <button type="button" data-act="cancel">Cancel</button>
        <button type="submit" class="primary">${isNew ? 'Add' : 'Save'}</button>
      </div>
    </form>`;

  const form = dlg.querySelector('form');
  const msg = form.querySelector('.msg');
  const say = (text, kind = 'error') => { msg.textContent = text; msg.dataset.kind = kind; msg.hidden = !text; };

  const hint = form.querySelector('#stage-hint');
  const rankBox = (r) => form.querySelector(`input[name="rank"][value="${r}"]`);
  const showHint = (text) => { hint.textContent = text; hint.hidden = !text; };

  // Stage list follows the track. Keeps the person's current stage even if
  // it isn't normally on that track, so saving never changes it by surprise.
  function fillStages(keep) {
    const list = TRACK_STAGES[form.track.value];
    const opts = keep && !list.includes(keep) ? [keep, ...list] : list;
    form.stage.innerHTML = opts.map((s) => `<option value="${s}">${esc(stageLabel(s))}</option>`).join('');
    form.stage.value = keep && opts.includes(keep) ? keep : list[0];
  }

  // ABAT learners are never CARE staff: rank Applicant, no office roles.
  function applyTrack() {
    const abat = form.track.value === 'abat';
    for (const box of form.querySelectorAll('input[name="rank"], input[name="office"]')) {
      if (box.dataset.fixed !== undefined) continue;
      box.disabled = abat && box.value !== 'applicant';
      if (abat) box.checked = box.value === 'applicant';
    }
  }

  // Probation = passed field overlap session 8 and signed the contract.
  function onStage() {
    const careHire = form.track.value === 'care_hire';
    if (careHire && THERAPIST_STAGES.includes(form.stage.value) && rankBox('applicant').checked) {
      rankBox('therapist').checked = true;
      showHint('🎉 Passed field overlap session 8 and signed the contract: they become a Junior therapist when you save.');
    } else if (careHire && form.stage.value === 'field_overlap') {
      showHint('Sessions 1–7 with a senior, session 8 is the supervisor evaluation. They stay an Applicant until Probation.');
    } else if (form.track.value === 'abat' && form.stage.value === 'online_course') {
      showHint('ABAT learners only take the online course and exam. Move them to Certified when they pass.');
    } else {
      showHint('');
    }
  }

  fillStages(p?.stage ?? null);
  applyTrack();
  form.track.addEventListener('change', () => { fillStages(null); applyTrack(); onStage(); });
  form.stage.addEventListener('change', onStage);

  // Picking "Left CARE" fills in today's date and the 'exited' stage.
  form.status.addEventListener('change', () => {
    if (form.status.value === 'exited') {
      if (!form.exited_on.value) form.exited_on.value = todayLocal();
      form.stage.value = 'exited';
    }
  });

  form.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
  form.querySelector('[data-act="record"]')?.addEventListener('click', () => {
    dlg.close();
    showRecord(p);
  });
  form.querySelector('[data-act="reset"]')?.addEventListener('click', async (ev) => {
    if (!confirm(`Give ${p.nickname || p.full_name} a new temporary password? Their current password stops working.`)) return;
    dlg.close();
    await doLogin('reset_password', p, ev.currentTarget);
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    say('');
    const f = new FormData(form);
    const fields = {
      full_name: f.get('full_name').trim(),
      nickname: f.get('nickname').trim() || null,
      track: f.get('track'),
      stage: f.get('stage'),
      status: f.get('status'),
      accepted_on: f.get('accepted_on') || null,
      start_date: f.get('start_date') || null,
      probation_end_date: f.get('probation_end_date') || null,
      exited_on: f.get('exited_on') || null,
    };
    if (!p?.auth_user_id) fields.email = f.get('email').trim().toLowerCase();
    // Read .checked directly so locked (disabled) choices are kept as they were.
    const pickedRank = form.querySelector('input[name="rank"]:checked')?.value || null;
    const office = [...form.querySelectorAll('input[name="office"]')].filter((b) => b.checked).map((b) => b.value);
    // One rank per person. If the rank is locked for this user, leave the
    // rank roles exactly as they are (older records may hold several).
    const rankRoles = rankLocked ? roles.filter((r) => RANKS.includes(r)) : pickedRank ? [pickedRank] : [];
    const wanted = [...rankRoles, ...office];
    if (!wanted.length) { btn.disabled = false; return say('Please choose a rank (or an office role for office staff).'); }

    let id = p?.id;
    try {
      if (isNew) id = await addPerson(fields);
      else await updatePerson(id, fields);
    } catch (e) {
      btn.disabled = false;
      if (isNew && /already in the list/.test(e.message)) form.email.focus();
      return say(e.message);
    }
    try {
      await setRoles(id, isNew ? [] : p.roles, wanted, ctx.me.id);
      const makeLogin = isNew && f.get('make_login');
      const justLeft = !isNew && p.status !== 'exited' && fields.status === 'exited';
      dlg.close();
      await reload();
      if (makeLogin) await doLogin('create_login', people.find((x) => x.id === id));
      if (justLeft && confirm(`${fields.nickname || fields.full_name} is now marked as left. Their record is kept.\n\nDownload a copy of their record for the HR file?`)) {
        showRecord(people.find((x) => x.id === id));
      }
    } catch (e) {
      // The record itself was saved; only the roles failed. Close and say so.
      dlg.close();
      await reload();
      alert(`Saved, but the roles were not changed: ${e.message}`);
    } finally {
      btn.disabled = false;
    }
  });

  dlg.showModal();
  form.full_name.focus();
}

function showRecord(p) {
  if (p) openRecord(p, { people, me: ctx.me, host: panelEl });
}

// ---------------------------------------------------------------------------
// Logins
// ---------------------------------------------------------------------------
async function doLogin(action, p, btn) {
  if (!p) return;
  if (btn) btn.disabled = true;
  try {
    const res = await staffLogin(action, p.id);
    showPassword(p, res, action);
    await reload();
  } catch (e) {
    alert(e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function showPassword(p, res, action) {
  const dlg = panelEl.querySelector('#pw-dlg');
  dlg.innerHTML = `
    <div class="pw-box">
      <h2>${action === 'create_login' ? 'Login created 🎉' : 'New temporary password'}</h2>
      <p>For <strong>${esc(p.nickname || p.full_name)}</strong></p>
      <dl class="facts">
        <div><dt>Sign in with</dt><dd>${esc(res.email)}</dd></div>
        <div><dt>Temporary password</dt><dd><code class="pw">${esc(res.temp_password)}</code></dd></div>
      </dl>
      <p class="muted small">Give this to them privately (in person or a direct message). It is shown <strong>only once</strong>.
        When they first sign in, the Portal asks them to choose their own password.</p>
      <div class="dlg-actions">
        <button type="button" data-act="copy">Copy</button>
        <span class="spacer"></span>
        <button type="button" class="primary" data-act="done">Done</button>
      </div>
    </div>`;
  dlg.querySelector('[data-act="copy"]').addEventListener('click', async (ev) => {
    try {
      await navigator.clipboard.writeText(`CARE Therapist Portal\nEmail: ${res.email}\nTemporary password: ${res.temp_password}`);
      ev.currentTarget.textContent = 'Copied ✓';
    } catch { ev.currentTarget.textContent = 'Copy failed. Select it by hand.'; }
  });
  dlg.querySelector('[data-act="done"]').addEventListener('click', () => { dlg.close(); dlg.innerHTML = ''; });
  dlg.showModal();
}
