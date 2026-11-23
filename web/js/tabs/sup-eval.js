// Supervision → Supervisor evaluation (Portal 062).
//   Team → Supervisor evaluations ... the evaluator: start / continue an evaluation, rate items
//                                     1–5 or N/A (optional detail per item), summary and goals,
//                                     then mark it finished.
//                                     Admin: sees finished ones, sets up the review meeting,
//                                     prints, and shares it with the supervisor.
//   My supervision ................... a supervisor sees their own evaluations once shared,
//                                     and signs to say they've seen it (not agreement).
// Other supervisors never see these.
// The database works the scores out again; this page only shows a live preview.
import { supa } from '../supabase.js';
import { esc, todayLocal, byName } from '../ui.js';
import { icon } from '../icons.js';

const must = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };
const api = {
  role: () => supa.rpc('sv_sup_role').then(must),
  form: (version = null) => supa.rpc('sv_form', { p_key: 'sup_eval', p_version: version }).then(must),
  people: () => supa.rpc('sv_sup_people').then(must),
  list: (who) => supa.rpc('sv_sup_list', { p_who: who }).then(must),
  get: (id) => supa.rpc('sv_sup_get', { p_id: id }).then(must),
  save: (s) => supa.rpc('sv_sup_save', {
    p_id: s.id || null, p_who: s.who, p_kind: s.kind, p_on: s.eval_on, p_period: s.period || null,
    p_scores: s.scores, p_notes: s.notes, p_review: s.review,
  }).then(must),
  finish: (id, ready) => supa.rpc('sv_sup_finish', { p_id: id, p_ready: ready }).then(must),
  release: (id, show) => supa.rpc('sv_sup_release', { p_id: id, p_show: show }).then(must),
  remove: (id) => supa.rpc('sv_sup_delete', { p_id: id }).then(must),
  schedule: () => supa.rpc('sv_sup_schedule_list').then(must).catch(() => []),   // [] until Portal 063 is run
  setSince: (who, since) => supa.rpc('sv_sup_set_since', { p_who: who, p_since: since || null }).then(must),
  pastAdd: (who, kind, on) => supa.rpc('sv_sup_past_add', { p_who: who, p_kind: kind, p_on: on }).then(must),
  pastDelete: (id) => supa.rpc('sv_sup_past_delete', { p_id: id }).then(must),
  sign: (id, comment) => supa.rpc('sv_sup_sign', { p_id: id, p_comment: comment }).then(must),
};

export const KIND = { '6_month': '6-month', '12_month': '12-month', annual: 'Annual', check_in: 'Mid-year check-in', extra: 'Extra' };
const KINDS = ['6_month', '12_month', 'annual', 'extra'];    // supervisors have no mid-year check-in
const REVIEW_TEXT = [
  ['strengths', 'Overall strengths and evidence'],
  ['priorities', 'Priority areas for improvement'],
  ['recommendations', 'Additional recommendations'],
  ['comments', 'Evaluator overall comments'],
];
const GOALS = 3;

let env;                      // { panelEl, ctx, openDlg, closeDlg, printReports, role }
const bodies = new Map();
let latest = null;

const dayText = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const num = (v) => (v == null ? '—' : Number(v).toFixed(2));
const nameOf = (p) => p.nickname || p.full_name;

// 'evaluator', 'admin' or null (also null when Portal 062 hasn't been run yet).
export async function supRole() { try { return await api.role(); } catch { return null; } }

async function bodyOf(version = null) {
  if (version && bodies.has(version)) return bodies.get(version);
  const f = await api.form(version);
  if (!f) throw new Error('The supervisor evaluation isn’t set up yet (Portal 062).');
  bodies.set(f.version, f.body);
  if (!version) latest = f;
  return f.body;
}
const allItems = (body) => body.sections.flatMap((s) => s.items);

