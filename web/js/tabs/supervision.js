// Supervision tab, part 1: QCD sessions (Portal 045).
//   My supervision ... a therapist's own QCD sessions this year (scores, notes, trend)
//   Team ............. QCD / supervisors / admin: everyone's QCD summary, record a
//                      session (QCD + supervisors), and edit the checklist
//                      (supervisors + admin). Two QCDs in a row below 2.5 = "PIP suggested".
// Scores are worked out again in the database; this page only shows them.
// Case codes only (3 letters), never a child's name. No files.
import { supa } from '../supabase.js';
import { rankOf } from '../labels.js';
import { esc, fmtDate, todayLocal, byName } from '../ui.js';
import { icon } from '../icons.js';

const must = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };
const api = {
  form: (key, version = null) => supa.rpc('sv_form', { p_key: key, p_version: version }).then(must),
  people: (year) => supa.rpc('sv_people', { p_year: year }).then(must),
  records: (who, year) => supa.rpc('sv_records', { p_who: who, p_year: year }).then(must),
  save: (r) => supa.rpc('sv_record_save', {
    p_id: r.id || null, p_who: r.who, p_held_on: r.held_on, p_case: r.case_code || null,
    p_level: r.level, p_scores: r.scores, p_notes: r.notes, p_tallies: r.tallies || null,
  }).then(must),
  remove: (id) => supa.rpc('sv_record_delete', { p_id: id }).then(must),
  reflection: (who, yr) => supa.rpc('sv_reflection_get', { p_who: who, p_year: yr }).then(must),
  saveReflection: (yr, answers, submit) => supa.rpc('sv_reflection_save', { p_year: yr, p_answers: answers, p_submit: submit }).then(must),
  adminGet: (who, yr) => supa.rpc('sv_admin_eval_get', { p_who: who, p_year: yr }).then(must),
  adminSave: (who, yr, half, section, scores, note) => supa.rpc('sv_admin_eval_save', { p_who: who, p_year: yr, p_half: half, p_section: section, p_scores: scores, p_note: note }).then(must),
  adminOwners: (owners) => supa.rpc('sv_admin_eval_owners', { p_owners: owners }).then(must),
  setNoYearly: (who, none) => supa.rpc('sv_set_no_yearly', { p_who: who, p_none: none }).then(must),
  leaveTaken: (who, from, to) => supa.from('leave_requests').select('type,days,start_date').eq('therapist_id', who).eq('status', 'approved')
    .gte('start_date', from).lte('start_date', to).then(must),
  alDays: (who, yr) => supa.from('leave_entitlements').select('al_days').eq('therapist_id', who).eq('year', yr).maybeSingle().then(must),
  clinicalGet: (who, yr) => supa.rpc('sv_clinical_get', { p_who: who, p_year: yr }).then(must),
  clinicalSave: (who, yr, level, scores, notes, submit) => supa.rpc('sv_clinical_save', { p_who: who, p_year: yr, p_level: level, p_scores: scores, p_notes: notes, p_submit: submit }).then(must),
  clinicalFinal: (who, yr, scores, notes) => supa.rpc('sv_clinical_finalize', { p_who: who, p_year: yr, p_scores: scores, p_notes: notes }).then(must),
  assign: (who, yr, lead, second, mid, end) => supa.rpc('sv_yearly_assign', { p_who: who, p_year: yr, p_lead: lead || null, p_second: second || null, p_mid: mid || null, p_end: end || null }).then(must),
  release: (who, yr, which, show) => supa.rpc('sv_yearly_release', { p_who: who, p_year: yr, p_which: which, p_show: show }).then(must),
  myReview: (yr) => supa.rpc('sv_my_review', { p_year: yr }).then(must),
  sign: (yr, comment) => supa.rpc('sv_yearly_sign', { p_year: yr, p_comment: comment }).then(must),
  yearlyPeople: (yr) => supa.rpc('sv_yearly_people', { p_year: yr }).then(must),
  draftGet: (who) => supa.rpc('sv_draft_get', { p_who: who }).then(must),
  draftPut: (who, version, state) => supa.rpc('sv_draft_put', { p_who: who, p_version: version, p_state: state }).then(must),
  draftDelete: (who) => supa.rpc('sv_draft_delete', { p_who: who }).then(must),
  saveForm: (key, title, body) => supa.rpc('sv_form_save', { p_key: key, p_title: title, p_body: body }).then(must),
};

const LEVEL = { junior: 'Junior', senior: 'Senior / QCD', supervisor: 'Supervisor' };
const LOW = 2.5;
const TAB_KEY = 'care-supervision-tab';

let ctx; let panelEl;
let year;
let form = null;                // latest QCD checklist { key, title, version, body }
const versions = new Map();     // version -> body (records keep the checklist they were scored with)
let people = [];
let filter = 'all';
let search = '';

const has = (...r) => ctx.roles.some((x) => r.includes(x));
const isTeam = () => has('admin', 'supervisor', 'qcd');
const canRecord = () => has('qcd', 'supervisor');
const canEdit = () => has('admin', 'supervisor');
// Yearly review: supervisors + admin / Portal manager read everyone's (not QCD).
const yearlyTeam = () => has('admin', 'supervisor');
let teamView = 'qcd';
// Supervisors don't get QCD sessions, so they have no "My supervision" (yet).
const myLevel = () => ({ therapist: 'junior', senior: 'senior', qcd: 'senior' })[rankOf(ctx.roles)] || null;
const RANK_GROUPS = [['qcd', 'QCD'], ['senior', 'Senior'], ['therapist', 'Junior']];
const qcdLevels = (body) => (body.levels || []).filter((l) => l.key !== 'supervisor');
const nameOf = (p) => p.nickname || p.full_name;
const fmtScore = (n) => (n == null ? '—' : Number(n).toFixed(2));
const dlg = () => panelEl.querySelector('#sv-dlg');
const openDlg = (html, wide = false) => { const d = dlg(); d.classList.toggle('sv-wide', wide); d.classList.remove('sv-full'); d.innerHTML = html; if (!d.open) d.showModal(); return d; };
const closeDlg = () => { const d = dlg(); if (d.open) d.close(); };
const lastTab = () => { try { return localStorage.getItem(TAB_KEY); } catch { return null; } };
const keepTab = (t) => { try { localStorage.setItem(TAB_KEY, t); } catch { /* private mode */ } };

async function bodyOf(version) {
  if (versions.has(version)) return versions.get(version);
  const f = await api.form('qcd', version);
  versions.set(version, f.body);
  return f.body;
}

export async function render(panel, context) {
  ctx = context;
  panelEl = panel;
  year = year ?? Number(todayLocal().slice(0, 4));
  panel.innerHTML = '<p class="muted">Loading…</p>';
  try {
    form = await api.form('qcd');
    if (!form) throw new Error('The QCD checklist isn’t set up yet (Portal 045).');
    versions.set(form.version, form.body);
  } catch (e) {
    panel.innerHTML = `<section class="card"><p class="error">Could not load Supervision: ${esc(e.message)}</p></section>`;
    return;
  }
  draw();
}

