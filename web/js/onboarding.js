// New therapist onboarding: the trainee's path (Training tab, Home, My Journey),
// the team view (admin plans dates and trainers; trainers / supervisors record)
// and a trainer's own list of sessions. Who can see and do what is decided by
// the database (Portal 039); the paper checklists stay outside the Portal.
import { supa } from './supabase.js';
import { esc, fmtDate, todayLocal } from './ui.js';
import { icon } from './icons.js';
import { assignPeople } from './training-data.js';

const must = ({ data, error }) => { if (error) throw error; return data; };

export const ONB_STAGES = ['interview', 'online_course', 'roleplay_orientation', 'field_overlap', 'probation'];
const STAGE_ORDER = [...ONB_STAGES, 'active'];
const STAGE_NAME = { interview: 'Interview', online_course: 'Online course', roleplay_orientation: 'Role-play & orientation', field_overlap: 'Field overlap', probation: 'Probation', active: 'Thriving' };
export const inOnboarding = (me) => !!me && me.track === 'care_hire' && me.status !== 'exited' && ONB_STAGES.includes(me.stage);
export const CAREWAY_KEY = 'care_way';

// The 9 role-play topics (competency checklist) and what to review before each.
export const ROLEPLAY = [
  { n: 1, title: 'Introduction and building rapport (pairing)', hours: 1, review: 'Core Principles of ABA · Skill Acquisition Programming 1' },
  { n: 2, title: 'Discrete trial training (DTT)', hours: 3, review: 'Skill Acquisition Programming 1' },
  { n: 3, title: 'Discrimination training', hours: 3, review: 'Skill Acquisition Programming 2' },
  { n: 4, title: 'Prompting and prompt fading', hours: 2.5, review: 'Skill Acquisition Programming 2' },
  { n: 5, title: 'Shaping, chaining and NET', hours: 2, review: 'Skill Acquisition Programming 3' },
  { n: 6, title: 'Data collection and graphing', hours: 2, review: 'Data Collection and Analysis' },
  { n: 7, title: 'Behaviour management', hours: 5, review: 'Antecedent and Behavior Reduction Interventions' },
  { n: 8, title: 'Ethics, professionalism, school shadow and confidentiality', hours: 2, review: 'Legal, Ethical and Professional Considerations' },
  { n: 9, title: 'Putting it all together (mock session)', hours: 1, review: 'All skill acquisition modules' },
];
// What each overlap session focuses on (overlap protocol).
export const OVERLAP = {
  1: 'Observe the session and review the log book',
  2: 'Run 25% of programs and take data throughout',
  3: 'Run 50% of programs and take data throughout',
  4: 'Run 75% of programs and take data throughout',
  5: 'Run 75% of programs and take data throughout',
  6: 'Run 100% of the session, including data and behaviour management',
  7: 'Run 100% of the session, including data and behaviour management',
};
const STEPS = [
  { key: 'interview', label: 'Interview', ico: 'calendar' },
  { key: 'online', label: 'Online course', ico: 'school' },
  { key: 'orientation', label: 'Orientation', ico: 'door' },
  { key: 'roleplay', label: 'Role-play', ico: 'users' },
  { key: 'written_exam', label: 'Written exam', ico: 'file-text' },
  { key: 'overlap', label: 'Field overlap', ico: 'route' },
  { key: 'probation', label: 'Probation', ico: 'award' },
];
// The stage each step must be finished by (people part-way through when the
// Portal started have earlier steps counted as done).
const DONE_BY_STAGE = { interview: 1, online: 2, orientation: 3, roleplay: 3, written_exam: 3, overlap: 4, probation: 5 };
// Which steps finish each stage, and the stage that comes next.
const STAGE_NEEDS = {
  interview: { steps: ['interview'], next: 'online_course' },
  online_course: { steps: ['online'], next: 'roleplay_orientation' },
  roleplay_orientation: { steps: ['orientation', 'roleplay', 'written_exam'], next: 'field_overlap' },
  field_overlap: { steps: ['overlap'], next: 'probation' },
  probation: { steps: ['probation'], next: 'active' },
};

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
export const loadItems = (who = null) => supa.rpc('onboarding_items', { p_who: who }).then(must);
export const loadPeople = () => supa.rpc('onboarding_people').then(must);
export const loadLed = () => supa.rpc('onboarding_led').then(must);
const planItem = (f) => supa.rpc('onboarding_plan', {
  p_who: f.who, p_step: f.step, p_seq: f.seq ?? 0, p_title: f.title || null, p_held_on: f.held_on || null,
  p_start: f.start_time || null, p_place: f.place || null, p_trainer: f.trainer_id || null, p_case: f.case_code || null,
}).then(must);
const removeItem = (id) => supa.rpc('onboarding_remove', { p_id: id }).then(must);
const recordItem = (id, f) => supa.rpc('onboarding_record', {
  p_id: id, p_status: f.status, p_score: f.score ?? null, p_passed: f.passed ?? null, p_reviewed_on: f.reviewed_on || null, p_note: f.note || null,
}).then(must);
// ABAT / CARE Way status for several people (training team).
async function onlineStatus(ids) {
  if (!ids.length) return [];
  return must(await supa.from('training_enrollments').select('therapist_id,program_key,status').in('therapist_id', ids));
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------
const one = (items, step, seq = 0) => items.find((i) => i.step === step && i.seq === seq);
const many = (items, step) => items.filter((i) => i.step === step).sort((a, b) => a.seq - b.seq);
const signed = (i) => i?.status === 'done';
const held = (i) => i && ['attended', 'done'].includes(i.status);

// online = { abat: 'passed'|'active'|null, careway: 'passed'|'active'|null, carewayReady: bool }
function stepDoneByEvidence(key, items, online) {
  switch (key) {
    case 'interview': { const i = one(items, 'interview'); return held(i) || (!!i?.held_on && i.held_on < todayLocal()); }
    case 'online': return online.abat === 'passed' && (!online.carewayReady || online.careway === 'passed');
    case 'orientation': return held(one(items, 'orientation'));
    case 'roleplay': return ROLEPLAY.every((t) => signed(one(items, 'roleplay', t.n)));
    case 'written_exam': return one(items, 'written_exam')?.passed === true;
    case 'overlap': return [1, 2, 3, 4, 5, 6, 7].every((n) => signed(one(items, 'overlap', n))) && one(items, 'field_eval')?.passed === true;
    case 'probation': return one(items, 'probation')?.passed === true;
    default: return false;
  }
}
export function progress(person, items, online) {
  const sIdx = STAGE_ORDER.indexOf(person.stage);
  const states = STEPS.map((s) => (stepDoneByEvidence(s.key, items, online) || sIdx >= DONE_BY_STAGE[s.key] ? 'done' : 'todo'));
  const cur = states.indexOf('todo');
  if (cur >= 0) states[cur] = 'current';
  const need = STAGE_NEEDS[person.stage];
  const ready = need && need.steps.every((k) => stepDoneByEvidence(k, items, online)) ? need.next : null;
  return { states, cur, ready };
}
function stepStatus(key, items, online) {
  const n = (step) => many(items, step).filter(signed).length;
  switch (key) {
    case 'interview': { const i = one(items, 'interview'); return i?.held_on ? when(i) : 'Date to be set'; }
    case 'online': return `ABAT ${online.abat === 'passed' ? 'passed' : online.abat ? 'in progress' : 'not started'}${online.carewayReady ? ` · CARE Way ${online.careway === 'passed' ? 'passed' : online.careway ? 'in progress' : 'not started'}` : ''}`;
    case 'orientation': { const i = one(items, 'orientation'); return held(i) ? 'Done' : i?.held_on ? when(i) : 'Date to be set'; }
    case 'roleplay': return `${n('roleplay')} of 9 signed off`;
    case 'written_exam': { const i = one(items, 'written_exam'); return i?.passed ? 'Passed' : i?.status === 'done' ? 'Not passed yet' : i?.held_on ? when(i) : 'Date to be set'; }
    case 'overlap': { const f = one(items, 'field_eval'); return `${n('overlap')} of 7 signed off · field evaluation ${f?.passed ? 'passed' : f?.status === 'done' ? 'not passed yet' : f?.held_on ? when(f) : 'to be set'}`; }
    case 'probation': { const i = one(items, 'probation'); return i?.passed ? 'Passed 🎉' : i?.held_on ? `Review ${when(i)}${i.trainer ? ` with ${i.trainer}` : ''}` : 'Waiting for the supervisor’s review'; }
    default: return '';
  }
}
const when = (i) => `${fmtDate(i.held_on)}${i.start_time ? `, ${i.start_time.slice(0, 5)}` : ''}`;
const itemState = (i) => {
  if (!i) return '<span class="muted">Not planned yet</span>';
  if (i.status === 'missed') return '<span class="chip warn">Missed</span>';
  if (i.step === 'probation') return i.passed ? '<span class="chip ok">Passed</span>' : i.status === 'done' ? '<span class="chip warn">Not yet</span>'
    : `<span class="muted">${i.held_on ? `Review ${esc(fmtDate(i.held_on))}${i.start_time ? ` ${esc(i.start_time.slice(0, 5))}` : ''}` : 'Waiting'}</span>`;
  if (['written_exam', 'field_eval'].includes(i.step)) {
    if (i.status === 'done') return i.passed ? '<span class="chip ok">Passed</span>' : '<span class="chip warn">Not passed yet</span>';
    return held(i) ? '<span class="chip">Attended</span>' : `<span class="muted">${i.held_on ? 'Planned' : 'Date to be set'}</span>`;
  }
  if (i.status === 'done') return `<span class="chip ok">${icon('check')} ${i.step === 'roleplay' || i.step === 'overlap' ? 'Signed off' : 'Done'}</span>`;
  if (i.status === 'attended') return '<span class="chip">Attended</span>';
  return `<span class="muted">${i.held_on ? (i.held_on < todayLocal() ? 'Waiting for sign-off' : 'Planned') : 'Date to be set'}</span>`;
};

// The next thing coming up for the trainee (Home).
export function nextUp(person, items, online) {
  const { cur } = progress(person, items, online);
  if (cur < 0) return null;
  const key = STEPS[cur].key;
  const label = STEPS[cur].label;
  if (key === 'online') return { label, text: online.abat === 'passed' ? 'Finish the CARE Way course and exam' : 'Finish the ABAT Preparation Course and exam' };
  const pick = (list) => list.find((i) => !['done'].includes(i.status) && i.held_on && i.held_on >= todayLocal()) || list.find((i) => i.status !== 'done');
  const list = key === 'roleplay' ? many(items, 'roleplay') : key === 'overlap' ? [...many(items, 'overlap'), ...many(items, 'field_eval')] : many(items, key);
  const i = pick(list);
  if (!i) return { label, text: 'Your next date will appear here once it’s set' };
  const what = i.step === 'roleplay' ? ROLEPLAY[i.seq - 1]?.title : i.step === 'overlap' ? `Session ${i.seq}` : i.step === 'field_eval' ? 'Field evaluation' : '';
  return { label, text: [what, i.held_on ? when(i) : 'date to be set', i.trainer ? `with ${i.trainer}` : ''].filter(Boolean).join(' · ') };
}

// ---------------------------------------------------------------------------
// Trainee's path card (Training tab)
// ---------------------------------------------------------------------------
const openSteps = new Set();
export function pathCard(person, items, online, { team = false, admin = false, recorder = () => false } = {}) {
  const { states, cur } = progress(person, items, online);
  const row = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  const act = (i) => (team && i && recorder(i) ? ` <button type="button" class="small-btn" data-onb-rec="${esc(i.id)}">Record</button>` : '');
  const plan = (step, seq = 0, label = 'Set date') => (admin ? ` <button type="button" class="small-btn" data-onb-plan="${esc(step)}|${seq}">${esc(label)}</button>` : '');
  const who = (i, word = 'with') => (i?.trainer ? ` · ${word} ${esc(i.trainer)}` : '');
  const single = (step, word) => {
    const i = one(items, step);
    return `<p class="onb-line">${i?.held_on ? `${icon('calendar')} ${esc(when(i))}${i.place ? ` · ${esc(i.place)}` : ''}${who(i, word)}` : '<span class="muted">The date will be set by an admin.</span>'}
      ${i ? itemState(i) : ''}${plan(step, 0, i ? 'Edit' : 'Set date')}${act(i)}</p>
      ${team && i?.note ? `<p class="muted small">Note: ${esc(i.note)}</p>` : ''}`;
  };
  const body = {
    interview: () => single('interview', 'with'),
    online: () => `<div class="onb-online">
        <div><strong>ABAT Preparation Course</strong><span class="muted small">Modules + ABAT Readiness Exam</span>
          <span>${online.abat === 'passed' ? '<span class="chip ok">Passed</span>' : online.abat ? '<span class="chip">In progress</span>' : '<span class="muted">Not started</span>'}</span></div>
        <div><strong>CARE Way</strong><span class="muted small">CARE-style ABA: online content + exam</span>
          <span>${!online.carewayReady ? '<span class="chip">Coming soon</span>' : online.careway === 'passed' ? '<span class="chip ok">Passed</span>' : online.careway ? '<span class="chip">In progress</span>' : '<span class="muted">Not started</span>'}</span></div>
      </div>
      ${team
        ? (!online.abat && admin ? `<p class="onb-line"><span class="muted small">No ABAT place yet.</span> <button type="button" class="small-btn primary" data-onb-abat>Give ABAT place</button></p>` : '')
        : online.abat ? '<p class="muted small">Your courses are further down this page. Pass both before the role-plays.</p>'
          : '<p class="muted small">Your ABAT course will appear on this page once an admin gives you a place. Ask an admin if it hasn’t appeared.</p>'}`,
    orientation: () => single('orientation', 'with'),
    roleplay: () => `<div class="table-wrap"><table class="onb-table">
        <thead><tr><th>#</th><th>Topic</th><th>Date</th><th>Trainer</th><th>Result</th></tr></thead>
        <tbody>${ROLEPLAY.map((t) => { const i = one(items, 'roleplay', t.n); return row([
          t.n, `${esc(t.title)}<span class="muted small onb-sub">Review first: ${esc(t.review)} · about ${t.hours} h</span>`,
          i?.held_on ? esc(when(i)) : '—', i?.trainer ? esc(i.trainer) : '—',
          `${itemState(i)}${team && i?.score != null ? ` <span class="small ${i.score >= 80 ? '' : 'onb-low'}">${Number(i.score)}% independent</span>` : ''}${plan('roleplay', t.n, i ? 'Edit' : 'Plan')}${act(i)}`]); }).join('')}</tbody>
      </table></div>
      <p class="muted small">The trainer signs off each topic when you’ve attended it. Your checklist is kept on paper.</p>`,
    written_exam: () => `${single('written_exam', 'proctor:')}
      <p class="muted small">In person at CARE, on paper, with a proctor. Pass mark 80%.${team && one(items, 'written_exam')?.score != null ? ` Score: ${Number(one(items, 'written_exam').score)} of ${Number(one(items, 'written_exam').full_score || 130)}.` : ''}</p>`,
    overlap: () => `<div class="table-wrap"><table class="onb-table">
        <thead><tr><th>#</th><th>Focus</th><th>Date</th><th>With</th><th>Case</th><th>Sign-off</th></tr></thead>
        <tbody>${[1, 2, 3, 4, 5, 6, 7].map((n) => { const i = one(items, 'overlap', n); return row([
          n, esc(OVERLAP[n]), i?.held_on ? esc(when(i)) : '—', i?.trainer ? esc(i.trainer) : '—', i?.case_code ? esc(i.case_code) : '—',
          `${itemState(i)}${plan('overlap', n, i ? 'Edit' : 'Plan')}${act(i)}`]); }).join('')}
        ${(() => { const f = one(items, 'field_eval'); return row([8, '<strong>Field evaluation</strong>', f?.held_on ? esc(when(f)) : '—', f?.trainer ? esc(f.trainer) : '—', f?.case_code ? esc(f.case_code) : '—',
          `${itemState(f)}${team && f?.score != null ? ` <span class="small">avg ${Number(f.score)}</span>` : ''}${plan('field_eval', 0, f ? 'Edit' : 'Plan')}${act(f)}`]); })()}
        </tbody></table></div>
      <p class="muted small">Sessions 1–7: your trainer signs off each one (the checklist is on paper). Session 8: the supervisor’s field evaluation, pass with an average of 3 or more.</p>`,
    probation: () => `<p class="onb-line">${person.probation_end_date ? `${icon('calendar')} Probation ends ${esc(fmtDate(person.probation_end_date))}` : '<span class="muted">End date not set yet.</span>'}
      ${one(items, 'probation') ? `${itemState(one(items, 'probation'))}${one(items, 'probation').trainer ? ` <span class="muted small">· ${esc(one(items, 'probation').trainer)}</span>` : ''}` : '<span class="muted">Waiting for the supervisor’s review</span>'}${plan('probation', 0, one(items, 'probation') ? 'Edit' : 'Set dates & supervisor')}${act(one(items, 'probation'))}</p>`,
  };
  const done = states.filter((s) => s === 'done').length;
  return `<section class="card onb" data-onb-person="${esc(person.id)}">
    <div class="onb-hero">
      <div><p class="level-kicker">Training</p><h2>New therapist onboarding</h2></div>
      <span class="chip ${cur < 0 ? 'ok' : 'stage'}">${cur < 0 ? 'Completed 🎉' : `Step ${cur + 1} of ${STEPS.length}`}</span>
    </div>
    <ol class="onb-path" aria-label="Onboarding steps">${STEPS.map((s, i) => `<li class="${states[i]}"><button type="button" data-onb-go="${s.key}">
      <span>${states[i] === 'done' ? icon('check') : i + 1}</span>${esc(s.label)}</button></li>`).join('')}</ol>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${STEPS.length}" aria-valuenow="${done}"><span style="width:${Math.round((done / STEPS.length) * 100)}%"></span></div>
    <div class="onb-steps">${STEPS.map((s, i) => `<details class="onb-step ${states[i]}" data-onb-step="${s.key}" ${openSteps.has(s.key) || (!openSteps.size && i === cur) ? 'open' : ''}>
      <summary><span class="cstep-num">${states[i] === 'done' ? icon('check') : i + 1}</span><span class="cstep-ico">${icon(s.ico)}</span>
        <h3>${esc(s.label)}</h3><span class="onb-sum muted small">${esc(stepStatus(s.key, items, online))}</span><span class="cstep-chev">${icon('chevron-down')}</span></summary>
      <div class="onb-body">${body[s.key]()}</div></details>`).join('')}</div>
  </section>`;
}
export function wirePath(root) {
  for (const d of root.querySelectorAll('details[data-onb-step]')) {
    d.querySelector('summary').addEventListener('click', () => setTimeout(() => (d.open ? openSteps.add(d.dataset.onbStep) : openSteps.delete(d.dataset.onbStep))));
  }
  for (const b of root.querySelectorAll('[data-onb-go]')) {
    b.addEventListener('click', () => {
      const d = root.querySelector(`details[data-onb-step="${b.dataset.onbGo}"]`);
      if (d) { d.open = true; openSteps.add(b.dataset.onbGo); d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  }
}

// The trainee's own card (Training tab).
export async function drawMine(el, me, online) {
  let items;
  try { items = await loadItems(); } catch (e) { el.innerHTML = `<section class="card"><p class="error">Could not load your onboarding: ${esc(e.message)}</p></section>`; return; }
  el.innerHTML = pathCard(me, items, online);
  wirePath(el);
}

// ---------------------------------------------------------------------------
// Team view (Training tab → Trainees → New therapist onboarding)
// ---------------------------------------------------------------------------
let teamState = null;   // { body, ctx, people, staff, online, open }
export async function drawTeam(body, ctx, { programs = [], staff = [], updatePerson }) {
  teamState = { body, ctx, programs, staff, updatePerson, open: teamState?.open ?? null };
  body.innerHTML = '<p class="muted">Loading…</p>';
  let people; let enr; let all;
  try {
    people = await loadPeople();
    [enr, all] = await Promise.all([onlineStatus(people.map((p) => p.id)), Promise.all(people.map((p) => loadItems(p.id)))]);
  } catch (e) { body.innerHTML = `<p class="error">Could not load onboarding: ${esc(e.message)}</p>`; return; }
  const carewayReady = programs.some((p) => p.key === CAREWAY_KEY && p.enabled && !p.coming_soon);
  const onlineOf = (id) => {
    const st = (k) => { const r = enr.filter((x) => x.therapist_id === id && x.program_key === k && x.status !== 'withdrawn'); return r.some((x) => x.status === 'passed') ? 'passed' : r.length ? 'active' : null; };
    return { abat: st('abat'), careway: st(CAREWAY_KEY), carewayReady };
  };
  teamState.people = people.map((p, k) => ({ ...p, items: all[k], online: onlineOf(p.id) }));
  const admin = ctx.roles.includes('admin');
  body.innerHTML = teamState.people.length ? `<ul class="tr-list">${teamState.people.map((p) => {
    const { states, cur, ready } = progress(p, p.items, p.online);
    return `<li class="tr-row">
      <div class="tr-who"><strong>${esc(p.nickname || p.full_name)}</strong><span class="chip stage">${esc(STAGE_NAME[p.stage])}</span>
        ${ready ? `<span class="chip ok">Ready for ${esc(STAGE_NAME[ready])}</span>` : ''}</div>
      <div class="tr-path" aria-hidden="true">${states.map((st, i) => `<span class="${st}" title="${esc(STEPS[i].label)}"></span>`).join('')}</div>
      <div class="tr-now small">${cur >= 0 ? `Now: <strong>${esc(STEPS[cur].label)}</strong> · ${esc(stepStatus(STEPS[cur].key, p.items, p.online))}` : 'All steps done'}</div>
      <div class="tr-act"><button type="button" class="small-btn" data-onb-open="${esc(p.id)}">Open</button></div>
    </li>`;
  }).join('')}</ul>
  <p class="muted small">New therapists appear here while their stage (set in People) is Interview, Online course, Role-play & orientation, Field overlap or Probation.${admin ? ' Plan each step’s date and trainer from Open.' : ''}</p>`
    : '<p class="muted">No one is in onboarding right now. New therapists appear here once they’re added in People (CARE staff / new hire, stage Interview to Probation).</p>';
  for (const b of body.querySelectorAll('[data-onb-open]')) b.addEventListener('click', () => { teamState.open = b.dataset.onbOpen; personDialog(); });
  if (teamState.open && dlg()?.open) personDialog();
}

const dlg = () => document.getElementById('onb-dlg') || (() => { const d = document.createElement('dialog'); d.id = 'onb-dlg'; d.className = 'dlg onb-dlg'; document.body.append(d); return d; })();
const openDlg = (html) => { const d = dlg(); d.innerHTML = html; if (!d.open) d.showModal(); return d; };
const closeDlg = () => { const d = dlg(); if (d.open) d.close(); };

function personDialog() {
  const { ctx } = teamState;
  const p = teamState.people.find((x) => x.id === teamState.open);
  if (!p) return closeDlg();
  const admin = ctx.roles.includes('admin');
  const isSup = ctx.roles.some((r) => ['admin', 'supervisor'].includes(r));
  const assessor = ctx.roles.some((r) => ['admin', 'supervisor', 'qcd'].includes(r));
  const recorder = (i) => (['field_eval', 'probation'].includes(i.step) ? isSup || i.trainer_id === ctx.me.id : assessor || i.trainer_id === ctx.me.id);
  const { ready } = progress(p, p.items, p.online);
  const d = openDlg(`<div class="lh-form onb-person">
    <div class="page-head"><h2>${esc(p.nickname || p.full_name)}</h2><span class="spacer"></span><button type="button" class="small-btn" data-close>Close</button></div>
    ${ready && admin ? `<p class="onb-ready">${icon('sparkles')} Everything for <strong>${esc(STAGE_NAME[p.stage])}</strong> is done.
      <button type="button" class="primary small-btn" data-onb-move="${esc(ready)}">Move to ${esc(STAGE_NAME[ready])}</button></p>` : ''}
    ${pathCard(p, p.items, p.online, { team: true, admin, recorder })}
  </div>`);
  wirePath(d);
  d.querySelector('[data-close]').addEventListener('click', closeDlg);
  d.querySelector('[data-onb-abat]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const due = new Date(`${todayLocal()}T00:00:00`); due.setDate(due.getDate() + 14);   // new hires: 2 weeks
    const dueOn = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
    try { await assignPeople('abat', [p.id], dueOn, ctx.me.id, todayLocal()); await redraw(); } catch (err) { alert(err.message); e.currentTarget.disabled = false; }
  });
  d.querySelector('[data-onb-move]')?.addEventListener('click', async (e) => {
    const next = e.currentTarget.dataset.onbMove;
    if (!confirm(`Move ${p.nickname || p.full_name} to ${STAGE_NAME[next]}?`)) return;
    try { await teamState.updatePerson(p.id, { stage: next }); closeDlg(); teamState.open = null; await redraw(); } catch (err) { alert(err.message); }
  });
  for (const b of d.querySelectorAll('[data-onb-plan]')) {
    const [step, seq] = b.dataset.onbPlan.split('|');
    b.addEventListener('click', () => planDialog(p, step, Number(seq)));
  }
  for (const b of d.querySelectorAll('[data-onb-rec]')) b.addEventListener('click', () => recordDialog(p, p.items.find((i) => i.id === b.dataset.onbRec)));
}
async function redraw() {
  const { body, ctx, programs, staff, updatePerson } = teamState;
  await drawTeam(body, ctx, { programs, staff, updatePerson });
  if (teamState.open) personDialog();
}

const STEP_TITLE = { interview: 'Interview', orientation: 'Orientation', written_exam: 'Written exam', field_eval: 'Field evaluation (session 8)', probation: 'Probation review' };
function planDialog(p, step, seq) {
  const i = one(p.items, step, seq);
  const staff = teamState.staff.filter((s) => s.status !== 'exited' && s.track === 'care_hire' && s.id !== p.id && s.roles?.some((r) => r !== 'applicant'));
  const fit = step === 'roleplay' ? staff.filter((s) => s.roles.some((r) => ['supervisor', 'qcd'].includes(r)))
    : ['field_eval', 'probation'].includes(step) ? staff.filter((s) => s.roles.includes('supervisor')) : staff;
  // Overlap: seniors first (the preferred trainers).
  const rank = (s) => (s.roles.includes('senior') ? 0 : s.roles.some((r) => ['qcd', 'supervisor'].includes(r)) ? 1 : 2);
  if (step === 'overlap') fit.sort((a, b) => rank(a) - rank(b) || (a.nickname || a.full_name).localeCompare(b.nickname || b.full_name));
  const title = step === 'roleplay' ? `Role-play ${seq}: ${ROLEPLAY[seq - 1].title}` : step === 'overlap' ? `Overlap session ${seq}` : STEP_TITLE[step];
  const whoLabel = step === 'roleplay' ? 'Trainer (supervisor or QCD)' : step === 'overlap' ? 'Trainer (therapist they shadow; seniors first)'
    : step === 'written_exam' ? 'Proctor' : ['field_eval', 'probation'].includes(step) ? 'Supervisor' : step === 'interview' ? 'Interviewer' : 'Run by';
  const d = openDlg(`<form class="lh-form" method="dialog">
    <h2>${esc(p.nickname || p.full_name)} · ${esc(title)}</h2>
    ${step === 'overlap' ? `<p class="muted small">${esc(OVERLAP[seq])}</p>` : ''}
    ${step === 'probation' ? `<label>Probation ends <span class="muted small">(also changes it in People)</span><input type="date" name="end_on" value="${esc(p.probation_end_date || '')}"></label>` : ''}
    ${`<div class="lh-2col">
      <label>${step === 'probation' ? 'Review date <span class="muted small">(with the supervisor)</span>' : 'Date'}<input type="date" name="held_on" value="${esc(i?.held_on || '')}"></label>
      <label>Start time <span class="muted small">(optional)</span><input type="time" name="start_time" value="${esc(i?.start_time?.slice(0, 5) || '')}"></label>
    </div>`}
    ${['orientation', 'written_exam', 'interview'].includes(step) ? `<label>Place <span class="muted small">(optional)</span><input name="place" maxlength="120" value="${esc(i?.place || '')}"></label>` : ''}
    <label>${esc(whoLabel)}<select name="trainer_id"><option value="">Not chosen yet</option>
      ${fit.map((s) => `<option value="${esc(s.id)}" ${i?.trainer_id === s.id ? 'selected' : ''}>${esc(s.nickname || s.full_name)}${step === 'overlap' && s.roles.includes('senior') ? ' (Senior)' : ''}</option>`).join('')}</select></label>
    ${['overlap', 'field_eval'].includes(step) ? `<label>Case code <span class="muted small">(3 letters, never a name)</span><input name="case_code" maxlength="3" pattern="[A-Za-z]{3}" value="${esc(i?.case_code || '')}" placeholder="ABC" style="text-transform:uppercase"></label>` : ''}
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="submit" class="primary">${icon('check')} Save</button><button type="button" data-back>Back</button>
      ${i && !i.recorded_at ? '<span class="spacer"></span><button type="button" class="small-btn" data-del>Remove</button>' : ''}</div>
  </form>`);
  const f = d.querySelector('form');
  const msg = (t) => { const m = d.querySelector('[data-msg]'); m.textContent = t; m.hidden = false; };
  d.querySelector('[data-back]').addEventListener('click', personDialog);
  d.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm('Remove this from the plan?')) return;
    try { await removeItem(i.id); await redraw(); } catch (e) { msg(e.message); }
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      if (step === 'probation' && (f.end_on.value || null) !== (p.probation_end_date || null)) {
        await teamState.updatePerson(p.id, { probation_end_date: f.end_on.value || null });
      }
      await planItem({ who: p.id, step, seq, held_on: f.held_on?.value, start_time: f.start_time?.value, place: f.place?.value,
        trainer_id: f.trainer_id.value, case_code: f.case_code?.value });
      await redraw();
    } catch (err) { msg(err.message); }
  });
}

