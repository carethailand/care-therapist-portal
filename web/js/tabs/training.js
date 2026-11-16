// Training tab: my programmes (modules, exam, certificate) and, for the
// training team, everyone's progress. Exams are marked on the server; this
// page never sees the answers.
import {
  loadContent, loadMyTraining, setItemDone, agreeStep, examStart, examSave, examSubmit, examMySummary, examReview,
  loadTeamProgram, allowRetake, setDueDate, assignPeople,
} from '../training-data.js';
import { rankOf } from '../labels.js';
import { docHtml } from '../doc-text.js';
import { listStaff } from '../data.js';
import { esc, fmtDate, todayLocal } from '../ui.js';

const TEAM = ['admin', 'hr', 'supervisor', 'qcd'];
const ITEM_ICON = { canva: '🎨', pdf: '📄', video: '▶️', link: '🔗', document: '📄', other: '📎' };
const STEP_ICON = { agree: '🤝', learn: '📖', exam: '📝', session: '👥', gap: '⏸', result: '📄', practicum: '✅', certificate: '🎓' };
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
const canTick = (it) => (it.kind === 'document' ? !!it.body : !!safeUrl(it.url));

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
    if (n < items.length) locks.push(`Finish all the course modules first (${n} of ${items.length} done).`);
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
  return content.programs.filter((p) => p.enabled && !current.some((e) => e.program_key === p.key));
}

function drawHome() {
  const current = myCurrent();
  const previews = previewPrograms(current);
  const teamPrograms = content.programs.filter((p) => p.enabled);
  panelEl.innerHTML = `
    ${current.map(programCard).join('')}
    ${previews.map(previewCard).join('')}
    ${!current.length && !previews.length
      ? `<section class="card"><h2>My training</h2>
           <p class="muted">You're not in a training programme right now. When you are, it will appear here.</p></section>` : ''}
    ${isTeam() ? `
      <section class="card" id="team-card">
        <div class="page-head">
          <h2>Trainees</h2>
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
      } catch (e) {
        box.checked = !box.checked;
        alert(e.message);
      } finally {
        box.disabled = false;
      }
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
    sel.addEventListener('change', () => drawTeam(sel.value));
    if (sel.value) drawTeam(sel.value);
    else panelEl.querySelector('#team-body').innerHTML = '<p class="muted">No programmes are switched on yet.</p>';
  }
}

function learnCount(enrId, stepId) {
  const items = itemsOf(stepId);
  const n = items.filter((i) => mine.done.some((d) => d.enrollment_id === enrId && d.item_id === i.id)).length;
  return `${n} of ${items.length} done`;
}

function previewCard(prog) {
  const steps = stepsOf(prog.key);
  const itemLine = (it) => {
    const url = safeUrl(it.url);
    let action = '<span class="muted small nowrap">Link coming soon</span>';
    if (it.kind === 'document' && it.body) action = `<button type="button" class="small-btn" data-read="${esc(it.id)}">Read</button>`;
    else if (canvaEmbed(url)) action = `<button type="button" class="small-btn" data-canva="${esc(it.id)}">View</button>`;
    else if (url) action = `<a class="small-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open</a>`;
    return `<li><span>${ITEM_ICON[it.kind] ?? '•'} ${esc(it.title)}${it.note ? ` <span class="muted small">${esc(it.note)}</span>` : ''}</span>${action}</li>`;
  };
  return `
    <section class="card program-card preview-card">
      <div class="page-head">
        <h2>${esc(prog.title)}</h2>
        <span class="chip">Preview</span>
      </div>
      ${prog.summary ? `<p class="muted">${esc(prog.summary)}</p>` : ''}
      <p class="lock-note">🔒 You can look through the course. To take part and sit the exam, an admin needs to assign you. Ask your supervisor if you'd like to join.</p>
      <ol class="steps">${steps.map((s) => `
        <li class="step">
          <div class="step-head"><span class="step-icon" aria-hidden="true">${STEP_ICON[s.kind] ?? '•'}</span><strong>${esc(s.title)}</strong></div>
          ${['learn', 'agree'].includes(s.kind) && itemsOf(s.id).length
            ? `<ul class="items">${itemsOf(s.id).map(itemLine).join('')}</ul>`
            : s.kind === 'exam' ? '<p class="muted small">Opens when you are assigned.</p>'
            : s.details ? `<p class="muted small">${esc(s.details)}</p>` : ''}
        </li>`).join('')}</ol>
    </section>`;
}

