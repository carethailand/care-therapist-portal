// Reports & Forms tab (Portal 068). First form: the incident report (therapist or client).
//   Everyone ......... writes their own reports (draft → sign and send).
//   The supervisor ... chosen BY HAND = the supervisor of that case; reviews and adds a note.
//   Admin / HR ....... see every sent report and close it after the supervisor's review.
// Other supervisors never see a report. The child is a 3-letter case code only: no names,
// no photos, no files. The database checks who may read / change what.
import { supa } from '../supabase.js';
import { esc, fmtDate, todayLocal, byName } from '../ui.js';
import { icon } from '../icons.js';

const must = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };
const api = {
  role: () => supa.rpc('incident_role').then(must),
  sups: () => supa.rpc('incident_supervisors').then(must),
  list: () => supa.rpc('incident_list').then(must),
  save: (id, p) => supa.rpc('incident_save', { p_id: id || null, p }).then(must),
  submit: (id) => supa.rpc('incident_submit', { p_id: id }).then(must),
  remove: (id) => supa.rpc('incident_delete', { p_id: id }).then(must),
  review: (id, note) => supa.rpc('incident_review', { p_id: id, p_note: note }).then(must),
  close: (id, note) => supa.rpc('incident_close', { p_id: id, p_note: note }).then(must),
};

const SYMPTOMS = [
  ['bite', 'Bite', 'ถูกกัด'], ['abrasion', 'Abrasion / graze', 'แผลถลอก'], ['cut', 'Cut / open wound / laceration', 'บาด / แผลเปิด / ฉีกขาด'],
  ['bruise', 'Bruise / contusion', 'ห้อเลือด / ฟกช้ำ'], ['swelling', 'Inflammation / swelling', 'อักเสบ / บวม'], ['blisters', 'Blisters', 'พุพอง'],
  ['concussion', 'Concussion', 'กระทบกระเทือนทางศีรษะ'], ['cramp', 'Cramp', 'ตะคริว'], ['numb', 'Numb', 'อาการชา'], ['infection', 'Infection', 'ติดเชื้อ'],
  ['rash', 'Rash', 'ผื่น'], ['runny_nose', 'Runny nose', 'น้ำมูกไหล'], ['headache', 'Headache', 'ปวดศีรษะ'], ['stomachache', 'Stomachache', 'ปวดท้อง'],
  ['asthma', 'Asthma', 'หอบหืด'], ['nausea', 'Nausea / vomit', 'คลื่นไส้ / อาเจียน'], ['allergy', 'Allergic reaction', 'อาการภูมิแพ้'], ['other', 'Other', 'อื่น ๆ'],
];
const REPORTED = [['supervisor', 'Supervisor'], ['parent', 'Parent'], ['om', 'OM'], ['nanny', 'Nanny'], ['other', 'Other']];
const STATUS = { draft: ['Draft · only you', 'warn'], submitted: ['Waiting for supervisor', 'warn'], reviewed: ['Waiting for OM / HR', 'warn'], closed: ['Closed', 'ok'] };
// Body map areas: [key, label, x, y, w, h] on a 100×190 figure. Front view: the person's RIGHT is on the viewer's left.
const AREAS = [
  ['head', 'head', 38, 4, 24, 24], ['neck', 'neck', 44, 28, 12, 8], ['chest', 'chest', 31, 36, 38, 24], ['belly', 'belly / lower back', 33, 60, 34, 24],
  ['R_upper_arm', 'upper arm', 17, 38, 13, 24], ['L_upper_arm', 'upper arm', 70, 38, 13, 24], ['R_forearm', 'forearm', 14, 62, 13, 20], ['L_forearm', 'forearm', 73, 62, 13, 20],
  ['R_hand', 'hand', 12, 82, 14, 12], ['L_hand', 'hand', 74, 82, 14, 12], ['R_thigh', 'thigh', 33, 84, 16, 40], ['L_thigh', 'thigh', 51, 84, 16, 40],
  ['R_knee', 'knee', 34, 124, 14, 10], ['L_knee', 'knee', 52, 124, 14, 10], ['R_shin', 'lower leg', 35, 134, 13, 36], ['L_shin', 'lower leg', 52, 134, 13, 36],
  ['R_foot', 'foot', 33, 170, 15, 10], ['L_foot', 'foot', 52, 170, 15, 10],
];
const FACE = [['forehead', 'forehead'], ['eye', 'eye'], ['nose', 'nose'], ['cheek', 'cheek'], ['mouth', 'mouth / lips'], ['ear', 'ear'], ['chin', 'chin / jaw']];

