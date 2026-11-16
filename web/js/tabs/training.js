// Training tab: my programmes (modules, exam, certificate) and, for the
// training team, everyone's progress. Exams are marked on the server; this
// page never sees the answers.
import {
  loadContent, loadMyTraining, setItemDone, agreeStep, examStart, examSave, examSubmit, examMySummary, examReview,
  loadTeamProgram, allowRetake, setDueDate, assignPeople,
  recommend, approveRecommendation, declineRecommendation, recordResult, logHours, removeHours, saveEval, promote,
  loadGroups, saveGroup, deleteGroup, setGroupMembers, saveSession, deleteSession, takeAttendance,
  uploadAssignment, workUrl, reviewSubmission, WORK_ACCEPT,
} from '../training-data.js';
import { rankOf } from '../labels.js';
import { docHtml } from '../doc-text.js';
import { listStaff } from '../data.js';
import { esc, fmtDate, todayLocal } from '../ui.js';
import { icon } from '../icons.js';

const TEAM = ['admin', 'hr', 'supervisor', 'qcd'];
const STATUS_LABEL = {
  recommended: 'Recommended · waiting for admin approval',
  active: 'In progress',
  passed: 'Completed 🎉',
  not_passed: 'Not passed',
  withdrawn: 'Withdrawn',
};

let ctx;      // { me, roles }
let panelEl;
let content;  // { programs, steps, items }
let mine;     // { enrollments, done, attempts, certificates }