function programCard(enr) {
  const prog = content.programs.find((p) => p.key === enr.program_key);
  if (!prog) return '';
  return `
    <section class="card program-card">
      <div class="page-head">
        <h2>${esc(prog.title)}</h2>
        <span class="chip ${enr.status === 'passed' ? 'ok' : 'stage'}">${esc(STATUS_LABEL[enr.status] ?? enr.status)}</span>
      </div>
      ${prog.summary ? `<p class="muted">${esc(prog.summary)}</p>` : ''}
      ${enr.due_on && enr.status === 'active'
        ? (enr.due_on < todayLocal()
          ? `<p class="small error">⚠️ The finish date (${esc(fmtDate(enr.due_on))}) has passed. Please talk to your supervisor.</p>`
          : `<p class="small">🗓 Started ${esc(fmtDate(enr.started_on))} · please finish the modules <strong>and the exam</strong> by <strong>${esc(fmtDate(enr.due_on))}</strong></p>`)
        : ''}
      <ol class="steps">${stepsOf(prog.key).map((s) => stepHtml(s, enr)).join('')}</ol>
    </section>`;
}

function stepHtml(step, enr) {
  const head = (extra = '') => `<div class="step-head"><span class="step-icon" aria-hidden="true">${STEP_ICON[step.kind] ?? '•'}</span>
    <strong>${esc(step.title)}</strong>${extra}</div>
    ${step.details ? `<p class="muted small">${esc(step.details)}</p>` : ''}`;
  const active = enr.status === 'active';

  if (step.kind === 'agree') {
    const docs = itemsOf(step.id);
    const done = agreedOn(enr.id, step.id);
    const names = docs.map((d) => d.title).join(' and ');
    return `<li class="step">${head()}
      <ul class="items">${docs.map((d) => `<li><span>📄 ${esc(d.title)}</span>
        <button type="button" class="small-btn" data-read="${esc(d.id)}">Read</button></li>`).join('')}</ul>
      ${done
        ? `<p class="ok-text">✅ You agreed on ${esc(new Date(done.done_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium' }))}.</p>`
        : active ? `<label class="check agree-box"><input type="checkbox" data-agree-box="${esc(step.id)}">
              <span>I have read and agree to the ${esc(names || 'course policies')}.</span></label>
            <button type="button" class="primary" data-agree="${esc(step.id)}" data-enr="${esc(enr.id)}" disabled>I agree</button>`
          : ''}
    </li>`;
  }

  if (step.kind === 'learn') {
    const items = itemsOf(step.id);
    return `<li class="step" data-step="${esc(step.id)}">
      ${head(items.length ? ` <span class="muted small step-count">${esc(learnCount(enr.id, step.id))}</span>` : '')}
      ${items.length ? `<ul class="items">${items.map((it) => {
        const done = mine.done.some((d) => d.enrollment_id === enr.id && d.item_id === it.id);
        const url = safeUrl(it.url);
        const ready = canTick(it);
        let action = '<span class="muted small nowrap">Link coming soon</span>';
        if (it.kind === 'document' && it.body) action = `<button type="button" class="small-btn" data-read="${esc(it.id)}">Read</button>`;
        else if (canvaEmbed(url)) action = `<button type="button" class="small-btn" data-canva="${esc(it.id)}">View</button>`;
        else if (url) action = `<a class="small-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open</a>`;
        return `<li>
          <label class="check"><input type="checkbox" data-enr="${esc(enr.id)}" data-item="${esc(it.id)}"${done ? ' checked' : ''}${active && ready ? '' : ' disabled'}>
            <span>${ITEM_ICON[it.kind] ?? '•'} ${esc(it.title)}${it.note ? ` <span class="muted small">${esc(it.note)}</span>` : ''}</span></label>
          ${action}
        </li>`;
      }).join('')}</ul>` : '<p class="muted small">The modules will appear here soon.</p>'}
    </li>`;
  }

  if (step.kind === 'exam') {
    const atts = mine.attempts.filter((a) => a.enrollment_id === enr.id && a.step_id === step.id);
    const open = atts.find((a) => a.status === 'in_progress');
    const passed = atts.some((a) => a.passed);
    const max = step.config?.max_attempts ?? 1;
    const left = max + (enr.extra_attempts ?? 0) - atts.length;
    const mins = step.config?.time_limit_min ?? 120;
    const wait = step.config?.retake_wait_days ?? 0;
    const lastSub = atts.filter((a) => a.submitted_at).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];
    const reSitFrom = lastSub && wait ? new Date(Date.parse(lastSub.submitted_at) + wait * 86400000) : null;
    const locks = examLocks(step, enr);
    const rules = `${mins} minutes · ${max === 1 ? 'one attempt' : `up to ${max} attempts`}${wait && max > 1 ? `, at least ${wait} days apart` : ''} · the timer keeps running even if you close the page.`;
    let body;
    if (passed) body = '<p class="ok-text">✅ Passed</p>';
    else if (open && active) body = `<p>You have started this exam. The timer is still running.</p>
      <button type="button" class="primary" data-start-exam="${esc(step.id)}" data-resume="1">Continue exam</button>`;
    else if (atts.length && left <= 0) body = '<p>Thank you for taking the exam. You didn\'t pass this time. Your supervisor will talk with you about the next step.</p>';
    else if (!active) body = '<p class="muted small">Not open.</p>';
    else if (locks.length) body = `<p class="muted small">${esc(rules)}</p><ul class="locks">${locks.map((l) => `<li>🔒 ${esc(l)}</li>`).join('')}</ul>`;
    else if (reSitFrom && reSitFrom > new Date()) {
      const reSitDay = reSitFrom.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      body = `<p>You didn't pass last time. You can re-sit from <strong>${esc(reSitFrom.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }))}</strong>. Use the time to review the modules.</p>
        ${enr.due_on && reSitDay > enr.due_on ? `<p class="error small">⚠️ That is after your finish date (${esc(fmtDate(enr.due_on))}). Please talk to your supervisor about an extension.</p>` : ''}`;
    }
    else body = `<p class="muted small">${esc(rules)}</p>
      ${atts.length ? `<p>You may re-sit the exam (${left} attempt${left === 1 ? '' : 's'} left).</p>` : ''}
      <button type="button" class="primary" data-start-exam="${esc(step.id)}">${atts.length ? 'Start re-sit' : 'Start exam'}</button>`;
    const subs = atts.filter((a) => a.status === 'submitted').sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
    const results = subs.length ? `<p class="small">${subs.map((a, n) => `<button type="button" class="link" data-summary="${esc(a.id)}">📊 My results${subs.length > 1 ? ` (attempt ${n + 1})` : ''}</button>`).join(' · ')}</p>` : '';
    return `<li class="step">${head()}${body}${results}</li>`;
  }

  if (step.kind === 'certificate') {
    const cert = mine.certificates.find((c) => c.enrollment_id === enr.id);
    return `<li class="step">${head()}
      ${cert ? `<button type="button" class="primary" data-cert="${esc(cert.id)}">🎓 View certificate</button>`
             : '<p class="muted small">Unlocks when you pass the exam.</p>'}</li>`;
  }

  return `<li class="step">${head()}<p class="muted small">Coming soon.</p></li>`;
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
  dlg.showModal();
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
  dlg.showModal();
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
  dlg.showModal();
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
  dlg.showModal();
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
  dlg.showModal();
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
  dlg.showModal();
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
  const learnItems = stepsOf(programKey).filter((s) => s.kind === 'learn').flatMap((s) => itemsOf(s.id));
  const agreeSteps = stepsOf(programKey).filter((s) => s.kind === 'agree');
  const examStep = stepsOf(programKey).find((s) => s.kind === 'exam');
  const maxAttempts = examStep?.config?.max_attempts ?? 1;
  const rows = data.enrollments.filter((e) => e.status !== 'withdrawn');
  const assignBtn = ctx.roles.includes('admin')
    ? `<p><button type="button" class="primary" data-assign>+ Assign people</button></p>` : '';
  const wireAssign = () => body.querySelector('[data-assign]')?.addEventListener('click', () => assignDialog(programKey, people, data));
  if (!rows.length) {
    body.innerHTML = `${assignBtn}<p class="muted">No one is in this programme yet.</p>`;
    wireAssign();
    return;
  }
  const order = { active: 0, recommended: 1, not_passed: 2, passed: 3 };
  rows.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  body.innerHTML = `${assignBtn}
    <div class="table-wrap"><table class="team-table">
      <thead><tr><th>Person</th><th>Status</th><th>Started</th><th>Finish by</th><th>Policies</th><th>Modules</th><th>Exam</th><th></th></tr></thead>
      <tbody>${rows.map((e) => {
        const p = people.find((x) => x.id === e.therapist_id);
        const name = p ? (p.nickname || p.full_name) : 'Unknown';
        const doneN = learnItems.filter((i) => data.done.some((d) => d.enrollment_id === e.id && d.item_id === i.id)).length;
        const atts = data.results.filter((r) => r.enrollment_id === e.id);
        const last = atts[0];
        const passed = atts.some((r) => r.passed);
        const left = maxAttempts + (e.extra_attempts ?? 0) - atts.length;
        const agreed = agreeSteps.length ? agreeSteps.every((s) => data.stepsDone.some((d) => d.enrollment_id === e.id && d.step_id === s.id)) : null;
        let exam = '<span class="muted">Not started</span>';
        if (last?.status === 'in_progress') exam = 'In progress';
        else if (last) {
          const best = passed ? atts.find((r) => r.passed) : last;
          exam = `${best.passed ? '<span class="ok-text">Passed</span>' : '<span class="error">Not passed</span>'}
            · ${Number(best.score)}/${Number(best.total)}${best.time_used_min ? ` · ${best.time_used_min} min` : ''}
            ${atts.length > 1 ? `<span class="muted small"> (${atts.length} attempts)</span>` : ''}`;
        }
        if (canReview()) {
          const subs = atts.filter((r) => r.status === 'submitted').slice().reverse();
          if (subs.length) exam += `<div>${subs.map((r, n) => `<button type="button" class="link small" data-review="${esc(r.attempt_id)}">Review${subs.length > 1 ? ` #${n + 1}` : ''}</button>`).join(' · ')}</div>`;
        }
        const cert = data.certificates.find((c) => c.enrollment_id === e.id);
        const actions = [
          cert ? `<button type="button" class="small-btn" data-tcert="${esc(cert.id)}">Certificate</button>` : '',
          canRetake() && e.status === 'active' && atts.length && !passed && left <= 0 && last?.status !== 'in_progress'
            ? `<button type="button" class="small-btn" data-retake="${esc(e.id)}" data-name="${esc(name)}">Allow extra attempt</button>` : '',
        ].join(' ');
        return `<tr>
          <td><strong>${esc(name)}</strong>${p?.track === 'abat' ? ' <span class="chip track-abat">ABAT</span>' : ''}</td>
          <td>${esc(STATUS_LABEL[e.status] ?? e.status)}</td>
          <td>${esc(fmtDate(e.started_on))}</td>
          <td class="nowrap">${e.due_on ? esc(fmtDate(e.due_on)) : '—'}${e.status === 'active' && e.due_on && e.due_on < todayLocal() ? ' <span class="chip warn">Overdue</span>' : ''}
            ${isAdmin() && e.status === 'active' ? `<button type="button" class="small-btn" data-due="${esc(e.id)}" data-name="${esc(name)}" data-date="${esc(e.due_on ?? '')}" aria-label="Change finish date">Change</button>` : ''}</td>
          <td>${agreed === null ? '—' : agreed ? '<span class="ok-text">✓ Agreed</span>' : '<span class="muted">Not yet</span>'}</td>
          <td>${learnItems.length ? `${doneN}/${learnItems.length}` : '—'}</td>
          <td>${exam}</td>
          <td>${actions}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <p class="muted small">Trainees see their own score and a summary by domain, but never which questions they got wrong. Answer reviews are for admins, supervisors and QCD.</p>`;

  wireAssign();
  for (const b of body.querySelectorAll('[data-retake]')) {
    b.addEventListener('click', async () => {
      if (!confirm(`${b.dataset.name} has used all their attempts. Allow one extra attempt?`)) return;
      b.disabled = true;
      try {
        await allowRetake(b.dataset.retake);
        await drawTeam(programKey);
      } catch (e) {
        alert(e.message);
        b.disabled = false;
      }
    });
  }
  for (const b of body.querySelectorAll('[data-review]')) {
    b.addEventListener('click', () => showReview(b.dataset.review));
  }
  for (const b of body.querySelectorAll('[data-due]')) {
    b.addEventListener('click', () => dueDialog(b.dataset.due, b.dataset.name, b.dataset.date, programKey));
  }
  for (const b of body.querySelectorAll('[data-tcert]')) {
    b.addEventListener('click', () => showCertificate(data.certificates.find((c) => c.id === b.dataset.tcert)));
  }
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
  dlg.showModal();
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
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
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
  dlg.showModal();
}