function draw() {
  const mine = true;                       // everyone writes a year-end reflection
  const team = isTeam() || yearlyTeam();
  const thisYear = Number(todayLocal().slice(0, 4));
  panelEl.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Supervision</h1>
      <span class="spacer"></span>
      <select id="sv-year" aria-label="Year">${[thisYear - 2, thisYear - 1, thisYear].map((y) => `<option${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
    </div>
    ${mine && team ? `<div class="seg tr-tabs" role="tablist" id="sv-tabs">
      <button type="button" role="tab" data-tab="mine">${icon('user-check')} My supervision</button>
      <button type="button" role="tab" data-tab="team">${icon('users')} Team</button></div>` : ''}
    <div data-pane="mine"${mine ? '' : ' hidden'}><div id="sv-mine"><p class="muted">Loading…</p></div></div>
    <div data-pane="team"${team ? '' : ' hidden'}>
      ${isTeam() && yearlyTeam() ? `<div class="seg sv-teamview" role="tablist" id="sv-teamview">
        <button type="button" role="tab" data-tv="qcd">QCD sessions</button><button type="button" role="tab" data-tv="yearly">Yearly review</button></div>` : ''}
      <div id="sv-team"${isTeam() ? '' : ' hidden'}><p class="muted">Loading…</p></div>
      <div id="sv-yearly" hidden></div>
    </div>
    <dialog id="sv-dlg" class="dlg"></dialog>`;
  panelEl.querySelector('#sv-year').addEventListener('change', (e) => { year = Number(e.target.value); draw(); });
  const tabs = panelEl.querySelector('#sv-tabs');
  if (tabs) {
    const set = (t) => {
      for (const b of tabs.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
      panelEl.querySelector('[data-pane="mine"]').hidden = t !== 'mine';
      panelEl.querySelector('[data-pane="team"]').hidden = t !== 'team';
    };
    for (const b of tabs.querySelectorAll('[data-tab]')) b.addEventListener('click', () => { keepTab(b.dataset.tab); set(b.dataset.tab); });
    set(lastTab() === 'mine' ? 'mine' : 'team');
  }
  if (mine) drawMine();
  if (team) {
    if (!isTeam()) teamView = 'yearly';
    if (!yearlyTeam()) teamView = 'qcd';
    const tv = panelEl.querySelector('#sv-teamview');
    const setTv = (v) => {
      teamView = v;
      tv?.querySelectorAll('[data-tv]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tv === v)));
      panelEl.querySelector('#sv-team').hidden = v !== 'qcd';
      panelEl.querySelector('#sv-yearly').hidden = v !== 'yearly';
      if (v === 'yearly') drawYearly();
    };
    tv?.addEventListener('click', (e) => { const b = e.target.closest('[data-tv]'); if (b) setTv(b.dataset.tv); });
    if (isTeam()) drawTeam();
    setTv(teamView);
  }
}

// ---------------------------------------------------------------------------
// My supervision (own QCD sessions)
// ---------------------------------------------------------------------------
async function drawMine() {
  const box = panelEl.querySelector('#sv-mine');
  box.innerHTML = '<div id="sv-myyear"></div><div id="sv-myqcd"></div>';
  drawMyYear();
  if (!myLevel()) return;                  // supervisors / office staff: no QCD sessions
  const qbox = box.querySelector('#sv-myqcd');
  let list = [];
  try { list = await api.records(ctx.me.id, year); } catch (e) { qbox.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  qbox.innerHTML = `<section class="card">
      <h2>My QCD sessions <span class="chip">${list.length}</span></h2>
      <p class="muted small">Scored 0–3 by a QCD or supervisor during a session (the schedule is in the timesheet). Tap a session to see every item and the notes.</p>
      ${list.length ? `${await resultsHtml(list)}<h3 class="sv-listhead">Sessions</h3>${sessionList(list)}` : `<p class="muted">No QCD sessions in ${year} yet.</p>`}
    </section>`;
  wireResults(qbox);
  wireSessions(qbox, list, { who: ctx.me, readOnly: true });
}

// ---------------------------------------------------------------------------
// Results view: 4 numbers, total score over time, section grid, focus items, goals.
// Colours come from --qr-* (light + dark in app.css). Numbers are always printed,
// and sessions below 2.5 are hollow rings (not colour alone).
// ---------------------------------------------------------------------------
const shortTitle = (t) => String(t || '').replace(/^[IVX]+\.\s*/, '').replace(/\s*\(.*\)\s*$/, '').trim();
const band = (v) => (v < 1 ? 0 : v < 2 ? 1 : v < 2.5 ? 2 : v < 2.85 ? 3 : 4);
const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

async function resultsHtml(list) {
  const recs = [...list].reverse();                     // oldest → newest
  const bodies = new Map(await Promise.all([...new Set(recs.map((r) => r.form_version))].map(async (v) => [v, await bodyOf(v)])));
  const last = recs[recs.length - 1];
  const prev = recs[recs.length - 2];
  // sections, in the order of the newest checklist
  const title = {};
  const order = [];
  for (const r of [...recs].reverse()) for (const sc of bodies.get(r.form_version).sections || []) {
    if (!(sc.key in title)) { title[sc.key] = shortTitle(sc.title); order.push(sc.key); }
  }
  const keys = order.filter((k) => recs.some((r) => r.sections?.[k] != null));
  const secAvg = keys.map((k) => ({ k, v: mean(recs.map((r) => r.sections?.[k]).filter((x) => x != null).map(Number)) }));
  const best = secAvg.length > 1 ? secAvg.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const worst = secAvg.length > 1 ? secAvg.reduce((a, b) => (b.v < a.v ? b : a)) : null;
  const totals = recs.map((r) => (r.total == null ? null : Number(r.total)));
  const avg = mean(totals.filter((x) => x != null));
  const delta = last.total != null && prev?.total != null ? Number(last.total) - Number(prev.total) : null;

  const kpis = `<div class="qr-kpis">
    <div class="qr-kpi"><p class="qr-l">Latest total</p><p class="qr-v">${fmtScore(last.total)}</p>
      <p class="qr-s">${delta == null ? esc(shortDate(last.held_on)) : `<span class="${delta >= 0 ? 'qr-up' : 'qr-down'}">${delta >= 0 ? '↑ +' : '↓ −'}${Math.abs(delta).toFixed(2)}</span> since last`}</p></div>
    <div class="qr-kpi"><p class="qr-l">Average ${year}</p><p class="qr-v">${fmtScore(avg)}</p><p class="qr-s">${recs.length} session${recs.length === 1 ? '' : 's'}</p></div>
    ${best && worst && best.k !== worst.k && best.v - worst.v >= 0.01 ? `
    <div class="qr-kpi"><p class="qr-l">Strongest area</p><p class="qr-w">${esc(title[best.k])}</p><p class="qr-s">average ${best.v.toFixed(2)}</p></div>
    <div class="qr-kpi"><p class="qr-l">To work on</p><p class="qr-w">${esc(title[worst.k])}</p><p class="qr-s">average ${worst.v.toFixed(2)}</p></div>` : ''}
  </div>`;

  // total score over time
  // Drawn at about the real width, so the 11px labels stay readable on a phone.
  const W = Math.round(Math.min(620, Math.max(300, (window.innerWidth || 620) - 90))); const H = W < 420 ? 200 : 180; const L = 30; const R = 16; const T = 14; const B = 30;
  const n = recs.length;
  const x = (i) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v) => T + ((3 - v) / 3) * (H - T - B);
  const pts = recs.map((r, i) => ({ r, i })).filter((p) => p.r.total != null);
  const every = Math.ceil(n / (W < 420 ? 4 : 8));        // date labels: at most ~4 on a phone, ~8 wide
  let svg = [0, 1, 2, 3].map((v) => `<line class="qr-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  svg += `<line class="qr-thr" x1="${L}" x2="${W - R}" y1="${y(LOW)}" y2="${y(LOW)}"/>`;
  if (pts.length > 1) svg += `<polyline class="qr-path" points="${pts.map((p) => `${x(p.i).toFixed(1)},${y(Number(p.r.total)).toFixed(1)}`).join(' ')}"/>`;
  svg += recs.map((r, i) => `${r.total != null ? `<circle class="qr-dot${Number(r.total) < LOW ? ' low' : ''}" cx="${x(i).toFixed(1)}" cy="${y(Number(r.total)).toFixed(1)}" r="5"/>` : ''}
    ${i % every === 0 || i === n - 1 ? `<text x="${x(i).toFixed(1)}" y="${H - 9}" text-anchor="middle">${esc(shortDate(r.held_on))}</text>` : ''}
    <rect data-qr="${i}" x="${(x(i) - Math.max(14, (W - L - R) / Math.max(1, n - 1) / 2)).toFixed(1)}" y="0" width="${Math.max(28, (W - L - R) / Math.max(1, n - 1)).toFixed(1)}" height="${H - B}" fill="transparent"/>`).join('');
  const endY = y(Number(last.total)) - 11 < 12 ? y(Number(last.total)) + 20 : y(Number(last.total)) - 11;   // near the top: put the label under the point
  if (last.total != null) svg += `<text class="qr-end" x="${Math.min(x(n - 1), W - R).toFixed(1)}" y="${endY.toFixed(1)}" text-anchor="${n === 1 ? 'middle' : 'end'}">${fmtScore(last.total)}</text>`;
  const tips = recs.map((r) => `${esc(fmtDate(r.held_on))}${r.case_code ? ` · case ${esc(r.case_code)}` : ''} · by ${esc(r.recorder || 'someone')}<br>Total <b>${fmtScore(r.total)}</b>${Number(r.total) < LOW ? ' · below 2.5' : ''}`);
  const trend = `<div class="qr-box" data-qr-tips='${esc(JSON.stringify(tips))}'>
    <h3>Total score over time</h3>
    <p class="qr-note">Dotted line = ${LOW}. A hollow ring = a session below ${LOW}. Two in a row = “Needs attention”.</p>
    <svg class="qr-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Total QCD score per session in ${year}: ${recs.map((r) => `${shortDate(r.held_on)} ${fmtScore(r.total)}`).join(', ')}">${svg}</svg>
    <div class="qr-tip" hidden></div>
  </div>`;

  // section × session grid
  const cell = (v) => (v == null ? '<span class="muted">—</span>' : `<span class="qr-c v${band(Number(v))}" title="${Number(v).toFixed(2)}">${Number(v).toFixed(1)}</span>`);
  const grid = `<div class="qr-box">
    <h3>Score by section, each session</h3>
    <div class="qr-key">0 <i style="background:var(--qr-0)"></i><i style="background:var(--qr-1)"></i><i style="background:var(--qr-2)"></i><i style="background:var(--qr-3)"></i><i style="background:var(--qr-4)"></i> 3 · stronger colour = higher score</div>
    <div class="qr-tablewrap"><table class="qr-table">
      <thead><tr><th></th>${recs.map((r) => `<th>${esc(shortDate(r.held_on))}<br><span class="small">${r.case_code ? `${esc(r.case_code)} · ` : ''}${esc(r.recorder || '')}</span></th>`).join('')}</tr></thead>
      <tbody>${keys.map((k) => `<tr><td>${esc(title[k])}</td>${recs.map((r) => `<td>${cell(r.sections?.[k])}</td>`).join('')}</tr>`).join('')}
        <tr class="qr-total"><td>Total</td>${recs.map((r) => `<td>${cell(r.total)}</td>`).join('')}</tr></tbody>
    </table></div>
  </div>`;

  // focus items (latest session) + goals
  const lb = bodies.get(last.form_version);
  const items = (lb.sections || []).flatMap((sc) => (sc.items || []).filter((it) => (it.levels || []).includes(last.level)));
  const scored = items.map((it) => ({ it, v: last.scores?.[it.key] })).filter((p) => typeof p.v === 'number');
  const low = scored.filter((p) => p.v <= 1).sort((a, b) => a.v - b.v);
  const focus = (low.length ? low : scored.filter((p) => p.v === 2)).slice(0, 5);
  const focusBox = `<div class="qr-box">
    <h3>${icon('help-circle')} Focus items <span class="muted small">(latest session)</span></h3>
    ${focus.length ? `<ul class="qr-focus">${focus.map((p) => `<li><span>${esc(p.it.text)}</span><b class="qr-c v${band(p.v)}">${p.v}</b></li>`).join('')}</ul>`
      : '<p class="muted small">Every item was scored 3 (or N/A). 🎉</p>'}
  </div>`;
  const ng = last.notes?.new_goals; const pg = last.notes?.prev_goals; const st = last.notes?.strengths;
  const goals = `<div class="qr-box qr-goal">
    <h3>${icon('check')} Goals</h3>
    ${st ? `<p class="qr-l">Strengths</p><p>${esc(st)}</p>` : ''}
    ${pg ? `<p class="qr-l">Previous goals: accomplished?</p><p>${esc(pg)}</p>` : ''}
    ${ng ? `<p class="qr-l">New goals · ${esc(shortDate(last.held_on))}${last.recorder ? `, by ${esc(last.recorder)}` : ''}</p><p>${esc(ng)}</p>` : ''}
    ${!st && !pg && !ng ? '<p class="muted small">No notes written for the latest session.</p>' : ''}
  </div>`;

  return `<div class="qr">${kpis}${trend}${grid}<div class="qr-two">${focusBox}${goals}</div></div>`;
}

// Hover / tap a point on the trend line for its details.
function wireResults(root) {
  // Goals / Focus boxes scroll when long: show "Scroll for more" until the end is reached.
  requestAnimationFrame(() => {
    for (const bx of root.querySelectorAll('.qr-two > .qr-box')) {
      const upd = () => bx.classList.toggle('sv-more', bx.scrollHeight - bx.scrollTop - bx.clientHeight > 8);
      upd(); bx.addEventListener('scroll', upd, { passive: true });
    }
  });
  for (const box of root.querySelectorAll('[data-qr-tips]')) {
    const tips = JSON.parse(box.dataset.qrTips);
    const tip = box.querySelector('.qr-tip');
    const show = (e, i) => {
      tip.innerHTML = tips[i]; tip.hidden = false;
      const b = box.getBoundingClientRect();
      tip.style.left = `${Math.max(4, Math.min(e.clientX - b.left + 10, b.width - tip.offsetWidth - 4))}px`;
      tip.style.top = `${Math.max(4, e.clientY - b.top - tip.offsetHeight - 8)}px`;
    };
    for (const r of box.querySelectorAll('[data-qr]')) {
      r.addEventListener('mousemove', (e) => show(e, +r.dataset.qr));
      r.addEventListener('click', (e) => show(e, +r.dataset.qr));
      r.addEventListener('mouseleave', () => { tip.hidden = true; });
    }
  }
}

function sessionList(list) {
  return `<ul class="sv-list">${list.map((r) => `
    <li><button type="button" class="sv-row" data-rec="${esc(r.id)}">
      <span><strong>${esc(fmtDate(r.held_on))}</strong>${r.case_code ? ` · case ${esc(r.case_code)}` : ''}
        <span class="muted small"> · ${esc(LEVEL[r.level] || r.level)} · by ${esc(r.recorder || 'someone')}</span></span>
      <span class="sv-total${Number(r.total) < LOW ? ' low' : ''}">${fmtScore(r.total)}</span>
    </button></li>`).join('')}</ul>`;
}

function wireSessions(box, list, opts) {
  for (const b of box.querySelectorAll('[data-rec]')) {
    b.addEventListener('click', () => viewDialog(list.find((r) => r.id === b.dataset.rec), opts));
  }
}

// ---------------------------------------------------------------------------
// Team (QCD, supervisors, admin)
// ---------------------------------------------------------------------------
async function drawTeam() {
  const box = panelEl.querySelector('#sv-team');
  try { people = await api.people(year); } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const flagged = people.filter((p) => p.flag).length;
  box.innerHTML = `<section class="card">
      <div class="page-head sv-head">
        <h2>QCD sessions · ${year}</h2>
        <span class="spacer"></span>
        ${canEdit() ? `<button type="button" class="small-btn" data-edit-form>${icon('settings')} Edit checklist</button>` : ''}
      </div>
      <div class="sv-tools">
        <input type="search" id="sv-search" placeholder="Search a name" value="${esc(search)}" aria-label="Search a name">
        <div class="seg" role="tablist">
          <button type="button" role="tab" data-filter="all" aria-selected="${filter === 'all'}">Everyone</button>
          <button type="button" role="tab" data-filter="flag" aria-selected="${filter === 'flag'}">Needs attention${flagged ? ` <span class="chip warn">${flagged}</span>` : ''}</button>
          <button type="button" role="tab" data-filter="none" aria-selected="${filter === 'none'}">No QCD yet</button>
        </div>
      </div>
      <ul class="sv-people" id="sv-people"></ul>
      <p class="muted small">Needs attention = the last 2 QCD sessions (any case) both below ${LOW}: a PIP may be needed. A supervisor decides.</p>
    </section>`;
  const paint = () => {
    const q = search.trim().toLowerCase();
    const shown = people.filter((p) => (!q || `${p.nickname || ''} ${p.full_name}`.toLowerCase().includes(q))
      && (filter === 'all' || (filter === 'flag' && p.flag) || (filter === 'none' && !p.sessions)));
    const rowHtml = (p) => `
      <li><button type="button" class="sv-person${p.flag ? ' flag' : ''}" data-person="${esc(p.id)}">
        <span class="sv-name"><strong>${esc(nameOf(p))}</strong> </span>
        <span class="muted small">${p.sessions ? `${p.sessions} QCD${p.sessions === 1 ? '' : 's'} in ${year}` : `No QCD in ${year}`}${p.last_on ? ` · last ${esc(fmtDate(p.last_on))}` : ''}</span>
        <span class="sv-total${p.last_total != null && Number(p.last_total) < LOW ? ' low' : ''}">${fmtScore(p.last_total)}</span>
        ${p.flag ? `<span class="chip warn sv-flag">PIP suggested</span>` : ''}
      </button></li>`;
    box.querySelector('#sv-people').innerHTML = shown.length
      ? RANK_GROUPS.map(([k, label]) => {
        const g = shown.filter((p) => (p.rank || (p.level === 'junior' ? 'therapist' : 'senior')) === k).sort(byName);
        return g.length ? `<li class="sv-grouphead">${esc(label)} <span class="muted small">${g.length}</span></li>${g.map(rowHtml).join('')}` : '';
      }).join('')
      : '<li class="muted">Nobody matches.</li>';
    for (const b of box.querySelectorAll('[data-person]')) b.addEventListener('click', () => personDialog(people.find((p) => p.id === b.dataset.person)));
  };
  paint();
  box.querySelector('#sv-search').addEventListener('input', (e) => { search = e.target.value; paint(); });
  for (const b of box.querySelectorAll('[data-filter]')) b.addEventListener('click', () => { filter = b.dataset.filter; drawTeam(); });
  box.querySelector('[data-edit-form]')?.addEventListener('click', () => formEditor());
}

async function personDialog(p) {
  const d = openDlg(`<div class="lh-form"><h2>${esc(nameOf(p))}</h2><p class="muted">Loading…</p></div>`);
  let list = [];
  try { list = await api.records(p.id, year); } catch (e) { d.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const self = p.id === ctx.me.id;
  d.innerHTML = `<div class="lh-form">
    <h2>${esc(nameOf(p))} <span class="chip">${esc(LEVEL[p.level] || p.level)}</span></h2>
    ${p.flag ? `<p class="sv-alert">${icon('help-circle')} The last 2 QCD sessions are both below ${LOW}. A supervisor decides whether to start a PIP.</p>` : ''}
    ${canRecord() && !self ? `<p><button type="button" class="primary" data-new>${icon('plus')} Record a QCD session</button></p>` : ''}
    ${list.length ? `${await resultsHtml(list)}<h3 class="sv-listhead">Sessions</h3>${sessionList(list)}` : `<p class="muted">No QCD sessions in ${year}.</p>`}
    <div class="dlg-actions"><button type="button" data-close>Close</button></div>
  </div>`;
  d.classList.add('sv-wide');
  wireResults(d);
  d.querySelector('[data-close]').addEventListener('click', closeDlg);
  d.querySelector('[data-new]')?.addEventListener('click', () => recordDialog(p, null));
  wireSessions(d, list, { who: p, readOnly: false });
}

// ---------------------------------------------------------------------------
// One session: view / record / edit
// ---------------------------------------------------------------------------
const itemsFor = (body, level) => (body.sections || []).map((s) => ({ ...s, items: (s.items || []).filter((i) => (i.levels || []).includes(level)) }))
  .filter((s) => s.items.length);

function liveScore(body, level, scores) {
  let tot = 0; let tn = 0; const sec = {};
  for (const s of itemsFor(body, level)) {
    const vals = s.items.map((i) => scores[i.key]).filter((v) => typeof v === 'number');
    if (vals.length) { sec[s.key] = vals.reduce((a, b) => a + b, 0) / vals.length; tot += sec[s.key]; tn += 1; }
  }
  return { sec, total: tn ? tot / tn : null };
}

async function viewDialog(r, { who, readOnly }) {
  const body = await bodyOf(r.form_version);
  const mineToEdit = !readOnly && (r.recorded_by === ctx.me.id || has('supervisor'));
  const canDel = !readOnly && (r.recorded_by === ctx.me.id || has('admin', 'supervisor'));
  const label = (v) => (v === 'na' ? 'N/A' : v == null ? '—' : String(v));
  const d = openDlg(`<div class="lh-form">
    <h2>${esc(nameOf(who))} · QCD ${esc(fmtDate(r.held_on))}</h2>
    <p class="muted small">${r.case_code ? `Case ${esc(r.case_code)} · ` : ''}${esc(LEVEL[r.level] || r.level)} level · by ${esc(r.recorder || 'someone')}</p>
    <p class="sv-big">Total <span class="sv-total${Number(r.total) < LOW ? ' low' : ''}">${fmtScore(r.total)}</span></p>
    ${itemsFor(body, r.level).map((s) => `<details class="sv-sec"><summary><strong>${esc(s.title)}</strong>
        <span class="sv-total small">${fmtScore(r.sections?.[s.key])}</span></summary>
      <ul class="sv-items">${s.items.map((i) => `<li><span>${esc(i.text)}${r.tallies?.[i.key]?.n ? ` <span class="muted small">(${r.tallies[i.key].c}/${r.tallies[i.key].n})</span>` : ''}</span><b class="sv-score s${esc(String(r.scores?.[i.key] ?? ''))}">${esc(label(r.scores?.[i.key]))}</b></li>`).join('')}</ul></details>`).join('')}
    ${(body.notes || []).map((n) => (r.notes?.[n.key] ? `<p class="sv-note"><strong>${esc(n.label)}</strong><br>${esc(r.notes[n.key])}</p>` : '')).join('')}
    <div class="dlg-actions">
      ${mineToEdit ? '<button type="button" class="primary" data-edit>Edit</button>' : ''}
      <button type="button" data-back>${readOnly ? 'Close' : 'Back'}</button>
      ${canDel ? '<span class="spacer"></span><button type="button" class="small-btn" data-del>Remove</button>' : ''}
    </div></div>`, true);
  d.querySelector('[data-back]').addEventListener('click', () => (readOnly ? closeDlg() : personDialog(who)));
  d.querySelector('[data-edit]')?.addEventListener('click', () => recordDialog(who, r));
  d.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm('Remove this QCD session? This can’t be undone.')) return;
    try { await api.remove(r.id); await drawTeam(); personDialog(who); } catch (e) { alert(e.message); }
  });
}

// ---------------------------------------------------------------------------
// Live QCD observation (tablet / laptop): sections on the left, items on the
// right in any order. Counted items: tap ✓ / ✗ and the score works itself out
// from the checklist's rule (% correct, at least `min` chances). Rated items:
// tap 0–3. Any score can be set by hand. Saved on this device as you go; then
// Review and save. Raw tallies are kept for the year-end summary.
// ---------------------------------------------------------------------------
const DEFAULT_RULE = { min: 3, junior: [30, 50, 70], senior: [50, 70, 90] };
const draftKey = (who) => `care-qcd-draft:${who}`;
const readDraft = (who) => { try { return JSON.parse(localStorage.getItem(draftKey(who)) || 'null'); } catch { return null; } };
const writeDraft = (who, d) => { try { localStorage.setItem(draftKey(who), JSON.stringify(d)); return true; } catch { return false; } };
const dropDraft = (who) => { try { localStorage.removeItem(draftKey(who)); } catch { /* ignore */ } };

async function recordDialog(p, rec) {
  const body = rec ? await bodyOf(rec.form_version) : form.body;
  const rule = body.rule || null;                       // old checklists have no rule: everything is rated
  const modeOf = (i) => (rule ? (i.mode || 'count') : 'rate');
  const st = {
    level: rec?.level || (p.level === 'supervisor' ? 'senior' : p.level) || 'junior',
    held_on: rec?.held_on || todayLocal(), case_code: rec?.case_code || '',
    scores: { ...(rec?.scores || {}) }, tallies: JSON.parse(JSON.stringify(rec?.tallies || {})),
    manual: [], notes: { ...(rec?.notes || {}) }, recent: [],
  };
  const autoScore = (t) => {
    const r = rule || DEFAULT_RULE;
    if (!t || t.n < (r.min ?? 3)) return undefined;
    const th = r[st.level] || r.senior || DEFAULT_RULE.senior;
    const pct = (t.c / t.n) * 100;
    return pct >= th[2] ? 3 : pct >= th[1] ? 2 : pct >= th[0] ? 1 : 0;
  };
  if (rec) {   // a hand-set score = one that the tally doesn't give
    for (const s of body.sections || []) for (const i of s.items || []) {
      if (modeOf(i) === 'count' && rec.scores?.[i.key] != null && autoScore(rec.tallies?.[i.key]) !== rec.scores[i.key]) st.manual.push(i.key);
    }
  } else {
    // A draft may be on this device and / or in the Portal (only you can see it): use the newest.
    const local = readDraft(p.id);
    let remote = null;
    try { const r = await api.draftGet(p.id); if (r) remote = { v: r.version, at: Date.parse(r.updated_at), st: r.state }; } catch { /* offline: device copy only */ }
    const dr = [local, remote].filter((x) => x && x.v === body.version && x.st).sort((a, b) => b.at - a.at)[0];
    if (dr && confirm(`Continue the unsaved QCD draft for ${nameOf(p)} from ${new Date(dr.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}?\n\nCancel = delete it and start a new one.`)) Object.assign(st, dr.st);
    else if (local || remote) { dropDraft(p.id); api.draftDelete(p.id).catch(() => {}); }
    st.level = (p.level === 'supervisor' ? 'senior' : p.level) || 'junior';   // always the person's current rank
  }
  const history = [];
  let view = 'all'; let query = ''; let reviewing = false;

  const items = () => itemsFor(body, st.level);
  const flat = () => items().flatMap((s) => s.items.map((i) => ({ ...i, sec: s })));
  const effective = (i) => {
    if (modeOf(i) === 'rate' || st.manual.includes(i.key)) return st.scores[i.key];
    return autoScore(st.tallies[i.key]);
  };
  const finalScores = () => Object.fromEntries(flat().map((i) => [i.key, effective(i)]).filter(([, v]) => v !== undefined));
  // Draft: on this device at once, and in the Portal a moment later (private to the scorer).
  let putTimer = null;
  const status = (txt, warn = false) => { const el = d?.querySelector('[data-saved]'); if (el) { el.innerHTML = txt; el.classList.toggle('sv-draft-warn', warn); } };
  const save = () => {
    if (rec) return;
    writeDraft(p.id, { v: body.version, at: Date.now(), st });
    status(`${icon('lock')} Draft · saving…`);
    clearTimeout(putTimer);
    putTimer = setTimeout(async () => {
      try { await api.draftPut(p.id, body.version, st); status(`${icon('lock')} Draft saved · only you can see it until you tap Save QCD`); }
      catch {
        status(`${icon('lock')} Draft kept on this device only (no connection). It goes up when you're back online.`, true);
        window.addEventListener('online', () => { if (d.isConnected && d.open) save(); }, { once: true });
      }
    }, 1200);
  };
  const snap = () => { history.push(JSON.stringify({ scores: st.scores, tallies: st.tallies, manual: st.manual })); if (history.length > 60) history.shift(); };
  const touch = (k) => { st.recent = [k, ...st.recent.filter((x) => x !== k)].slice(0, 8); };

  const d = openDlg(`<div class="sv-live">
    <div class="sv-live-head">
      <h2>${esc(nameOf(p))} · ${rec ? 'Edit QCD' : 'Live QCD'}</h2>
      <span class="sv-lvl"><span class="muted small">Level</span><b>${esc(LEVEL[st.level] || st.level)}</b></span>
      <label>Date<input type="date" data-f="held_on" value="${esc(st.held_on)}" max="${todayLocal()}"></label>
      <label>Case<input data-f="case_code" maxlength="3" value="${esc(st.case_code)}" placeholder="ABC" style="text-transform:uppercase;width:5.5em"></label>
      <span class="spacer"></span>
      <span class="sv-draft small" data-saved>${rec ? '' : `${icon('lock')} Draft · only you can see it until you tap Save QCD`}</span>
      <button type="button" class="primary" data-review>Review and save</button>
      <button type="button" data-back>Back</button>
    </div>
    <div class="sv-live-body">
      <aside class="sv-live-side" data-side></aside>
      <section class="sv-live-main" data-main></section>
    </div>
  </div>`, true);
  d.classList.add('sv-full');
  const side = d.querySelector('[data-side]');
  const main = d.querySelector('[data-main]');

  const scoreBadge = (i) => {
    const v = effective(i);
    const t = st.tallies[i.key];
    const cls = v === undefined || v === 'na' ? 'sv-b-none' : `qr-c v${band(Number(v))}`;
    const txt = v === undefined ? (t && t.n ? '…' : '—') : v === 'na' ? 'N/A' : String(v);
    return `<button type="button" class="sv-badge ${cls}${st.manual.includes(i.key) ? ' manual' : ''}" data-pick="${esc(i.key)}" title="Set the score by hand">${txt}</button>`;
  };
  const rowHtml = (i) => {
    const t = st.tallies[i.key];
    const mode = modeOf(i);
    const meta = `${esc(shortTitle(i.sec.title))}${i.group ? ` · ${esc(i.group)}` : ''}`;
    const tally = mode === 'count'
      ? `<span class="sv-tally">${t && t.n ? `${t.c} / ${t.n} · ${Math.round((t.c / t.n) * 100)}%` : '—'}${t && t.n && t.n < ((rule || DEFAULT_RULE).min ?? 3) ? '<br><span class="muted">too few yet</span>' : ''}</span>`
      : '<span class="sv-tally muted">rate 0–3</span>';
    const ctrl = mode === 'count'
      ? `<span class="sv-tick"><button type="button" class="sv-yes" data-t="${esc(i.key)}" data-c="1" aria-label="Correct: ${esc(i.text)}">${icon('check')}</button><button type="button" class="sv-no" data-t="${esc(i.key)}" data-c="0" aria-label="Missed: ${esc(i.text)}">✕</button></span>`
      : `<span class="sv-pick">${[0, 1, 2, 3].map((v) => `<button type="button" data-r="${esc(i.key)}" data-v="${v}" aria-pressed="${st.scores[i.key] === v}">${v}</button>`).join('')}<button type="button" data-r="${esc(i.key)}" data-v="na" aria-pressed="${st.scores[i.key] === 'na'}">N/A</button></span>`;
    return `<div class="sv-lrow" data-row="${esc(i.key)}"><div><div class="sv-ltext">${esc(i.text)}</div><div class="sv-lmeta">${meta}</div></div>${tally}${ctrl}${scoreBadge(i)}
      <div class="sv-handpick" data-hand="${esc(i.key)}" hidden>Score by hand: ${[0, 1, 2, 3].map((v) => `<button type="button" data-h="${v}">${v}</button>`).join('')}<button type="button" data-h="na">N/A</button>${mode === 'count' ? '<button type="button" data-h="auto">Use the tally</button>' : '<button type="button" data-h="clear">Clear</button>'}</div></div>`;
  };

  const paintSide = () => {
    const secs = items();
    const sc = finalScores();
    const done = (list) => list.filter((i) => sc[i.key] !== undefined).length;
    const all = flat();
    const { total } = liveScore(body, st.level, sc);
    side.innerHTML = `${[['all', 'All items', `${done(all)}/${all.length}`], ['recent', 'Recent', String(st.recent.length)], ['todo', 'Not scored yet', String(all.length - done(all))],
      ...secs.map((s) => [s.key, shortTitle(s.title), `${done(s.items)}/${s.items.length}`])]
      .map(([k, l, c]) => `<button type="button" class="sv-secbtn${view === k ? ' on' : ''}" data-view="${esc(k)}"><span>${esc(l)}</span><span>${esc(c)}</span></button>`).join('')}
      <div class="sv-live-total"><span class="muted small">Total so far</span><span class="qr-v${total != null && total < LOW ? ' low' : ''}">${fmtScore(total)}</span></div>`;
  };
  const shown = () => {
    let list = flat();
    const q = query.trim().toLowerCase();
    if (q) return list.filter((i) => `${i.text} ${i.group || ''} ${i.sec.title}`.toLowerCase().includes(q));
    if (view === 'recent') return st.recent.map((k) => list.find((i) => i.key === k)).filter(Boolean);
    if (view === 'todo') { const sc = finalScores(); return list.filter((i) => sc[i.key] === undefined); }
    if (view !== 'all') list = list.filter((i) => i.sec.key === view);
    return list;
  };
  const paintMain = () => {
    if (!items().length) { main.innerHTML = `<p class="sv-alert">The checklist has no items for the ${esc(LEVEL[st.level] || st.level)} level yet.</p>`; return; }
    const list = shown();
    main.innerHTML = `<div class="sv-live-tools"><input type="search" data-q placeholder="Find an item (e.g. prompt, SD, BIP)" value="${esc(query)}" aria-label="Find an item">
        <button type="button" class="small-btn" data-undo${history.length ? '' : ' disabled'}>↶ Undo</button></div>
      <div class="sv-lrows">${list.length ? list.map(rowHtml).join('') : `<p class="muted">${view === 'recent' ? 'Items you tap appear here.' : 'Nothing matches.'}</p>`}</div>
      <p class="muted small">Counted items: ✓ correct / ✕ missed. The score shows after ${(rule || DEFAULT_RULE).min ?? 3} chances (${st.level === 'junior' ? 'Junior' : 'Senior / QCD'}: ${((rule || DEFAULT_RULE)[st.level] || DEFAULT_RULE.senior).slice().reverse().map((x, n) => `${x}%+ = ${3 - n}`).join(', ')}). Tap a score to set it by hand.</p>`;
    const qi = main.querySelector('[data-q]');
    qi.addEventListener('input', () => { query = qi.value; const pos = qi.selectionStart; paintMain(); const n = main.querySelector('[data-q]'); n.focus(); n.setSelectionRange(pos, pos); });
  };
  const paintRow = (k) => {
    const el = main.querySelector(`[data-row="${CSS.escape(k)}"]`);
    const i = flat().find((x) => x.key === k);
    if (el && i) el.outerHTML = rowHtml(i);
    const u = main.querySelector('[data-undo]'); if (u) u.disabled = !history.length;
    paintSide();
  };
  const paintAll = () => { if (reviewing) paintReview(); else { paintSide(); paintMain(); } };

  // review step: totals, every score, notes, save
  const paintReview = () => {
    const sc = finalScores();
    const { sec, total } = liveScore(body, st.level, sc);
    const all = flat();
    const missing = all.filter((i) => sc[i.key] === undefined).length;
    side.innerHTML = `<div class="sv-live-total"><span class="muted small">Total</span><span class="qr-v${total != null && total < LOW ? ' low' : ''}">${fmtScore(total)}</span></div>
      ${items().map((s) => `<div class="sv-secbtn"><span>${esc(shortTitle(s.title))}</span><span>${fmtScore(sec[s.key])}</span></div>`).join('')}`;
    main.innerHTML = `<h3>Review</h3>
      ${missing ? `<p class="sv-alert">${missing} item${missing === 1 ? '' : 's'} not scored (not counted in the total).</p>` : ''}
      <div class="sv-review">${items().map((s) => `<h4>${esc(shortTitle(s.title))}</h4><ul class="sv-items">${s.items.map((i) => {
        const v = sc[i.key]; const t = st.tallies[i.key];
        return `<li><span>${esc(i.text)}${t && t.n ? ` <span class="muted small">(${t.c}/${t.n})</span>` : ''}${st.manual.includes(i.key) ? ' <span class="muted small">· by hand</span>' : ''}</span><b class="sv-score s${esc(String(v ?? ''))}">${v === undefined ? '—' : v === 'na' ? 'N/A' : v}</b></li>`;
      }).join('')}</ul>`).join('')}</div>
      ${(body.notes || []).map((n) => `<label>${esc(n.label)}<textarea data-note="${esc(n.key)}" rows="2" maxlength="1500">${esc(st.notes[n.key] || '')}</textarea></label>`).join('')}
      <p class="muted small">Please use case codes only, never a child’s name.</p>
      <p class="error" data-msg hidden></p>
      <div class="dlg-actions"><button type="button" class="primary" data-save>${icon('check')} Save QCD</button><button type="button" data-unreview>Back to scoring</button></div>`;
    for (const t of main.querySelectorAll('[data-note]')) t.addEventListener('input', () => { st.notes[t.dataset.note] = t.value; save(); });
  };

  // events
  d.querySelector('.sv-live-head').addEventListener('input', (e) => {
    const f = e.target.dataset.f; if (!f) return;
    st[f] = e.target.value; save();
    if (f === 'level') paintAll();
  });
  side.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (!b || reviewing) return; view = b.dataset.view; query = ''; paintAll(); });
  main.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-t]');
    if (t) {
      snap(); const k = t.dataset.t; const cur = st.tallies[k] || { c: 0, n: 0 };
      st.tallies[k] = { c: cur.c + Number(t.dataset.c), n: cur.n + 1 };
      touch(k); save(); paintRow(k); return;
    }
    const r = e.target.closest('[data-r]');
    if (r) {
      snap(); const k = r.dataset.r; const v = r.dataset.v === 'na' ? 'na' : Number(r.dataset.v);
      if (st.scores[k] === v) delete st.scores[k]; else st.scores[k] = v;
      touch(k); save(); paintRow(k); return;
    }
    const pk = e.target.closest('[data-pick]');
    if (pk) { const h = main.querySelector(`[data-hand="${CSS.escape(pk.dataset.pick)}"]`); if (h) h.hidden = !h.hidden; return; }
    const hb = e.target.closest('[data-h]');
    if (hb) {
      snap(); const k = hb.closest('[data-hand]').dataset.hand; const v = hb.dataset.h;
      if (v === 'auto') { st.manual = st.manual.filter((x) => x !== k); delete st.scores[k]; }
      else if (v === 'clear') delete st.scores[k];
      else { st.scores[k] = v === 'na' ? 'na' : Number(v); if (!st.manual.includes(k)) st.manual.push(k); }
      touch(k); save(); paintRow(k); return;
    }
    if (e.target.closest('[data-undo]') && history.length) {
      Object.assign(st, JSON.parse(history.pop())); save(); paintAll(); return;
    }
    if (e.target.closest('[data-unreview]')) { reviewing = false; paintAll(); return; }
    if (e.target.closest('[data-save]')) {
      const msg = main.querySelector('[data-msg]'); const btn = e.target.closest('[data-save]');
      const sc = finalScores();
      const keys = new Set(flat().map((i) => i.key));
      const tallies = Object.fromEntries(Object.entries(st.tallies).filter(([k, v]) => keys.has(k) && v && v.n > 0 && modeOf(flat().find((i) => i.key === k)) === 'count'));
      const notes = Object.fromEntries(Object.entries(st.notes).map(([k, v]) => [k, String(v || '').trim()]).filter(([, v]) => v));
      btn.disabled = true;
      try {
        await api.save({ id: rec?.id, who: p.id, held_on: st.held_on, case_code: st.case_code, level: st.level, scores: sc, notes, tallies });
        clearTimeout(putTimer);
        dropDraft(p.id);
        if (!rec) await api.draftDelete(p.id).catch(() => {});
        await drawTeam();
        personDialog(people.find((x) => x.id === p.id) || p);
      } catch (err) { msg.textContent = err.message; msg.hidden = false; btn.disabled = false; }
    }
  });
  d.querySelector('[data-review]').addEventListener('click', () => { reviewing = true; paintAll(); });
  d.querySelector('[data-back]').addEventListener('click', () => {
    if (!rec && Object.keys(st.tallies).length + Object.keys(st.scores).length && !confirm('Leave this QCD for now? It stays as a draft only you can see, and you can continue it next time on any device.')) return;
    d.classList.remove('sv-full');
    if (rec) viewDialog(rec, { who: p, readOnly: false }); else personDialog(p);
  });
  paintAll();
}