const isTeam = () => ctx.roles.some((r) => TEAM.includes(r));
const isAdmin = () => ctx.roles.includes('admin');
const canReview = () => ctx.roles.some((r) => ['admin', 'supervisor', 'qcd'].includes(r));
const canRetake = () => ctx.roles.some((r) => r === 'admin' || r === 'supervisor');
const safeUrl = (u) => (/^https?:\/\//i.test(u ?? '') ? u : null);
const stepsOf = (key) => content.steps.filter((s) => s.program_key === key);
const itemsOf = (stepId) => content.items.filter((i) => i.step_id === stepId);
const canTick = (it) => (it.kind === 'document' ? !!it.body : it.kind === 'video' ? true : !!safeUrl(it.url));

// Canva designs are shown INSIDE the Portal (no link to copy on screen).
// Only real Canva design links are embedded; anything else opens normally.
function canvaEmbed(url) {
  const m = /^https:\/\/(?:www\.)?canva\.com\/design\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?/.exec(url ?? '');
  if (!m) return null;
  return `https://www.canva.com/design/${m[1]}${m[2] && m[2] !== 'view' && m[2] !== 'edit' ? `/${m[2]}` : ''}/view?embed`;
}

const agreedOn = (enrId, stepId) => mine.stepsDone.find((d) => d.enrollment_id === enrId && d.step_id === stepId);
function examLocks(step, enr) {
  const locks = [];
  if (enr.due_on && enr.due_on < todayLocal()) locks.push(`The finish date (${fmtDate(enr.due_on)}) has passed. Please ask your supervisor or an admin for an extension.`);
  const agree = stepsOf(step.program_key).filter((s) => s.kind === 'agree');
  if (agree.some((s) => !agreedOn(enr.id, s.id))) locks.push('Read and agree to the course policies first (step above).');
  if (step.config?.require_modules) {
    const items = stepsOf(step.program_key).filter((s) => s.kind === 'learn').flatMap((s) => itemsOf(s.id));
    const n = items.filter((i) => mine.done.some((d) => d.enrollment_id === enr.id && d.item_id === i.id)).length;
    if (n < items.length) locks.push(`Finish all the lessons first (${n} of ${items.length} done).`);
  }
  return locks;
}

export async function render(panel, context) {
  ctx = context;
  panelEl = panel;
  panel.innerHTML = '<p class="muted">Loading…</p>';
  try {
    [content, mine] = await Promise.all([loadContent(), loadMyTraining(ctx.me.id)]);
  } catch (e) {
    panel.innerHTML = `<section class="card"><p class="error">Could not load training: ${esc(e.message)}</p></section>`;
    return;
  }
  drawHome();
}

async function refresh() {
  mine = await loadMyTraining(ctx.me.id);
  drawHome();
}

// ---------------------------------------------------------------------------
// Home: my programmes + (team) trainees
// ---------------------------------------------------------------------------
function myCurrent() {
  // Latest place per programme, newest first.
  const seen = new Set();
  return mine.enrollments.filter((e) => {
    if (e.status === 'withdrawn' || seen.has(e.program_key)) return false;
    seen.add(e.program_key);
    return true;
  });
}

// CARE staff (not applicants or ABAT learners) can look through a programme
// they haven't been assigned to, read-only.
function previewPrograms(current) {
  const staff = ctx.me.track !== 'abat' && rankOf(ctx.roles) !== 'applicant';
  if (!staff) return [];
  // Programmes that lead to a rank are previewed only by the rank below
  // (Senior training: Junior therapists; QCD training: Senior therapists).
  const fromRank = { senior: 'therapist', qcd: 'senior' };
  return content.programs.filter((p) => p.enabled && !current.some((e) => e.program_key === p.key)
    && (!p.promotes_to || rankOf(ctx.roles) === fromRank[p.promotes_to]));
}

function drawHome() {
  const current = myCurrent();
  const previews = previewPrograms(current);
  const teamPrograms = content.programs.filter((p) => p.enabled);
  panelEl.innerHTML = `
    <div id="my-training">
    ${current.map(programCard).join('')}
    ${previews.map(previewCard).join('')}
    </div>
    ${!current.length && !previews.length
      ? `<section class="card"><h2>My training</h2>
           <p class="muted">You're not in a training programme right now. When you are, it will appear here.</p></section>` : ''}
    ${isTeam() ? `
      <section class="card" id="team-card">
        <div class="page-head">
          <h2>Trainees</h2>
          <span class="spacer"></span>
          <div class="seg" role="tablist" id="team-view" hidden>
            <button type="button" role="tab" data-view="trainees" aria-selected="true">People</button>
            <button type="button" role="tab" data-view="groups" aria-selected="false">Groups & schedule</button>
          </div>
          <select id="team-prog" aria-label="Programme">
            ${teamPrograms.map((p) => `<option value="${esc(p.key)}">${esc(p.title)}</option>`).join('')}
          </select>
        </div>
        <div id="team-body" aria-live="polite"><p class="muted">Loading…</p></div>
      </section>` : ''}
    <dialog id="tr-dlg" class="dlg"></dialog>`;

  for (const box of panelEl.querySelectorAll('input[data-item]')) {
    box.addEventListener('change', async () => {
      box.disabled = true;
      try {
        await setItemDone(box.dataset.enr, box.dataset.item, box.checked);
        if (box.checked) mine.done.push({ enrollment_id: box.dataset.enr, item_id: box.dataset.item });
        else mine.done = mine.done.filter((d) => !(d.enrollment_id === box.dataset.enr && d.item_id === box.dataset.item));
        const card = box.closest('[data-step]');
        const count = card?.querySelector('.step-count');
        if (count) count.textContent = learnCount(box.dataset.enr, card.dataset.step);
        box.closest('.lesson')?.classList.toggle('done', box.checked);
        updateProgress(box.dataset.enr);
      } catch (e) {
        box.checked = !box.checked;
        alert(e.message);
      } finally {
        box.disabled = false;
      }
    });
  }
  // Remember only what the person opens/closes (the browser also fires
  // "toggle" when a step is drawn open, which mustn't count).
  for (const d of panelEl.querySelectorAll('details[data-fold]')) {
    d.querySelector('summary').addEventListener('click', () => stepOpen.set(d.dataset.fold, !d.open));
  }
  const showSteps = (card, key, show) => {
    const list = card.querySelector(`[data-steps="${CSS.escape(key)}"]`);
    const btn = card.querySelector(`[data-steps-toggle="${CSS.escape(key)}"]`);
    if (!list || !btn) return;
    list.hidden = !show;
    if (show) courseOpen.add(key); else courseOpen.delete(key);
    btn.setAttribute('aria-expanded', String(show));
    btn.innerHTML = `${show ? 'Hide steps' : 'Show steps'} ${icon('chevron-down')}`;
  };
  for (const b of panelEl.querySelectorAll('[data-steps-toggle]')) {
    b.addEventListener('click', () => showSteps(b.closest('.course'), b.dataset.stepsToggle, !courseOpen.has(b.dataset.stepsToggle)));
  }
  // Tapping a step in the path opens the steps with that one unfolded.
  for (const b of panelEl.querySelectorAll('[data-goto]')) {
    b.addEventListener('click', () => {
      const card = b.closest('.course');
      const key = card.querySelector('[data-steps]')?.dataset.steps;
      showSteps(card, key, true);
      const d = card.querySelector(`details[data-fold="${CSS.escape(b.dataset.goto)}"]`);
      if (d) { d.open = true; stepOpen.set(b.dataset.goto, true); d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  }
  for (const inp of panelEl.querySelectorAll('#my-training input[data-upload]')) {
    inp.addEventListener('change', async () => {
      const file = inp.files[0];
      if (!file) return;
      const [enrId, stepId, ch] = inp.dataset.upload.split('|');
      const row = inp.closest('.asg');
      const msg = row.querySelector('.asg-msg');
      msg.hidden = false; msg.className = 'asg-msg small muted'; msg.textContent = 'Uploading…';
      try {
        await uploadAssignment(enrId, stepId, Number(ch), file);
        stepOpen.set(stepId, true);
        courseOpen.add(content.steps.find((x) => x.id === stepId).program_key);
        await refresh();
      } catch (e) { msg.className = 'asg-msg small error'; msg.textContent = e.message; inp.value = ''; }
    });
  }
  for (const b of panelEl.querySelectorAll('#my-training [data-work]')) {
    b.addEventListener('click', async () => {
      const w = window.open('', '_blank');
      try { const url = await workUrl(b.dataset.work); if (w) w.location = url; else window.location.href = url; } catch (e) { w?.close(); alert(e.message); }
    });
  }
  for (const b of panelEl.querySelectorAll('#my-training [data-pr]')) {
    b.addEventListener('click', () => {
      const [stepId, enrId, section, seq] = b.dataset.pr.split('|');
      const step = content.steps.find((x) => x.id === stepId);
      const enr = mine.enrollments.find((x) => x.id === enrId);
      const slot = practicumSlots(step).find((x) => x.section === section && x.seq === Number(seq));
      practicumDialog(step, enr, slot, evalFor(mine.evals, enrId, stepId, slot), { editable: false });
    });
  }
  for (const b of panelEl.querySelectorAll('[data-start-exam]')) {
    b.addEventListener('click', () => confirmStart(content.steps.find((s) => s.id === b.dataset.startExam), b.dataset.resume === '1'));
  }
  for (const b of panelEl.querySelectorAll('[data-cert]')) {
    b.addEventListener('click', () => showCertificate(mine.certificates.find((c) => c.id === b.dataset.cert)));
  }
  for (const b of panelEl.querySelectorAll('[data-summary]')) {
    b.addEventListener('click', () => showSummary(b.dataset.summary));
  }
  for (const b of panelEl.querySelectorAll('[data-read]')) {
    b.addEventListener('click', () => showDocument(content.items.find((i) => i.id === b.dataset.read)));
  }
  for (const b of panelEl.querySelectorAll('[data-canva]')) {
    b.addEventListener('click', () => showCanva(content.items.find((i) => i.id === b.dataset.canva)));
  }
  for (const box of panelEl.querySelectorAll('input[data-agree-box]')) {
    const btn = panelEl.querySelector(`[data-agree="${box.dataset.agreeBox}"]`);
    box.addEventListener('change', () => { btn.disabled = !box.checked; });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await agreeStep(btn.dataset.enr, btn.dataset.agree);
        await refresh();
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
      }
    });
  }
  if (isTeam()) {
    const sel = panelEl.querySelector('#team-prog');
    const seg = panelEl.querySelector('#team-view');
    const show = () => {
      const hasGroups = stepsOf(sel.value).some((x) => x.kind === 'session');
      seg.hidden = !hasGroups;
      if (!hasGroups) teamView = 'trainees';
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.view === teamView));
      teamOpen = null;
      return teamView === 'groups' ? drawGroups(sel.value) : drawTeam(sel.value);
    };
    sel.addEventListener('change', show);
    for (const b of seg.querySelectorAll('button')) b.addEventListener('click', () => { teamView = b.dataset.view; show(); });
    if (sel.value) show();
    else panelEl.querySelector('#team-body').innerHTML = '<p class="muted">No programmes are switched on yet.</p>';
  }
}

// Course progress: lessons ticked (ABAT), or steps completed for programmes
// with recorded steps (Senior, QCD), where lessons are only the first part.
function progressOf(prog, enr) {
  const steps = stepsOf(prog.key);
  if (steps.some((s) => ['session', 'result', 'practicum'].includes(s.kind))) {
    const st = stepStates(prog, enr);
    return { done: st.filter((x) => x === 'done').length, total: steps.length, unit: 'steps' };
  }
  const lessons = steps.filter((s) => s.kind === 'learn').flatMap((s) => itemsOf(s.id));
  return { done: enr ? lessons.filter((i) => mine.done.some((d) => d.enrollment_id === enr.id && d.item_id === i.id)).length : 0, total: lessons.length, unit: '' };
}
const progressText = (p) => `${p.done} of ${p.total}${p.unit ? ` ${p.unit}` : ''} done`;

function updateProgress(enrId) {
  const box = panelEl.querySelector(`[data-progress="${CSS.escape(enrId)}"]`);
  const enr = mine.enrollments.find((e) => e.id === enrId);
  const prog = enr && content.programs.find((p) => p.key === enr.program_key);
  if (!box || !prog) return;
  const p = progressOf(prog, enr);
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  box.querySelector('.progress span').style.width = `${pct}%`;
  box.querySelector('.progress').setAttribute('aria-valuenow', pct);
  box.querySelector('[data-progress-text]').textContent = progressText(p);
}

function learnCount(enrId, stepId) {
  const items = itemsOf(stepId);
  const n = items.filter((i) => mine.done.some((d) => d.enrollment_id === enrId && d.item_id === i.id)).length;
  return `${n} of ${items.length} ${items.some((i) => i.kind === 'video') ? 'watched' : 'done'}`;
}

// ---- Course page pieces (design 2026-11-16: calm, no "Module" wording, one
// line icon per step, domain letters for lessons) ----------------------------
const STEP_ICO = { agree: 'file-text', learn: 'book', exam: 'clock', certificate: 'award', practicum: 'user-check', session: 'school', gap: 'calendar', result: 'file-text' };
const STEP_SHORT = { agree: 'Policies', learn: 'Coursework', exam: 'Exam', certificate: 'Certificate', practicum: 'Practicum', session: 'Training', gap: 'Review' };
const stepIcon = (s) => (s.kind === 'result' && s.config?.mode === 'oral' ? 'users' : STEP_ICO[s.kind] ?? 'sparkles');
const stepShort = (s) => (s.kind === 'learn' && itemsOf(s.id).some((i) => i.kind === 'video') ? 'Videos' : STEP_SHORT[s.kind] ?? s.title);

// "Module 5 — Skill Acquisition 1 (goals, prompting…)" → { title, sub }
function lessonName(t) {
  const clean = String(t ?? '').replace(/^\s*module\s*\d+\s*[—–:-]\s*/i, '');
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(clean);
  return m ? { title: m[1], sub: m[2] } : { title: clean, sub: '' };
}
const domainOf = (it) => (/domain\s+([A-Z])\b/i.exec(it.note ?? '') || [])[1]?.toUpperCase() || '';
const hoursOf = (it) => Number((/([\d.]+)\s*h\b/.exec(it.note ?? '') || [])[1] || 0);
const metaOf = (it) => (domainOf(it) ? String(it.note ?? '') : '');

function lessonAction(it) {
  const url = safeUrl(it.url);
  if (it.kind === 'video' && !url) return '<span class="muted small nowrap">Link from Admin</span>';
  if (it.kind === 'document' && it.body) return `<button type="button" class="small-btn" data-read="${esc(it.id)}">Read</button>`;
  if (canvaEmbed(url)) return `<button type="button" class="small-btn" data-canva="${esc(it.id)}">${icon('player-play')} Open</button>`;
  if (url) return `<a class="small-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open</a>`;
  return '<span class="muted small nowrap">Coming soon</span>';
}

// One lesson row. enr = null for a read-only preview.
function lessonRow(it, enr, ico = null) {
  const d = domainOf(it);
  const { title, sub } = lessonName(it.title);
  const done = !!enr && mine.done.some((x) => x.enrollment_id === enr.id && x.item_id === it.id);
  const tile = d ? `<span class="lesson-tile d-${esc(d)}" aria-hidden="true">${esc(d)}</span>`
    : `<span class="lesson-tile d-read" aria-hidden="true">${icon(ico || (it.kind === 'document' ? 'books' : it.kind === 'video' ? 'player-play' : 'link'))}</span>`;
  const meta = d ? metaOf(it) : (it.note ? it.note : '');
  const tick = enr ? `<label class="tick" title="Mark as done">
      <input type="checkbox" data-enr="${esc(enr.id)}" data-item="${esc(it.id)}"${done ? ' checked' : ''}${enr.status === 'active' && canTick(it) ? '' : ' disabled'}>
      <span class="tick-box">${icon('check')}</span><span class="sr-only">Done: ${esc(title)}</span></label>` : '';
  return `<li class="lesson${done ? ' done' : ''}">
    ${tile}
    <span class="lesson-main">
      <span class="lesson-title">${esc(title)}</span>
      ${sub ? `<span class="lesson-sub">${esc(sub)}</span>` : ''}
      ${meta ? `<span class="lesson-meta">${esc(meta)}</span>` : ''}
    </span>
    <span class="lesson-act">${lessonAction(it)}${tick}</span>
  </li>`;
}

// Each step folds open/closed. Every step starts closed with a one-line status
// (Songg 2026-11-16: "all closed, leave only a brief step"); what you open or
// close stays that way until you leave the tab.
const stepOpen = new Map(); // step id → true/false (chosen by the person)
// The course card shows only its header until "Show steps" (or a step in the
// path) is tapped. Remembered while you stay on the tab.
const courseOpen = new Set(); // programme keys
function stepShell(step, n, state, inner, status = '', defaultOpen = false) {
  const open = stepOpen.has(step.id) ? stepOpen.get(step.id) : defaultOpen;
  return `<li class="cstep ${state}" data-kind="${esc(step.kind)}"${step.kind === 'learn' ? ` data-step="${esc(step.id)}"` : ''}>
    <details data-fold="${esc(step.id)}"${open ? ' open' : ''}>
      <summary class="cstep-head">
        <span class="cstep-num" aria-hidden="true">${state === 'done' ? icon('check') : n}</span>
        <span class="cstep-ico" aria-hidden="true">${icon(stepIcon(step))}</span>
        <h3>${esc(step.title)}</h3>
        ${status ? `<span class="cstep-status${state === 'done' ? ' ok' : ''}${step.kind === 'learn' ? ' step-count' : ''}">${esc(status)}</span>` : ''}
        <span class="cstep-chev" aria-hidden="true">${icon('chevron-down')}</span>
      </summary>
      ${step.details ? `<p class="cstep-details">${esc(step.details)}</p>` : ''}
      ${inner}
    </details>
  </li>`;
}

// Where someone is: which steps are done, and which is current.
function stepStates(prog, enr) {
  const steps = stepsOf(prog.key);
  const done = (s) => {
    if (!enr) return false;
    if (s.kind === 'agree') return !!agreedOn(enr.id, s.id);
    if (s.kind === 'learn') { const it = itemsOf(s.id); return it.length > 0 && it.every((i) => mine.done.some((d) => d.enrollment_id === enr.id && d.item_id === i.id)); }
    if (s.kind === 'exam') return mine.attempts.some((a) => a.enrollment_id === enr.id && a.step_id === s.id && a.passed);
    if (s.kind === 'certificate') return mine.certificates.some((c) => c.enrollment_id === enr.id);
    if (s.kind === 'session') return hoursFor(enr.id, s.id) >= (s.config?.target_hours ?? Infinity);
    if (s.kind === 'result' || s.kind === 'practicum') return !!resultFor(enr.id, s.id)?.passed;
    if (s.kind === 'gap') { // done once anything after it has a result
      const later = steps.filter((x) => x.sort_order > s.sort_order && ['result', 'practicum'].includes(x.kind));
      return later.some((x) => resultFor(enr.id, x.id));
    }
    return false;
  };
  let currentSet = false;
  return steps.map((s) => {
    if (done(s)) return 'done';
    if (enr && !currentSet) { currentSet = true; return 'current'; }
    return 'todo';
  });
}

function courseHero(prog, enr, statusChip) {
  const steps = stepsOf(prog.key);
  const lessons = steps.filter((s) => s.kind === 'learn').flatMap((s) => itemsOf(s.id));
  const mods = lessons.filter((i) => domainOf(i));
  const vids = lessons.filter((i) => i.kind === 'video');
  const stepIds = new Set(steps.map((x) => x.id));
  const nextSes = enr ? (mine.sessions || []).find((x) => x.status === 'planned' && x.held_on >= todayLocal() && (!x.step_id || stepIds.has(x.step_id))) : null;
  const hrs = lessons.reduce((t, i) => t + hoursOf(i), 0);
  const prg = progressOf(prog, enr);
  const pct = prg.total ? Math.round((prg.done / prg.total) * 100) : 0;
  const states = stepStates(prog, enr);
  let due = '';
  if (enr?.due_on && enr.status === 'active') {
    const days = Math.round((Date.parse(enr.due_on) - Date.parse(todayLocal())) / 86400000);
    due = days < 0 ? `<span class="pill warn">${icon('clock')} Finish date passed (${esc(fmtDate(enr.due_on))})</span>`
      : `<span class="pill">${icon('clock')} Finish by ${esc(fmtDate(enr.due_on))} · ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} left`}</span>`;
  }
  return `<header class="course-hero">
    <div class="course-top">
      <div>
        <p class="level-kicker">Training</p>
        <h2>${esc(prog.title)}</h2>
        ${prog.accreditation ? `<p class="course-accr">${icon('award')} ${esc(prog.accreditation)}</p>` : ''}
      </div>
      ${statusChip}
    </div>
    ${prog.summary ? `<p class="course-sum">${esc(prog.summary)}</p>` : ''}
    <div class="course-pills">
      ${mods.length ? `<span class="pill">${icon('book')} ${mods.length} lessons${hrs ? ` · about ${Math.round(hrs)} h` : ''}</span>` : ''}
      ${vids.length ? `<span class="pill">${icon('player-play')} ${vids.length} videos</span>` : ''}
      ${nextSes ? `<span class="pill next">${icon('calendar')} Next: ${esc(fmtDay(nextSes.held_on))}${nextSes.start_time ? `, ${esc(fmtTime(nextSes.start_time))}` : ''}</span>` : ''}
      ${steps.filter((x) => x.kind === 'session').map((x) => `<span class="pill">${icon('school')} ${x.config?.target_hours ?? ''} h in-person training</span>`).join('')}
      ${due}
    </div>
    ${enr ? `<div class="course-progress" data-progress="${esc(enr.id)}">
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
      <span class="small muted" data-progress-text>${esc(progressText(prg))}</span></div>` : ''}
    <ol class="course-path" aria-label="Course steps">${steps.map((s, i) => `
      <li class="${states[i]}"${states[i] === 'current' ? ' aria-current="step"' : ''}><button type="button" class="path-btn" data-goto="${esc(s.id)}"><span>${states[i] === 'done' ? icon('check') : i + 1}</span>${esc(stepShort(s))}</button></li>`).join('')}
    </ol>
    <button type="button" class="course-toggle" data-steps-toggle="${esc(prog.key)}" aria-expanded="${courseOpen.has(prog.key)}">${courseOpen.has(prog.key) ? 'Hide steps' : 'Show steps'} ${icon('chevron-down')}</button>
  </header>`;
}

function previewCard(prog) {
  const steps = stepsOf(prog.key);
  return `
    <section class="card course preview-card">
      ${courseHero(prog, null, '<span class="chip">Preview</span>')}
      <p class="lock-note">${icon('lock')} You can look through the course. To take part and sit the exam, an admin needs to assign you. Ask your supervisor if you'd like to join.</p>
      <ol class="csteps" data-steps="${esc(prog.key)}"${courseOpen.has(prog.key) ? '' : ' hidden'}>${steps.map((s, i) => stepShell(s, i + 1, 'todo',
        ['learn', 'agree'].includes(s.kind) && itemsOf(s.id).length
          ? `<ul class="lessons">${itemsOf(s.id).map((it) => lessonRow(it, null)).join('')}</ul>`
          : s.kind === 'exam' ? `${examFacts(s)}<p class="muted small">Opens when you are assigned.</p>` : '', previewStatus(s))).join('')}</ol>
    </section>`;
}

function programCard(enr) {
  const prog = content.programs.find((p) => p.key === enr.program_key);
  if (!prog) return '';
  const states = stepStates(prog, enr);
  const chip = `<span class="chip ${enr.status === 'passed' ? 'ok' : 'stage'}">${esc(STATUS_LABEL[enr.status] ?? enr.status)}</span>`;
  return `
    <section class="card course">
      ${courseHero(prog, enr, chip)}
      <ol class="csteps" data-steps="${esc(prog.key)}"${courseOpen.has(prog.key) ? '' : ' hidden'}>${stepsOf(prog.key).map((s, i) => stepHtml(s, enr, i + 1, states[i])).join('')}</ol>
    </section>`;
}

function examFacts(step) {
  const c = step.config || {};
  const max = c.max_attempts ?? 1;
  return `<div class="course-pills">
    <span class="pill">${icon('clock')} ${esc(c.time_limit_min ?? 120)} minutes</span>
    ${c.pass_mark ? `<span class="pill">Pass mark ${esc(c.pass_mark)}%</span>` : ''}
    <span class="pill">${max === 1 ? 'One attempt' : `${max} attempts${c.retake_wait_days ? `, ${c.retake_wait_days} days apart` : ''}`}</span>
  </div>`;
}

function stepHtml(step, enr, n = 1, state = 'todo') {
  const active = enr.status === 'active';
  const status = stepStatus(step, enr, myData());

  if (step.kind === 'agree') {
    const docs = itemsOf(step.id);
    const done = agreedOn(enr.id, step.id);
    const names = docs.map((d) => d.title).join(' and ');
    return stepShell(step, n, state, `
      <ul class="lessons">${docs.map((d) => lessonRow(d, null, 'file-text')).join('')}</ul>
      ${done
        ? `<p class="ok-text">${icon('check')} You agreed on ${esc(new Date(done.done_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium' }))}.</p>`
        : active ? `<label class="check agree-box"><input type="checkbox" data-agree-box="${esc(step.id)}">
              <span>I have read and agree to the ${esc(names || 'course policies')}.</span></label>
            <button type="button" class="primary" data-agree="${esc(step.id)}" data-enr="${esc(enr.id)}" disabled>I agree</button>`
          : ''}`, status);
  }

  if (step.kind === 'learn') {
    const items = itemsOf(step.id);
    return stepShell(step, n, state,
      items.length ? `<ul class="lessons">${items.map((it) => lessonRow(it, enr)).join('')}</ul>` : '<p class="muted small">The lessons will appear here soon.</p>', status);
  }

  if (step.kind === 'exam') {
    const atts = mine.attempts.filter((a) => a.enrollment_id === enr.id && a.step_id === step.id);
    const open = atts.find((a) => a.status === 'in_progress');
    const passed = atts.some((a) => a.passed);
    const max = step.config?.max_attempts ?? 1;
    const left = max + (enr.extra_attempts ?? 0) - atts.length;
    const wait = step.config?.retake_wait_days ?? 0;
    const lastSub = atts.filter((a) => a.submitted_at).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];
    const reSitFrom = lastSub && wait ? new Date(Date.parse(lastSub.submitted_at) + wait * 86400000) : null;
    const locks = examLocks(step, enr);
    let body;
    if (passed) body = `<p class="ok-text">${icon('check')} Passed</p>`;
    else if (open && active) body = `<p>You have started this exam. The timer is still running.</p>
      <button type="button" class="primary" data-start-exam="${esc(step.id)}" data-resume="1">Continue exam</button>`;
    else if (atts.length && left <= 0) body = '<p>Thank you for taking the exam. You didn\'t pass this time. Your supervisor will talk with you about the next step.</p>';
    else if (!active) body = '<p class="muted small">Not open.</p>';
    else if (locks.length) body = `<ul class="locks">${locks.map((l) => `<li>${icon('lock')} ${esc(l)}</li>`).join('')}</ul>`;
    else if (reSitFrom && reSitFrom > new Date()) {
      const reSitDay = reSitFrom.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      body = `<p>You didn't pass last time. You can re-sit from <strong>${esc(reSitFrom.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }))}</strong>. Use the time to review the lessons.</p>
        ${enr.due_on && reSitDay > enr.due_on ? `<p class="error small">⚠️ That is after your finish date (${esc(fmtDate(enr.due_on))}). Please talk to your supervisor about an extension.</p>` : ''}`;
    }
    else body = `<p class="muted small">The timer keeps running even if you close the page.</p>
      ${atts.length ? `<p>You may re-sit the exam (${left} attempt${left === 1 ? '' : 's'} left).</p>` : ''}
      <button type="button" class="primary" data-start-exam="${esc(step.id)}">${atts.length ? 'Start re-sit' : 'Start exam'}</button>`;
    const subs = atts.filter((a) => a.status === 'submitted').sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
    const results = subs.length ? `<p class="small">${subs.map((a, k) => `<button type="button" class="link" data-summary="${esc(a.id)}">My results${subs.length > 1 ? ` (attempt ${k + 1})` : ''}</button>`).join(' · ')}</p>` : '';
    return stepShell(step, n, state, `${passed ? '' : examFacts(step)}${body}${results}`, status);
  }

  if (step.kind === 'certificate') {
    const cert = mine.certificates.find((c) => c.enrollment_id === enr.id);
    return stepShell(step, n, state, cert
      ? `<button type="button" class="primary" data-cert="${esc(cert.id)}">${icon('award')} View certificate</button>`
      : '<p class="muted small">Unlocks when you pass the exam.</p>', status);
  }

  if (step.kind === 'session') {
    const target = step.config?.target_hours ?? 0;
    const got = hoursFor(enr.id, step.id);
    const pct = target ? Math.min(100, Math.round((got / target) * 100)) : 0;
    const log = (mine.hours || []).filter((h) => h.enrollment_id === enr.id && h.step_id === step.id);
    const topics = step.config?.topics || [];
    const covered = chaptersCovered(log);
    return stepShell(step, n, state, `
      <div class="course-progress"><div class="progress"><span style="width:${pct}%"></span></div>
        <span class="small muted">${fmtHours(got)} of ${target} hours</span></div>
      ${topics.length ? `<p class="small muted ch-count">${covered.size} of ${topics.length} chapters covered</p>
        <ol class="chapters">${topics.map((t, i) => `<li class="${covered.has(i + 1) ? 'done' : ''}"><span class="ch-num">${covered.has(i + 1) ? icon('check') : i + 1}</span><span>${esc(t)}</span></li>`).join('')}</ol>` : ''}
      ${myAssignments(step, enr, topics)}
      ${mySchedule(step, enr, topics)}
      ${log.length ? `<h4 class="ch-h">Hours logged</h4><ul class="hours-list">${log.map((h) => sessionLine(h, topics)).join('')}</ul>`
        : '<p class="muted small">Your hours appear here after each session.</p>'}`, status);
  }

  if (step.kind === 'gap') {
    return stepShell(step, n, state, step.config?.days ? `<div class="course-pills"><span class="pill">${icon('calendar')} ${Math.round(step.config.days / 7)} weeks</span></div>` : '', status);
  }

  if (step.kind === 'result') {
    const r = resultFor(enr.id, step.id);
    const c = step.config || {};
    const facts = `<div class="course-pills">
      ${c.mode === 'paper' ? `<span class="pill">${icon('file-text')} On paper at CARE</span>` : ''}
      ${c.mode === 'oral' ? `<span class="pill">${icon('users')} Oral, with the examiners</span>` : ''}
      ${c.duration_min ? `<span class="pill">${icon('clock')} ${fmtMinutes(c.duration_min)}</span>` : ''}
    </div>`;
    const planned = (mine.sessions || []).find((x) => x.kind === 'exam' && x.step_id === step.id && x.status === 'planned');
    const body = !r ? `${planned ? `<p>${icon('calendar')} <strong>${esc(fmtDay(planned.held_on))}${planned.start_time ? `, ${esc(fmtTime(planned.start_time))}` : ''}</strong>${planned.place ? ` · ${esc(planned.place)}` : ''}</p>` : ''}<p class="muted small">Your supervisor records the result after the exam.</p>`
      : r.passed ? `<p class="ok-text">${icon('check')} Passed${r.held_on ? ` · ${esc(fmtDate(r.held_on))}` : ''}</p>`
        : `<p>Not passed this time${r.held_on ? ` (${esc(fmtDate(r.held_on))})` : ''}. Your supervisor will talk with you about the next step.</p>`;
    return stepShell(step, n, state, `${r?.passed ? '' : facts}${body}`, status);
  }

  if (step.kind === 'practicum') {
    return stepShell(step, n, state, practicumHtml(step, enr, false), status);
  }

  return stepShell(step, n, state, '<p class="muted small">Coming soon.</p>');
}

// ---- one-line status per step (trainee page and the team's trainee list) -----
// d: { done, stepsDone, examAtts, results, hours, evals, certs } for one viewer.
const myData = () => ({ done: mine.done, stepsDone: mine.stepsDone, examAtts: mine.attempts, results: mine.results, hours: mine.hours, evals: mine.evals, certs: mine.certificates, subs: mine.subs });
function stepStatus(step, e, d, team = false) {
  const c = step.config || {};
  switch (step.kind) {
    case 'agree': return d.stepsDone.some((x) => x.enrollment_id === e.id && x.step_id === step.id) ? 'Agreed' : 'Read and agree';
    case 'learn': {
      const items = itemsOf(step.id);
      const n = items.filter((i) => d.done.some((x) => x.enrollment_id === e.id && x.item_id === i.id)).length;
      return items.length ? `${n} of ${items.length} ${items.some((i) => i.kind === 'video') ? 'watched' : 'done'}` : '';
    }
    case 'exam': {
      const atts = (d.examAtts || []).filter((a) => a.enrollment_id === e.id && (!a.step_id || a.step_id === step.id));
      if (atts.some((a) => a.passed)) return 'Passed';
      if (atts.some((a) => a.status === 'in_progress')) return 'In progress';
      if (atts.length) return 'Not passed yet';
      return team ? 'Not started' : (examLocks(step, e).length ? 'Opens after the lessons' : 'Ready to start');
    }
    case 'session': {
      const got = hoursFor(e.id, step.id, d.hours);
      const topics = (c.topics || []).length;
      const cov = chaptersCovered((d.hours || []).filter((h) => h.enrollment_id === e.id && h.step_id === step.id)).size;
      const subN = (d.subs || []).filter((x) => x.enrollment_id === e.id && x.step_id === step.id).length;
      return `${fmtHours(got)} / ${c.target_hours ?? '?'} h${topics ? ` · ${cov}/${topics} chapters` : ''}${topics && subN ? ` · ${subN} assignments` : ''}`;
    }
    case 'gap': return c.days ? `${Math.round(c.days / 7)} weeks` : '';
    case 'result': {
      const r = resultFor(e.id, step.id, d.results);
      const planned = !team && (mine.sessions || []).find((x) => x.kind === 'exam' && x.step_id === step.id && x.status === 'planned');
      if (!r) return planned ? `On ${fmtDay(planned.held_on)}` : 'Not yet';
      const sc = team && r.score != null ? ` · ${Number(r.score)}${r.full_score ? `/${Number(r.full_score)}` : ''}` : '';
      return `${r.passed ? 'Passed' : 'Not passed'}${sc}`;
    }
    case 'practicum': {
      const r = resultFor(e.id, step.id, d.results);
      if (r?.passed) return 'Passed';
      const slots = practicumSlots(step);
      const filled = slots.filter((sl) => evalFor(d.evals, e.id, step.id, sl)).length;
      return `${filled} of ${slots.length} forms${r && !r.passed ? ' · not passed' : ''}`;
    }
    case 'certificate': return (d.certs || []).some((x) => x.enrollment_id === e.id) ? 'Ready to view' : 'After the last step';
    default: return '';
  }
}
function previewStatus(s) {
  if (s.kind === 'learn') { const n = itemsOf(s.id).length; return n ? `${n} ${itemsOf(s.id).some((i) => i.kind === 'video') ? 'videos' : 'lessons'}` : ''; }
  if (s.kind === 'agree') return `${itemsOf(s.id).length} documents`;
  if (s.kind === 'exam') return `${s.config?.time_limit_min ?? 120} minutes`;
  if (s.kind === 'session') return `${s.config?.target_hours ?? ''} h`;
  if (s.kind === 'gap') return s.config?.days ? `${Math.round(s.config.days / 7)} weeks` : '';
  return '';
}

// ---- helpers for recorded steps ---------------------------------------------
const chaptersCovered = (log) => new Set((log || []).flatMap((h) => h.chapters || []));
const chapterText = (h) => ((h.chapters || []).length ? `Ch ${[...h.chapters].sort((a, b) => a - b).join(', ')}` : '');
function sessionLine(h, topics, extra = '') {
  const ch = chapterText(h);
  const names = (h.chapters || []).map((c) => topics[c - 1]).filter(Boolean).join(' · ');
  return `<li><span>${esc(fmtDate(h.held_on))}</span>
    <span>${ch ? `<strong>${esc(ch)}</strong>${names ? ` <span class="muted small">${esc(names)}</span>` : ''}` : ''}${h.topic ? `${ch ? '<br>' : ''}<span class="small">${esc(h.topic)}</span>` : ''}${!ch && !h.topic ? 'Training session' : ''}</span>
    <span class="nowrap">${fmtHours(h.hours)} h${extra}</span></li>`;
}
const fmtHours = (h) => String(Math.round(Number(h || 0) * 10) / 10);
const fmtMinutes = (m) => (m % 60 ? `${Math.floor(m / 60) ? `${Math.floor(m / 60)} h ` : ''}${m % 60} min` : `${m / 60} hour${m === 60 ? '' : 's'}`);
function hoursFor(enrId, stepId, list = mine.hours) {
  return (list || []).filter((h) => h.enrollment_id === enrId && h.step_id === stepId).reduce((t, h) => t + Number(h.hours), 0);
}
function resultFor(enrId, stepId, list = mine.results) {
  return (list || []).find((r) => r.enrollment_id === enrId && r.step_id === stepId);
}

// Practicum: the evaluation slots (Prep 1–4, Clinic 1–4, Technical skills).
function practicumSlots(step) {
  const form = step.config?.practicum;
  if (!form) return [];
  const out = [];
  for (const sec of form.sections) {
    if (sec.key === 'skills') out.push({ section: 'skills', seq: 0, label: 'Technical skills', sec });
    else for (let k = 1; k <= (sec.count || 1); k += 1) out.push({ section: sec.key, seq: k, label: `${sec.label} ${k}`, sec });
  }
  return out;
}
const evalFor = (list, enrId, stepId, slot) => (list || []).find((e) => e.enrollment_id === enrId && e.step_id === stepId && e.section === slot.section && e.seq === slot.seq);

// Summary of one filled form: "5 of 7 +" or "18 of 21 tasks".
function evalSummary(slot, ev) {
  if (!ev) return '';
  if (slot.section === 'skills') {
    const items = slot.sec.groups.flatMap((g) => g.items);
    const doneN = items.filter((it) => Object.values(ev.marks?.[it.n] || {}).some(Boolean)).length;
    return `${doneN} of ${items.length} tasks`;
  }
  const plus = slot.sec.items.filter((_, i) => ev.marks?.[i + 1] === '+').length;
  return `${plus} of ${slot.sec.items.length} +`;
}

// The pass rule, as a hint for the supervisor (they still record the result).
function practicumCheck(step, enrId, list) {
  const form = step.config?.practicum;
  if (!form) return null;
  const okLast = (key) => {
    const sec = form.sections.find((x) => x.key === key);
    const ev = (list || []).find((e) => e.enrollment_id === enrId && e.step_id === step.id && e.section === key && e.seq === sec.count);
    return !!ev && sec.items.every((_, i) => ['+', 'n/a'].includes(ev.marks?.[i + 1]));
  };
  const skillsSec = form.sections.find((x) => x.key === 'skills');
  const sk = (list || []).find((e) => e.enrollment_id === enrId && e.step_id === step.id && e.section === 'skills');
  const skillsOk = !!sk && skillsSec.groups.flatMap((g) => g.items).every((it) => Object.values(sk.marks?.[it.n] || {}).some(Boolean));
  return { prep: okLast('prep'), clinic: okLast('clinic'), skills: skillsOk };
}

function practicumHtml(step, enr, team, list = team ? null : mine.evals, result = null) {
  const slots = practicumSlots(step);
  if (!slots.length) return '<p class="muted small">The practicum checklist will appear here soon.</p>';
  const r = result ?? resultFor(enr.id, step.id);
  const filled = slots.filter((sl) => evalFor(list, enr.id, step.id, sl)).length;
  return `
    ${r ? (r.passed ? `<p class="ok-text">${icon('check')} Practicum passed${r.held_on ? ` · ${esc(fmtDate(r.held_on))}` : ''}</p>`
      : '<p>Practicum not passed yet. Your supervisor will talk with you about the next step.</p>') : ''}
    <p class="small muted">${filled} of ${slots.length} evaluations filled in</p>
    <ul class="pr-slots">${slots.map((sl) => {
      const ev = evalFor(list, enr.id, step.id, sl);
      return `<li class="${ev ? 'filled' : ''}">
        <span class="pr-label">${esc(sl.label)}</span>
        <span class="pr-meta small muted">${ev ? `${ev.held_on ? esc(fmtDate(ev.held_on)) : ''}${ev.case_code ? ` · ${esc(ev.case_code)}` : ''} · ${esc(evalSummary(sl, ev))}` : 'Not yet'}</span>
        ${ev || team ? `<button type="button" class="small-btn" data-pr="${esc(step.id)}|${esc(enr.id)}|${esc(sl.section)}|${sl.seq}">${team ? (ev ? 'Edit' : 'Fill in') : 'View'}</button>` : ''}
      </li>`;
    }).join('')}</ul>`;
}

// Read-only (trainee) or editable (assessor) checklist for one slot.
function practicumDialog(step, enr, slot, ev, { editable, who = '', onSaved } = {}) {
  const form = step.config.practicum;
  const dlg = panelEl.querySelector('#tr-dlg');
  const marks = ev?.marks || {};
  const markSelect = (name, val) => editable
    ? `<select name="${name}" aria-label="Mark">${['', ...form.marks].map((m) => `<option value="${esc(m)}"${val === m ? ' selected' : ''}>${m ? esc(m) : '–'}</option>`).join('')}</select>`
    : `<span class="pr-mark ${val === '+' ? 'plus' : val ? '' : 'none'}">${esc(val || '–')}</span>`;
  const keys = `<details class="pr-keys"><summary>Marking keys</summary>${form.keys.map((k) => `<p class="small"><strong>${esc(k.title)}</strong></p>
    <ul class="small">${k.rows.map(([m, t]) => `<li><strong>${esc(m)}</strong> ${esc(t)}</li>`).join('')}</ul>`).join('')}</details>`;
  let rows;
  if (slot.section === 'skills') {
    rows = slot.sec.groups.map((g) => `<h4>${esc(g.title)}</h4><ol class="pr-items" start="${g.items[0].n}">${g.items.map((it) => `
      <li><span class="pr-text">${esc(it.text)}</span>
        <span class="pr-methods">${it.methods.map((m) => editable
          ? `<label class="check"><input type="checkbox" name="s${it.n}_${m}"${marks[it.n]?.[m] ? ' checked' : ''}> <span>${esc(form.methods[m])}</span></label>`
          : `<span class="chip${marks[it.n]?.[m] ? ' ok' : ''}">${marks[it.n]?.[m] ? '✓ ' : ''}${esc(form.methods[m])}</span>`).join('')}</span></li>`).join('')}</ol>`).join('');
  } else {
    rows = `<ol class="pr-items">${slot.sec.items.map((t, i) => `<li><span class="pr-text">${esc(t)}</span>${markSelect(`m${i + 1}`, marks[i + 1])}</li>`).join('')}</ol>`;
  }
  dlg.innerHTML = `
    <form method="dialog" class="pr-form">
      <h2>${esc(slot.label)}${who ? ` · ${esc(who)}` : ''}</h2>
      <p class="muted small">${esc(slot.sec.title)}. ${esc(slot.sec.note || '')}</p>
      ${slot.section === 'skills' ? '' : (editable
        ? `<div class="grid2"><label>Case (3-letter code) <input name="case" maxlength="3" pattern="[A-Za-z]{3}" value="${esc(ev?.case_code || '')}" placeholder="ABC"></label>
           <label>Date <input name="held" type="date" value="${esc(ev?.held_on || todayLocal())}"></label></div>`
        : `<p class="small">${ev?.held_on ? esc(fmtDate(ev.held_on)) : ''}${ev?.case_code ? ` · case ${esc(ev.case_code)}` : ''}</p>`)}
      ${slot.section === 'skills' && editable ? `<label>Date <input name="held" type="date" value="${esc(ev?.held_on || todayLocal())}"></label>` : ''}
      ${slot.section === 'skills' ? '' : keys}
      ${rows}
      ${editable ? `<label>Comment for the trainee <textarea name="comment" rows="3" maxlength="2000">${esc(ev?.comment || '')}</textarea></label>`
        : ev?.comment ? `<div class="pr-comment"><p class="small muted">Comment</p><p>${esc(ev.comment)}</p></div>` : ''}
      <p class="muted small">Cases are written as 3-letter codes only. Never a child's name.</p>
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions"><span class="spacer"></span>
        <button type="button" data-act="close">${editable ? 'Cancel' : 'Close'}</button>
        ${editable ? '<button type="submit" class="primary">Save</button>' : ''}</div>
    </form>`;
  const f = dlg.querySelector('form');
  f.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  if (editable) {
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = f.querySelector('.msg');
      const out = {};
      if (slot.section === 'skills') {
        for (const it of slot.sec.groups.flatMap((g) => g.items)) {
          const m = {};
          for (const k of it.methods) if (f[`s${it.n}_${k}`].checked) m[k] = true;
          if (Object.keys(m).length) out[it.n] = m;
        }
      } else {
        slot.sec.items.forEach((_, i) => { const v = f[`m${i + 1}`].value; if (v) out[i + 1] = v; });
      }
      const code = f.case ? f.case.value.trim().toUpperCase() : '';
      if (code && !/^[A-Z]{3}$/.test(code)) { msg.hidden = false; msg.dataset.kind = 'error'; msg.textContent = 'The case code is exactly 3 letters (e.g. ABC).'; return; }
      try {
        await saveEval({
          enrollment_id: enr.id, step_id: step.id, section: slot.section, seq: slot.seq,
          case_code: code || null, held_on: f.held?.value || null, marks: out,
          comment: f.comment.value.trim() || null, assessor_id: ctx.me.id,
        });
        dlg.close();
        await onSaved?.();
      } catch (err) { msg.hidden = false; msg.dataset.kind = 'error'; msg.textContent = err.message; }
    });
  }
  if (!dlg.open) dlg.showModal();
}

// ---------------------------------------------------------------------------
// Exam
// ---------------------------------------------------------------------------
function confirmStart(step, resume) {
  if (resume) return openExam(step);
  const dlg = panelEl.querySelector('#tr-dlg');
  const mins = step.config?.time_limit_min ?? 120;
  dlg.innerHTML = `
    <div class="pw-box">
      <h2>Start ${esc(step.title)}?</h2>
      <ul>
        <li>You have <strong>${mins} minutes</strong>. The timer starts now and keeps running even if you close the page.</li>
        <li>Your answers are saved as you go.</li>
        <li>When time is up, the exam is handed in automatically.</li>
        <li>Find a quiet place and a steady internet connection.</li>
      </ul>
      <div class="dlg-actions"><span class="spacer"></span>
        <button type="button" data-act="no">Not yet</button>
        <button type="button" class="primary" data-act="go">Start now</button>
      </div>
    </div>`;
  dlg.querySelector('[data-act="no"]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-act="go"]').addEventListener('click', () => { dlg.close(); openExam(step); });
  if (!dlg.open) dlg.showModal();
}

async function openExam(step) {
  let data;
  try {
    data = await examStart(step.id);
  } catch (e) {
    alert(e.message);
    return refresh();
  }
  if (data.expired) {
    alert('Time ran out while you were away, so your saved answers were handed in.');
    return refresh();
  }
  examView(step, data);
}

function examView(step, data) {
  const attempt = data.attempt_id;
  const localKey = `care_exam_${attempt}`;
  const offset = Date.parse(data.server_now) - Date.now(); // server clock − this device
  const deadline = Date.parse(data.deadline);
  let answers = { ...(data.answers || {}) };
  try { Object.assign(answers, JSON.parse(localStorage.getItem(localKey) || '{}')); } catch { /* no local copy */ }
  const qs = data.questions || [];
  let dirty = false;
  let finished = false;
  let saving = null;

  panelEl.innerHTML = `
    <section class="exam" aria-label="${esc(step.title)}">
      <div class="exam-bar">
        <strong>${esc(step.title)}</strong>
        <span class="spacer"></span>
        <span class="muted small" id="ex-saved" aria-live="polite"></span>
        <span class="timer" id="ex-timer" role="timer">--:--</span>
      </div>
      <ol class="exam-qs">
        ${qs.map((q) => `
          <li class="exam-q" data-q="${esc(q.id)}">
            <p class="q-prompt">${esc(q.prompt)}</p>
            ${q.type === 'multiselect' ? '<p class="muted small">Select all that apply.</p>' : ''}
            <div class="q-opts">
              ${q.options.map((o) => `
                <label class="check"><input type="${q.type === 'mcq' ? 'radio' : 'checkbox'}" name="q-${esc(q.id)}" value="${o.i}"${(answers[q.id] || []).includes(o.i) ? ' checked' : ''}>
                  <span>${esc(o.text)}</span></label>`).join('')}
            </div>
          </li>`).join('')}
      </ol>
      <div class="exam-foot">
        <span id="ex-count" class="muted"></span>
        <span class="spacer"></span>
        <button type="button" class="primary" id="ex-submit">Hand in exam</button>
      </div>
    </section>
    <dialog id="tr-dlg" class="dlg"></dialog>`;

  const root = panelEl.querySelector('.exam');
  const timerEl = root.querySelector('#ex-timer');
  const savedEl = root.querySelector('#ex-saved');
  const countEl = root.querySelector('#ex-count');

  const answeredCount = () => qs.filter((q) => (answers[q.id] || []).length).length;
  const showCount = () => { countEl.textContent = `${answeredCount()} of ${qs.length} answered`; };
  showCount();

  const keepLocal = () => { try { localStorage.setItem(localKey, JSON.stringify(answers)); } catch { /* storage off */ } };

  async function saveNow() {
    if (!dirty || finished) return;
    dirty = false;
    savedEl.textContent = 'Saving…';
    try {
      await examSave(attempt, answers);
      savedEl.textContent = 'Saved ✓';
    } catch (e) {
      dirty = true;
      savedEl.textContent = /Time is up/i.test(e.message) ? '' : 'Not saved yet (will retry)';
    }
  }

  root.addEventListener('change', (ev) => {
    const box = ev.target.closest('input');
    const li = box?.closest('[data-q]');
    if (!li) return;
    answers[li.dataset.q] = [...li.querySelectorAll('input:checked')].map((b) => Number(b.value));
    dirty = true;
    keepLocal();
    showCount();
    clearTimeout(saving);
    saving = setTimeout(saveNow, 1500);
  });

  const warn = (e) => { if (!finished) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);

  const stillHere = () => document.body.contains(root);
  const every30 = setInterval(() => { if (stillHere()) saveNow(); else stop(); }, 30000);
  const tick = setInterval(() => {
    if (!stillHere()) return stop();
    const left = deadline - (Date.now() + offset);
    if (left <= 0) {
      timerEl.textContent = '00:00';
      handIn(true);
      return;
    }
    const s = Math.floor(left / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    timerEl.textContent = `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
    timerEl.dataset.level = left < 2 * 60000 ? 'red' : left < 10 * 60000 ? 'amber' : '';
  }, 1000);

  function stop() {
    clearInterval(tick);
    clearInterval(every30);
    clearTimeout(saving);
    window.removeEventListener('beforeunload', warn);
  }

  async function handIn(timeUp) {
    if (finished) return;
    finished = true;
    stop();
    root.querySelector('#ex-submit').disabled = true;
    savedEl.textContent = 'Handing in…';
    try {
      const res = await examSubmit(attempt, answers);
      try { localStorage.removeItem(localKey); } catch { /* ignore */ }
      mine = await loadMyTraining(ctx.me.id);
      resultView(step, res.passed, timeUp, attempt);
    } catch (e) {
      finished = false;
      root.querySelector('#ex-submit').disabled = false;
      savedEl.textContent = '';
      alert(`Could not hand in: ${e.message}\n\nYour answers are safe on this device. Check the connection and press "Hand in exam" again.`);
    }
  }

  root.querySelector('#ex-submit').addEventListener('click', () => {
    const missing = qs.length - answeredCount();
    const msg = missing
      ? `You have ${missing} unanswered question${missing === 1 ? '' : 's'}. Hand in anyway?`
      : 'Hand in your exam now? You can\'t change your answers after this.';
    if (confirm(msg)) handIn(false);
  });
}

