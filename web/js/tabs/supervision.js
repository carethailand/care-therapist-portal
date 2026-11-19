// Supervision tab, part 1: QCD sessions (Portal 045).
//   My supervision ... a therapist's own QCD sessions this year (scores, notes, trend)
//   Team ............. QCD / supervisors / admin: everyone's QCD summary, record a
//                      session (QCD + supervisors), and edit the checklist
//                      (supervisors + admin). Two QCDs in a row below 2.5 = "PIP suggested".
// Scores are worked out again in the database; this page only shows them.
// Case codes only (3 letters), never a child's name. No files.
import { supa } from '../supabase.js';
import { rankOf } from '../labels.js';
import { esc, fmtDate, todayLocal } from '../ui.js';
import { icon } from '../icons.js';

const must = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };
const api = {
  form: (key, version = null) => supa.rpc('sv_form', { p_key: key, p_version: version }).then(must),
  people: (year) => supa.rpc('sv_people', { p_year: year }).then(must),
  records: (who, year) => supa.rpc('sv_records', { p_who: who, p_year: year }).then(must),
  save: (r) => supa.rpc('sv_record_save', {
    p_id: r.id || null, p_who: r.who, p_held_on: r.held_on, p_case: r.case_code || null,
    p_level: r.level, p_scores: r.scores, p_notes: r.notes,
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
const myLevel = () => ({ therapist: 'junior', senior: 'senior', qcd: 'senior', supervisor: 'supervisor' })[rankOf(ctx.roles)] || null;
const nameOf = (p) => p.nickname || p.full_name;
const fmtScore = (n) => (n == null ? '—' : Number(n).toFixed(2));
const dlg = () => panelEl.querySelector('#sv-dlg');
const openDlg = (html, wide = false) => { const d = dlg(); d.classList.toggle('sv-wide', wide); d.innerHTML = html; if (!d.open) d.showModal(); return d; };
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
      <p class="muted small">Scored 0–3 by a QCD or supervisor during a session (the schedule is in the timesheet). Tap one to see every item and the notes.</p>
      ${list.length ? `${trendSvg(list)}${sessionList(list)}` : `<p class="muted">No QCD sessions in ${year} yet.</p>`}
    </section>`;
  wireSessions(box, list, { who: ctx.me, readOnly: true });
}

// Tiny trend line of totals, oldest → newest, with the 2.5 line.
function trendSvg(list) {
  const pts = [...list].reverse().filter((r) => r.total != null);
  if (pts.length < 2) return '';
  const W = 320; const H = 70; const max = 3;
  const x = (i) => 12 + (i * (W - 24)) / (pts.length - 1);
  const y = (v) => H - 8 - (v / max) * (H - 16);
  const line = pts.map((r, i) => `${x(i).toFixed(1)},${y(Number(r.total)).toFixed(1)}`).join(' ');
  return `<svg class="sv-trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="QCD totals over time">
    <line x1="8" x2="${W - 8}" y1="${y(LOW)}" y2="${y(LOW)}" class="sv-trend-low"/>
    <polyline points="${line}" class="sv-trend-line"/>
    ${pts.map((r, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(Number(r.total)).toFixed(1)}" r="3.5" class="${Number(r.total) < LOW ? 'low' : ''}"/>`).join('')}
  </svg><p class="muted small sv-trend-key">Dotted line = ${LOW}</p>`;
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
    box.querySelector('#sv-people').innerHTML = shown.length ? shown.map((p) => `
      <li><button type="button" class="sv-person${p.flag ? ' flag' : ''}" data-person="${esc(p.id)}">
        <span class="sv-name"><strong>${esc(nameOf(p))}</strong> <span class="chip">${esc(LEVEL[p.level] || p.level)}</span></span>
        <span class="muted small">${p.sessions ? `${p.sessions} QCD${p.sessions === 1 ? '' : 's'} in ${year}` : `No QCD in ${year}`}${p.last_on ? ` · last ${esc(fmtDate(p.last_on))}` : ''}</span>
        <span class="sv-total${p.last_total != null && Number(p.last_total) < LOW ? ' low' : ''}">${fmtScore(p.last_total)}</span>
        ${p.flag ? `<span class="chip warn sv-flag">PIP suggested</span>` : ''}
      </button></li>`).join('') : '<li class="muted">Nobody matches.</li>';
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
    ${list.length ? `${trendSvg(list)}${sessionList(list)}` : `<p class="muted">No QCD sessions in ${year}.</p>`}
    <div class="dlg-actions"><button type="button" data-close>Close</button></div>
  </div>`;
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
      <ul class="sv-items">${s.items.map((i) => `<li><span>${esc(i.text)}</span><b class="sv-score s${esc(String(r.scores?.[i.key] ?? ''))}">${esc(label(r.scores?.[i.key]))}</b></li>`).join('')}</ul></details>`).join('')}
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

async function recordDialog(p, rec) {
  const body = rec ? await bodyOf(rec.form_version) : form.body;
  let level = rec?.level || p.level || 'junior';
  const scores = { ...(rec?.scores || {}) };
  const scale = body.scale || { min: 0, max: 3, na: true };
  const vals = [];
  for (let v = scale.min ?? 0; v <= (scale.max ?? 3); v += 1) vals.push(v);
  const d = openDlg(`<form class="lh-form sv-form" novalidate>
    <h2>${esc(nameOf(p))} · ${rec ? 'Edit QCD session' : 'New QCD session'}</h2>
    ${body.intro ? `<p class="muted small">${esc(body.intro)}</p>` : ''}
    <div class="sv-meta">
      <label>Date<input type="date" name="held_on" value="${esc(rec?.held_on || todayLocal())}" max="${todayLocal()}" required></label>
      <label>Case code <span class="muted small">(3 letters)</span><input name="case_code" maxlength="3" value="${esc(rec?.case_code || '')}" placeholder="ABC" style="text-transform:uppercase"></label>
      <label>Level<select name="level">${(body.levels || []).map((l) => `<option value="${esc(l.key)}"${l.key === level ? ' selected' : ''}>${esc(l.label)}</option>`).join('')}</select></label>
    </div>
    <details class="sv-scale"><summary class="small">Scale ${vals[0]}–${vals[vals.length - 1]}${scale.na ? ' or N/A' : ''}: what each score means</summary>
      <ul class="small">${(scale.labels || []).map((l) => `<li><b>${l.v}</b> ${esc(l.label)}${l.hint ? ` <span class="muted">· ${esc(l.hint)}</span>` : ''}</li>`).join('')}</ul></details>
    <div data-items></div>
    ${(body.notes || []).map((n) => `<label>${esc(n.label)}<textarea name="note_${esc(n.key)}" rows="2" maxlength="1500">${esc(rec?.notes?.[n.key] || '')}</textarea></label>`).join('')}
    <p class="muted small">Please use case codes only, never a child’s name.</p>
    <p class="sv-big sticky">Total <span class="sv-total" data-total>—</span> <span class="muted small" data-count></span></p>
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="submit" class="primary">${icon('check')} Save</button><button type="button" data-back>Back</button></div>
  </form>`, true);
  const f = d.querySelector('form');
  const box = d.querySelector('[data-items]');
  const paintItems = () => {
    const secs = itemsFor(body, level);
    if (!secs.length) { box.innerHTML = `<p class="sv-alert">The checklist has no items for the ${esc(LEVEL[level] || level)} level yet.</p>`; return; }
    box.innerHTML = secs.map((s) => `<fieldset class="sv-sec-edit"><legend>${esc(s.title)} <span class="sv-total small" data-sec="${esc(s.key)}">—</span></legend>
      ${s.items.map((i, n) => `${n === 0 || s.items[n - 1].group !== i.group ? (i.group ? `<p class="sv-group">${esc(i.group)}</p>` : '') : ''}
        <div class="sv-item"><span>${esc(i.text)}</span>
          <span class="sv-pick" role="radiogroup" aria-label="${esc(i.text)}">${vals.map((v) => `<button type="button" data-k="${esc(i.key)}" data-v="${v}" aria-pressed="${scores[i.key] === v}">${v}</button>`).join('')}${scale.na ? `<button type="button" data-k="${esc(i.key)}" data-v="na" aria-pressed="${scores[i.key] === 'na'}">N/A</button>` : ''}</span></div>`).join('')}
    </fieldset>`).join('');
    paintTotals();
  };
  const paintTotals = () => {
    const { sec, total } = liveScore(body, level, scores);
    for (const el of box.querySelectorAll('[data-sec]')) el.textContent = fmtScore(sec[el.dataset.sec]);
    const t = d.querySelector('[data-total]'); t.textContent = fmtScore(total); t.classList.toggle('low', total != null && total < LOW);
    const all = itemsFor(body, level).flatMap((s) => s.items);
    d.querySelector('[data-count]').textContent = `· ${all.filter((i) => scores[i.key] != null).length} of ${all.length} scored`;
  };
  paintItems();
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    const v = b.dataset.v === 'na' ? 'na' : Number(b.dataset.v);
    scores[b.dataset.k] = scores[b.dataset.k] === v ? undefined : v;   // tap again to clear
    if (scores[b.dataset.k] === undefined) delete scores[b.dataset.k];
    for (const x of box.querySelectorAll(`[data-k="${CSS.escape(b.dataset.k)}"]`)) x.setAttribute('aria-pressed', String(scores[b.dataset.k] !== undefined && String(scores[b.dataset.k]) === x.dataset.v));
    paintTotals();
  });
  f.level.addEventListener('change', () => { level = f.level.value; paintItems(); });
  d.querySelector('[data-back]').addEventListener('click', () => (rec ? viewDialog(rec, { who: p, readOnly: false }) : personDialog(p)));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = d.querySelector('[data-msg]');
    const keys = new Set(itemsFor(body, level).flatMap((s) => s.items.map((i) => i.key)));
    const clean = Object.fromEntries(Object.entries(scores).filter(([k]) => keys.has(k)));
    const notes = Object.fromEntries((body.notes || []).map((n) => [n.key, f[`note_${n.key}`].value.trim()]).filter(([, v]) => v));
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try {
      await api.save({ id: rec?.id, who: p.id, held_on: f.held_on.value, case_code: f.case_code.value, level, scores: clean, notes });
      await drawTeam();
      personDialog(people.find((x) => x.id === p.id) || p);
    } catch (err) { msg.textContent = err.message; msg.hidden = false; btn.disabled = false; }
  });
}

// ---------------------------------------------------------------------------
// Checklist editor (supervisors + admin). Each save = a new version; old
// sessions keep the wording they were scored with.
// ---------------------------------------------------------------------------
function formEditor() {
  const body = JSON.parse(JSON.stringify(form.body));
  const levels = body.levels || [];
  const newKey = (prefix) => `${prefix}${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 36).toString(36)}`;
  const d = openDlg('<div class="lh-form"></div>', true);
  const paint = () => {
    d.innerHTML = `<form class="lh-form sv-editor">
      <h2>Edit checklist: ${esc(form.title)}</h2>
      <p class="muted small">Version ${form.version}${form.updated_by ? ` · last changed by ${esc(form.updated_by)}` : ''}. Saving makes version ${form.version + 1}; sessions already recorded keep the wording they were scored with.</p>
      ${body.sections.map((s, si) => `<fieldset class="sv-sec-edit"><legend><input class="sv-sec-title" data-sec-title="${si}" value="${esc(s.title)}" aria-label="Section title"></legend>
        ${s.items.map((i, ii) => `<div class="sv-ed-item">
          <textarea rows="2" data-text="${si}|${ii}" aria-label="Item wording">${esc(i.text)}</textarea>
          <div class="sv-ed-row">
            <input data-group="${si}|${ii}" value="${esc(i.group || '')}" placeholder="Group (optional)" aria-label="Group">
            ${levels.map((l) => `<label class="check small"><input type="checkbox" data-lvl="${si}|${ii}|${esc(l.key)}"${(i.levels || []).includes(l.key) ? ' checked' : ''}> ${esc(l.label)}</label>`).join('')}
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
    };
    f.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t || t.type === 'submit') return;
      read();
      if (t.dataset.add != null) body.sections[+t.dataset.add].items.push({ key: newKey('i'), text: '', group: '', levels: levels.map((l) => l.key).filter((k) => k !== 'supervisor') });
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