function recordDialog(p, i, { onSaved = redraw, onBack = personDialog } = {}) {
  const step = i.step;
  const title = step === 'roleplay' ? `Role-play ${i.seq}: ${ROLEPLAY[i.seq - 1].title}` : step === 'overlap' ? `Overlap session ${i.seq}` : STEP_TITLE[step];
  const choices = step === 'probation' ? [] : step === 'roleplay' || step === 'overlap' ? [['done', 'Attended and signed off'], ['attended', 'Attended (not signed off yet)'], ['missed', 'Missed']]
    : ['written_exam', 'field_eval'].includes(step) ? [['done', 'Done: enter the result'], ['missed', 'Missed']] : [['done', 'Done'], ['missed', 'Missed']];
  const cur = i.status === 'planned' ? (choices[0]?.[0] ?? 'done') : i.status;
  const d = openDlg(`<form class="lh-form" method="dialog">
    <h2>${esc(p.nickname || p.full_name || p.trainee || '')} · ${esc(title)}</h2>
    <p class="muted small">${i.held_on ? esc(when(i)) : 'No date set'}${i.case_code ? ` · case ${esc(i.case_code)}` : ''}${i.trainer ? ` · ${esc(i.trainer)}` : ''}</p>
    ${choices.length ? `<fieldset class="onb-choices"><legend>What happened?</legend>${choices.map(([v, l]) => `<label class="check"><input type="radio" name="status" value="${v}" ${cur === v ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</fieldset>` : ''}
    ${step === 'roleplay' ? `<label>% Independent (from the competency checklist) <span class="muted small">optional; 80% = pass</span><input type="number" name="score" min="0" max="100" step="1" value="${i.score ?? ''}"></label>` : ''}
    ${step === 'written_exam' ? `<label>Score (out of ${Number(i.full_score || 130)}) <span class="muted small">pass = ${Math.ceil(0.8 * (i.full_score || 130))}</span><input type="number" name="score" min="0" max="${Number(i.full_score || 130)}" step="0.5" value="${i.score ?? ''}"></label>` : ''}
    ${step === 'field_eval' ? `<div class="lh-2col"><label>Average score (0–4) <span class="muted small">pass = 3 or more</span><input type="number" name="score" min="0" max="4" step="0.01" value="${i.score ?? ''}"></label>
      <label>Reviewed with the trainee on<input type="date" name="reviewed_on" value="${esc(i.reviewed_on || '')}"></label></div>` : ''}
    ${step === 'probation' ? `<fieldset class="onb-choices"><legend>Probation review</legend>
      <label class="check"><input type="radio" name="passed" value="1" ${i.passed === true ? 'checked' : ''}> Passed</label>
      <label class="check"><input type="radio" name="passed" value="0" ${i.passed === false ? 'checked' : ''}> Not yet</label></fieldset>` : ''}
    <label>Short note <span class="muted small">(optional; the trainee doesn’t see it)</span><textarea name="note" rows="2" maxlength="500">${esc(i.note || '')}</textarea></label>
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="submit" class="primary">${icon('check')} Save</button><button type="button" data-back>Back</button>
      ${i.recorded_at ? '<span class="spacer"></span><button type="button" class="small-btn" data-clear>Clear result</button>' : ''}</div>
  </form>`);
  const f = d.querySelector('form');
  const msg = (t) => { const m = d.querySelector('[data-msg]'); m.textContent = t; m.hidden = false; };
  d.querySelector('[data-back]').addEventListener('click', onBack);
  d.querySelector('[data-clear]')?.addEventListener('click', async () => {
    if (!confirm('Clear this result?')) return;
    try { await recordItem(i.id, { status: 'planned' }); await onSaved(); } catch (e) { msg(e.message); }
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = step === 'probation' ? 'done' : f.status?.value;
    const score = f.score && f.score.value !== '' ? Number(f.score.value) : null;
    if (step === 'probation' && !f.passed?.value) return msg('Choose Passed or Not yet.');
    try {
      await recordItem(i.id, { status, score, passed: step === 'probation' ? f.passed.value === '1' : null, reviewed_on: f.reviewed_on?.value, note: f.note.value });
      await onSaved();
    } catch (err) { msg(err.message); }
  });
}

// ---------------------------------------------------------------------------
// A trainer's own sessions (anyone who leads overlap / role-play / exams)
// ---------------------------------------------------------------------------
export async function drawLed(el) {
  let led;
  try { led = await loadLed(); } catch { return; }
  const open = led.filter((i) => i.status !== 'done' || (i.step === 'probation' && i.passed == null));
  if (!open.length) { el.hidden = true; return; }
  const label = (i) => (i.step === 'roleplay' ? `Role-play ${i.seq}: ${ROLEPLAY[i.seq - 1]?.title}` : i.step === 'overlap' ? `Overlap session ${i.seq}` : STEP_TITLE[i.step]);
  el.hidden = false;
  el.innerHTML = `<section class="card"><h2>Onboarding sessions you lead</h2>
    <p class="muted small">Record attendance and sign off after each session. The checklists stay on paper.</p>
    <ul class="onb-led">${open.map((i) => `<li>
      <span><strong>${esc(i.trainee)}</strong> · ${esc(label(i))}${i.case_code ? ` · case ${esc(i.case_code)}` : ''}</span>
      <span class="muted small">${i.held_on ? esc(when(i)) : 'date to be set'}</span>
      <span>${itemState(i)} <button type="button" class="small-btn" data-led="${esc(i.id)}">Record</button></span></li>`).join('')}</ul></section>`;
  for (const b of el.querySelectorAll('[data-led]')) {
    b.addEventListener('click', () => {
      const i = led.find((x) => x.id === b.dataset.led);
      recordDialog({ nickname: i.trainee }, i, { onSaved: async () => { closeDlg(); await drawLed(el); }, onBack: closeDlg });
    });
  }
}