function resultView(step, passed, timeUp, attemptId) {
  const cert = mine.certificates.find((c) => mine.enrollments.some((e) => e.id === c.enrollment_id && e.program_key === step.program_key));
  panelEl.innerHTML = `
    <section class="card result-card">
      ${timeUp ? '<p class="muted">Time is up. Your exam was handed in automatically.</p>' : ''}
      ${passed
        ? `<h2>🎉 You passed!</h2><p>Well done. Your result is saved, and your supervisor can see it.</p>
           ${cert ? `<button type="button" class="primary" data-cert="${esc(cert.id)}">🎓 View your certificate</button>` : ''}`
        : `<h2>Thank you for taking the exam</h2>
           <p>You didn't pass this time. Your supervisor will talk with you about the next step. Keep going!</p>`}
      <div id="my-summary" class="summary-box"></div>
      <p><button type="button" data-act="back">Back to training</button></p>
    </section>
    <dialog id="tr-dlg" class="dlg"></dialog>`;
  panelEl.querySelector('[data-act="back"]').addEventListener('click', drawHome);
  if (attemptId) {
    examMySummary(attemptId)
      .then((sum) => { const box = panelEl.querySelector('#my-summary'); if (box) box.innerHTML = summaryHtml(sum); })
      .catch(() => { /* the summary is a bonus; the result above is what matters */ });
  }
  panelEl.querySelector('[data-cert]')?.addEventListener('click', () => showCertificate(cert));
}

// ---------------------------------------------------------------------------
// Results: the trainee's summary, and the team's answer review
// ---------------------------------------------------------------------------
const pct = (a, b) => (Number(b) ? Math.round((Number(a) / Number(b)) * 100) : 0);

function domainsHtml(domains, names) {
  if (!domains?.length) return '';
  return `<table class="domain-table"><thead><tr><th>Domain</th><th>Score</th><th class="bar-col"></th></tr></thead><tbody>
    ${domains.map((d) => {
      const p = pct(d.correct, d.total);
      return `<tr><td><strong>${esc(d.domain)}</strong> ${esc(names?.[d.domain] ?? '')}</td>
        <td class="nowrap">${Number(d.correct)} / ${Number(d.total)} <span class="muted">(${p}%)</span></td>
        <td class="bar-col"><span class="bar"><span style="width:${p}%"${p < 80 ? ' class="low"' : ''}></span></span></td></tr>`;
    }).join('')}</tbody></table>`;
}

function summaryHtml(sum) {
  const p = pct(sum.score, sum.total);
  const passPct = sum.pass_mark != null ? pct(sum.pass_mark, sum.total) : null;
  return `
    <p class="score-line">Your score: <strong>${Number(sum.score)} / ${Number(sum.total)}</strong> (${p}%)${passPct != null ? ` · pass mark ${passPct}%` : ''}</p>
    ${sum.domains?.length ? `<p class="muted small">By domain. Use this to see what to review.</p>${domainsHtml(sum.domains, sum.domain_names)}` : ''}`;
}

async function showSummary(attemptId) {
  const dlg = panelEl.querySelector('#tr-dlg');
  dlg.innerHTML = '<p class="muted">Loading…</p>';
  if (!dlg.open) dlg.showModal();
  try {
    const sum = await examMySummary(attemptId);
    dlg.innerHTML = `<div class="pw-box">
      <h2>My results ${sum.passed ? '<span class="chip ok">Passed</span>' : '<span class="chip warn">Not passed</span>'}</h2>
      ${summaryHtml(sum)}
      <div class="dlg-actions"><span class="spacer"></span><button type="button" class="primary" data-act="close">Close</button></div></div>`;
  } catch (e) {
    dlg.innerHTML = `<p class="error">${esc(e.message)}</p><div class="dlg-actions"><span class="spacer"></span><button type="button" data-act="close">Close</button></div>`;
  }
  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
}

const LETTERS = 'ABCDEFGH';
async function showReview(attemptId) {
  const dlg = viewerDialog('review-dlg', 'review-dlg');
  dlg.innerHTML = '<p class="muted">Loading…</p>';
  if (!dlg.open) dlg.showModal();
  let r;
  try {
    r = await examReview(attemptId);
  } catch (e) {
    dlg.innerHTML = `<p class="error">${esc(e.message)}</p><div class="dlg-actions"><span class="spacer"></span><button type="button" data-act="close">Close</button></div>`;
    dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
    return;
  }
  const wrong = r.questions.filter((q) => !q.correct).length;
  const answerList = (q) => (Array.isArray(q.answer) ? q.answer : [q.answer]);
  const qHtml = (q) => `
    <li class="rv-q ${q.correct ? 'right' : 'wrong'}" data-correct="${q.correct ? 1 : 0}">
      <p class="q-prompt">${q.correct ? '✅' : '❌'} ${esc(q.prompt)} ${q.tag ? `<span class="chip stage">${esc(q.tag)}</span>` : ''}</p>
      <ul class="rv-opts">${q.options.map((o, i) => {
        const isAns = answerList(q).includes(i);
        const isGiven = (q.given || []).includes(i);
        return `<li class="${isAns ? 'is-answer' : ''} ${isGiven && !isAns ? 'is-wrong-pick' : ''}">
          <strong>${LETTERS[i]}.</strong> ${esc(o)}
          ${isAns ? ' <span class="ok-text small">correct answer</span>' : ''}${isGiven ? ` <span class="small ${isAns ? 'ok-text' : 'error'}">← their answer</span>` : ''}</li>`;
      }).join('')}</ul>
      ${(q.given || []).length ? '' : '<p class="muted small">Not answered.</p>'}
    </li>`;
  const html = `<article class="review">
      <h2>${esc(r.exam)}: ${esc(r.full_name)}</h2>
      <p>${r.passed ? '<span class="chip ok">Passed</span>' : '<span class="chip warn">Not passed</span>'}
        <strong>${Number(r.score)} / ${Number(r.total)}</strong> (${pct(r.score, r.total)}%)
        · ${wrong} wrong · ${r.time_used_min ? `${r.time_used_min} min` : ''}
        · ${esc(new Date(r.submitted_at || r.started_at).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }))}</p>
      ${domainsHtml(r.domains, r.domain_names)}
      <ol class="rv-list">${r.questions.map(qHtml).join('')}</ol>
    </article>`;
  dlg.innerHTML = `
    <div class="viewer-head"><label class="check"><input type="checkbox" id="rv-wrong" checked> <span>Wrong answers only</span></label>
      <span class="spacer"></span>
      <button type="button" data-act="print">Save as PDF / Print</button>
      <button type="button" class="primary" data-act="close">Close</button></div>
    <div class="doc-scroll">${html}</div>
    <p class="muted small">Confidential: this shows the answer key. Don't share it with trainees.</p>`;
  const list = dlg.querySelector('.rv-list');
  const apply = () => list.classList.toggle('wrong-only', dlg.querySelector('#rv-wrong').checked);
  dlg.querySelector('#rv-wrong').addEventListener('change', apply);
  apply();
  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-act="print"]').addEventListener('click', () => {
    const area = document.getElementById('print-area');
    area.innerHTML = dlg.querySelector('.review').outerHTML;
    area.querySelector('.rv-list')?.classList.toggle('wrong-only', dlg.querySelector('#rv-wrong').checked);
    const oldTitle = document.title;
    document.title = `Exam review - ${r.full_name}`;
    const done = () => { area.innerHTML = ''; document.title = oldTitle; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  });
}