// ---------------------------------------------------------------------------
// Checklist editor (supervisors + admin). Each save = a new version; old
// sessions keep the wording they were scored with.
// ---------------------------------------------------------------------------
async function formEditor(key = 'qcd') {
  let ef;
  try { ef = key === 'qcd' ? form : await api.form(key); } catch (e) { alert(e.message); return; }
  const body = JSON.parse(JSON.stringify(ef.body));
  const levels = key === 'qcd' ? qcdLevels(body) : (body.levels || []);
  const newKey = (prefix) => `${prefix}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 36).toString(36)}`;
  const d = openDlg('<div class="lh-form"></div>', true);
  const paint = () => {
    d.innerHTML = `<form class="lh-form sv-editor">
      <h2>Edit checklist: ${esc(ef.title)}</h2>
      <p class="muted small">Version ${ef.version}${ef.updated_by ? ` · last changed by ${esc(ef.updated_by)}` : ''}. Saving makes version ${ef.version + 1}; sessions already recorded keep the wording they were scored with.</p>
      ${body.rule ? `<fieldset class="sv-rule"><legend>Score rule for counted items (% correct)</legend>
        <label>At least <input type="number" min="1" max="20" data-rule="min" value="${esc(String(body.rule.min ?? 3))}"> chances before it scores</label>
        ${[['junior', 'Junior'], ['senior', 'Senior / QCD']].map(([lk, ll]) => `<div class="sv-rule-row"><b>${ll}</b>${[1, 2, 3].map((sc, n) => `<label>${sc} from <input type="number" min="0" max="100" data-rule="${lk}|${n}" value="${esc(String((body.rule[lk] || [])[n] ?? ''))}">%</label>`).join('')}</div>`).join('')}
      </fieldset>` : ''}
      ${body.sections.map((s, si) => `<fieldset class="sv-sec-edit"><legend><input class="sv-sec-title" data-sec-title="${si}" value="${esc(s.title)}" aria-label="Section title"></legend>
        ${s.items.map((i, ii) => `<div class="sv-ed-item">
          <textarea rows="2" data-text="${si}|${ii}" aria-label="Item wording">${esc(i.text)}</textarea>
          <div class="sv-ed-row">
            <input data-group="${si}|${ii}" value="${esc(i.group || '')}" placeholder="Group (optional)" aria-label="Group">
            ${levels.map((l) => `<label class="check small"><input type="checkbox" data-lvl="${si}|${ii}|${esc(l.key)}"${(i.levels || []).includes(l.key) ? ' checked' : ''}> ${esc(l.label)}</label>`).join('')}
            ${body.rule ? `<select data-mode="${si}|${ii}" aria-label="How it's scored"><option value="count"${(i.mode || 'count') === 'count' ? ' selected' : ''}>Counted ✓ / ✕</option><option value="rate"${i.mode === 'rate' ? ' selected' : ''}>Rated 0–3</option></select>` : ''}
            <span class="spacer"></span>
            <button type="button" class="small-btn" data-up="${si}|${ii}" aria-label="Move up"${ii === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" class="small-btn" data-rm="${si}|${ii}">Remove</button>
          </div></div>`).join('')}
        <p><button type="button" class="small-btn" data-add="${si}">${icon('plus')} Add an item</button>
          ${s.items.length ? '' : `<button type="button" class="small-btn" data-rm-sec="${si}">Remove this section</button>`}</p>
      </fieldset>`).join('')}
      <p><button type="button" class="small-btn" data-add-sec>${icon('plus')} Add a section</button></p>
      <p class="error" data-msg hidden></p>
      <div class="dlg-actions"><button type="submit" class="primary">${icon('check')} Save checklist</button><button type="button" data-cancel>Cancel</button></div>
    </form>`;
    const f = d.querySelector('form');
    const read = () => {   // keep typed text before repainting
      for (const el of f.querySelectorAll('[data-sec-title]')) body.sections[+el.dataset.secTitle].title = el.value;
      for (const el of f.querySelectorAll('[data-text]')) { const [a, b] = el.dataset.text.split('|').map(Number); body.sections[a].items[b].text = el.value; }
      for (const el of f.querySelectorAll('[data-group]')) { const [a, b] = el.dataset.group.split('|').map(Number); body.sections[a].items[b].group = el.value.trim(); }
      for (const s of body.sections) for (const i of s.items) i.levels = [];
      for (const el of f.querySelectorAll('[data-lvl]:checked')) { const [a, b, l] = el.dataset.lvl.split('|'); body.sections[+a].items[+b].levels.push(l); }
      for (const el of f.querySelectorAll('[data-mode]')) { const [a, b] = el.dataset.mode.split('|').map(Number); body.sections[a].items[b].mode = el.value; }
      for (const el of f.querySelectorAll('[data-rule]')) {
        const [k, n] = el.dataset.rule.split('|'); const v = Math.max(0, Math.min(k === 'min' ? 20 : 100, Math.round(Number(el.value) || 0)));
        if (k === 'min') body.rule.min = Math.max(1, v); else { body.rule[k] = [...(body.rule[k] || [0, 0, 0])]; body.rule[k][+n] = v; }
      }
    };
    f.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t || t.type === 'submit') return;
      read();
      if (t.dataset.add != null) body.sections[+t.dataset.add].items.push({ key: newKey('i'), text: '', group: '', levels: levels.map((l) => l.key), ...(body.rule ? { mode: 'count' } : {}) });
      else if (t.dataset.rm) { const [a, b] = t.dataset.rm.split('|').map(Number); body.sections[a].items.splice(b, 1); }
      else if (t.dataset.up) { const [a, b] = t.dataset.up.split('|').map(Number); const it = body.sections[a].items; [it[b - 1], it[b]] = [it[b], it[b - 1]]; }
      else if (t.dataset.rmSec != null) body.sections.splice(+t.dataset.rmSec, 1);
      else if (t.hasAttribute('data-add-sec')) body.sections.push({ key: newKey('s'), title: 'New section', items: [] });
      else if (t.hasAttribute('data-cancel')) { closeDlg(); return; }
      else return;
      paint();
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); read();
      const msg = d.querySelector('[data-msg]');
      const empty = body.sections.flatMap((s) => s.items).find((i) => i.text.trim().length < 3);
      if (empty) { msg.textContent = 'Each item needs its wording.'; msg.hidden = false; return; }
      if (body.sections.flatMap((s) => s.items).some((i) => !i.levels.length)) { msg.textContent = 'Tick at least one level for every item.'; msg.hidden = false; return; }
      if (body.rule && ['junior', 'senior'].some((k) => { const r = body.rule[k] || []; return !(r[0] <= r[1] && r[1] <= r[2]); })) { msg.textContent = 'In the score rule, 1 ≤ 2 ≤ 3 (e.g. 30, 50, 70).'; msg.hidden = false; return; }
      try {
        await api.saveForm(key, ef.title, body);
        if (key !== 'qcd') { yearlyBodies.clear(); closeDlg(); drawYearly(); return; }
        form = await api.form('qcd');
        versions.set(form.version, form.body);
        closeDlg();
        drawTeam();
      } catch (err) { msg.textContent = err.message; msg.hidden = false; }
    });
  };
  paint();
}