let ctx; let panelEl; let role = 'staff'; let sups = []; let list = []; let filter = 'mine'; let picked = false;   // picked = the person chose a filter
const nameOf = (p) => p?.nickname || p?.full_name || '';
const symLabel = (k) => SYMPTOMS.find((s) => s[0] === k)?.[1] || k;
// 'front:R_thigh' → 'right thigh (front)'
function areaLabel(key) {
  const [side, k] = key.split(':');
  if (side === 'face') return `face: ${FACE.find((f) => f[0] === k)?.[1] || k}`;
  const a = AREAS.find((x) => x[0] === k);
  const lr = k.startsWith('R_') ? 'right ' : k.startsWith('L_') ? 'left ' : '';
  const name = side === 'back' && k === 'belly' ? 'lower back' : side === 'back' && k === 'chest' ? 'upper back' : a?.[1] || k;
  return `${lr}${name} (${side})`;
}
const dlg = () => panelEl.querySelector('#rf-dlg');
const closeDlg = () => { const d = dlg(); d.classList.remove('rf-full'); if (d.open) d.close(); };

export async function render(panel, context) {
  ctx = context; panelEl = panel;
  panel.innerHTML = '<p class="muted">Loading…</p>';
  try { [role, sups] = await Promise.all([api.role(), api.sups()]); } catch (e) {
    panel.innerHTML = `<section class="card"><p class="error">Reports & Forms isn’t set up yet (Portal 068). ${esc(e.message)}</p></section>`; return;
  }
  sups = (sups || []).slice().sort(byName);
  if (role === 'office') filter = 'todo';
  await draw();
}