// Same rule as the database: rated items only; weights re-shared over rated areas.
function calc(body, scores) {
  let wsum = 0; let wtot = 0;
  const sections = body.sections.map((s) => {
    const vals = s.items.map((i) => scores[i.key]).filter((v) => typeof v === 'number');
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    if (avg != null && s.weight > 0) { wsum += avg * s.weight; wtot += s.weight; }
    return { key: s.key, avg: avg == null ? null : Math.round(avg * 100) / 100, n: vals.length, of: s.items.length };
  });
  const weighted = wtot ? Math.round((wsum / wtot) * 100) / 100 : null;
  return { sections, weighted, band: bandOf(body, weighted) };
}
const bandOf = (body, v) => (v == null ? null : (body.bands || []).slice().sort((a, b) => b.min - a.min).find((b) => v >= b.min)?.label || null);
const secOf = (list, key) => (list || []).find((s) => s.key === key);
const isEv = () => env.role === 'evaluator';
const daysTo = (iso) => Math.round((new Date(`${String(iso).slice(0, 10)}T00:00:00`) - new Date(`${todayLocal()}T00:00:00`)) / 86400000);
// Next evaluation (Portal 063): "12-month · due 20 Nov 2026" + overdue / due soon / on track.
function dueHtml(p) {
  const due = p.sched?.due;
  if (!due) return `<span class="muted small">Next: ${p.sched ? 'tap the name to add the start date or past evaluations' : '—'}</span>`;
  const n = daysTo(due.due_on);
  const busy = p.open && !p.open.ready_at;          // a draft is being written
  const chip = busy ? '<span class="chip">In progress</span>'
    : due.status === 'overdue' ? `<span class="chip se-late">Overdue ${-n} day${n === -1 ? '' : 's'}</span>`
    : due.status === 'soon' ? `<span class="chip warn">Due in ${n} day${n === 1 ? '' : 's'}</span>`
    : '<span class="chip ok">On track</span>';
  return `<span class="se-due"><span class="muted small">Next: ${esc(KIND[due.kind])} · due ${esc(dayText(due.due_on))}</span> ${chip}</span>`;
}
const stateChip = (x) => (x.signed_at ? '<span class="chip ok">Signed</span>'
  : x.released_at ? '<span class="chip">Shared · not signed yet</span>'
  : x.ready_at ? '<span class="chip warn">Finished · not shared yet</span>'
  : '<span class="chip warn">Draft · only the evaluator</span>');

// Score summary: weighted score, growth, and one bar per area (tick = last time).
function resultHtml(body, cur, prev) {
  const diff = cur.weighted != null && prev?.weighted != null ? cur.weighted - prev.weighted : null;
  const rated = cur.sections.reduce((n, s) => n + s.n, 0);
  return `<div class="se-kpis">
      <div class="se-kpi"><span class="muted small">Weighted score</span><b>${num(cur.weighted)}<span class="sv-of"> / 5</span></b><span>${esc(cur.band || 'Not rated yet')}</span></div>
      <div class="se-kpi"><span class="muted small">Since last time</span><b class="${diff == null ? '' : diff >= 0 ? 'se-up' : 'se-down'}">${diff == null ? '—' : `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(2)}`}</b>
        <span>${prev ? `${esc(KIND[prev.kind] || '')} ${esc(dayText(prev.eval_on))}: ${num(prev.weighted)}` : 'First evaluation'}</span></div>
      <div class="se-kpi"><span class="muted small">Items rated</span><b>${rated}<span class="sv-of"> / ${allItems(body).length}</span></b><span>N/A and blanks don’t count</span></div>
    </div>
    <div class="se-bars">${body.sections.map((s, i) => {
      const c = secOf(cur.sections, s.key); const p = secOf(prev?.sections, s.key);
      return `<div class="se-bar"><div class="se-bar-top"><span>${i + 1}. ${esc(s.title)} <span class="muted small">${s.weight}%</span></span>
          <b>${c?.avg == null ? '<span class="muted">not rated</span>' : num(c.avg)}</b></div>
        <div class="se-track" role="img" aria-label="${esc(s.title)}: ${c?.avg == null ? 'not rated' : num(c.avg)}${p?.avg != null ? `, last time ${num(p.avg)}` : ''}">
          ${c?.avg != null ? `<span class="se-fill" style="width:${(c.avg / 5) * 100}%"></span>` : ''}
          ${p?.avg != null ? `<span class="se-tick" style="left:${(p.avg / 5) * 100}%"></span>` : ''}</div></div>`;
    }).join('')}</div>
    <p class="muted small">${prev ? 'The dark line shows the score at the last evaluation. ' : ''}Bands: ${(body.bands || []).slice().sort((a, b) => a.min - b.min).map((b, i, all) => `${esc(b.label)} ${i === 0 ? `below ${all[1]?.min}` : `${b.min}+`}`).join(' · ')}.</p>`;
}