// ---------------------------------------------------------------------------
// Yearly review, step 1: the year-end self-reflection (Portal 050).
// Everyone writes one. Saved as you go (only you see a draft); Submit sends it
// to supervisors + admin. You can still improve it after submitting.
// ---------------------------------------------------------------------------
let selfForm = null;
const selfBodies = new Map();
async function selfBody(version = null) {
  if (version && selfBodies.has(version)) return selfBodies.get(version);
  const f = await api.form('self', version);
  if (!f) throw new Error('The year-end reflection isn’t set up yet (Portal 050).');
  selfBodies.set(f.version, f.body);
  if (!version) selfForm = f;
  return f.body;
}
const answered = (body, ans) => (body.parts || []).flatMap((pt) => pt.questions).filter((q) => String(ans?.[q.key] || '').trim()).length;
const totalQs = (body) => (body.parts || []).reduce((n, pt) => n + pt.questions.length, 0);
const whenText = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

async function drawMyYear() {
  const box = panelEl.querySelector('#sv-myyear');
  let r = null; let body; let rv = null;
  const evaluated = !!myLevel() || has('supervisor');   // office staff: reflection only
  try { [r, body, rv] = await Promise.all([api.reflection(ctx.me.id, year), selfBody(), evaluated ? api.myReview(year).catch(() => null) : null]); } catch (e) { box.innerHTML = `<section class="card"><p class="error">${esc(e.message)}</p></section>`; return; }
  if (r) body = await selfBody(r.form_version);
  const n = answered(body, r?.answers); const all = totalQs(body);
  const thisYear = Number(todayLocal().slice(0, 4));
  const canWrite = year === thisYear || year === thisYear - 1;
  const state = !r ? ['Not started', ''] : r.status === 'submitted' ? [`Submitted ${whenText(r.submitted_at)}`, 'ok'] : [`Draft · ${n} of ${all} answered`, 'warn'];
  box.innerHTML = `<section class="card sv-year">
    <div class="page-head sv-head"><h2>Yearly review ${year}</h2></div>
    <ol class="sv-steps">
      <li class="${r?.status === 'submitted' ? 'done' : 'now'}">
        <span class="sv-step-dot">${r?.status === 'submitted' ? icon('check') : '1'}</span>
        <span><strong>Year-end reflection</strong><br><span class="muted small">Your own look back at the year: ${all} short questions in 6 parts, Thai or English. Supervisors and admin read it once you submit.</span></span>
        <span class="sv-step-side"><span class="chip ${state[1]}">${esc(state[0])}</span>
          ${canWrite ? `<button type="button" class="${r?.status === 'submitted' ? 'small-btn' : 'small-btn primary'}" data-self>${!r ? 'Start' : r.status === 'submitted' ? 'View or edit' : 'Continue'}</button>`
            : r ? '<button type="button" class="small-btn" data-self>View</button>' : ''}</span>
      </li>
      ${evaluated ? await reviewSteps(rv) : ''}
    </ol>
  </section>`;
  box.querySelector('[data-self]')?.addEventListener('click', () => reflectionEditor(r, body, !canWrite));
  box.querySelectorAll('[data-myrev]').forEach((b) => b.addEventListener('click', () => myReviewDialog(rv, b.dataset.myrev)));
  box.querySelector('[data-sign]')?.addEventListener('click', async () => {
    const c = box.querySelector('[data-signnote]')?.value || '';
    if (!confirm('Sign your yearly review? This says you’ve seen your scores and agree with them.')) return;
    try { await api.sign(year, c); drawMyYear(); } catch (e) { alert(e.message); }
  });
}