async function draw() {
  try { list = await api.list(); } catch (e) { panelEl.innerHTML = `<section class="card"><p class="error">${esc(e.message)}</p></section>`; return; }
  const me = ctx.me.id;
  const todo = list.filter((r) => (r.status === 'submitted' && r.supervisor_id === me) || (role === 'office' && r.status === 'reviewed'));
  const others = role === 'office' || list.some((r) => r.reporter_id !== me);
  if (!picked && todo.length) filter = 'todo';
  const shown = filter === 'todo' ? todo : filter === 'all' ? list : list.filter((r) => r.reporter_id === me);
  panelEl.innerHTML = `
    <div class="page-head"><h1 class="page-title">Reports & Forms</h1></div>
    <section class="card">
      <div class="page-head"><h2>Incident reports ${todo.length ? `<span class="chip warn">${todo.length} to sign</span>` : ''}</h2><span class="spacer"></span>
        <button type="button" class="primary" data-new>${icon('plus')} New incident report</button></div>
      <p class="muted small">${icon('lock')} For a therapist or a client who got hurt or unwell at work. Use the child’s 3-letter case code only, never a name or photo.
        Only you, the supervisor of that case you choose, and OM / HR can read a report.</p>
      ${others ? `<div class="seg" role="tablist" id="rf-filter">
        <button type="button" role="tab" data-f="todo" aria-selected="${filter === 'todo'}">To sign${todo.length ? ` (${todo.length})` : ''}</button>
        <button type="button" role="tab" data-f="mine" aria-selected="${filter === 'mine'}">Mine</button>
        <button type="button" role="tab" data-f="all" aria-selected="${filter === 'all'}">All I can see</button></div>` : ''}
      ${shown.length ? `<ul class="rf-list">${shown.map((r) => `<li><button type="button" data-open="${esc(r.id)}">
          <span><b>${esc(r.occurred_on ? fmtDate(r.occurred_on) : 'No date yet')}</b> · case ${esc(r.case_code || '—')} · ${r.for_whom === 'client' ? 'Client' : 'Therapist'}
            ${r.reporter_id !== me ? `<span class="muted small">· by ${esc(r.reporter)}</span>` : ''}<br>
            <span class="muted small">${esc([...(r.symptoms || []).map(symLabel), ...(r.body_areas || []).slice(0, 2).map(areaLabel)].join(' · ') || 'Not filled in yet')}</span></span>
          <span class="chip ${STATUS[r.status][1]}">${esc(STATUS[r.status][0])}</span></button></li>`).join('')}</ul>`
        : `<p class="muted">${filter === 'todo' ? 'Nothing waiting for you.' : 'No incident reports yet.'}</p>`}
    </section>
    <dialog id="rf-dlg" class="dlg rf-dlg"></dialog>`;
  panelEl.querySelector('[data-new]').addEventListener('click', () => editor(null));
  panelEl.querySelector('#rf-filter')?.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; picked = true; draw(); } });
  for (const b of panelEl.querySelectorAll('[data-open]')) b.addEventListener('click', () => {
    const r = list.find((x) => x.id === b.dataset.open);
    if (r.reporter_id === me && ['draft', 'submitted'].includes(r.status)) editor(r); else viewer(r);
  });
}

// --- Body map ------------------------------------------------------------------------------------------
function bodySvg(picked, readOnly) {
  // On the back view the person's left is on the viewer's left, so R_ / L_ swap there.
  const mirror = (k) => k.replace(/^R_/, 'X_').replace(/^L_/, 'R_').replace(/^X_/, 'L_');
  const fig = (side, dx) => AREAS.map(([k, label, x, y, w, h]) => {
    const key = `${side}:${side === 'back' ? mirror(k) : k}`;
    return `<rect class="rf-zone${picked.has(key) ? ' on' : ''}" ${readOnly ? '' : `data-area="${key}" tabindex="0" role="checkbox" aria-checked="${picked.has(key)}"`} aria-label="${esc(areaLabel(key))}"
      x="${x + dx}" y="${y}" width="${w}" height="${h}" rx="${k === 'head' ? 12 : 4}"><title>${esc(areaLabel(key))}</title></rect>`;
  }).join('');
  return `<svg class="rf-body" viewBox="0 0 220 196" role="group" aria-label="Body map: front and back">
    ${fig('front', 0)}${fig('back', 115)}
    <text x="50" y="194" text-anchor="middle" class="rf-cap">front · their right ←</text><text x="165" y="194" text-anchor="middle" class="rf-cap">back · their left ←</text></svg>
    <div class="rf-face">${FACE.map(([k, l]) => { const key = `face:${k}`; return readOnly ? (picked.has(key) ? `<span class="chip">${esc(l)}</span>` : '') : `<button type="button" class="small-btn${picked.has(key) ? ' on' : ''}" data-area="${key}" aria-pressed="${picked.has(key)}">${esc(l)}</button>`; }).join('')}</div>`;
}