// ---------------------------------------------------------------------------
// Certificate (view + Save as PDF)
// ---------------------------------------------------------------------------
function certificateHtml(c) {
  const prog = content?.programs.find((p) => p.key === c.program_key);
  return `
    <div class="certificate">
      <p class="cert-org">${esc(prog?.provider_name || 'CARE Learning Center Skills Enhancement School')}</p>
      <p class="cert-kicker">Certificate of Completion</p>
      <p>This certifies that</p>
      <p class="cert-name">${esc(c.full_name)}</p>
      <p>has successfully completed</p>
      <p class="cert-title">${esc(c.title)}</p>
      <div class="cert-foot">
        <span>Date: ${esc(fmtDate(c.issued_on))}</span>
        <span>Certificate no. ${esc(c.code)}</span>
      </div>
      ${prog?.certificate_note ? `<p class="cert-note">${esc(prog.certificate_note)}</p>` : ''}
    </div>`;
}

export function showCertificate(c, host = panelEl) {
  if (!c) return;
  let dlg = host.querySelector('#cert-dlg');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'cert-dlg';
    dlg.className = 'dlg cert-dlg';
    host.append(dlg);
  }
  const html = certificateHtml(c);
  dlg.innerHTML = `${html}
    <div class="dlg-actions">
      <span class="muted small">In the print window, choose <strong>Save as PDF</strong>.</span>
      <span class="spacer"></span>
      <button type="button" data-act="close">Close</button>
      <button type="button" class="primary" data-act="print">Save as PDF / Print</button>
    </div>`;
  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-act="print"]').addEventListener('click', () => printCertificate(html, c));
  if (!dlg.open) dlg.showModal();
}