function reflectionEditor(rec, body, readOnly = false) {
  const ans = { ...(rec?.answers || {}) };
  let submitted = rec?.status === 'submitted';
  let part = 0; let timer = null; let dirty = false;
  const d = openDlg(`<div class="sv-live">
    <div class="sv-live-head">
      <h2>${esc(body.title || 'Year-end reflection')} · ${year}</h2>
      <span class="spacer"></span>
      <span class="sv-draft small" data-saved></span>
      ${readOnly ? '' : `<button type="button" class="primary" data-submit>${submitted ? 'Save changes' : 'Submit'}</button>`}
      <button type="button" data-close>Close</button>
    </div>
    <div class="sv-live-body">
      <aside class="sv-live-side" data-side></aside>
      <section class="sv-live-main" data-main></section>
    </div></div>`, true);
  d.classList.add('sv-full');
  const side = d.querySelector('[data-side]'); const main = d.querySelector('[data-main]'); const st = d.querySelector('[data-saved]');
  const status = (txt, warn = false) => { st.innerHTML = txt; st.classList.toggle('sv-draft-warn', warn); };
  status(readOnly ? '' : submitted ? `${icon('check')} Submitted · supervisors and admin can read it` : `${icon('lock')} Draft · only you can see it until you submit`);
  const paintSide = () => {
    side.innerHTML = `${(body.parts || []).map((pt, i) => {
      const done = pt.questions.filter((q) => String(ans[q.key] || '').trim()).length;
      return `<button type="button" class="sv-secbtn${i === part ? ' on' : ''}" data-part="${i}"><span>${esc(pt.title)}</span><span>${done}/${pt.questions.length}</span></button>`;
    }).join('')}<div class="sv-live-total"><span class="muted small">Answered</span><span class="qr-v">${answered(body, ans)} / ${totalQs(body)}</span></div>`;
  };
  const paintMain = () => {
    const pt = body.parts[part];
    main.innerHTML = `${part === 0 && body.intro ? `<p class="muted">${esc(body.intro)}</p>` : ''}
      <h3>${esc(pt.title)}</h3>${pt.intro ? `<p class="muted small">${esc(pt.intro)}</p>` : ''}
      ${pt.questions.map((q) => `<label class="sv-q"><span>${esc(q.text)}</span>${q.hint ? `<span class="muted small">${esc(q.hint)}</span>` : ''}
        <textarea data-q="${esc(q.key)}" rows="4" maxlength="4000"${readOnly ? ' readonly' : ''}>${esc(ans[q.key] || '')}</textarea></label>`).join('')}
      <div class="dlg-actions">${part > 0 ? '<button type="button" data-prev>← Previous part</button>' : ''}
        ${part < body.parts.length - 1 ? '<button type="button" class="primary" data-next>Next part →</button>'
          : `<span class="muted small">${esc(body.thanks || '')}</span>`}</div>`;
  };
  const push = async (submit = false) => {
    if (readOnly) return;
    clearTimeout(timer);
    try {
      await api.saveReflection(year, ans, submit);
      dirty = false;
      if (submit) submitted = true;
      status(submitted ? `${icon('check')} ${submit ? 'Submitted' : 'Saved'} · supervisors and admin can read it` : `${icon('lock')} Draft saved · only you can see it until you submit`);
      return true;
    } catch (e) { status(`${icon('lock')} Not saved yet: ${esc(e.message)}`, true); return false; }
  };
  main.addEventListener('input', (e) => {
    const t = e.target.closest('[data-q]'); if (!t) return;
    ans[t.dataset.q] = t.value; dirty = true;
    status(`${icon('lock')} Saving…`);
    clearTimeout(timer); timer = setTimeout(() => push(false), 1500);
    paintSide();
  });
  main.addEventListener('click', (e) => {
    if (e.target.closest('[data-next]')) { part += 1; paintSide(); paintMain(); main.scrollTop = 0; }
    if (e.target.closest('[data-prev]')) { part -= 1; paintSide(); paintMain(); main.scrollTop = 0; }
  });
  side.addEventListener('click', (e) => { const b = e.target.closest('[data-part]'); if (!b) return; part = +b.dataset.part; paintSide(); paintMain(); main.scrollTop = 0; });
  d.querySelector('[data-submit]')?.addEventListener('click', async () => {
    if (!submitted && answered(body, ans) < totalQs(body) && !confirm(`You've answered ${answered(body, ans)} of ${totalQs(body)} questions. Submit anyway? You can still add to it later.`)) return;
    if (await push(true)) { d.classList.remove('sv-full'); closeDlg(); drawMyYear(); }
  });
  d.querySelector('[data-close]').addEventListener('click', async () => {
    if (dirty) await push(false);
    d.classList.remove('sv-full'); closeDlg(); drawMyYear();
  });
  paintSide(); paintMain();
}

// Team → Yearly review (supervisors + admin): reflection + admin evaluation progress.
let yearlyFilter = 'all';
let adminForm = null;
async function loadAdminForm() { adminForm = await api.form('admin_eval'); if (!adminForm) throw new Error('The admin evaluation isn’t set up yet (Portal 051).'); return adminForm; }
const myAdminSections = () => (adminForm?.body.sections || []).filter((sc) => sc.owner === ctx.me.id || has('manager')).map((sc) => sc.key);
const nowHalf = () => (Number(todayLocal().slice(5, 7)) <= 6 ? 1 : 2);

