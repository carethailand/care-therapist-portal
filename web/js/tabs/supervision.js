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
  const mine = !!myLevel();
  const team = isTeam();
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
    <div data-pane="team"${team ? '' : ' hidden'}><div id="sv-team"><p class="muted">Loading…</p></div></div>
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
  if (team) drawTeam();
  if (!mine && !team) panelEl.querySelector('[data-pane="mine"]').hidden = false;
}

// ---------------------------------------------------------------------------
// My supervision (own QCD sessions)
// ---------------------------------------------------------------------------
async function drawMine() {
  const box = panelEl.querySelector('#sv-mine');
  let list = [];
  try { list = await api.records(ctx.me.id, year); } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  box.innerHTML = `<section class="card">
      <h2>My QCD sessions <span class="chip">${list.length}</span></h2>
      <p class="muted small">Scored 0–3 by a QCD or supervisor during a session (the schedule is in the timesheet). Tap a session to see every item and the notes.</p>
      ${list.length ? `${await resultsHtml(list)}<h3 class="sv-listhead">Sessions</h3>${sessionList(list)}` : `<p class="muted">No QCD sessions in ${year} yet.</p>`}
    </section>`;
  wireResults(box);
  wireSessions(box, list, { who: ctx.me, readOnly: true });
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
  if (last.total != null) svg += `<text class="qr-end" x="${Math.min(x(n - 1), W - R).toFixed(1)}" y="${(y(Number(last.total)) - 11).toFixed(1)}" text-anchor="${n === 1 ? 'middle' : 'end'}">${fmtScore(last.total)}</text>`;
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
    ${(body.notes || []).map((n) => (r.notes?.[n.key] ? `<p><strong>${esc(n.label)}</strong><br>${esc(r.notes[n.key])}</p>` : '')).join('')}
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
    const dr = readDraft(p.id);
    if (dr && dr.v === body.version && confirm(`Continue the unsaved QCD for ${nameOf(p)} from ${new Date(dr.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}?\n\nCancel = start a new one.`)) Object.assign(st, dr.st);
    else dropDraft(p.id);
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
  const save = () => { if (!rec) writeDraft(p.id, { v: body.version, at: Date.now(), st }); };
  const snap = () => { history.push(JSON.stringify({ scores: st.scores, tallies: st.tallies, manual: st.manual })); if (history.length > 60) history.shift(); };
  const touch = (k) => { st.recent = [k, ...st.recent.filter((x) => x !== k)].slice(0, 8); };

  const d = openDlg(`<div class="sv-live">
    <div class="sv-live-head">
      <h2>${esc(nameOf(p))} · ${rec ? 'Edit QCD' : 'Live QCD'}</h2>
      <label>Level<select data-f="level">${qcdLevels(body).map((l) => `<option value="${esc(l.key)}"${l.key === st.level ? ' selected' : ''}>${esc(l.label)}</option>`).join('')}</select></label>
      <label>Date<input type="date" data-f="held_on" value="${esc(st.held_on)}" max="${todayLocal()}"></label>
      <label>Case<input data-f="case_code" maxlength="3" value="${esc(st.case_code)}" placeholder="ABC" style="text-transform:uppercase;width:5.5em"></label>
      <span class="spacer"></span>
      <span class="muted small" data-saved>${rec ? '' : `${icon('check')} saved on this device`}</span>
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
        dropDraft(p.id);
        await drawTeam();
        personDialog(people.find((x) => x.id === p.id) || p);
      } catch (err) { msg.textContent = err.message; msg.hidden = false; btn.disabled = false; }
    }
  });
  d.querySelector('[data-review]').addEventListener('click', () => { reviewing = true; paintAll(); });
  d.querySelector('[data-back]').addEventListener('click', () => {
    if (!rec && Object.keys(st.tallies).length + Object.keys(st.scores).length && !confirm('Leave this QCD? It stays saved on this device, and you can continue it next time.')) return;
    d.classList.remove('sv-full');
    if (rec) viewDialog(rec, { who: p, readOnly: false }); else personDialog(p);
  });
  paintAll();
}

// ---------------------------------------------------------------------------
// Checklist editor (supervisors + admin). Each save = a new version; old
// sessions keep the wording they were scored with.
// ---------------------------------------------------------------------------
function formEditor() {
  const body = JSON.parse(JSON.stringify(form.body));
  const levels = qcdLevels(body);
  const newKey = (prefix) => `${prefix}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 36).toString(36)}`;
  const d = openDlg('<div class="lh-form"></div>', true);
  const paint = () => {
    d.innerHTML = `<form class="lh-form sv-editor">
      <h2>Edit checklist: ${esc(form.title)}</h2>
      <p class="muted small">Version ${form.version}${form.updated_by ? ` · last changed by ${esc(form.updated_by)}` : ''}. Saving makes version ${form.version + 1}; sessions already recorded keep the wording they were scored with.</p>
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
        await api.saveForm('qcd', form.title, body);
        form = await api.form('qcd');
        versions.set(form.version, form.body);
        closeDlg();
        drawTeam();
      } catch (err) { msg.textContent = err.message; msg.hidden = false; }
    });
  };
  paint();
}