function goalsHtml(review, readOnly) {
  const prev = review.prev_goals || []; const next = review.new_goals || [];
  const cell = (list, i, k, label) => (readOnly
    ? `<span>${esc(list[i]?.[k] || '') || '<span class="muted">—</span>'}</span>`
    : `<textarea rows="2" maxlength="600" data-goal="${list === prev ? 'prev' : 'new'}" data-i="${i}" data-k="${k}" aria-label="${esc(label)} ${i + 1}">${esc(list[i]?.[k] || '')}</textarea>`);
  const table = (list, cols, title) => {
    if (readOnly && !list.some((g) => g && Object.values(g).some((v) => String(v || '').trim()))) return '';
    return `<h4>${title}</h4><div class="se-goals" style="--cols:${cols.length}">
      ${cols.map(([, l]) => `<span class="muted small">${esc(l)}</span>`).join('')}
      ${Array.from({ length: GOALS }, (_, i) => cols.map(([k, l]) => cell(list, i, k, l)).join('')).join('')}</div>`;
  };
  return table(prev, [['goal', 'Previous goal'], ['outcome', 'Outcome'], ['comment', 'Evidence / comments']], 'Previous goals')
    + table(next, [['goal', 'New measurable goal'], ['criteria', 'Success criteria'], ['target', 'Target date / support']], 'New goals');
}

// ---------------------------------------------------------------------------
// Team → Supervisor evaluations (evaluator only)
// ---------------------------------------------------------------------------
export async function drawSupTeam(box, e) {
  env = e;
  box.innerHTML = '<p class="muted">Loading…</p>';
  let list; let sched;
  try { [list, , sched] = await Promise.all([api.people(), bodyOf(), api.schedule()]); } catch (err) { box.innerHTML = `<section class="card"><p class="error">${esc(err.message)}</p></section>`; return; }
  const sMap = new Map((sched || []).map((s) => [s.id, s]));
  list = (list || []).map((p) => ({ ...p, sched: sMap.get(p.id) || null })).sort(byName);
  const drafting = (p) => p.open && !p.open.ready_at;
  const late = list.filter((p) => p.sched?.due?.status === 'overdue' && !drafting(p)).length;
  const soon = list.filter((p) => p.sched?.due?.status === 'soon' && !drafting(p)).length;
  box.innerHTML = `<section class="card">
    <h2>Supervisor evaluations <span class="chip">${list.length}</span>${late ? ` <span class="chip se-late">${late} overdue</span>` : ''}${soon ? ` <span class="chip warn">${soon} due soon</span>` : ''}</h2>
    <p class="muted small">${icon('lock')} ${isEv()
      ? 'Drafts are yours only. When you mark one finished, Admin can see it to set up the review meeting and print it; the supervisor sees it once it’s shared.'
      : 'Finished evaluations from the evaluator: set up the review meeting, print, and share each one with the supervisor. Other supervisors never see these.'} ${allItems(latest.body).length} items in ${latest.body.sections.length} areas, rated 1–5 or N/A.</p>
    ${list.length ? `<div class="se-people">${list.map((p) => `<div class="se-person">
        <button type="button" class="se-name" data-hist="${esc(p.id)}"><b>${esc(nameOf(p))}</b><span class="muted small">${p.total} evaluation${p.total === 1 ? '' : 's'} · dates</span></button>
        <span class="se-last">${p.last ? `<span class="muted small">Last: ${esc(KIND[p.last.kind])} · ${esc(dayText(p.last.eval_on))}</span><b>${num(p.last.weighted)}</b> ${esc(p.last.band || '')} ${stateChip(p.last)}` : '<span class="muted small">No shared evaluation yet</span>'}${dueHtml(p)}</span>
        <span class="se-act">${p.open ? `<button type="button" class="small-btn primary" data-open="${esc(p.open.id)}" data-who="${esc(p.id)}">${p.open.ready_at ? `Open ${esc(KIND[p.open.kind])}${isEv() ? ' (finished)' : ' · share'}` : `Continue ${esc(KIND[p.open.kind])}`}</button>`
          : isEv() ? `<button type="button" class="small-btn" data-new="${esc(p.id)}">${icon('plus')} New evaluation</button>`
          : p.last ? `<button type="button" class="small-btn" data-open="${esc(p.last.id)}" data-who="${esc(p.id)}">Open</button>` : ''}</span></div>`).join('')}</div>`
      : '<p class="muted">No supervisors to evaluate.</p>'}
  </section>`;
  const byId = new Map(list.map((p) => [p.id, p]));
  box.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => startNew(byId.get(b.dataset.new), box)));
  box.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openEval(b.dataset.open, byId.get(b.dataset.who), box)));
  box.querySelectorAll('[data-hist]').forEach((b) => b.addEventListener('click', () => historyDialog(byId.get(b.dataset.hist), box)));
}