async function drawYearly() {
  const box = panelEl.querySelector('#sv-yearly');
  if (!box) return;
  let list = [];
  try { [list] = await Promise.all([api.yearlyPeople(year), adminForm ? null : loadAdminForm().catch(() => null)]); } catch (e) { box.innerHTML = `<section class="card"><p class="error">${esc(e.message)}</p></section>`; return; }
  const secs = adminForm?.body.sections || [];
  const nSec = secs.length || 3;
  const mine = myAdminSections();
  const owner = mine.length > 0 && has('admin');
  const active = list.filter((p) => !p.no_yearly);
  const evaluated = active.filter((p) => p.rank !== 'office');
  const sub = active.filter((p) => p.reflection === 'submitted').length;
  const groups = [['supervisor', 'Supervisors'], ['qcd', 'QCD'], ['senior', 'Senior'], ['therapist', 'Junior'], ['office', 'Office team']];
  const myClin = (p) => (p.lead_id === ctx.me.id && (!p.lead_done || (p.final_total == null && (p.second_done || !p.second_id))))
    || (p.second_id === ctx.me.id && !p.second_done && p.final_total == null);
  const keep = (p) => yearlyFilter === 'all' || (yearlyFilter === 'waiting' && p.reflection !== 'submitted')
    || (yearlyFilter === 'clinical' && myClin(p))
    || (yearlyFilter === 'admin' && p.rank !== 'office' && (p[`admin_h${nowHalf()}`] || 0) < nSec);
  const shown = active.filter(keep);
  const chip = (n) => `<span class="chip ${n >= nSec ? 'ok' : n ? 'warn' : ''}">${n}/${nSec}</span>`;
  box.innerHTML = `<section class="card">
    <div class="page-head sv-head"><h2>Yearly review · ${year}</h2><span class="spacer"></span>
      ${canEdit() ? '<button type="button" class="small-btn" data-edit-yearly>Edit yearly checklist</button>' : ''}
      ${has('admin') ? `<button type="button" class="small-btn" data-owners>${icon('settings')} Admin sections</button>` : ''}</div>
    <div class="sv-tools">
      <span class="muted small">Reflections <strong>${sub}</strong>/${active.length} · admin half ${nowHalf()} done for <strong>${evaluated.filter((p) => (p[`admin_h${nowHalf()}`] || 0) >= nSec).length}</strong>/${evaluated.length}</span><span class="spacer"></span>
      <div class="seg" role="tablist"><button type="button" role="tab" data-yf="all" aria-selected="${yearlyFilter === 'all'}">Everyone</button>
        <button type="button" role="tab" data-yf="waiting" aria-selected="${yearlyFilter === 'waiting'}">Reflection not in</button>
        ${owner || has('admin') ? `<button type="button" role="tab" data-yf="admin" aria-selected="${yearlyFilter === 'admin'}">Admin to score</button>` : ''}
        ${has('supervisor') ? `<button type="button" role="tab" data-yf="clinical" aria-selected="${yearlyFilter === 'clinical'}">Clinical for me${active.filter(myClin).length ? ` <span class="chip warn">${active.filter(myClin).length}</span>` : ''}</button>` : ''}</div>
    </div>
    ${owner ? `<p class="muted small">You score: <strong>${esc(secs.filter((sc) => mine.includes(sc.key)).map((sc) => sc.title).join(', ') || '—')}</strong>. Open a person → Admin evaluation.</p>` : ''}
    <ul class="sv-people">${groups.map(([k, label]) => {
      const g = shown.filter((p) => p.rank === k).sort(byName);
      return g.length ? `<li class="sv-grouphead">${esc(label)} <span class="muted small">${g.length}</span></li>${g.map((p) => `
        <li><button type="button" class="sv-person" data-yp="${esc(p.id)}">
          <span class="sv-name"><strong>${esc(nameOf(p))}</strong></span>
          <span class="muted small">Reflection: ${p.reflection === 'submitted' ? `submitted ${esc(whenText(p.submitted_at))}` : p.reflection === 'started' ? 'draft' : 'not started'}${p.rank !== 'office' ? ` · admin half 1 ${p.admin_h1 || 0}/${nSec} · half 2 ${p.admin_h2 || 0}/${nSec}` : ''}
            ${p.rank !== 'office' ? `<br>Clinical: ${p.final_total != null ? `final <b>${fmtScore(p.final_total)}</b>${p.ioa != null ? ` · IOA ${Number(p.ioa)}%` : ''}`
              : p.lead_id ? `lead ${esc(p.lead || '')} ${p.lead_done ? '✓' : '…'}${p.second_id ? ` · second ${esc(p.second || '')} ${p.second_done ? '✓' : '…'}` : ''}` : 'evaluators not assigned'}${myClin(p) ? ' · <b>waiting for you</b>' : ''}
              · shown: mid ${p.release_mid_at ? '✓' : '—'} · year-end ${p.release_end_at ? '✓' : '—'}${p.signed_at ? ` · <b>signed ${esc(whenText(p.signed_at))}</b>` : ''}` : ''}</span>
          ${p.rank !== 'office' ? chip(p[`admin_h${nowHalf()}`] || 0) : `<span class="chip ${p.reflection === 'submitted' ? 'ok' : ''}">${p.reflection === 'submitted' ? 'Reflection in' : '—'}</span>`}
        </button></li>`).join('')}` : '';
    }).join('') || '<li class="muted">Nobody here.</li>'}
    ${list.some((p) => p.no_yearly) ? `<li class="sv-grouphead">No yearly review <span class="muted small">${list.filter((p) => p.no_yearly).length}</span></li>
      ${list.filter((p) => p.no_yearly).sort(byName).map((p) => `<li><button type="button" class="sv-person sv-off" data-yp="${esc(p.id)}"><span class="sv-name"><strong>${esc(nameOf(p))}</strong></span><span class="muted small">Not reviewed</span><span></span></button></li>`).join('')}` : ''}
    </ul>
    <p class="muted small">The person sees admin and clinical scores only when the review is released at the end of the year. Reflection drafts stay private.</p>
  </section>`;
  box.querySelectorAll('[data-yf]').forEach((b) => b.addEventListener('click', () => { yearlyFilter = b.dataset.yf; drawYearly(); }));
  box.querySelectorAll('[data-yp]').forEach((b) => b.addEventListener('click', () => yearlyPerson(list.find((p) => p.id === b.dataset.yp))));
  box.querySelector('[data-owners]')?.addEventListener('click', ownersDialog);
  box.querySelector('[data-edit-yearly]')?.addEventListener('click', () => formEditor('yearly_clinical'));
}

// One person's yearly review: Reflection | Admin evaluation.
async function yearlyPerson(p, tab = null) {
  tab = tab || ((p.lead_id === ctx.me.id || p.second_id === ctx.me.id) ? 'clinical' : myAdminSections().length && p.rank !== 'office' ? 'admin' : 'reflection');
  const d = openDlg(`<div class="lh-form"><h2>${esc(nameOf(p))}</h2><p class="muted">Loading…</p></div>`, true);
  const head = `<h2>${esc(nameOf(p))} · yearly review ${year}</h2>
    ${has('admin') ? `<label class="check small"><input type="checkbox" data-noyearly${p.no_yearly ? ' checked' : ''}> No yearly review for this person (e.g. not evaluated by anyone)</label>` : ''}
    ${p.rank !== 'office' && !p.no_yearly && (has('admin') || p.lead_id === ctx.me.id) ? `<div class="sv-release">
      <span><b>Shown to ${esc(nameOf(p))}:</b> mid-year ${p.release_mid_at ? `✓ ${esc(whenText(p.release_mid_at))}` : 'hidden'} · year-end ${p.release_end_at ? `✓ ${esc(whenText(p.release_end_at))}` : 'hidden'}${p.signed_at ? ` · <b>signed ${esc(whenText(p.signed_at))}</b>` : ''}</span>
      <span class="spacer"></span>
      ${p.signed_at ? '' : `<button type="button" class="small-btn" data-rel="mid|${p.release_mid_at ? 0 : 1}">${p.release_mid_at ? 'Hide mid-year' : 'Show mid-year'}</button>
      <button type="button" class="small-btn ${p.release_end_at ? '' : 'primary'}" data-rel="end|${p.release_end_at ? 0 : 1}">${p.release_end_at ? 'Hide year-end' : 'Show year-end'}</button>`}</div>` : ''}
    <div class="seg" role="tablist" style="margin:6px 0 10px"><button type="button" role="tab" data-yt="reflection" aria-selected="${tab === 'reflection'}">Reflection</button>
      ${p.rank !== 'office' ? `<button type="button" role="tab" data-yt="admin" aria-selected="${tab === 'admin'}">Admin evaluation</button>
        <button type="button" role="tab" data-yt="clinical" aria-selected="${tab === 'clinical'}">Clinical</button>` : ''}</div>`;
  const wire = () => {
    d.querySelectorAll('[data-yt]').forEach((b) => b.addEventListener('click', () => yearlyPerson(p, b.dataset.yt)));
    d.querySelector('[data-noyearly]')?.addEventListener('change', async (e) => {
      try { await api.setNoYearly(p.id, e.target.checked); p.no_yearly = e.target.checked; drawYearly(); } catch (err) { alert(err.message); e.target.checked = !e.target.checked; }
    });
    d.querySelector('[data-close]')?.addEventListener('click', closeDlg);
    d.querySelectorAll('[data-rel]').forEach((b) => b.addEventListener('click', async () => {
      const [which, on] = b.dataset.rel.split('|'); const show = on === '1';
      if (show && !confirm(`Show the ${which === 'mid' ? 'mid-year' : 'year-end'} review to ${nameOf(p)} now? They'll see their ${which === 'mid' ? 'admin evaluation (half 1)' : 'clinical and admin scores and the final score, and can sign'}.`)) return;
      try { await api.release(p.id, year, which, show); p[`release_${which}_at`] = show ? new Date().toISOString() : null; drawYearly(); yearlyPerson(p, tab); }
      catch (err) { alert(err.message); }
    }));
  };
  if (tab === 'reflection') {
    let r = null; let body;
    try { r = await api.reflection(p.id, year); body = await selfBody(r?.form_version); } catch (e) { d.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
    d.innerHTML = `<div class="lh-form sv-read">${head}
      ${!r ? `<p class="muted">${p.reflection === 'started' ? 'Started but not submitted yet (drafts are private).' : 'Not started yet.'}</p>` : `
      <p class="muted small">Submitted ${esc(whenText(r.submitted_at))}${r.updated_at && r.updated_at !== r.submitted_at ? ` · last changed ${esc(whenText(r.updated_at))}` : ''}</p>
      ${(body.parts || []).map((pt) => `<h3>${esc(pt.title)}</h3>${pt.questions.map((q) => `<div class="sv-ans"><p class="sv-ans-q">${esc(q.text)}</p>
        <p class="sv-ans-a">${String(r.answers?.[q.key] || '').trim() ? esc(r.answers[q.key]).replace(/\n/g, '<br>') : '<span class="muted">No answer</span>'}</p></div>`).join('')}`).join('')}`}
      <div class="dlg-actions"><button type="button" data-close>Close</button></div></div>`;
    wire(); return;
  }
  if (tab === 'clinical') { await clinicalTab(d, p, head, wire); return; }
  // admin evaluation
  let evals = []; let form;
  try { [evals, form] = await Promise.all([api.adminGet(p.id, year), adminForm || loadAdminForm()]); } catch (e) { d.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  let half = p._half || nowHalf();
  const paint = async () => {
    const body = form.body; const scale = body.scale;
    const rows = evals.filter((e) => e.half === half);
    const avgs = body.sections.map((sc) => rows.find((e) => e.section === sc.key)?.average).filter((v) => v != null).map(Number);
    const hrPerf = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
    const mineKeys = myAdminSections();
    d.innerHTML = `<div class="lh-form">${head}
      <div class="sv-tools"><div class="seg" role="tablist">${[1, 2].map((h) => `<button type="button" role="tab" data-half="${h}" aria-selected="${half === h}">Half ${h} <span class="muted small">${h === 1 ? 'Jan–Jun' : 'Jul–Dec'}</span></button>`).join('')}</div>
        <span class="spacer"></span><span>HR performance <span class="sv-total${hrPerf != null && hrPerf < LOW ? ' low' : ''}">${fmtScore(hrPerf)}</span> <span class="muted small">(${avgs.length}/${body.sections.length} sections)</span></span></div>
      <details class="sv-scale"><summary class="small">Scale 0–3: what each score means</summary><ul class="small">${scale.labels.map((l) => `<li><b>${l.v}</b> ${esc(l.label)}</li>`).join('')}</ul></details>
      ${body.sections.map((sc) => {
        const e = rows.find((x) => x.section === sc.key);
        const can = mineKeys.includes(sc.key) && p.id !== ctx.me.id && !p.no_yearly;
        const val = (k) => e?.scores?.[k];
        return `<fieldset class="sv-sec-edit sv-adm" data-sec="${esc(sc.key)}"><legend>${esc(sc.title)} <span class="muted small">· ${esc(sc.owner_name || 'no owner set')}</span>
            <span class="sv-total small">${fmtScore(e?.average)}</span></legend>
          ${sc.items.map((it) => `<div class="sv-item"><span>${esc(it.text)}${it.note ? `<br><span class="muted small">${esc(it.note)}</span>` : ''}</span>
            ${can ? `<span class="sv-pick">${[0, 1, 2, 3].map((v) => `<button type="button" data-k="${esc(it.key)}" data-v="${v}" aria-pressed="${val(it.key) === v}">${v}</button>`).join('')}<button type="button" data-k="${esc(it.key)}" data-v="na" aria-pressed="${val(it.key) === 'na'}">N/A</button></span>`
              : `<b class="sv-score s${esc(String(val(it.key) ?? ''))}">${val(it.key) === undefined ? '—' : val(it.key) === 'na' ? 'N/A' : val(it.key)}</b>`}</div>`).join('')}
          ${can ? `<label class="small">Comment <span class="muted">(optional)</span><textarea data-note rows="2" maxlength="1500">${esc(e?.note || '')}</textarea></label>
            <p class="row-actions"><span class="muted small" data-msg>${e ? `Scored ${esc(whenText(e.scored_at))} by ${esc(e.scorer || '')}` : 'Not scored yet'}</span><span class="spacer"></span><button type="button" class="small-btn primary" data-savesec>${icon('check')} Save ${esc(sc.title)}</button></p>`
            : `${e?.note ? `<p class="small"><strong>Comment:</strong> ${esc(e.note)}</p>` : ''}<p class="muted small">${e ? `Scored ${esc(whenText(e.scored_at))} by ${esc(e.scorer || '')}` : 'Not scored yet'}</p>`}
        </fieldset>`;
      }).join('')}
      <div class="sv-attend" data-attend><p class="muted small">Attendance…</p></div>
      <div class="dlg-actions"><button type="button" data-close>Close</button></div></div>`;
    wire();
    d.querySelectorAll('[data-half]').forEach((b) => b.addEventListener('click', () => { half = +b.dataset.half; p._half = half; paint(); }));
    for (const fs of d.querySelectorAll('.sv-adm')) {
      const key = fs.dataset.sec; const e = rows.find((x) => x.section === key);
      const sc = { ...(e?.scores || {}) };
      fs.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-k]');
        if (b) {
          const v = b.dataset.v === 'na' ? 'na' : Number(b.dataset.v);
          if (sc[b.dataset.k] === v) delete sc[b.dataset.k]; else sc[b.dataset.k] = v;
          fs.querySelectorAll(`[data-k="${CSS.escape(b.dataset.k)}"]`).forEach((x) => x.setAttribute('aria-pressed', String(sc[b.dataset.k] !== undefined && String(sc[b.dataset.k]) === x.dataset.v)));
          return;
        }
        if (ev.target.closest('[data-savesec]')) {
          const msg = fs.querySelector('[data-msg]');
          try {
            await api.adminSave(p.id, year, half, key, sc, fs.querySelector('[data-note]')?.value || '');
            evals = await api.adminGet(p.id, year); drawYearly(); paint();
          } catch (err) { msg.textContent = err.message; msg.classList.add('error'); }
        }
      });
    }
    // attendance from Leave & HR (Admin / HR only)
    const att = d.querySelector('[data-attend]');
    const leaveTeam = has('hr') || (has('admin') && !has('manager'));
    if (!leaveTeam) { att.innerHTML = '<p class="muted small">Attendance (from Leave & HR) is shown to Admin and HR.</p>'; return; }
    try {
      const from = `${year}-${half === 1 ? '01-01' : '07-01'}`; const to = `${year}-${half === 1 ? '06-30' : '12-31'}`;
      const [taken, ent] = await Promise.all([api.leaveTaken(p.id, from, to), api.alDays(p.id, year)]);
      const sum = (codes) => taken.filter((x) => codes.includes(x.type)).reduce((n, x) => n + Number(x.days), 0);
      const fmt = (n) => String(Math.round(n * 10) / 10);
      att.innerHTML = `<h3>Attendance · half ${half} <span class="muted small">(${esc(fmtDate(from))} – ${esc(fmtDate(to))}, approved leave, from Leave & HR)</span></h3>
        <div class="sv-attgrid">${[['Annual leave allowance (year)', ent?.al_days != null ? String(Number(ent.al_days)) : '—'], ['Annual leave', fmt(sum(['AL']))], ['Personal leave', fmt(sum(['PL']))],
          ['Sick leave', fmt(sum(['SL']))], ['Leave without pay', fmt(sum(['LWP']))], ['Other leave', fmt(sum(['OL', 'BL']))]]
          .map(([l, v]) => `<div><span class="muted small">${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div>
        <p class="muted small">Days. Shown for the discussion; not part of the score.</p>`;
    } catch (e) { att.innerHTML = `<p class="muted small">Attendance couldn't load: ${esc(e.message)}</p>`; }
  };
  paint();
}

// Admin: who scores each section.
async function ownersDialog() {
  let form; let staff = [];
  try { form = await loadAdminForm(); staff = await import('../data.js').then((m) => m.listStaff()); } catch (e) { alert(e.message); return; }
  const office = staff.filter((x) => x.status !== 'exited' && (x.roles || []).some((r) => ['admin', 'hr', 'manager'].includes(r)));
  const d = openDlg(`<form class="lh-form"><h2>Admin evaluation sections</h2>
    <p class="muted small">Each section is scored only by its owner (the Portal manager can cover any section).</p>
    ${form.body.sections.map((sc) => `<label>${esc(sc.title)}<select data-owner="${esc(sc.key)}"><option value="">Nobody yet</option>
      ${office.map((x) => `<option value="${esc(x.id)}"${x.id === sc.owner ? ' selected' : ''}>${esc(x.nickname || x.full_name)}</option>`).join('')}</select></label>`).join('')}
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="submit" class="primary">${icon('check')} Save</button><button type="button" data-close>Cancel</button></div></form>`);
  d.querySelector('[data-close]').addEventListener('click', closeDlg);
  d.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const owners = Object.fromEntries([...d.querySelectorAll('[data-owner]')].map((x) => [x.dataset.owner, x.value]));
    try { await api.adminOwners(owners); await loadAdminForm(); closeDlg(); drawYearly(); } catch (err) { const m = d.querySelector('[data-msg]'); m.textContent = err.message; m.hidden = false; }
  });
}