function viewerDialog(id, cls) {
  let dlg = panelEl.querySelector(`#${id}`);
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = id;
    dlg.className = `dlg ${cls}`;
    panelEl.append(dlg);
  }
  return dlg;
}

// A course document, read inside the Portal (and Save as PDF).
function showDocument(it) {
  if (!it) return;
  const prog = content.programs.find((p) => stepsOf(p.key).some((s) => s.id === it.step_id));
  const dlg = viewerDialog('doc-dlg', 'doc-dlg');
  const html = `<article class="doc">
      ${prog?.provider_name ? `<p class="muted small">${esc(prog.provider_name)}</p>` : ''}
      <h2>${esc(it.title)}</h2>${docHtml(it.body)}</article>`;
  dlg.innerHTML = `<div class="doc-scroll">${html}</div>
    <div class="dlg-actions">
      <span class="spacer"></span>
      <button type="button" data-act="print">Save as PDF / Print</button>
      <button type="button" class="primary" data-act="close">Close</button>
    </div>`;
  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-act="print"]').addEventListener('click', () => {
    const area = document.getElementById('print-area');
    area.innerHTML = html;
    const oldTitle = document.title;
    document.title = it.title;
    const done = () => { area.innerHTML = ''; document.title = oldTitle; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  });
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('.doc-scroll').scrollTop = 0;
}

// A Canva module, shown inside the Portal.
function showCanva(it) {
  const src = canvaEmbed(it?.url);
  if (!src) return;
  const dlg = viewerDialog('canva-dlg', 'canva-dlg');
  dlg.innerHTML = `
    <div class="viewer-head"><strong>${esc(it.title)}</strong><span class="spacer"></span>
      <button type="button" class="primary" data-act="close">Close</button></div>
    <div class="canva-frame">
      <iframe src="${esc(src)}" title="${esc(it.title)}" loading="lazy" allow="fullscreen; autoplay" allowfullscreen
        sandbox="allow-scripts allow-same-origin allow-presentation"
        referrerpolicy="strict-origin-when-cross-origin"></iframe>
    </div>
    <p class="muted small">Course materials are for your own study only. Please don't share them.</p>`;
  // Closing removes the frame, so nothing keeps playing in the background.
  const close = () => { dlg.close(); dlg.innerHTML = ''; };
  dlg.querySelector('[data-act="close"]').addEventListener('click', close);
  dlg.addEventListener('cancel', () => { dlg.innerHTML = ''; }, { once: true });
  if (!dlg.open) dlg.showModal();
}

function printCertificate(html, c) {
  const area = document.getElementById('print-area');
  area.innerHTML = html;
  const page = document.createElement('style');
  page.textContent = '@page { size: A4 landscape; margin: 12mm; }';
  document.head.append(page);
  const oldTitle = document.title;
  document.title = `Certificate - ${c.full_name} - ${c.title}`;
  const done = () => {
    area.innerHTML = '';
    page.remove();
    document.title = oldTitle;
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

// ---------------------------------------------------------------------------
// Team view: who is where, results with scores, retakes
// ---------------------------------------------------------------------------
// The team's view of a programme: tools on top, then one row per trainee
// (mini step path + where they are now). "Open" shows that trainee's steps
// with only the actions that make sense for each step.
let teamOpen = null; // enrolment shown in the trainee panel (re-opened after an action)
let teamView = 'trainees'; // 'trainees' | 'groups'
async function drawTeam(programKey) {
  const body = panelEl.querySelector('#team-body');
  body.innerHTML = '<p class="muted">Loading…</p>';
  let people;
  let data;
  try {
    [people, data] = await Promise.all([listStaff(), loadTeamProgram(programKey)]);
  } catch (e) {
    body.innerHTML = `<p class="error">Could not load trainees: ${esc(e.message)}</p>`;
    return;
  }
  const prog = content.programs.find((p) => p.key === programKey);
  const steps = stepsOf(programKey);
  const sessionSteps = steps.filter((s) => s.kind === 'session');
  const rows = data.enrollments.filter((e) => e.status !== 'withdrawn');
  const nameOf = (id) => { const p = people.find((x) => x.id === id); return p ? (p.nickname || p.full_name) : 'Unknown'; };
  const isSup = ctx.roles.includes('supervisor');
  const assessor = ctx.roles.some((r) => ['admin', 'supervisor', 'qcd'].includes(r));
  const td = teamData(data);
  const toReview = (data.subs || []).filter((x) => x.status === 'submitted' && rows.some((e) => e.id === x.enrollment_id && e.status === 'active')).length;
  const tools = [
    isAdmin() ? '<button type="button" class="primary" data-assign>+ Assign people</button>' : '',
    prog?.promotes_to && (isSup || isAdmin()) ? '<button type="button" data-recommend>+ Recommend someone</button>' : '',
    assessor && sessionSteps.length && rows.some((e) => e.status === 'active') ? `<button type="button" data-goto-groups>${icon('calendar')} Groups & schedule</button>` : '',
    assessor && toReview ? `<button type="button" class="primary" data-to-review>${icon('file-text')} To review (${toReview})</button>` : '',
  ].filter(Boolean).join(' ');
  const order = { recommended: 0, active: 1, not_passed: 2, passed: 3 };
  rows.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || nameOf(a.therapist_id).localeCompare(nameOf(b.therapist_id)));

  body.innerHTML = `${tools ? `<p class="row-actions">${tools}</p>` : ''}
    ${rows.length ? `<ul class="tr-list">${rows.map((e) => {
      const p = people.find((x) => x.id === e.therapist_id);
      const name = nameOf(e.therapist_id);
      const states = steps.map((s) => (stepDoneFor(s, e, td) ? 'done' : 'todo'));
      const cur = states.indexOf('todo');
      if (cur >= 0 && e.status === 'active') states[cur] = 'current';
      const now = e.status === 'recommended'
        ? `Recommended by ${esc(nameOf(e.recommended_by))}${e.reason ? `: “${esc(e.reason)}”` : ''}`
        : e.status === 'passed' ? `Completed${e.finished_on ? ` ${esc(fmtDate(e.finished_on))}` : ''}${e.promoted_on ? ` · promoted ${esc(fmtDate(e.promoted_on))}` : ''}`
          : cur >= 0 ? `Now: <strong>${esc(steps[cur].title)}</strong>${stepStatus(steps[cur], e, td, true) ? ` · ${esc(stepStatus(steps[cur], e, td, true))}` : ''}` : 'All steps done';
      const late = e.status === 'active' && e.due_on && e.due_on < todayLocal();
      return `<li class="tr-row">
        <div class="tr-who"><strong>${esc(name)}</strong>${p?.track === 'abat' ? ' <span class="chip track-abat">ABAT</span>' : ''}
          <span class="chip ${e.status === 'passed' ? 'ok' : e.status === 'recommended' ? 'warn' : 'stage'}">${esc(e.status === 'recommended' ? 'Recommended' : STATUS_LABEL[e.status] ?? e.status)}</span>
          ${late ? '<span class="chip warn">Overdue</span>' : ''}</div>
        <div class="tr-path" aria-hidden="true">${states.map((st, i) => `<span class="${st}" title="${esc(steps[i].title)}"></span>`).join('')}</div>
        <div class="tr-now small">${now}</div>
        <div class="tr-act">${e.status === 'recommended' && isAdmin()
          ? `<button type="button" class="small-btn primary" data-approve="${esc(e.id)}">Approve</button> <button type="button" class="small-btn" data-decline="${esc(e.id)}" data-name="${esc(name)}">Decline</button>`
          : `<button type="button" class="small-btn" data-open="${esc(e.id)}">Open</button>`}</div>
      </li>`;
    }).join('')}</ul>` : '<p class="muted">No one is in this programme yet.</p>'}`;

  body.querySelector('[data-assign]')?.addEventListener('click', () => assignDialog(programKey, people, data));
  body.querySelector('[data-recommend]')?.addEventListener('click', () => recommendDialog(programKey, people, data));
  body.querySelector('[data-to-review]')?.addEventListener('click', () => reviewDialog(programKey, sessionSteps[0], rows.filter((e) => e.status === 'active'), people, data, true));
  body.querySelector('[data-goto-groups]')?.addEventListener('click', () => panelEl.querySelector('#team-view [data-view="groups"]')?.click());
  for (const b of body.querySelectorAll('[data-open]')) {
    b.addEventListener('click', () => { teamOpen = b.dataset.open; traineePanel(programKey, rows.find((x) => x.id === b.dataset.open), people, data); });
  }
  for (const b of body.querySelectorAll('[data-approve]')) {
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await approveRecommendation(b.dataset.approve, ctx.me.id, todayLocal()); await drawTeam(programKey); } catch (e) { alert(e.message); b.disabled = false; }
    });
  }
  for (const b of body.querySelectorAll('[data-decline]')) {
    b.addEventListener('click', async () => {
      if (!confirm(`Decline the recommendation for ${b.dataset.name}?`)) return;
      try { await declineRecommendation(b.dataset.decline); await drawTeam(programKey); } catch (e) { alert(e.message); }
    });
  }
  // After an action from the trainee panel, show that trainee again.
  if (teamOpen) {
    const e = rows.find((x) => x.id === teamOpen);
    const dlg = panelEl.querySelector('#tr-dlg');
    if (e && !dlg.open) traineePanel(programKey, e, people, data);
  }
}

const teamData = (data) => ({ done: data.done, stepsDone: data.stepsDone, examAtts: data.results, results: data.stepResults, hours: data.hours, evals: data.evals, certs: data.certificates, subs: data.subs });
function stepDoneFor(s, e, d) {
  if (s.kind === 'agree') return d.stepsDone.some((x) => x.enrollment_id === e.id && x.step_id === s.id);
  if (s.kind === 'learn') { const it = itemsOf(s.id); return it.length > 0 && it.every((i) => d.done.some((x) => x.enrollment_id === e.id && x.item_id === i.id)); }
  if (s.kind === 'exam') return (d.examAtts || []).some((a) => a.enrollment_id === e.id && a.passed);
  if (s.kind === 'certificate') return (d.certs || []).some((c) => c.enrollment_id === e.id);
  if (s.kind === 'session') return hoursFor(e.id, s.id, d.hours) >= (s.config?.target_hours ?? Infinity);
  if (s.kind === 'result' || s.kind === 'practicum') return !!resultFor(e.id, s.id, d.results)?.passed;
  if (s.kind === 'gap') return stepsOf(s.program_key).some((x) => x.sort_order > s.sort_order && ['result', 'practicum'].includes(x.kind) && resultFor(e.id, x.id, d.results));
  return false;
}