// --- Write / edit (the writer) -------------------------------------------------------------------------
function editor(rec) {
  const r = rec || { for_whom: 'tx', occurred_on: todayLocal(), body_areas: [], symptoms: [], reported_to: [], status: 'draft' };
  const st = { ...r };
  const picked = new Set(r.body_areas || []); const syms = new Set(r.symptoms || []); const rep = new Set(r.reported_to || []);
  const sent = r.status === 'submitted';
  const v = (k) => esc(st[k] ?? '');
  const d = dlg();
  d.innerHTML = `<form class="rf-form" novalidate>
    <div class="rf-head"><h2>Incident report</h2><span class="spacer"></span><button type="button" data-x>Close</button></div>
    ${sent ? '<p class="muted small">Sent. You can still change it until your supervisor reviews it.</p>' : ''}
    <fieldset class="rf-sec"><legend>The incident</legend>
      <div class="seg" role="radiogroup" aria-label="Report for">
        <button type="button" data-for="tx" aria-selected="${st.for_whom !== 'client'}">For a therapist</button>
        <button type="button" data-for="client" aria-selected="${st.for_whom === 'client'}">For a client</button></div>
      <div class="rf-grid">
        <label>Case code (3 letters)<input name="case_code" maxlength="3" autocapitalize="characters" placeholder="ABC" value="${v('case_code')}" required></label>
        <label>Scheduled time<input name="schedule_time" maxlength="40" placeholder="15:00–17:00" value="${v('schedule_time')}"></label>
        <label>Date of incident<input name="occurred_on" type="date" max="${todayLocal()}" value="${v('occurred_on')}" required></label>
        <label>Time<input name="occurred_time" maxlength="20" placeholder="about 16:45" value="${v('occurred_time')}"></label>
        <label class="rf-wide">Location<input name="location" maxlength="120" placeholder="e.g. CARE centre, school, home" value="${v('location')}"></label>
      </div>
      <label class="check"><input type="checkbox" name="before_session"${st.before_session ? ' checked' : ''}> Wound / injury was found before the session started (บาดแผลเดิมตรวจพบก่อนเริ่มทำการสอน)</label>
    </fieldset>
    <fieldset class="rf-sec"><legend>Where and what</legend>
      <div class="rf-bodywrap">
        <div><p class="muted small">Tap where it happened (front / back, face below)</p><div data-body>${bodySvg(picked, false)}</div><p class="small" data-picked></p></div>
        <div><p class="muted small">What was it? (all that apply)</p>
          <div class="rf-syms">${SYMPTOMS.map(([k, en, th]) => `<label class="check rf-sym"><input type="checkbox" data-sym="${k}"${syms.has(k) ? ' checked' : ''}><span>${esc(en)}<br><span class="muted small">${esc(th)}</span></span></label>`).join('')}</div>
          <label data-symother${syms.has('other') ? '' : ' hidden'}>Other<input name="symptom_other" maxlength="200" value="${v('symptom_other')}"></label></div>
      </div>
      <label>What happened<textarea name="description" rows="4" maxlength="3000" placeholder="Describe what happened. Case codes only, never a child’s name.">${v('description')}</textarea></label>
    </fieldset>
    <fieldset class="rf-sec"><legend>After the incident</legend>
      <p class="muted small">Who did you report it to?</p>
      <div class="rf-checks">${REPORTED.map(([k, l]) => `<label class="check"><input type="checkbox" data-rep="${k}"${rep.has(k) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div>
      <div class="rf-grid">
        <label data-repother${rep.has('other') ? '' : ' hidden'}>Other (who)<input name="reported_other" maxlength="120" value="${v('reported_other')}"></label>
        <label>Reported on<input name="reported_on" type="date" value="${v('reported_on')}"></label>
        <label>Reported at (time)<input name="reported_time" maxlength="20" placeholder="19:42" value="${v('reported_time')}"></label>
        <label>If the therapist left work: time<input name="left_work_time" maxlength="20" value="${v('left_work_time')}"></label>
        <label>Did the therapist come back?<select name="returned"><option value="">—</option><option value="true"${st.returned === true ? ' selected' : ''}>Yes</option><option value="false"${st.returned === false ? ' selected' : ''}>No</option></select></label>
        <label>Came back at<input name="returned_time" maxlength="20" value="${v('returned_time')}"></label>
      </div>
      <label class="check"><input type="checkbox" name="no_medical"${st.no_medical ? ' checked' : ''}> I do not wish to seek medical attention at this time.</label>
      <label>What measures were taken following the incident?<textarea name="measures" rows="3" maxlength="2000">${v('measures')}</textarea></label>
      <label>What is being done to avoid such incidents in the future?<textarea name="prevention" rows="3" maxlength="2000">${v('prevention')}</textarea></label>
      <label>Additional comments<textarea name="comments" rows="2" maxlength="2000">${v('comments')}</textarea></label>
    </fieldset>
    <fieldset class="rf-sec"><legend>Send to</legend>
      <label>Supervisor of this case<select name="supervisor_id" required><option value="">Choose…</option>
        ${sups.filter((s) => s.id !== ctx.me.id).map((s) => `<option value="${esc(s.id)}"${s.id === st.supervisor_id ? ' selected' : ''}>${esc(nameOf(s))}</option>`).join('')}</select></label>
      <p class="muted small">Only this supervisor and OM / HR will see the report.</p>
    </fieldset>
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions">${rec?.id && !sent ? '<button type="button" class="link small" data-del>Delete draft</button>' : ''}<span class="spacer"></span>
      ${sent ? `<button type="button" class="primary" data-save>${icon('check')} Save changes</button>`
        : `<button type="button" data-save>Save draft</button><button type="button" class="primary" data-send>${icon('check')} Sign and send</button>`}</div>
  </form>`;
  d.classList.add('rf-full');
  if (!d.open) d.showModal();
  const f = d.querySelector('form'); const msg = d.querySelector('[data-msg]');
  const showPicked = () => { d.querySelector('[data-picked]').textContent = picked.size ? `Picked: ${[...picked].map(areaLabel).join(', ')}` : 'Nothing picked yet.'; };
  showPicked();
  const collect = () => {
    const g = (n) => f.elements[n]?.value ?? '';
    return {
      for_whom: st.for_whom === 'client' ? 'client' : 'tx', case_code: g('case_code').toUpperCase(), schedule_time: g('schedule_time'),
      occurred_on: g('occurred_on'), occurred_time: g('occurred_time'), location: g('location'), before_session: f.before_session.checked,
      body_areas: [...picked], symptoms: [...syms], symptom_other: syms.has('other') ? g('symptom_other') : '', description: g('description'),
      reported_to: [...rep], reported_other: rep.has('other') ? g('reported_other') : '', reported_on: g('reported_on'), reported_time: g('reported_time'),
      left_work_time: g('left_work_time'), returned: g('returned') === '' ? null : g('returned') === 'true', returned_time: g('returned_time'),
      no_medical: f.no_medical.checked, measures: g('measures'), prevention: g('prevention'), comments: g('comments'), supervisor_id: g('supervisor_id'),
    };
  };
  d.addEventListener('click', (e) => {
    const fb = e.target.closest('[data-for]');
    if (fb) { st.for_whom = fb.dataset.for; d.querySelectorAll('[data-for]').forEach((b) => b.setAttribute('aria-selected', String(b === fb))); return; }
    const a = e.target.closest('[data-area]');
    if (a) { const k = a.dataset.area; if (picked.has(k)) picked.delete(k); else picked.add(k); d.querySelector('[data-body]').innerHTML = bodySvg(picked, false); showPicked(); }
  });
  d.addEventListener('keydown', (e) => { const a = e.target.closest?.('rect[data-area]'); if (a && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); a.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
  d.addEventListener('change', (e) => {
    const s = e.target.closest('[data-sym]'); if (s) { if (s.checked) syms.add(s.dataset.sym); else syms.delete(s.dataset.sym); d.querySelector('[data-symother]').hidden = !syms.has('other'); }
    const p = e.target.closest('[data-rep]'); if (p) { if (p.checked) rep.add(p.dataset.rep); else rep.delete(p.dataset.rep); d.querySelector('[data-repother]').hidden = !rep.has('other'); }
  });
  f.case_code.addEventListener('input', () => { f.case_code.value = f.case_code.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  const fail = (t) => { msg.textContent = t; msg.hidden = false; msg.scrollIntoView({ block: 'nearest' }); };
  const save = async () => { msg.hidden = true; st.id = await api.save(st.id, collect()); return st.id; };
  d.querySelector('[data-x]').addEventListener('click', () => { closeDlg(); draw(); });
  d.querySelector('[data-save]').addEventListener('click', async () => { try { await save(); closeDlg(); draw(); } catch (e) { fail(e.message); } });
  d.querySelector('[data-send]')?.addEventListener('click', async () => {
    const p = collect();
    if (!/^[A-Z]{3}$/.test(p.case_code)) return fail('Add the 3-letter case code (e.g. ABC).');
    if (!p.occurred_on) return fail('Add the date of the incident.');
    if (p.description.trim().length < 10) return fail('Please describe what happened.');
    if (!p.supervisor_id) return fail('Choose the supervisor of this case.');
    if (!confirm('Sign and send this report? Your supervisor and OM / HR will see it.')) return;
    try { await save(); await api.submit(st.id); closeDlg(); draw(); } catch (e) { fail(e.message); }
  });
  d.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm('Delete this draft? This can’t be undone.')) return;
    try { await api.remove(st.id); closeDlg(); draw(); } catch (e) { fail(e.message); }
  });
}

// --- Read, review, close, print --------------------------------------------------------------------------
function reportHtml(r) {
  const row = (l, val) => (val ? `<div class="rf-row"><span class="muted small">${esc(l)}</span><span>${esc(val)}</span></div>` : '');
  const areas = new Set(r.body_areas || []);
  return `<article class="rf-report">
    <h2>Incident report · ${r.for_whom === 'client' ? 'client' : 'therapist'}</h2>
    <div class="rf-rows">
      ${row('Written by', r.reporter)}${row('Case code', r.case_code)}${row('Scheduled time', r.schedule_time)}
      ${row('Date / time', [r.occurred_on && fmtDate(r.occurred_on), r.occurred_time].filter(Boolean).join(' · '))}${row('Location', r.location)}
      ${r.before_session ? row('Note', 'Wound / injury was found before the session started') : ''}
    </div>
    <div class="rf-bodywrap"><div>${bodySvg(areas, true)}<p class="small">${esc([...areas].map(areaLabel).join(', ') || 'No body area marked')}</p></div>
      <div><h4>What it was</h4><p>${esc([...(r.symptoms || []).filter((k) => k !== 'other').map(symLabel), r.symptom_other].filter(Boolean).join(', ') || '—')}</p></div></div>
    <h4>What happened</h4><p class="rf-pre">${esc(r.description || '—')}</p>
    <div class="rf-rows">
      ${row('Reported to', [...(r.reported_to || []).filter((k) => k !== 'other').map((k) => REPORTED.find((x) => x[0] === k)?.[1]), r.reported_other].filter(Boolean).join(', '))}
      ${row('Reported on', [r.reported_on && fmtDate(r.reported_on), r.reported_time].filter(Boolean).join(' · '))}
      ${row('Left work at', r.left_work_time)}${row('Came back', r.returned == null ? '' : r.returned ? `Yes${r.returned_time ? `, at ${r.returned_time}` : ''}` : 'No')}
      ${r.no_medical ? row('Medical attention', 'Not wanted at this time') : ''}
    </div>
    ${r.measures ? `<h4>Measures taken</h4><p class="rf-pre">${esc(r.measures)}</p>` : ''}
    ${r.prevention ? `<h4>To avoid it in the future</h4><p class="rf-pre">${esc(r.prevention)}</p>` : ''}
    ${r.comments ? `<h4>Additional comments</h4><p class="rf-pre">${esc(r.comments)}</p>` : ''}
    <h4>Sign-off</h4>
    <ol class="rf-steps">
      <li class="${r.submitted_at ? 'done' : ''}">Employee: ${esc(r.reporter || '')}${r.submitted_at ? ` · signed ${esc(fmtDate(String(r.submitted_at).slice(0, 10)))}` : ' · not sent yet'}</li>
      <li class="${r.sup_signed_at ? 'done' : ''}">Supervisor: ${esc(r.supervisor || '—')}${r.sup_signed_at ? ` · reviewed ${esc(fmtDate(String(r.sup_signed_at).slice(0, 10)))}${r.sup_note ? `<br><span class="rf-pre">${esc(r.sup_note)}</span>` : ''}` : ' · waiting'}</li>
      <li class="${r.closed_at ? 'done' : ''}">OM / HR: ${r.closed_at ? `${esc(r.hr || '')} · closed ${esc(fmtDate(String(r.closed_at).slice(0, 10)))}${r.hr_note ? `<br><span class="rf-pre">${esc(r.hr_note)}</span>` : ''}` : 'waiting'}</li>
    </ol>
  </article>`;
}

function viewer(r) {
  const me = ctx.me.id;
  const canReview = r.status === 'submitted' && r.supervisor_id === me;
  const canClose = r.status === 'reviewed' && role === 'office';
  const d = dlg();
  d.innerHTML = `<div class="rf-head"><span class="spacer"></span><button type="button" data-print>Print</button><button type="button" data-x>Close</button></div>
    ${reportHtml(r)}
    ${canReview ? `<div class="rf-act"><label>Your review (the writer and OM / HR will see it)<textarea data-note rows="3" maxlength="2000" placeholder="What you checked, follow-up, support"></textarea></label>
      <p class="error" data-msg hidden></p><div class="dlg-actions"><span class="spacer"></span><button type="button" class="primary" data-review>${icon('check')} Sign as reviewed</button></div></div>` : ''}
    ${canClose ? `<div class="rf-act"><label>Note (optional)<textarea data-note rows="2" maxlength="2000"></textarea></label>
      <p class="error" data-msg hidden></p><div class="dlg-actions"><span class="spacer"></span><button type="button" class="primary" data-closeit>${icon('check')} Close report</button></div></div>` : ''}`;
  d.classList.add('rf-full');
  if (!d.open) d.showModal();
  const msg = d.querySelector('[data-msg]');
  d.querySelector('[data-x]').addEventListener('click', closeDlg);
  d.querySelector('[data-print]').addEventListener('click', () => printIt(r));
  d.querySelector('[data-review]')?.addEventListener('click', async () => {
    try { await api.review(r.id, d.querySelector('[data-note]').value); closeDlg(); draw(); } catch (e) { msg.textContent = e.message; msg.hidden = false; }
  });
  d.querySelector('[data-closeit]')?.addEventListener('click', async () => {
    if (!confirm('Close this incident report?')) return;
    try { await api.close(r.id, d.querySelector('[data-note]').value); closeDlg(); draw(); } catch (e) { msg.textContent = e.message; msg.hidden = false; }
  });
}

function printIt(r) {
  const area = document.getElementById('print-area');
  area.innerHTML = `${reportHtml(r)}<div class="rf-signs"><span>Employee’s signature</span><span>Supervisor’s signature</span><span>OM or HR’s signature</span></div>
    <p class="small">CARE Therapist Portal · printed ${esc(fmtDate(todayLocal()))} · case codes only</p>`;
  const page = document.createElement('style');
  page.textContent = '@page { size: A4 portrait; margin: 12mm; }';
  document.head.append(page);
  const oldTitle = document.title;
  document.title = `Incident report ${r.case_code || ''} ${r.occurred_on || ''}`;
  const done = () => { area.innerHTML = ''; page.remove(); document.title = oldTitle; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}