// ---------------------------------------------------------------------------
// Yearly review, step 3: clinical checklist with IOA (Portal 052).
// Admin assigns a lead + second supervisor (and review dates). Each scores on
// their own; after submitting they can compare; the lead sets the final.
// ---------------------------------------------------------------------------
const yearlyBodies = new Map();
async function yearlyBody(version = null) {
  if (version && yearlyBodies.has(version)) return yearlyBodies.get(version);
  const f = await api.form('yearly_clinical', version);
  if (!f) throw new Error('The yearly clinical checklist isn’t set up yet (Portal 052).');
  yearlyBodies.set(f.version, f.body);
  return f.body;
}
const lvlOfRank = (r) => ({ therapist: 'junior', senior: 'senior', qcd: 'senior', supervisor: 'supervisor' })[r] || 'junior';
const scoreTxt = (v) => (v === undefined || v === null ? '—' : v === 'na' ? 'N/A' : String(v));
const dtLocal = (iso) => { if (!iso) return ''; const t = new Date(iso); const z = (n) => String(n).padStart(2, '0'); return `${t.getFullYear()}-${z(t.getMonth() + 1)}-${z(t.getDate())}T${z(t.getHours())}:${z(t.getMinutes())}`; };
const dtText = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'not set');

// Item summary from the QCD tallies of the year: correct / chances per item.
function tallySummaryHtml(list) {
  const body = form?.body; if (!body) return '';
  const rule = body.rule || DEFAULT_RULE;
  const agg = {};
  for (const r of list) {
    for (const [k, t] of Object.entries(r.tallies || {})) { agg[k] = agg[k] || { c: 0, n: 0, sc: [] }; agg[k].c += t.c; agg[k].n += t.n; }
    for (const [k, v] of Object.entries(r.scores || {})) if (typeof v === 'number') { agg[k] = agg[k] || { c: 0, n: 0, sc: [] }; agg[k].sc.push(v); }
  }
  const level = list[0]?.level || 'junior';
  const th = rule[level] || rule.senior;
  const items = (body.sections || []).flatMap((sc) => sc.items.map((i) => ({ ...i, sec: sc }))).filter((i) => agg[i.key]);
  if (!items.length) return '<p class="muted small">No QCD scores this year yet.</p>';
  return `<table class="sv-tsum"><thead><tr><th>Item</th><th>All tallies</th><th>Score from the data</th><th>Average of sessions</th></tr></thead><tbody>
    ${items.map((i) => {
      const a = agg[i.key]; const pct = a.n ? Math.round((a.c / a.n) * 100) : null;
      const ds = a.n >= (rule.min ?? 3) ? (pct >= th[2] ? 3 : pct >= th[1] ? 2 : pct >= th[0] ? 1 : 0) : null;
      const av = a.sc.length ? a.sc.reduce((x, y) => x + y, 0) / a.sc.length : null;
      return `<tr><td>${esc(i.text)}</td><td>${a.n ? `${a.c}/${a.n} · ${pct}%` : '—'}</td>
        <td>${ds == null ? '<span class="muted">—</span>' : `<span class="qr-c v${band(ds)}">${ds}</span>`}</td><td>${av == null ? '—' : av.toFixed(1)}</td></tr>`;
    }).join('')}</tbody></table>`;
}