// One trainee, step by step, with the actions for each step.
function traineePanel(programKey, e, people, data) {
  const prog = content.programs.find((p) => p.key === programKey);
  const steps = stepsOf(programKey);
  const td = teamData(data);
  const p = people.find((x) => x.id === e.therapist_id);
  const name = p ? (p.nickname || p.full_name) : 'Unknown';
  const nameOf = (id) => { const x = people.find((y) => y.id === id); return x ? (x.nickname || x.full_name) : 'Unknown'; };
  const active = e.status === 'active';
  const assessor = ctx.roles.some((r) => ['admin', 'supervisor', 'qcd'].includes(r));
  const maxAttempts = steps.find((s) => s.kind === 'exam')?.config?.max_attempts ?? 1;
  const cert = data.certificates.find((c) => c.enrollment_id === e.id);

  const stepBlock = (s, i) => {
    const done = stepDoneFor(s, e, td);
    const acts = [];
    let extra = '';
    if (s.kind === 'exam') {
      const atts = data.results.filter((r) => r.enrollment_id === e.id);
      const passed = atts.some((r) => r.passed);
      const last = atts[0];
      const best = passed ? atts.find((r) => r.passed) : atts.find((r) => r.status === 'submitted');
      if (best) extra = `${Number(best.score)}/${Number(best.total)}${best.time_used_min ? ` · ${best.time_used_min} min` : ''}${atts.length > 1 ? ` · ${atts.length} attempts` : ''}`;
      if (canReview()) atts.filter((r) => r.status === 'submitted').slice().reverse().forEach((r, n, arr) => acts.push(`<button type="button" class="small-btn" data-review="${esc(r.attempt_id)}">Review answers${arr.length > 1 ? ` #${n + 1}` : ''}</button>`));
      const left = maxAttempts + (e.extra_attempts ?? 0) - atts.length;
      if (canRetake() && active && atts.length && !passed && left <= 0 && last?.status !== 'in_progress') acts.push(`<button type="button" class="small-btn" data-retake="${esc(e.id)}">Allow extra attempt</button>`);
    }
    if (s.kind === 'session' && assessor && (active || hoursFor(e.id, s.id, data.hours))) acts.push(`<button type="button" class="small-btn" data-hours="${esc(s.id)}">${active ? 'Log hours' : 'View hours'}</button>`);
    if (s.kind === 'session' && (s.config?.topics || []).length) {
      const subs = (data.subs || []).filter((x) => x.enrollment_id === e.id && x.step_id === s.id);
      const waiting = subs.filter((x) => x.status === 'submitted').length;
      acts.push(`<button type="button" class="small-btn${waiting ? ' primary' : ''}" data-asg="${esc(s.id)}">Assignments${waiting ? ` (${waiting} to review)` : ''}</button>`);
    }
    if (s.kind === 'practicum' && (assessor || ctx.roles.includes('hr'))) acts.push(`<button type="button" class="small-btn" data-checklist="${esc(s.id)}">Checklist</button>`);
    if ((s.kind === 'result' || s.kind === 'practicum') && assessor && active) {
      const r = resultFor(e.id, s.id, data.stepResults);
      acts.push(`<button type="button" class="small-btn${r ? '' : ' primary'}" data-record="${esc(s.id)}">${r ? 'Edit result' : 'Record result'}</button>`);
      if (r?.note) extra = `Note: ${r.note}`;
      if (r?.held_on) extra = `${fmtDate(r.held_on)}${extra ? ` · ${extra}` : ''}`;
    }
    if (s.kind === 'certificate' && cert) acts.push(`<button type="button" class="small-btn" data-tcert="${esc(cert.id)}">${icon('award')} Certificate</button>`);
    return `<li class="tp-step${done ? ' done' : ''}">
      <span class="cstep-num" aria-hidden="true">${done ? icon('check') : i + 1}</span>
      <div class="tp-main"><strong>${esc(s.title)}</strong>
        <span class="small ${done ? 'ok-text' : 'muted'}">${esc(stepStatus(s, e, td, true))}</span>
        ${extra ? `<span class="small muted">${esc(extra)}</span>` : ''}</div>
      <div class="tp-act">${acts.join(' ')}</div>
    </li>`;
  };

  const dlg = panelEl.querySelector('#tr-dlg');
  dlg.innerHTML = `
    <div class="tp">
      <div class="tp-head">
        <div><p class="level-kicker">${esc(prog.title)}</p><h2>${esc(name)}</h2>
          <p class="small muted">${esc(STATUS_LABEL[e.status] ?? e.status)} · started ${esc(fmtDate(e.started_on))}${e.recommended_by ? ` · recommended by ${esc(nameOf(e.recommended_by))}` : ''}</p>
          ${e.due_on ? `<p class="small">Finish by <strong>${esc(fmtDate(e.due_on))}</strong>${active && e.due_on < todayLocal() ? ' <span class="chip warn">Overdue</span>' : ''}
            ${isAdmin() && active ? '<button type="button" class="link small" data-due>Change</button>' : ''}</p>` : ''}</div>
      </div>
      <ol class="tp-steps">${steps.map(stepBlock).join('')}</ol>
      ${isAdmin() && e.status === 'passed' && prog.promotes_to && !e.promoted_on && !(p?.roles || []).includes(prog.promotes_to)
        ? `<p class="tp-promote"><button type="button" class="primary" data-promote>Promote to ${esc(RANK_NAME[prog.promotes_to] ?? prog.promotes_to)}</button></p>` : ''}
      ${e.promoted_on ? `<p class="ok-text small">Promoted on ${esc(fmtDate(e.promoted_on))}.</p>` : ''}
      <p class="muted small">${steps.some((s) => s.kind === 'exam') ? 'Trainees see their own score and a summary by domain, never which questions they got wrong. ' : ''}${steps.some((s) => s.kind === 'result') ? 'For recorded exams, trainees see pass / not pass and the date only. Practicum marks and comments are shared with them.' : ''}</p>
      <div class="dlg-actions"><span class="spacer"></span><button type="button" data-act="close">Close</button></div>
    </div>`;
  const redraw = () => drawTeam(programKey);
  const q = (sel) => dlg.querySelectorAll(sel);
  dlg.querySelector('[data-act="close"]').addEventListener('click', () => { teamOpen = null; dlg.close(); });
  dlg.addEventListener('cancel', () => { teamOpen = null; }, { once: true });
  for (const b of q('[data-review]')) b.addEventListener('click', () => { teamOpen = null; dlg.close(); showReview(b.dataset.review); });
  for (const b of q('[data-tcert]')) b.addEventListener('click', () => { teamOpen = null; dlg.close(); showCertificate(cert); });
  for (const b of q('[data-retake]')) {
    b.addEventListener('click', async () => {
      if (!confirm(`${name} has used all their attempts. Allow one extra attempt?`)) return;
      try { await allowRetake(e.id); dlg.close(); await redraw(); } catch (err) { alert(err.message); }
    });
  }
  dlg.querySelector('[data-due]')?.addEventListener('click', () => dueDialog(e.id, name, e.due_on ?? '', programKey));
  dlg.querySelector('[data-promote]')?.addEventListener('click', async () => {
    const to = RANK_NAME[prog.promotes_to] ?? prog.promotes_to;
    if (!confirm(`Promote ${name} to ${to}? Their rank and badge change straight away.`)) return;
    try { await promote(e.id); dlg.close(); await redraw(); } catch (err) { alert(err.message); }
  });
  for (const b of q('[data-hours]')) b.addEventListener('click', () => hoursDialog(programKey, content.steps.find((x) => x.id === b.dataset.hours), [e], nameOf, data, true));
  for (const b of q('[data-asg]')) b.addEventListener('click', () => reviewDialog(programKey, content.steps.find((x) => x.id === b.dataset.asg), [e], people, data));
  for (const b of q('[data-record]')) {
    b.addEventListener('click', () => recordDialog(programKey, content.steps.find((x) => x.id === b.dataset.record), e, name, resultFor(e.id, b.dataset.record, data.stepResults), data));
  }
  for (const b of q('[data-checklist]')) {
    b.addEventListener('click', () => checklistDialog(programKey, content.steps.find((x) => x.id === b.dataset.checklist), e, name, data, assessor && active));
  }
  if (!dlg.open) dlg.showModal();
}

const RANK_NAME = { therapist: 'Junior therapist', senior: 'Senior', qcd: 'QCD', supervisor: 'Supervisor' };

// Supervisor (or admin): recommend a Junior therapist for this programme.
function recommendDialog(programKey, people, data) {
  const prog = content.programs.find((p) => p.key === programKey);
  const open = new Set(data.enrollments.filter((e) => ['active', 'recommended', 'passed'].includes(e.status)).map((e) => e.therapist_id));
  // Senior training is for Junior therapists; QCD training for Seniors.
  const fromRank = { senior: 'therapist', qcd: 'senior' }[prog.promotes_to];
  const eligible = people.filter((p) => p.status !== 'exited' && p.track !== 'abat' && rankOf(p.roles) === fromRank && !open.has(p.id))
    .sort((a, b) => (a.nickname || a.full_name).localeCompare(b.nickname || b.full_name));
  const dlg = panelEl.querySelector('#tr-dlg');
  dlg.innerHTML = `
    <form method="dialog" class="person-form">
      <h2>Recommend for ${esc(prog.title)}</h2>
      ${eligible.length ? `<label>Who? <select name="who" required><option value="">Choose…</option>${eligible.map((p) => `<option value="${esc(p.id)}">${esc(p.nickname ? `${p.nickname} (${p.full_name})` : p.full_name)}</option>`).join('')}</select></label>
        <label>Why are you recommending them? <textarea name="reason" rows="3" maxlength="500" required></textarea></label>
        <p class="muted small">An admin approves the recommendation, then their training place opens.</p>`
        : `<p class="muted">Nobody eligible right now (${esc(RANK_NAME[fromRank] ?? '')}s without a place).</p>`}
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions"><span class="spacer"></span>
        <button type="button" data-act="cancel">Cancel</button>
        <button type="submit" class="primary"${eligible.length ? '' : ' disabled'}>Recommend</button></div>
    </form>`;
  const f = dlg.querySelector('form');
  f.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await recommend(programKey, f.who.value, f.reason.value.trim(), ctx.me.id);
      dlg.close();
      await drawTeam(programKey);
    } catch (e) { const m = f.querySelector('.msg'); m.hidden = false; m.dataset.kind = 'error'; m.textContent = e.message; }
  });
  if (!dlg.open) dlg.showModal();
}

// Log in-person training hours: for one person (with their log) or the group.
function hoursDialog(programKey, step, enrs, nameOf, data, single = false) {
  const dlg = panelEl.querySelector('#tr-dlg');
  const log = single ? data.hours.filter((h) => h.enrollment_id === enrs[0].id && h.step_id === step.id) : [];
  const canAdd = enrs.some((e) => e.status === 'active');
  const topics = step.config?.topics || [];
  const covered = chaptersCovered(log);
  dlg.innerHTML = `
    <form method="dialog" class="person-form">
      <h2>${single ? `Training hours · ${esc(nameOf(enrs[0].therapist_id))}` : 'Log a group session'}</h2>
      ${single ? (log.length ? `<ul class="hours-list">${log.map((h) => sessionLine(h, topics, ` <button type="button" class="link small" data-del="${esc(h.id)}">Remove</button>`)).join('')}</ul>`
        : '<p class="muted small">No sessions yet.</p>') : ''}
      ${canAdd ? `
      <div class="grid2">
        <label>Date <input name="held" type="date" required value="${todayLocal()}"></label>
        <label>Hours <input name="hours" type="number" min="0.5" max="12" step="0.5" required value="2"></label>
      </div>
      ${topics.length ? `<fieldset class="ch-pick"><legend>Chapters covered</legend>${topics.map((t, i) => `
        <label class="check"><input type="checkbox" name="ch" value="${i + 1}"${covered.has(i + 1) ? '' : ''}> <span><strong>${i + 1}</strong> ${esc(t)}${single && covered.has(i + 1) ? ' <span class="muted small">(covered)</span>' : ''}</span></label>`).join('')}</fieldset>` : ''}
      <label>Notes <span class="muted small">(optional)</span> <input name="topic" maxlength="200" placeholder="${topics.length ? 'e.g. Role-play on clinic prep' : 'e.g. Running clinic prep'}"></label>
      ${single ? '' : `<fieldset class="assign-list"><legend>Who attended?</legend>${enrs.map((e) => `
        <label class="check"><input type="checkbox" name="who" value="${esc(e.id)}" checked> <span>${esc(nameOf(e.therapist_id))}</span></label>`).join('')}</fieldset>`}` : ''}
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions"><span class="spacer"></span>
        <button type="button" data-act="cancel">Close</button>
        ${canAdd ? '<button type="submit" class="primary">Add session</button>' : ''}</div>
    </form>`;
  const f = dlg.querySelector('form');
  const say = (t) => { const m = f.querySelector('.msg'); m.hidden = false; m.dataset.kind = 'error'; m.textContent = t; };
  f.querySelector('[data-act="cancel"]').addEventListener('click', () => { dlg.close(); if (teamOpen) drawTeam(programKey); });
  for (const b of f.querySelectorAll('[data-del]')) {
    b.addEventListener('click', async () => {
      if (!confirm('Remove this session from their hours?')) return;
      try { await removeHours(b.dataset.del); dlg.close(); await drawTeam(programKey); } catch (e) { say(e.message); }
    });
  }
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const ids = single ? [enrs[0].id] : [...f.querySelectorAll('input[name="who"]:checked')].map((b) => b.value);
    if (!ids.length) return say('Tick who attended.');
    const chapters = [...f.querySelectorAll('input[name="ch"]:checked')].map((b) => Number(b.value));
    if (topics.length && !chapters.length && !f.topic.value.trim()) return say('Tick the chapters covered (or write a note).');
    try {
      await logHours(ids.map((id) => ({ enrollment_id: id, step_id: step.id, held_on: f.held.value, hours: Number(f.hours.value), topic: f.topic.value.trim() || null, ...(topics.length ? { chapters } : {}), recorded_by: ctx.me.id })));
      dlg.close();
      await drawTeam(programKey);
    } catch (e) { say(e.message); }
  });
  if (!dlg.open) dlg.showModal();
}

// Record a written / oral exam or practicum result.
function recordDialog(programKey, step, enr, name, current, data) {
  const c = step.config || {};
  const dlg = panelEl.querySelector('#tr-dlg');
  const hint = step.kind === 'practicum' ? practicumCheck(step, enr.id, data.evals) : null;
  dlg.innerHTML = `
    <form method="dialog" class="person-form">
      <h2>${esc(step.title)} · ${esc(name)}</h2>
      ${hint ? `<ul class="pr-check small">
        <li class="${hint.prep ? 'ok-text' : 'muted'}">${hint.prep ? '✓' : '○'} Last clinic prep: every item +</li>
        <li class="${hint.clinic ? 'ok-text' : 'muted'}">${hint.clinic ? '✓' : '○'} Last clinic: every item +</li>
        <li class="${hint.skills ? 'ok-text' : 'muted'}">${hint.skills ? '✓' : '○'} Technical skills: every task completed</li></ul>` : ''}
      <div class="grid2">
        <label>Date <input name="held" type="date" value="${esc(current?.held_on || todayLocal())}"></label>
        ${step.kind === 'practicum' ? '' : `<label>Score <span class="muted small">(optional)</span>
          <span class="score-pair"><input name="score" type="number" min="0" step="0.5" value="${esc(current?.score ?? '')}"> / <input name="full" type="number" min="1" step="0.5" value="${esc(current?.full_score ?? c.full_score ?? '')}"></span></label>`}
      </div>
      ${c.pass_score ? `<p class="muted small">Pass mark: ${esc(c.pass_score)}${c.full_score ? ` of ${esc(c.full_score)}` : ''}.</p>` : ''}
      <fieldset class="pills"><legend>Result</legend>
        <label class="pill"><input type="radio" name="passed" value="1"${current?.passed === true ? ' checked' : ''} required><span>Passed</span></label>
        <label class="pill"><input type="radio" name="passed" value="0"${current?.passed === false ? ' checked' : ''}><span>Not passed</span></label>
      </fieldset>
      <label>Note for the team <span class="muted small">(the trainee doesn't see this)</span><textarea name="note" rows="2" maxlength="1000">${esc(current?.note || '')}</textarea></label>
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions"><span class="spacer"></span>
        <button type="button" data-act="cancel">Cancel</button>
        <button type="submit" class="primary">Save result</button></div>
    </form>`;
  const f = dlg.querySelector('form');
  // Suggest pass / not pass from the score.
  f.score?.addEventListener('input', () => {
    if (c.pass_score && f.score.value !== '') f.querySelector(`input[name="passed"][value="${Number(f.score.value) >= c.pass_score ? 1 : 0}"]`).checked = true;
  });
  f.querySelector('[data-act="cancel"]').addEventListener('click', () => { dlg.close(); if (teamOpen) drawTeam(programKey); });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const res = await recordResult(enr.id, step.id, {
        passed: f.passed.value === '1', score: f.score?.value !== '' && f.score ? Number(f.score.value) : null,
        full: f.full?.value ? Number(f.full.value) : null, heldOn: f.held.value, note: f.note.value.trim(),
      });
      dlg.close();
      if (res?.completed) alert(`${name} has completed the programme. 🎉 A certificate has been issued.`);
      await drawTeam(programKey);
    } catch (e) { const m = f.querySelector('.msg'); m.hidden = false; m.dataset.kind = 'error'; m.textContent = e.message; }
  });
  if (!dlg.open) dlg.showModal();
}