async function historyDialog(p, box) {
  let list; let sched;
  try { [list, sched] = await Promise.all([api.list(p.id), api.schedule()]); } catch (err) { alert(err.message); return; }
  const s = (sched || []).find((x) => x.id === p.id) || null;
  p = { ...p, sched: s };
  const d = env.openDlg(`<h2>${esc(nameOf(p))} · evaluations</h2>
    ${s ? `<div class="se-sched">
      <h3>Schedule</h3>
      <p class="muted small">First year as a supervisor: 6-month and 12-month evaluations. After that: one annual evaluation a year (no mid-year check-in).</p>
      <p>${dueHtml(p)}</p>
      <label class="se-since">Supervisor since <input type="date" data-since value="${esc(s.since || '')}"> <button type="button" class="small-btn" data-since-save>Save</button></label>
      <h4>Past evaluations (before the Portal)</h4>
      ${s.past.length ? `<ul class="se-past">${s.past.map((x) => `<li><span>${esc(KIND[x.kind])} · ${esc(dayText(x.eval_on))}</span><button type="button" class="small-btn" data-past-del="${esc(x.id)}" aria-label="Remove ${esc(KIND[x.kind])} ${esc(dayText(x.eval_on))}">Remove</button></li>`).join('')}</ul>` : '<p class="muted small">None added.</p>'}
      <div class="se-past-add"><select data-past-kind aria-label="Type">${KINDS.map((k) => `<option value="${k}">${esc(KIND[k])}</option>`).join('')}</select>
        <input type="date" data-past-on max="${esc(todayLocal())}" aria-label="Date"><button type="button" class="small-btn" data-past-add>${icon('plus')} Add</button></div>
      <p class="error" data-smsg hidden></p></div><h3>In the Portal</h3>` : ''}
    ${list.length ? `<ul class="se-hist">${list.map((x) => `<li><button type="button" data-id="${esc(x.id)}">
        <span><b>${esc(KIND[x.kind])}</b> · ${esc(dayText(x.eval_on))}${x.period ? ` <span class="muted small">(${esc(x.period)})</span>` : ''}</span>
        <span>${x.weighted != null ? `<b>${num(x.weighted)}</b> ${esc(x.band || '')}` : ''}
          ${stateChip(x)}</span></button></li>`).join('')}</ul>`
      : '<p class="muted">No evaluations yet.</p>'}
    <div class="dlg-actions">${isEv() ? `<button type="button" class="primary" data-new>${icon('plus')} New evaluation</button>` : ''}<button type="button" data-close>Close</button></div>`);
  d.querySelector('[data-close]').addEventListener('click', env.closeDlg);
  d.querySelector('[data-new]')?.addEventListener('click', () => { env.closeDlg(); startNew(p, box); });
  d.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => { env.closeDlg(); openEval(b.dataset.id, p, box); }));
  const smsg = d.querySelector('[data-smsg]');
  const run = async (fn) => {
    try { await fn(); } catch (err) { smsg.textContent = err.message; smsg.hidden = false; return; }
    await historyDialog(p, box); drawSupTeam(box, env);
  };
  d.querySelector('[data-since-save]')?.addEventListener('click', () => run(() => api.setSince(p.id, d.querySelector('[data-since]').value)));
  d.querySelector('[data-past-add]')?.addEventListener('click', () => {
    const on = d.querySelector('[data-past-on]').value;
    if (!on) { smsg.textContent = 'Choose the date first.'; smsg.hidden = false; return; }
    run(() => api.pastAdd(p.id, d.querySelector('[data-past-kind]').value, on));
  });
  d.querySelectorAll('[data-past-del]').forEach((b) => b.addEventListener('click', () => {
    if (confirm('Remove this past evaluation date?')) run(() => api.pastDelete(b.dataset.pastDel));
  }));
}

async function startNew(p, box) {
  let prev = null;
  try {
    const list = await api.list(p.id);
    const last = list.find((x) => x.released_at);
    if (last) prev = await api.get(last.id);
  } catch { /* no previous: fine */ }
  const kind = p.sched?.due?.kind || (!prev ? '6_month' : prev.kind === '6_month' ? '12_month' : 'annual');
  const review = { prev_goals: (prev?.review?.new_goals || []).map((g) => ({ goal: g?.goal || '', outcome: '', comment: '' })), new_goals: [] };
  editor(p, { id: null, who: p.id, kind, eval_on: todayLocal(), period: '', scores: {}, notes: {}, review, released_at: null,
    previous: prev ? { ...prev, review: undefined } : null }, latest.body, box);
}

async function openEval(id, p, box) {
  let rec;
  try { rec = await api.get(id); } catch (err) { alert(err.message); return; }
  const body = await bodyOf(rec.form_version);
  if (rec.released_at || rec.ready_at || !isEv()) viewer(rec, body, { evaluator: true, back: () => drawSupTeam(box, env), person: p, box });
  else editor(p, { ...rec, who: p.id }, body, box);
}