async function clinicalTab(d, p, head, wire) {
  let g; let body; let qcdList = [];
  try {
    [g, body, qcdList] = await Promise.all([api.clinicalGet(p.id, year), yearlyBody(), p.rank !== 'supervisor' ? api.records(p.id, year).catch(() => []) : []]);
  } catch (e) { d.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  g = g || { entries: [] };
  const entry = (r) => (g.entries || []).find((e) => e.role === r);
  const role = g.my_role;
  const mine = role ? entry(role) : null;
  const lead = entry('lead'); const second = entry('second'); const fin = entry('final');
  if (mine?.form_version) body = await yearlyBody(mine.form_version);
  else if (lead?.form_version) body = await yearlyBody(lead.form_version);
  let level = mine?.level || lead?.level || lvlOfRank(p.rank);
  const secs = () => itemsFor(body, level);
  const keys = () => secs().flatMap((sc) => sc.items.map((i) => i.key));
  const pick = (k, v, cur) => `<button type="button" data-k="${esc(k)}" data-v="${v}" aria-pressed="${cur === v}">${v === 'na' ? 'N/A' : v}</button>`;

  // 1. who + when
  const assignBox = `<div class="sv-assign">
    <div><span class="muted small">Lead supervisor</span><b>${esc(g.lead || 'not assigned')}</b></div>
    <div><span class="muted small">Second supervisor</span><b>${esc(g.second || (g.lead ? 'none' : 'not assigned'))}</b></div>
    <div><span class="muted small">Mid-year review</span><b>${esc(dtText(g.mid_review_at))}</b></div>
    <div><span class="muted small">Year-end review</span><b>${esc(dtText(g.end_review_at))}</b></div>
    ${has('admin') ? '<button type="button" class="small-btn" data-assign>Assign / change</button>' : ''}</div>`;
  // 2. reference: the year's QCD sessions + tally summary
  const ref = p.rank === 'supervisor' ? '' : `<details class="sv-refbox"><summary>QCD sessions this year (${qcdList.length})</summary>${qcdList.length ? await resultsHtml(qcdList) : '<p class="muted small">None yet.</p>'}</details>
    <details class="sv-refbox"><summary>QCD item summary: all tallies added up</summary>${tallySummaryHtml(qcdList)}</details>`;

  // 3. scoring
  let main = '';
  const mySc = { ...(mine?.scores || {}) }; const myNotes = { ...(mine?.notes || {}) };
  const canScore = role && !fin && secs().length;
  if (!secs().length) main = `<p class="sv-alert">The yearly checklist has no items for the ${esc(LEVEL[level] || level)} level yet${level === 'supervisor' ? ' (Chandni’s supervisor checklist)' : ''}. A supervisor can add them in Edit checklist.</p>`;
  else if (canScore) {
    main = `<h3>Your scores <span class="muted small">(${role === 'lead' ? 'lead' : 'second'} supervisor${mine?.submitted_at ? ` · submitted ${esc(whenText(mine.submitted_at))}` : ' · only you can see them until you submit'})</span></h3>
      <p class="muted small">Level: <b>${esc(LEVEL[level] || level)}</b> (from their rank)</p>
      <div data-mine>${secs().map((sc) => `<fieldset class="sv-sec-edit"><legend>${esc(sc.title)}</legend>${sc.items.map((i) => `<div class="sv-item"><span>${esc(i.text)}</span>
        <span class="sv-pick">${[0, 1, 2, 3, 'na'].map((v) => pick(i.key, v, mySc[i.key])).join('')}</span></div>`).join('')}</fieldset>`).join('')}</div>
      ${(body.notes || []).map((n) => `<label>${esc(n.label)}<textarea data-mynote="${esc(n.key)}" rows="2" maxlength="1500">${esc(myNotes[n.key] || '')}</textarea></label>`).join('')}
      <p class="row-actions"><span class="muted small" data-mymsg></span><span class="spacer"></span>
        <button type="button" class="small-btn" data-mysave>Save draft</button><button type="button" class="small-btn primary" data-mysubmit>${mine?.submitted_at ? 'Update my submitted scores' : 'Submit my scores'}</button></p>`;
  }
  // 4. compare + final (the lead), or the final
  const vis = (e) => e && !e.hidden && e.scores;
  const compareRows = () => secs().map((sc) => `<tr class="sv-csec"><td colspan="4">${esc(sc.title)}</td></tr>${sc.items.map((i) => {
    const a = vis(lead) ? lead.scores[i.key] : undefined; const b = vis(second) ? second.scores[i.key] : undefined;
    const dis = a !== undefined && b !== undefined && a !== b;
    return `<tr class="${dis ? 'sv-dis' : ''}" data-row="${esc(i.key)}"><td>${esc(i.text)}${dis ? ' <span class="chip warn">differ</span>' : ''}</td><td>${scoreTxt(a)}</td><td>${scoreTxt(b)}</td><td data-fcell="${esc(i.key)}"></td></tr>`;
  }).join('')}`).join('');
  const ioaOf = () => {
    if (!vis(lead) || !vis(second)) return null;
    const both = keys().filter((k) => k in lead.scores && k in second.scores);
    return both.length ? Math.round((both.filter((k) => lead.scores[k] === second.scores[k]).length / both.length) * 1000) / 10 : null;
  };
  const leadCanFinal = role === 'lead' && lead?.submitted_at;
  const finScores = { ...(fin?.scores || {}) };
  if (!fin && leadCanFinal) for (const k of keys()) {         // start from agreement / the one score there is
    const a = lead.scores?.[k]; const b = vis(second) ? second.scores[k] : undefined;
    if (a !== undefined && (b === undefined || a === b)) finScores[k] = a; else if (a === undefined && b !== undefined) finScores[k] = b;
  }
  let compare = '';
  if (fin || leadCanFinal || (role === 'second' && vis(lead) && vis(second))) {
    const ioa = fin?.ioa ?? ioaOf();
    compare = `<h3>${fin ? 'Final clinical scores' : 'Compare and set the final'} ${ioa != null ? `<span class="chip">IOA ${ioa}%</span>` : '<span class="muted small">(IOA needs both scores)</span>'}</h3>
      ${!fin && role === 'lead' ? `<p class="muted small">Where you agree, the final is filled in. Talk through the items that <b>differ</b>, then tap the final score. ${vis(second) ? '' : 'The second supervisor hasn’t submitted; you can still set the final from your own scores.'}</p>` : ''}
      <table class="sv-compare"><thead><tr><th>Item</th><th>Lead${g.lead ? `<br><span class="muted small">${esc(g.lead)}</span>` : ''}</th><th>Second${g.second ? `<br><span class="muted small">${esc(g.second)}</span>` : ''}</th><th>Final</th></tr></thead>
        <tbody>${compareRows()}</tbody></table>
      ${fin ? `<p>Clinical score <span class="sv-total${Number(fin.total) < LOW ? ' low' : ''}">${fmtScore(fin.total)}</span> <span class="muted small">· set ${esc(whenText(fin.submitted_at))} by ${esc(fin.scorer || '')}</span></p>
        ${(body.notes || []).map((n) => (fin.notes?.[n.key] ? `<p class="small"><strong>${esc(n.label)}:</strong> ${esc(fin.notes[n.key])}</p>` : '')).join('')}` : ''}
      ${!fin && role === 'lead' ? `${(body.notes || []).map((n) => `<label>${esc(n.label)} <span class="muted small">(final)</span><textarea data-fnote="${esc(n.key)}" rows="2" maxlength="1500">${esc(lead?.notes?.[n.key] || '')}</textarea></label>`).join('')}
        <p class="row-actions"><span class="muted small" data-fmsg></span><span class="spacer"></span><span>Final <span class="sv-total" data-ftotal>—</span></span>
        <button type="button" class="small-btn primary" data-final>${icon('check')} Save final scores</button></p>` : ''}`;
  } else if (!role && (lead || second)) {
    compare = `<p class="muted">Lead ${lead?.submitted_at ? 'submitted ✓' : 'not yet'} · second ${second?.submitted_at ? 'submitted ✓' : g.second ? 'not yet' : '—'}. Scores show here once the lead sets the final.</p>`;
  } else if (role === 'second' && mine?.submitted_at && !vis(lead)) {
    compare = '<p class="muted small">You’ll see the lead’s scores side by side once they submit too.</p>';
  }

  d.innerHTML = `<div class="lh-form">${head}${assignBox}<div data-assignform></div>${ref}${main}${compare}
    <div class="dlg-actions"><button type="button" data-close>Close</button></div></div>`;
  wire();

  // final cells (lead edits, others read)
  const paintFinal = () => {
    for (const td of d.querySelectorAll('[data-fcell]')) {
      const k = td.dataset.fcell;
      td.innerHTML = !fin && role === 'lead' ? `<span class="sv-pick">${[0, 1, 2, 3, 'na'].map((v) => `<button type="button" data-fk="${esc(k)}" data-fv="${v}" aria-pressed="${finScores[k] === v}">${v === 'na' ? 'N/A' : v}</button>`).join('')}</span>`
        : `<b class="sv-score s${esc(String(finScores[k] ?? ''))}">${scoreTxt(finScores[k])}</b>`;
    }
    const t = d.querySelector('[data-ftotal]'); if (t) { const { total } = liveScore(body, level, finScores); t.textContent = fmtScore(total); }
  };
  paintFinal();
  d.querySelector('.sv-compare')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fk]'); if (!b) return;
    const v = b.dataset.fv === 'na' ? 'na' : Number(b.dataset.fv);
    if (finScores[b.dataset.fk] === v) delete finScores[b.dataset.fk]; else finScores[b.dataset.fk] = v;
    paintFinal();
  });
  d.querySelector('[data-final]')?.addEventListener('click', async (e) => {
    const unset = keys().filter((k) => finScores[k] === undefined).length;
    if (unset && !confirm(`${unset} item(s) have no final score (they won't count). Save the final anyway?`)) return;
    const notes = Object.fromEntries([...d.querySelectorAll('[data-fnote]')].map((t) => [t.dataset.fnote, t.value.trim()]).filter(([, v]) => v));
    e.target.disabled = true;
    try { await api.clinicalFinal(p.id, year, finScores, notes); drawYearly(); yearlyPerson(p, 'clinical'); }
    catch (err) { d.querySelector('[data-fmsg]').textContent = err.message; e.target.disabled = false; }
  });
  // my scores
  const mineBox = d.querySelector('[data-mine]');
  mineBox?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    const v = b.dataset.v === 'na' ? 'na' : Number(b.dataset.v);
    if (mySc[b.dataset.k] === v) delete mySc[b.dataset.k]; else mySc[b.dataset.k] = v;
    mineBox.querySelectorAll(`[data-k="${CSS.escape(b.dataset.k)}"]`).forEach((x) => x.setAttribute('aria-pressed', String(mySc[b.dataset.k] !== undefined && String(mySc[b.dataset.k]) === x.dataset.v)));
  });
  const saveMine = async (submit) => {
    const notes = Object.fromEntries([...d.querySelectorAll('[data-mynote]')].map((t) => [t.dataset.mynote, t.value.trim()]).filter(([, v]) => v));
    const n = keys().filter((k) => mySc[k] !== undefined).length;
    if (submit && n < keys().length && !confirm(`You've scored ${n} of ${keys().length} items (N/A counts as scored). Submit anyway?`)) return;
    try { await api.clinicalSave(p.id, year, level, mySc, notes, submit); drawYearly(); yearlyPerson(p, 'clinical'); }
    catch (err) { d.querySelector('[data-mymsg]').textContent = err.message; }
  };
  d.querySelector('[data-mysave]')?.addEventListener('click', () => saveMine(false));
  d.querySelector('[data-mysubmit]')?.addEventListener('click', () => saveMine(true));
  // assign (admin)
  d.querySelector('[data-assign]')?.addEventListener('click', async () => {
    const box = d.querySelector('[data-assignform]');
    let staff = [];
    try { staff = await import('../data.js').then((m) => m.listStaff()); } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
    const sups = staff.filter((x) => x.status !== 'exited' && (x.roles || []).includes('supervisor') && x.id !== p.id);
    const opt = (sel) => `<option value="">${sel === undefined ? '—' : 'None'}</option>${sups.map((x) => `<option value="${esc(x.id)}"${x.id === sel ? ' selected' : ''}>${esc(x.nickname || x.full_name)}</option>`).join('')}`;
    box.innerHTML = `<form class="sv-assignform">
      <label>Lead supervisor<select name="lead">${opt(g.lead_id)}</select></label>
      <label>Second supervisor<select name="second">${opt(g.second_id)}</select></label>
      <label>Mid-year review<input type="datetime-local" name="mid" value="${esc(dtLocal(g.mid_review_at))}"></label>
      <label>Year-end review<input type="datetime-local" name="end" value="${esc(dtLocal(g.end_review_at))}"></label>
      <p class="muted small">The lead also runs the review meetings (with an admin). Dates can be added later.</p>
      <p class="row-actions"><span class="error small" data-amsg></span><span class="spacer"></span><button type="submit" class="small-btn primary">${icon('check')} Save</button></p></form>`;
    box.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = ev.target;
      const iso = (v) => (v ? new Date(v).toISOString() : null);
      try { await api.assign(p.id, year, f.lead.value, f.second.value, iso(f.mid.value), iso(f.end.value)); drawYearly(); yearlyPerson(p, 'clinical'); }
      catch (err) { box.querySelector('[data-amsg]').textContent = err.message; }
    });
  });
}


// ---------------------------------------------------------------------------
// Yearly review, step 4: what the person sees once it's shown (Portal 053).
// ---------------------------------------------------------------------------
async function reviewNumbers(rv) {
  const af = rv?.admin?.length ? await api.form('admin_eval', rv.admin[0].form_version).catch(() => null) : null;
  const half = (h) => { const xs = (rv?.admin || []).filter((e) => e.half === h && e.average != null).map((e) => Number(e.average)); return xs.length ? mean(xs) : null; };
  const h1 = half(1); const h2 = half(2);
  const hr = mean([h1, h2].filter((x) => x != null));
  const clin = rv?.clinical?.total != null ? Number(rv.clinical.total) : null;
  const fin = mean([clin, hr].filter((x) => x != null));
  return { af, h1, h2, hr, clin, fin };
}

async function reviewSteps(rv) {
  const n = await reviewNumbers(rv);
  const midShown = !!(rv?.release_mid_at || rv?.release_end_at); const endShown = !!rv?.release_end_at;
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  return `
    <li class="${midShown ? 'done' : 'later'}"><span class="sv-step-dot">${midShown ? icon('check') : '2'}</span>
      <span><strong>Mid-year review</strong><br><span class="muted small">${rv?.mid_review_at ? `Meeting ${esc(when(rv.mid_review_at))}${rv.lead ? ` with ${esc(rv.lead)} and an admin` : ''}` : 'A meeting with your lead supervisor and an admin; the date will appear here.'}
        ${midShown ? `<br>Admin evaluation, half 1: <b>${fmtScore(n.h1)}</b>` : ''}</span></span>
      <span class="sv-step-side">${midShown ? '<button type="button" class="small-btn" data-myrev="mid">See details</button>' : '<span class="chip">Not shown yet</span>'}</span></li>
    <li class="${rv?.signed_at ? 'done' : endShown ? 'now' : 'later'}"><span class="sv-step-dot">${rv?.signed_at ? icon('check') : '3'}</span>
      <span><strong>Year-end review</strong><br><span class="muted small">${rv?.end_review_at ? `Meeting ${esc(when(rv.end_review_at))}${rv.lead ? ` with ${esc(rv.lead)} and an admin` : ''}` : 'Your clinical checklist and admin evaluation, then you sign.'}</span>
        ${endShown ? `<span class="sv-final"><span><span class="muted small">Clinical</span><b>${fmtScore(n.clin)}</b></span><span><span class="muted small">HR performance</span><b>${fmtScore(n.hr)}</b></span>
          <span class="sv-final-big"><span class="muted small">Final score</span><b>${fmtScore(n.fin)}</b></span></span>
          ${rv.signed_at ? `<span class="small">Signed ${esc(whenText(rv.signed_at))}${rv.sign_comment ? ` · “${esc(rv.sign_comment)}”` : ''}</span>`
            : `<label class="small">Comment <span class="muted">(optional)</span><textarea data-signnote rows="2" maxlength="1500"></textarea></label>`}` : ''}</span>
      <span class="sv-step-side">${endShown ? `<button type="button" class="small-btn" data-myrev="end">See details</button>${rv.signed_at ? '' : `<button type="button" class="small-btn primary" data-sign>${icon('check')} I agree, sign</button>`}` : '<span class="chip">Not shown yet</span>'}</span></li>`;
}

async function myReviewDialog(rv, which) {
  const n = await reviewNumbers(rv);
  const scoreRow = (txt, v) => `<li><span>${esc(txt)}</span><b class="sv-score s${esc(String(v ?? ''))}">${v === undefined || v === null ? '—' : v === 'na' ? 'N/A' : v}</b></li>`;
  const adminHalf = (h) => {
    const rows = (rv.admin || []).filter((e) => e.half === h);
    if (!rows.length || !n.af) return `<p class="muted small">Half ${h}: not scored.</p>`;
    return `<h3>Admin evaluation · half ${h} <span class="sv-total small">${fmtScore(h === 1 ? n.h1 : n.h2)}</span></h3>${n.af.body.sections.map((sc) => {
      const e = rows.find((x) => x.section === sc.key);
      return `<h4>${esc(sc.title)} <span class="sv-total small">${fmtScore(e?.average)}</span></h4><ul class="sv-items">${sc.items.map((it) => scoreRow(it.text, e?.scores?.[it.key])).join('')}</ul>${e?.note ? `<p class="small">${esc(e.note)}</p>` : ''}`;
    }).join('')}`;
  };
  let clin = '';
  if (which === 'end' && rv.clinical) {
    const yb = await yearlyBody(rv.clinical.form_version);
    clin = `<h3>Clinical checklist <span class="sv-total small">${fmtScore(rv.clinical.total)}</span></h3>${itemsFor(yb, rv.clinical.level).map((sc) => `<h4>${esc(sc.title)} <span class="sv-total small">${fmtScore(rv.clinical.sections?.[sc.key])}</span></h4>
      <ul class="sv-items">${sc.items.map((it) => scoreRow(it.text, rv.clinical.scores?.[it.key])).join('')}</ul>`).join('')}
      ${(yb.notes || []).map((x) => (rv.clinical.notes?.[x.key] ? `<p class="small"><strong>${esc(x.label)}:</strong> ${esc(rv.clinical.notes[x.key])}</p>` : '')).join('')}`;
  }
  const d = openDlg(`<div class="lh-form sv-read">
    <h2>Your ${which === 'mid' ? 'mid-year' : 'year-end'} review ${year}</h2>
    ${which === 'end' ? `<p>Final score <span class="sv-total">${fmtScore(n.fin)}</span> <span class="muted small">= average of Clinical (${fmtScore(n.clin)}) and HR performance (${fmtScore(n.hr)})</span></p>` : ''}
    <p class="muted small">Scores 0–3. ${which === 'mid' ? 'Your QCD sessions are in My supervision too.' : ''}</p>
    ${clin}${adminHalf(1)}${which === 'end' ? adminHalf(2) : ''}
    <div class="dlg-actions"><button type="button" data-close>Close</button></div></div>`, true);
  d.querySelector('[data-close]').addEventListener('click', closeDlg);
}