// The practicum checklist for one trainee: pick a form to fill in or read.
function checklistDialog(programKey, step, enr, name, data, editable) {
  const dlg = panelEl.querySelector('#tr-dlg');
  const hint = practicumCheck(step, enr.id, data.evals);
  dlg.innerHTML = `
    <div class="person-form">
      <h2>Practicum checklist · ${esc(name)}</h2>
      <p class="muted small">${esc(step.config?.practicum?.pass_rule || '')}</p>
      <ul class="pr-check small">
        <li class="${hint.prep ? 'ok-text' : 'muted'}">${hint.prep ? '✓' : '○'} Last clinic prep: every item +</li>
        <li class="${hint.clinic ? 'ok-text' : 'muted'}">${hint.clinic ? '✓' : '○'} Last clinic: every item +</li>
        <li class="${hint.skills ? 'ok-text' : 'muted'}">${hint.skills ? '✓' : '○'} Technical skills: every task completed</li></ul>
      ${practicumHtml(step, enr, editable, data.evals, resultFor(enr.id, step.id, data.stepResults))}
      <div class="dlg-actions"><span class="spacer"></span><button type="button" data-act="close">Close</button></div>
    </div>`;
  dlg.querySelector('[data-act="close"]').addEventListener('click', () => { dlg.close(); if (teamOpen) drawTeam(programKey); });
  for (const b of dlg.querySelectorAll('[data-pr]')) {
    b.addEventListener('click', () => {
      const [, , section, seq] = b.dataset.pr.split('|');
      const slot = practicumSlots(step).find((x) => x.section === section && x.seq === Number(seq));
      practicumDialog(step, enr, slot, evalFor(data.evals, enr.id, step.id, slot), {
        editable, who: name,
        onSaved: async () => {
          await drawTeam(programKey);
          const fresh = await loadTeamProgram(programKey);
          checklistDialog(programKey, step, enr, name, fresh, editable);
        },
      });
    });
  }
  if (!dlg.open) dlg.showModal();
}

// Admin: give CARE staff a place on a programme (applicants are added automatically).
function assignDialog(programKey, people, data) {
  const prog = content.programs.find((p) => p.key === programKey);
  const open = new Set(data.enrollments.filter((e) => ['active', 'recommended'].includes(e.status)).map((e) => e.therapist_id));
  const done = new Set(data.enrollments.filter((e) => e.status === 'passed').map((e) => e.therapist_id));
  const order = ['supervisor', 'qcd', 'senior', 'therapist'];
  const eligible = people
    .filter((p) => p.status !== 'exited' && p.track !== 'abat' && order.includes(rankOf(p.roles)) && !open.has(p.id))
    .sort((a, b) => order.indexOf(rankOf(a.roles)) - order.indexOf(rankOf(b.roles)) || (a.nickname || a.full_name).localeCompare(b.nickname || b.full_name));
  const weeks = prog?.enrolment_weeks || 6;
  const today = todayLocal();
  const [y, m, d] = today.split('-').map(Number);
  const due = new Date(y, m - 1, d + weeks * 7);
  const dueIso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
  const label = { supervisor: 'Supervisor', qcd: 'QCD', senior: 'Senior therapist', therapist: 'Junior therapist' };
  const dlg = panelEl.querySelector('#tr-dlg');
  dlg.innerHTML = `
    <form method="dialog" class="person-form">
      <h2>Assign people: ${esc(prog?.title ?? '')}</h2>
      <p class="muted small">Pick CARE staff to take this course. Applicants are added automatically and aren't listed here.</p>
      ${eligible.length ? `<fieldset class="assign-list">${eligible.map((p) => `
        <label class="check"><input type="checkbox" name="who" value="${esc(p.id)}">
          <span><strong>${esc(p.nickname || p.full_name)}</strong> <span class="muted small">${esc(label[rankOf(p.roles)])}${done.has(p.id) ? ' · completed before' : ''}</span></span></label>`).join('')}</fieldset>`
        : '<p class="muted">Everyone eligible already has a place.</p>'}
      <label>Finish by <input name="due" type="date" required value="${dueIso}"></label>
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions"><span class="spacer"></span>
        <button type="button" data-act="cancel">Cancel</button>
        <button type="submit" class="primary"${eligible.length ? '' : ' disabled'}>Assign</button></div>
    </form>`;
  const form = dlg.querySelector('form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const ids = [...form.querySelectorAll('input[name="who"]:checked')].map((b) => b.value);
    const msg = form.querySelector('.msg');
    if (!ids.length) { msg.hidden = false; msg.dataset.kind = 'error'; msg.textContent = 'Tick at least one person.'; return; }
    try {
      await assignPeople(programKey, ids, form.due.value, ctx.me.id, today);
      dlg.close();
      await drawTeam(programKey);
    } catch (e) { msg.hidden = false; msg.dataset.kind = 'error'; msg.textContent = e.message; }
  });
  if (!dlg.open) dlg.showModal();
}

// Admin: change one person's finish-by date (e.g. an approved extension).
function dueDialog(enrollmentId, name, current, programKey) {
  const dlg = panelEl.querySelector('#tr-dlg');
  dlg.innerHTML = `
    <form method="dialog" class="person-form">
      <h2>Finish-by date for ${esc(name)}</h2>
      <label>Finish by <input name="due" type="date" required value="${esc(current)}"></label>
      <p class="muted small">Use this for an approved extension. Only this person's date changes.</p>
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions"><span class="spacer"></span>
        <button type="button" data-act="cancel">Cancel</button>
        <button type="submit" class="primary">Save</button></div>
    </form>`;
  const form = dlg.querySelector('form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => { dlg.close(); if (teamOpen) drawTeam(programKey); });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await setDueDate(enrollmentId, form.due.value);
      dlg.close();
      await drawTeam(programKey);
    } catch (e) {
      const msg = form.querySelector('.msg'); msg.hidden = false; msg.textContent = e.message;
    }
  });
  if (!dlg.open) dlg.showModal();
}

// ---------------------------------------------------------------------------
// Groups & schedule (admin plans; supervisors / QCD / admin take attendance)
// ---------------------------------------------------------------------------
const fmtDay = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const fmtTime = (t) => (t ? String(t).slice(0, 5) : '');
const KIND_LABEL = { session: 'Training session', exam: 'Exam', other: 'Other' };

function sessionTitle(se, topics, steps) {
  if (se.kind === 'exam') return se.title || steps.find((x) => x.id === se.step_id)?.title || 'Exam';
  const ch = (se.chapters || []).slice().sort((a, b) => a - b);
  const names = ch.map((c) => topics[c - 1]).filter(Boolean);
  return se.title || (ch.length ? `Ch ${ch.join(', ')}${names.length ? ` · ${names.join(' · ')}` : ''}` : KIND_LABEL[se.kind]);
}

async function drawGroups(programKey) {
  const body = panelEl.querySelector('#team-body');
  body.innerHTML = '<p class="muted">Loading…</p>';
  let people; let data; let g;
  try {
    [people, data, g] = await Promise.all([listStaff(), loadTeamProgram(programKey), loadGroups(programKey)]);
  } catch (e) { body.innerHTML = `<p class="error">Could not load groups: ${esc(e.message)}</p>`; return; }
  if (!g.ready) { body.innerHTML = '<p class="muted">Groups need the database update (Portal 022). Ask an admin to run it.</p>'; return; }
  const steps = stepsOf(programKey);
  const topics = steps.find((x) => x.kind === 'session')?.config?.topics || [];
  const nameOf = (id) => { const p = people.find((x) => x.id === id); return p ? (p.nickname || p.full_name) : 'Unknown'; };
  const enrName = (eid) => nameOf(data.enrollments.find((x) => x.id === eid)?.therapist_id);
  const admin = isAdmin();
  const assessor = ctx.roles.some((r) => ['admin', 'supervisor', 'qcd'].includes(r));
  const today = todayLocal();
  const ctxG = { programKey, people, data, g, steps, topics, nameOf, enrName };

  body.innerHTML = `
    ${admin ? '<p class="row-actions"><button type="button" class="primary" data-new-group>+ New group</button></p>' : ''}
    ${g.groups.length ? g.groups.map((gr) => {
      const mem = g.members.filter((m) => m.group_id === gr.id);
      const ses = g.sessions.filter((x) => x.group_id === gr.id);
      const next = ses.find((x) => x.status === 'planned' && x.held_on >= today);
      return `<section class="grp">
        <div class="grp-head">
          <div><h3>${esc(gr.name)}</h3>
            <p class="small muted">${mem.length} ${mem.length === 1 ? 'person' : 'people'}${mem.length ? `: ${mem.map((m) => esc(enrName(m.enrollment_id))).join(', ')}` : ''}</p>
            ${next ? `<p class="small">Next: <strong>${esc(fmtDay(next.held_on))}${next.start_time ? `, ${esc(fmtTime(next.start_time))}` : ''}</strong> · ${esc(sessionTitle(next, topics, steps))}</p>` : ''}</div>
          ${admin ? `<div class="row-actions"><button type="button" class="small-btn" data-edit-group="${esc(gr.id)}">Edit group</button>
            <button type="button" class="small-btn primary" data-plan="${esc(gr.id)}">+ Plan session</button></div>` : ''}
        </div>
        ${ses.length ? `<ul class="sched">${ses.map((se) => {
          const came = data.hours.filter((h) => h.session_id === se.id).length;
          const past = se.held_on <= today;
          return `<li class="${se.status}${past ? ' past' : ''}">
            <span class="sched-date"><strong>${esc(fmtDay(se.held_on))}</strong>${se.start_time ? `<br><span class="muted small">${esc(fmtTime(se.start_time))}${se.hours ? ` · ${esc(fmtHours(se.hours))} h` : ''}</span>` : se.hours ? `<br><span class="muted small">${esc(fmtHours(se.hours))} h</span>` : ''}</span>
            <span class="sched-main"><span class="chip${se.kind === 'exam' ? ' warn' : ''}">${esc(KIND_LABEL[se.kind])}</span> ${esc(sessionTitle(se, topics, steps))}
              <span class="muted small">${[se.place, se.trainer_id ? `with ${nameOf(se.trainer_id)}` : ''].filter(Boolean).map(esc).join(' · ')}</span></span>
            <span class="sched-act">
              ${se.status === 'done' ? `<span class="ok-text small">${icon('check')} ${came} attended</span>` : se.status === 'cancelled' ? '<span class="muted small">Cancelled</span>' : ''}
              ${assessor && se.kind === 'session' && se.status !== 'cancelled' && past ? `<button type="button" class="small-btn${se.status === 'done' ? '' : ' primary'}" data-attend="${esc(se.id)}">${se.status === 'done' ? 'Edit attendance' : 'Attendance'}</button>` : ''}
              ${admin ? `<button type="button" class="small-btn" data-edit-session="${esc(se.id)}">Edit</button>` : ''}
            </span>
          </li>`;
        }).join('')}</ul>` : '<p class="muted small">No sessions planned yet.</p>'}
      </section>`;
    }).join('') : '<p class="muted">No groups yet.' + (admin ? ' Create one, add people, then plan the sessions.' : '') + '</p>'}
    <p class="muted small">Trainees see their group's schedule. After a training session, tap <strong>Attendance</strong>: hours and chapters are logged for everyone who came.</p>`;

  const redraw = () => drawGroups(programKey);
  body.querySelector('[data-new-group]')?.addEventListener('click', () => groupDialog(ctxG, null, redraw));
  for (const b of body.querySelectorAll('[data-edit-group]')) b.addEventListener('click', () => groupDialog(ctxG, g.groups.find((x) => x.id === b.dataset.editGroup), redraw));
  for (const b of body.querySelectorAll('[data-plan]')) b.addEventListener('click', () => sessionDialog(ctxG, b.dataset.plan, null, redraw));
  for (const b of body.querySelectorAll('[data-edit-session]')) {
    b.addEventListener('click', () => { const se = g.sessions.find((x) => x.id === b.dataset.editSession); sessionDialog(ctxG, se.group_id, se, redraw); });
  }
  for (const b of body.querySelectorAll('[data-attend]')) b.addEventListener('click', () => attendanceDialog(ctxG, g.sessions.find((x) => x.id === b.dataset.attend), redraw));
}

function groupDialog(c, gr, redraw) {
  const dlg = panelEl.querySelector('#tr-dlg');
  const inGroup = new Set(c.g.members.filter((m) => gr && m.group_id === gr.id).map((m) => m.enrollment_id));
  const taken = new Set(c.g.members.filter((m) => !gr || m.group_id !== gr.id).map((m) => m.enrollment_id));
  const eligible = c.data.enrollments.filter((e) => (e.status === 'active' || inGroup.has(e.id)) && !taken.has(e.id));
  dlg.innerHTML = `
    <form method="dialog" class="person-form">
      <h2>${gr ? 'Edit group' : 'New group'}</h2>
      <label>Name <input name="name" required maxlength="80" value="${esc(gr?.name || '')}" placeholder="e.g. Senior 2027 – Group 1"></label>
      <label>Notes <span class="muted small">(optional)</span> <input name="notes" maxlength="500" value="${esc(gr?.notes || '')}"></label>
      <fieldset class="assign-list"><legend>Who is in this group?</legend>
        ${eligible.length ? eligible.map((e) => `<label class="check"><input type="checkbox" name="who" value="${esc(e.id)}"${inGroup.has(e.id) ? ' checked' : ''}> <span>${esc(c.nameOf(e.therapist_id))}</span></label>`).join('')
          : '<p class="muted small">Everyone with an active place is already in a group.</p>'}
      </fieldset>
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions">${gr ? '<button type="button" class="link" data-del>Delete group</button>' : ''}<span class="spacer"></span>
        <button type="button" data-act="cancel">Cancel</button>
        <button type="submit" class="primary">Save</button></div>
    </form>`;
  const f = dlg.querySelector('form');
  const say = (t) => { const m = f.querySelector('.msg'); m.hidden = false; m.dataset.kind = 'error'; m.textContent = t; };
  f.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
  f.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm(`Delete "${gr.name}" and its schedule? Hours already logged stay on each person's record.`)) return;
    try { await deleteGroup(gr.id); dlg.close(); await redraw(); } catch (e) { say(e.message); }
  });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const picked = new Set([...f.querySelectorAll('input[name="who"]:checked')].map((b) => b.value));
    try {
      const id = await saveGroup({ id: gr?.id, program_key: c.programKey, name: f.name.value.trim(), notes: f.notes.value.trim() || null, created_by: ctx.me.id });
      await setGroupMembers(id, [...picked].filter((x) => !inGroup.has(x)), [...inGroup].filter((x) => !picked.has(x)));
      dlg.close();
      await redraw();
    } catch (e) { say(e.message); }
  });
  if (!dlg.open) dlg.showModal();
}