function editor(p, rec, body, box) {
  const st = {
    id: rec.id, who: rec.who, kind: rec.kind, eval_on: String(rec.eval_on).slice(0, 10), period: rec.period || '',
    scores: Object.fromEntries(Object.entries(rec.scores || {}).map(([k, v]) => [k, v === 'na' ? 'na' : Number(v)])),
    notes: { ...(rec.notes || {}) }, review: { ...(rec.review || {}) },
  };
  st.review.prev_goals = [...(st.review.prev_goals || [])]; st.review.new_goals = [...(st.review.new_goals || [])];
  const prev = rec.previous || null;
  let view = st.kind === 'check_in' ? 'goals' : body.sections[0].key;
  let timer = null; let dirty = false; let saving = null;
  const openNotes = new Set(Object.keys(st.notes));

  const d = env.openDlg(`<div class="sv-live">
    <div class="sv-live-head">
      <h2>${esc(nameOf(p))} · supervisor evaluation</h2>
      <label>Type<select data-f="kind">${(st.kind === 'check_in' ? [...KINDS, 'check_in'] : KINDS).map((k) => `<option value="${k}"${k === st.kind ? ' selected' : ''}>${esc(KIND[k])}</option>`).join('')}</select></label>
      <label>Date<input type="date" data-f="eval_on" value="${esc(st.eval_on)}"></label>
      <label>Period (optional)<input type="text" data-f="period" maxlength="80" placeholder="Jan–Jun 2026" value="${esc(st.period)}"></label>
      <span class="spacer"></span>
      <span class="sv-draft small" data-saved>${icon('lock')} Draft · only you can see it until you share it</span>
      <button type="button" data-close>Close</button>
    </div>
    <div class="sv-live-body"><aside class="sv-live-side" data-side></aside><section class="sv-live-main" data-main></section></div></div>`, true);
  d.classList.add('sv-full');
  const side = d.querySelector('[data-side]'); const main = d.querySelector('[data-main]'); const stEl = d.querySelector('[data-saved]');
  const status = (html, warn = false) => { stEl.innerHTML = html; stEl.classList.toggle('sv-draft-warn', warn); };

  const push = async () => {
    clearTimeout(timer);
    if (saving) await saving;
    if (!dirty) return true;
    dirty = false;
    saving = api.save(st).then((id) => { st.id = id; status(`${icon('lock')} Saved · only you can see it until you share it`); return true; })
      .catch((err) => { dirty = true; status(`${icon('lock')} Not saved yet: ${esc(err.message)}`, true); return false; });
    const ok = await saving; saving = null; return ok;
  };
  const changed = () => { dirty = true; status(`${icon('lock')} Saving…`); clearTimeout(timer); timer = setTimeout(push, 1200); };

  const paintSide = () => {
    const c = calc(body, st.scores);
    const secs = st.kind === 'check_in' ? [] : body.sections.map((s, i) => {
      const x = secOf(c.sections, s.key);
      return `<button type="button" class="sv-secbtn${view === s.key ? ' on' : ''}" data-view="${esc(s.key)}"><span>${i + 1}. ${esc(s.title)}</span><span>${x.n}/${x.of}</span></button>`;
    });
    side.innerHTML = `${secs.join('')}
      <button type="button" class="sv-secbtn${view === 'goals' ? ' on' : ''}" data-view="goals"><span>Summary and goals</span><span></span></button>
      <button type="button" class="sv-secbtn${view === 'result' ? ' on' : ''}" data-view="result"><span>Result and share</span><span></span></button>
      <div class="sv-live-total"><span class="muted small">Weighted score</span><span class="qr-v">${num(c.weighted)}</span><span class="muted small">${esc(c.band || '')}</span></div>`;
  };
  const rowHtml = (i) => {
    const v = st.scores[i.key]; const open = openNotes.has(i.key);
    return `<div class="se-row" data-row="${esc(i.key)}">
      <div class="se-text"><span class="se-no">${esc(i.no)}</span>${esc(i.text)}</div>
      <span class="sv-pick">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-r="${esc(i.key)}" data-v="${n}" aria-pressed="${v === n}" title="${esc(body.anchors?.[n] || '')}">${n}</button>`).join('')}<button type="button" data-r="${esc(i.key)}" data-v="na" aria-pressed="${v === 'na'}" title="${esc(body.anchors?.na || '')}">N/A</button></span>
      <button type="button" class="small-btn se-notebtn${st.notes[i.key] ? ' has' : ''}" data-note-toggle="${esc(i.key)}" aria-expanded="${open}">${st.notes[i.key] ? 'Detail ✓' : '+ Detail'}</button>
      ${open ? `<textarea class="se-note" rows="2" maxlength="1000" data-note="${esc(i.key)}" placeholder="Optional: what you saw (e.g. from the recorded clinic meeting)" aria-label="Detail for ${esc(i.no)}">${esc(st.notes[i.key] || '')}</textarea>` : ''}</div>`;
  };
  const paintMain = () => {
    if (view === 'goals') {
      main.innerHTML = `<h3>Summary and goals</h3>
        ${st.kind === 'check_in' ? '<p class="muted small">A mid-year check-in covers progress and goals only (no item ratings).</p>' : ''}
        ${REVIEW_TEXT.map(([k, l]) => `<label class="sv-q"><span>${esc(l)}</span><textarea rows="3" maxlength="3000" data-rv="${k}">${esc(st.review[k] || '')}</textarea></label>`).join('')}
        ${goalsHtml(st.review, false)}
        <div class="dlg-actions"><button type="button" class="primary" data-go="result">Result and share →</button></div>`;
      return;
    }
    if (view === 'result') {
      const c = calc(body, st.scores);
      main.innerHTML = `<h3>Result</h3>${resultHtml(body, c, prev)}
        <p class="muted small">When it’s finished, Admin can see it to set up the review meeting and print it. Then you or Admin share it with ${esc(nameOf(p))}, who reads it and signs. You can reopen it to edit until it’s shared.</p>
        <p class="error" data-msg hidden></p>
        <div class="dlg-actions"><button type="button" class="primary" data-share>${icon('check')} Mark as finished</button>
          ${st.id ? '<button type="button" class="se-del" data-del>Delete draft</button>' : ''}</div>`;
      return;
    }
    const s = body.sections.find((x) => x.key === view);
    const n = body.sections.indexOf(s);
    main.innerHTML = `<h3>${n + 1}. ${esc(s.title)} <span class="muted small">weight ${s.weight}%</span></h3>
      <p class="muted small">1 Does not meet · 2 Developing · 3 Meets · 4 Exceeds · 5 Exceptional · N/A not applicable or not observed (never for poor performance).</p>
      <div class="se-rows">${s.items.map(rowHtml).join('')}</div>
      <div class="dlg-actions">${n > 0 ? '<button type="button" data-step="-1">← Previous area</button>' : ''}
        <button type="button" class="primary" data-step="1">${n < body.sections.length - 1 ? 'Next area →' : 'Summary and goals →'}</button></div>`;
  };
  const paint = () => { paintSide(); paintMain(); };
  const go = (v) => { view = v; paint(); main.scrollTop = 0; };

  d.querySelector('.sv-live-head').addEventListener('change', (e) => {
    const f = e.target.closest('[data-f]'); if (!f) return;
    st[f.dataset.f] = f.value;
    if (f.dataset.f === 'kind') { if (st.kind === 'check_in' && view !== 'result') view = 'goals'; paint(); }
    changed();
  });
  d.querySelector('[data-f="period"]').addEventListener('input', (e) => { st.period = e.target.value; changed(); });
  side.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) go(b.dataset.view); });
  main.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-r]');
    if (r) {
      const k = r.dataset.r; const v = r.dataset.v === 'na' ? 'na' : Number(r.dataset.v);
      if (st.scores[k] === v) delete st.scores[k]; else st.scores[k] = v;      // tap again to clear
      const row = main.querySelector(`[data-row="${CSS.escape(k)}"]`);
      row.querySelectorAll('[data-r]').forEach((b) => b.setAttribute('aria-pressed', String(st.scores[k] === (b.dataset.v === 'na' ? 'na' : Number(b.dataset.v)))));
      paintSide(); changed(); return;
    }
    const t = e.target.closest('[data-note-toggle]');
    if (t) {
      const k = t.dataset.noteToggle;
      if (openNotes.has(k) && !st.notes[k]) openNotes.delete(k); else openNotes.add(k);
      const i = allItems(body).find((x) => x.key === k);
      main.querySelector(`[data-row="${CSS.escape(k)}"]`).outerHTML = rowHtml(i);
      main.querySelector(`[data-note="${CSS.escape(k)}"]`)?.focus();
      return;
    }
    const step = e.target.closest('[data-step]');
    if (step) {
      const n = body.sections.findIndex((x) => x.key === view) + Number(step.dataset.step);
      go(n >= body.sections.length ? 'goals' : body.sections[Math.max(0, n)].key); return;
    }
    if (e.target.closest('[data-go]')) { go(e.target.closest('[data-go]').dataset.go); return; }
    if (e.target.closest('[data-share]')) {
      const c = calc(body, st.scores);
      const msg = main.querySelector('[data-msg]');
      if (st.kind !== 'check_in' && c.weighted == null) { msg.textContent = 'Rate at least one item first.'; msg.hidden = false; return; }
      const rated = c.sections.reduce((a, x) => a + x.n, 0);
      if (!confirm(`Mark this ${KIND[st.kind]} evaluation of ${nameOf(p)} as finished?${st.kind !== 'check_in' ? ` ${rated} of ${allItems(body).length} items rated, weighted score ${num(c.weighted)}.` : ''} Admin can then see it.`)) return;
      dirty = true;
      if (!(await push())) return;
      try { await api.finish(st.id, true); } catch (err) { msg.textContent = err.message; msg.hidden = false; return; }
      d.classList.remove('sv-full'); env.closeDlg(); drawSupTeam(box, env); return;
    }
    if (e.target.closest('[data-del]')) {
      if (!confirm('Delete this draft evaluation? This can’t be undone.')) return;
      clearTimeout(timer); dirty = false;
      try { await api.remove(st.id); } catch (err) { alert(err.message); return; }
      d.classList.remove('sv-full'); env.closeDlg(); drawSupTeam(box, env);
    }
  });
  main.addEventListener('input', (e) => {
    const n = e.target.closest('[data-note]');
    if (n) { st.notes[n.dataset.note] = n.value; changed(); return; }
    const rv = e.target.closest('[data-rv]');
    if (rv) { st.review[rv.dataset.rv] = rv.value; changed(); return; }
    const g = e.target.closest('[data-goal]');
    if (g) {
      const list = g.dataset.goal === 'prev' ? st.review.prev_goals : st.review.new_goals;
      const i = Number(g.dataset.i);
      list[i] = { ...(list[i] || {}), [g.dataset.k]: g.value };
      for (let j = 0; j < GOALS; j += 1) if (!list[j]) list[j] = {};
      changed();
    }
  });
  d.querySelector('[data-close]').addEventListener('click', async () => {
    if (dirty && !(await push()) && !confirm('Some changes aren’t saved. Close anyway?')) return;
    d.classList.remove('sv-full'); env.closeDlg(); drawSupTeam(box, env);
  });
  d.addEventListener('cancel', (e) => { if (dirty) { e.preventDefault(); d.querySelector('[data-close]').click(); } }, { once: true });
  paint();
}

// Read-only: the supervisor's own view (and the evaluator's view once shared).
function viewer(rec, body, { evaluator = false, back, person, box } = {}) {
  const cur = { sections: rec.sections, weighted: rec.weighted, band: rec.band };
  const scores = rec.scores || {}; const notes = rec.notes || {}; const review = rec.review || {};
  const isCheck = rec.kind === 'check_in';
  const d = env.openDlg(`<div class="sv-live">
    <div class="sv-live-head">
      <h2>${esc(evaluator ? nameOf(person) : 'Your')} ${esc(KIND[rec.kind])} evaluation · ${esc(dayText(rec.eval_on))}</h2>
      <span class="muted small">${rec.period ? `${esc(rec.period)} · ` : ''}by ${esc(rec.evaluator || '—')}</span>
      <span class="spacer"></span>
      <button type="button" data-print>Print</button>
      ${evaluator && isEv() && rec.ready_at && !rec.released_at ? '<button type="button" data-reopen>Reopen to edit</button>' : ''}
      ${evaluator && rec.ready_at && !rec.released_at ? `<button type="button" class="primary" data-show>Share with ${esc(nameOf(person))}</button>` : ''}
      ${evaluator && rec.released_at && !rec.signed_at ? `<button type="button" data-hide>Hide from ${esc(nameOf(person))}</button>` : ''}
      <button type="button" data-close>Close</button>
    </div>
    <div class="sv-live-main se-view">
      ${isCheck ? '' : resultHtml(body, cur, rec.previous)}
      ${REVIEW_TEXT.filter(([k]) => String(review[k] || '').trim()).map(([k, l]) => `<h4>${esc(l)}</h4><p class="se-pre">${esc(review[k])}</p>`).join('')}
      ${goalsHtml(review, true)}
      ${isCheck ? '' : `<h3>Every item</h3>${body.sections.map((s, n) => `<h4>${n + 1}. ${esc(s.title)}</h4><ul class="sv-items">${s.items.map((i) => {
        const v = scores[i.key];
        return `<li><span><span class="se-no">${esc(i.no)}</span>${esc(i.text)}${notes[i.key] ? `<br><span class="muted small">${esc(notes[i.key])}</span>` : ''}</span><b>${v == null ? '—' : v === 'na' ? 'N/A' : esc(String(v))}</b></li>`;
      }).join('')}</ul>`).join('')}`}
      <div class="se-sign">
        ${rec.signed_at ? `<p>${icon('check')} Signed ${esc(dayText(rec.signed_at))}.${rec.sign_comment ? `<br><span class="muted small">Comment: ${esc(rec.sign_comment)}</span>` : ''}</p>`
          : evaluator ? `<p class="muted">${rec.released_at ? `Shared ${esc(dayText(rec.released_at))} · not signed yet.` : 'Not shared with the supervisor yet.'}</p>`
          : `<label class="sv-q"><span>Your comments (optional)</span><textarea rows="3" maxlength="2000" data-signnote></textarea></label>
             <p class="muted small">Signing says you’ve seen and discussed this evaluation. It doesn’t have to mean you agree.</p>
             <div class="dlg-actions"><button type="button" class="primary" data-sign>${icon('check')} Sign</button></div>`}
      </div>
    </div></div>`, true);
  d.classList.add('sv-full');
  const close = () => { d.classList.remove('sv-full'); env.closeDlg(); back?.(); };
  d.querySelector('[data-close]').addEventListener('click', close);
  const again = () => { d.classList.remove('sv-full'); env.closeDlg(); openEval(rec.id, person, box); };
  d.querySelector('[data-hide]')?.addEventListener('click', async () => {
    if (!confirm(`Hide this evaluation from ${nameOf(person)} again?`)) return;
    try { await api.release(rec.id, false); } catch (err) { alert(err.message); return; }
    again();
  });
  d.querySelector('[data-show]')?.addEventListener('click', async () => {
    if (!confirm(`Share this evaluation with ${nameOf(person)}? They can read it and sign.`)) return;
    try { await api.release(rec.id, true); } catch (err) { alert(err.message); return; }
    again();
  });
  d.querySelector('[data-reopen]')?.addEventListener('click', async () => {
    if (!confirm('Reopen this evaluation to edit it? Admin won’t see it until you mark it finished again.')) return;
    try { await api.finish(rec.id, false); } catch (err) { alert(err.message); return; }
    again();
  });
  d.querySelector('[data-print]').addEventListener('click', () => {
    const who = evaluator ? nameOf(person) : (rec.name || '');
    const html = `<article class="se-print"><h1>Supervisor evaluation · ${esc(who)}</h1>
      <p>${esc(KIND[rec.kind])} · ${esc(dayText(rec.eval_on))}${rec.period ? ` · ${esc(rec.period)}` : ''} · evaluator ${esc(rec.evaluator || '—')}</p>
      ${d.querySelector('.se-view').innerHTML.replace(/<textarea[\s\S]*?<\/textarea>/g, '').replace(/<button[\s\S]*?<\/button>/g, '')}
      <div class="se-print-sign"><span>Supervisor signature</span><span>Evaluator signature</span><span>Review date</span></div>
      <p class="muted small">Signing shows the review took place; it doesn’t have to mean agreement. CARE Therapist Portal · printed ${esc(dayText(new Date().toISOString()))}</p></article>`;
    env.printReports(html, `Supervisor evaluation ${who} ${String(rec.eval_on).slice(0, 10)}`);
  });
  d.querySelector('[data-sign]')?.addEventListener('click', async () => {
    if (!confirm('Sign this evaluation to say you’ve seen it?')) return;
    try { await api.sign(rec.id, d.querySelector('[data-signnote]').value); } catch (err) { alert(err.message); return; }
    close();
  });
}

// ---------------------------------------------------------------------------
// My supervision → My evaluations (supervisors)
// ---------------------------------------------------------------------------
export async function drawMySup(box, e) {
  env = e;
  let list;
  try { list = await api.list(env.ctx.me.id); } catch { box.innerHTML = ''; return; }   // Portal 062 not run yet
  box.innerHTML = `<section class="card">
    <h2>My evaluations <span class="chip">${list.length}</span></h2>
    <p class="muted small">${icon('lock')} Your supervisor evaluations. Only you and your evaluator can read them. They show here once your evaluator shares them.</p>
    ${list.length ? `<ul class="se-hist">${list.map((x) => `<li><button type="button" data-id="${esc(x.id)}">
        <span><b>${esc(KIND[x.kind])}</b> · ${esc(dayText(x.eval_on))}</span>
        <span>${x.weighted != null ? `<b>${num(x.weighted)}</b> ${esc(x.band || '')}` : ''} ${x.signed_at ? '<span class="chip ok">Signed</span>' : '<span class="chip warn">Please read and sign</span>'}</span></button></li>`).join('')}</ul>`
      : '<p class="muted">No evaluations shared with you yet.</p>'}
  </section>`;
  box.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', async () => {
    let rec;
    try { rec = await api.get(b.dataset.id); } catch (err) { alert(err.message); return; }
    viewer(rec, await bodyOf(rec.form_version), { back: () => drawMySup(box, env) });
  }));
}