function sessionDialog(c, groupId, se, redraw) {
  const dlg = panelEl.querySelector('#tr-dlg');
  const resultSteps = c.steps.filter((x) => x.kind === 'result');
  const planned = new Set(c.g.sessions.filter((x) => x.group_id === groupId && x.id !== se?.id && x.status !== 'cancelled').flatMap((x) => x.chapters || []));
  const trainers = c.people.filter((p) => p.status !== 'exited' && (p.roles || []).some((r) => ['supervisor', 'qcd', 'admin'].includes(r)))
    .sort((a, b) => (a.nickname || a.full_name).localeCompare(b.nickname || b.full_name));
  const kind = se?.kind || 'session';
  dlg.innerHTML = `
    <form method="dialog" class="person-form">
      <h2>${se ? 'Edit session' : 'Plan a session'}</h2>
      <fieldset class="pills"><legend>What is it?</legend>
        ${[['session', 'Training session'], ['exam', 'Exam'], ['other', 'Other']].map(([k, l]) => `<label class="pill"><input type="radio" name="kind" value="${k}"${kind === k ? ' checked' : ''}><span>${l}</span></label>`).join('')}
      </fieldset>
      <div class="grid2">
        <label>Date <input name="held" type="date" required value="${esc(se?.held_on || todayLocal())}"></label>
        <label>Start time <input name="start" type="time" value="${esc(fmtTime(se?.start_time) || '13:00')}"></label>
      </div>
      <div class="grid2">
        <label data-k="session other">Hours <input name="hours" type="number" min="0.5" max="12" step="0.5" value="${esc(se?.hours ?? 3)}"></label>
        <label data-k="exam">Which exam? <select name="step">${resultSteps.map((x) => `<option value="${esc(x.id)}"${se?.step_id === x.id ? ' selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>
        <label>Place <input name="place" maxlength="120" value="${esc(se?.place || '')}" placeholder="e.g. CARE meeting room"></label>
      </div>
      ${c.topics.length ? `<fieldset class="ch-pick" data-k="session"><legend>Chapters</legend>${c.topics.map((t, i) => `
        <label class="check"><input type="checkbox" name="ch" value="${i + 1}"${(se?.chapters || []).includes(i + 1) ? ' checked' : ''}> <span><strong>${i + 1}</strong> ${esc(t)}${planned.has(i + 1) ? ' <span class="muted small">(already planned)</span>' : ''}</span></label>`).join('')}</fieldset>` : ''}
      <label data-k="session other">Supervisor <select name="trainer"><option value="">—</option>${trainers.map((p) => `<option value="${esc(p.id)}"${se?.trainer_id === p.id ? ' selected' : ''}>${esc(p.nickname || p.full_name)}</option>`).join('')}</select></label>
      <label>Title <span class="muted small">(optional)</span> <input name="title" maxlength="120" value="${esc(se?.title || '')}" placeholder="Shown instead of the chapter names"></label>
      ${se ? `<label class="check"><input type="checkbox" name="cancelled"${se.status === 'cancelled' ? ' checked' : ''}> <span>Cancelled</span></label>` : ''}
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions">${se ? '<button type="button" class="link" data-del>Delete</button>' : ''}<span class="spacer"></span>
        <button type="button" data-act="cancel">Cancel</button>
        <button type="submit" class="primary">Save</button></div>
    </form>`;
  const f = dlg.querySelector('form');
  const say = (t) => { const m = f.querySelector('.msg'); m.hidden = false; m.dataset.kind = 'error'; m.textContent = t; };
  const sync = () => { for (const el of f.querySelectorAll('[data-k]')) el.hidden = !el.dataset.k.split(' ').includes(f.kind.value); };
  f.addEventListener('change', sync); sync();
  f.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
  f.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm('Delete this session? Hours already logged from it stay on each person\'s record.')) return;
    try { await deleteSession(se.id); dlg.close(); await redraw(); } catch (e) { say(e.message); }
  });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const k = f.kind.value;
    const chapters = k === 'session' ? [...f.querySelectorAll('input[name="ch"]:checked')].map((b) => Number(b.value)) : [];
    if (k === 'session' && c.topics.length && !chapters.length && !f.title.value.trim()) return say('Tick the chapters (or give it a title).');
    const sessionStep = c.steps.find((x) => x.kind === 'session');
    try {
      await saveSession({
        id: se?.id, group_id: groupId, kind: k,
        step_id: k === 'exam' ? f.step.value || null : k === 'session' ? sessionStep?.id ?? null : null,
        title: f.title.value.trim() || null, held_on: f.held.value, start_time: f.start.value || null,
        hours: k === 'exam' ? null : (f.hours.value ? Number(f.hours.value) : null),
        chapters, place: f.place.value.trim() || null, trainer_id: k === 'exam' ? null : (f.trainer.value || null),
        status: se ? (f.cancelled?.checked ? 'cancelled' : (se.status === 'cancelled' ? 'planned' : se.status)) : 'planned',
        ...(se ? {} : { created_by: ctx.me.id }),
      });
      dlg.close();
      await redraw();
    } catch (e) { say(e.message); }
  });
  if (!dlg.open) dlg.showModal();
}

function attendanceDialog(c, se, redraw) {
  const dlg = panelEl.querySelector('#tr-dlg');
  const mem = c.g.members.filter((m) => m.group_id === se.group_id).map((m) => c.data.enrollments.find((e) => e.id === m.enrollment_id)).filter((e) => e && e.status === 'active');
  const came = new Set(c.data.hours.filter((h) => h.session_id === se.id).map((h) => h.enrollment_id));
  dlg.innerHTML = `
    <form method="dialog" class="person-form">
      <h2>Attendance</h2>
      <p class="small"><strong>${esc(fmtDay(se.held_on))}</strong>${se.start_time ? `, ${esc(fmtTime(se.start_time))}` : ''} · ${esc(sessionTitle(se, c.topics, c.steps))} · ${esc(fmtHours(se.hours))} h</p>
      <fieldset class="assign-list"><legend>Who came?</legend>
        ${mem.length ? mem.map((e) => `<label class="check"><input type="checkbox" name="who" value="${esc(e.id)}"${se.status !== 'done' || came.has(e.id) ? ' checked' : ''}> <span>${esc(c.nameOf(e.therapist_id))}</span></label>`).join('') : '<p class="muted small">Nobody active in this group.</p>'}
      </fieldset>
      <p class="muted small">Everyone ticked gets ${esc(fmtHours(se.hours))} h${(se.chapters || []).length ? ` and chapters ${esc(se.chapters.join(', '))}` : ''} on their record. Saving again replaces the earlier attendance.</p>
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions"><span class="spacer"></span>
        <button type="button" data-act="cancel">Cancel</button>
        <button type="submit" class="primary"${mem.length ? '' : ' disabled'}>Save attendance</button></div>
    </form>`;
  const f = dlg.querySelector('form');
  f.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await takeAttendance(se.id, [...f.querySelectorAll('input[name="who"]:checked')].map((b) => b.value));
      dlg.close();
      await redraw();
    } catch (e) { const m = f.querySelector('.msg'); m.hidden = false; m.dataset.kind = 'error'; m.textContent = e.message; }
  });
  if (!dlg.open) dlg.showModal();
}

// The trainee's group schedule for the in-person step.
function mySchedule(step, enr, topics) {
  const list = (mine.sessions || []).filter((x) => x.kind !== 'exam' && (!x.step_id || x.step_id === step.id));
  if (!list.length) return '';
  const today = todayLocal();
  const up = list.filter((x) => x.status === 'planned' && x.held_on >= today);
  const past = list.filter((x) => !(x.status === 'planned' && x.held_on >= today));
  const row = (x) => `<li class="${x.attended ? 'came' : ''}">
    <span class="sched-date"><strong>${esc(fmtDay(x.held_on))}</strong>${x.start_time ? `<br><span class="muted small">${esc(fmtTime(x.start_time))}${x.hours ? ` · ${esc(fmtHours(x.hours))} h` : ''}</span>` : ''}</span>
    <span class="sched-main">${esc(sessionTitle(x, topics, [step]))}<span class="muted small">${[x.place, x.trainer ? `with ${x.trainer}` : ''].filter(Boolean).map(esc).join(' · ')}</span></span>
    <span class="sched-act small">${x.status === 'done' ? (x.attended ? `<span class="ok-text">${icon('check')} Attended</span>` : '<span class="muted">Not attended</span>') : ''}</span>
  </li>`;
  return `<h4 class="ch-h">Schedule${list[0]?.group_name ? ` · ${esc(list[0].group_name)}` : ''}</h4>
    ${up.length ? `<ul class="sched">${up.map(row).join('')}</ul>` : '<p class="muted small">No upcoming sessions.</p>'}
    ${past.length ? `<details class="sched-past"><summary class="small">Past sessions (${past.length})</summary><ul class="sched">${past.map(row).join('')}</ul></details>` : ''}`;
}

// ---------------------------------------------------------------------------
// Chapter assignments
// ---------------------------------------------------------------------------
const SUB_LABEL = { submitted: 'Submitted · waiting for review', reviewed: 'Reviewed', redo: 'Please redo' };
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

// Trainee: one row per chapter, due 7 days after the session that covers it.
function myAssignments(step, enr, topics) {
  if (!topics.length) return '';
  const subs = (mine.subs || []).filter((x) => x.enrollment_id === enr.id && x.step_id === step.id);
  const active = enr.status === 'active';
  const today = todayLocal();
  const dueFor = (ch) => {
    const se = (mine.sessions || []).filter((x) => x.kind === 'session' && (x.chapters || []).includes(ch)).sort((a, b) => a.held_on.localeCompare(b.held_on))[0];
    return se ? addDays(se.held_on, 7) : null;
  };
  const done = subs.filter((x) => x.status === 'reviewed').length;
  return `<h4 class="ch-h">Assignments <span class="muted small">· ${subs.length} of ${topics.length} submitted${done ? `, ${done} reviewed` : ''}</span></h4>
    <ul class="asg-list">${topics.map((t, i) => {
      const ch = i + 1;
      const sub = subs.find((x) => x.chapter === ch);
      const due = dueFor(ch);
      const late = !sub && due && due < today;
      const canUpload = active && (!sub || sub.status !== 'reviewed');
      return `<li class="asg ${sub ? sub.status : 'none'}">
        <span class="ch-num">${sub?.status === 'reviewed' ? icon('check') : ch}</span>
        <span class="asg-main"><span>${esc(t)}</span>
          <span class="small ${sub?.status === 'redo' || late ? 'error' : sub?.status === 'reviewed' ? 'ok-text' : 'muted'}">${sub ? `${esc(SUB_LABEL[sub.status])}${sub.file_name ? ` · ${esc(sub.file_name)}` : ''}` : due ? `Due ${esc(fmtDate(due))}` : 'Not submitted'}</span>
          ${sub?.feedback ? `<span class="asg-fb small">“${esc(sub.feedback)}”</span>` : ''}
          <span class="asg-msg small" hidden></span></span>
        <span class="asg-act">
          ${sub?.file_path ? `<button type="button" class="small-btn" data-work="${esc(sub.file_path)}">Open</button>` : ''}
          ${canUpload ? `<label class="small-btn btn-file">${sub ? 'Replace' : 'Upload'}<input type="file" accept="${WORK_ACCEPT}" data-upload="${esc(enr.id)}|${esc(step.id)}|${ch}"></label>` : ''}
        </span>
      </li>`;
    }).join('')}</ul>
    <p class="muted small">PDF, Word or a photo, up to 10 MB. You can replace a file until it's reviewed.</p>`;
}

// Team: review assignments for one trainee, or everything waiting.
function reviewDialog(programKey, step, enrs, people, data, waitingOnly = false) {
  const dlg = panelEl.querySelector('#tr-dlg');
  const topics = step?.config?.topics || [];
  const nameOf = (eid) => { const e = enrs.find((x) => x.id === eid) || data.enrollments.find((x) => x.id === eid); const p = people.find((x) => x.id === e?.therapist_id); return p ? (p.nickname || p.full_name) : 'Unknown'; };
  const ids = new Set(enrs.map((e) => e.id));
  const subs = (data.subs || []).filter((x) => ids.has(x.enrollment_id) && x.step_id === step.id && (!waitingOnly || x.status === 'submitted'))
    .sort((a, b) => (waitingOnly ? a.submitted_at.localeCompare(b.submitted_at) : a.chapter - b.chapter));
  const single = !waitingOnly && enrs.length === 1;
  const rows = single
    ? topics.map((t, i) => ({ ch: i + 1, t, sub: subs.find((x) => x.chapter === i + 1) }))
    : subs.map((x) => ({ ch: x.chapter, t: topics[x.chapter - 1] || `Chapter ${x.chapter}`, sub: x }));
  dlg.innerHTML = `
    <div class="person-form rv">
      <h2>${single ? `Assignments · ${esc(nameOf(enrs[0].id))}` : 'Assignments to review'}</h2>
      ${rows.length ? `<ul class="rv-list">${rows.map(({ ch, t, sub }) => `<li class="${sub ? sub.status : 'none'}" data-sub="${esc(sub?.id || '')}">
        <div class="rv-head"><span class="ch-num">${ch}</span>
          <div><strong>${esc(t)}</strong>${single ? '' : ` <span class="muted small">· ${esc(nameOf(sub.enrollment_id))}</span>`}
            <div class="small muted rv-status">${sub ? `${esc(SUB_LABEL[sub.status])} · sent ${esc(fmtDate(sub.submitted_at.slice(0, 10)))}${sub.file_name ? ` · ${esc(sub.file_name)}` : ''}${sub.cleared_at ? ' · file cleared' : ''}` : 'Not submitted yet'}</div></div>
          ${sub?.file_path ? `<button type="button" class="small-btn" data-work="${esc(sub.file_path)}">Open</button>` : ''}</div>
        ${sub && sub.file_path ? `<div class="rv-form"><textarea rows="2" maxlength="2000" placeholder="Comment for the trainee (optional)">${esc(sub.feedback || '')}</textarea>
          <div class="row-actions"><button type="button" class="small-btn" data-rv="redo">Please redo</button>
            <button type="button" class="small-btn primary" data-rv="reviewed">Reviewed</button></div></div>` : ''}
      </li>`).join('')}</ul>` : '<p class="muted">Nothing waiting for review. 🎉</p>'}
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions"><span class="spacer"></span><button type="button" data-act="close">Close</button></div>
    </div>`;
  const msg = dlg.querySelector('.msg');
  dlg.querySelector('[data-act="close"]').addEventListener('click', () => { dlg.close(); if (teamOpen) drawTeam(programKey); else drawTeam(programKey); });
  for (const b of dlg.querySelectorAll('[data-work]')) {
    b.addEventListener('click', async () => {
      const w = window.open('', '_blank');
      try { const url = await workUrl(b.dataset.work); if (w) w.location = url; else window.location.href = url; } catch (e) { w?.close(); msg.hidden = false; msg.dataset.kind = 'error'; msg.textContent = e.message; }
    });
  }
  for (const b of dlg.querySelectorAll('[data-rv]')) {
    b.addEventListener('click', async () => {
      const li = b.closest('li');
      try {
        await reviewSubmission(li.dataset.sub, b.dataset.rv, li.querySelector('textarea').value.trim());
        const sub = data.subs.find((x) => x.id === li.dataset.sub);
        Object.assign(sub, { status: b.dataset.rv, feedback: li.querySelector('textarea').value.trim() || null });
        li.className = b.dataset.rv;
        li.querySelector('.rv-status').textContent = `${SUB_LABEL[b.dataset.rv]} · sent ${fmtDate(sub.submitted_at.slice(0, 10))}${sub.file_name ? ` · ${sub.file_name}` : ''}`;
      } catch (e) { msg.hidden = false; msg.dataset.kind = 'error'; msg.textContent = e.message; }
    });
  }
  if (!dlg.open) dlg.showModal();
}
