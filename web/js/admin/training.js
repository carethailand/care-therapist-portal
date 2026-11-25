// Admin → Training content: course modules, exam settings and exam
// questions. Answers are read and written only through admin-only database
// functions; they never appear in the trainee's browser.
import {
  loadContent, saveItem, removeItem, saveStepConfig, saveProgram,
  questionsAdmin, questionSave, questionRemove, questionsImport,
  setModuleEnabled, loadModule,
} from '../training-data.js';
import { esc } from '../ui.js';

const KINDS = { canva: '🎨 Canva', document: '📄 Document (read in the Portal)', pdf: '📄 PDF link', video: '▶️ Video', link: '🔗 Link', other: '📎 Other' };
// Canva links the Portal can show inside itself (see tabs/training.js).
const EMBEDDABLE = /^https:\/\/(?:www\.)?canva\.com\/design\/[A-Za-z0-9_-]+/;
const STEP_ICON = { agree: '🤝', learn: '📖', exam: '📝', session: '👥', gap: '⏸', result: '📄', practicum: '✅', certificate: '🎓' };

let host;
let content;
let program = 'abat';

export async function render(panel) {
  host = panel;
  panel.innerHTML = '<p class="muted">Loading…</p>';
  try {
    content = await loadContent();
  } catch (e) {
    panel.innerHTML = `<section class="card"><p class="error">Could not load: ${esc(e.message)}</p></section>`;
    return;
  }
  panel.innerHTML = `
    <section class="card">
      <div class="page-head">
        <h2>Training content</h2>
        <select id="tc-prog" aria-label="Programme">
          ${content.programs.map((p) => `<option value="${esc(p.key)}"${p.key === program ? ' selected' : ''}>${esc(p.title)}${p.enabled ? '' : ' (not built yet)'}</option>`).join('')}
        </select>
      </div>
      <div id="tc-tab" class="tab-switch"></div>
    </section>
    <div id="tc-body"></div>
    <dialog id="tc-dlg" class="dlg"></dialog>`;
  panel.querySelector('#tc-prog').addEventListener('change', (e) => { program = e.target.value; drawBody(); });
  drawTabSwitch();
  drawBody();
}

async function reloadContent() {
  content = await loadContent();
  drawBody();
}

// The Training tab is hidden from staff until you switch it on.
async function drawTabSwitch() {
  const el = host.querySelector('#tc-tab');
  try {
    const m = await loadModule('training');
    if (!m) { el.innerHTML = ''; return; }
    el.innerHTML = `<p>${m.enabled
      ? '✅ The <strong>Training</strong> tab is <strong>visible</strong> to staff and applicants.'
      : '🙈 The <strong>Training</strong> tab is <strong>hidden</strong> from staff (only admins can see it). Switch it on when the lessons and questions are ready.'}
      <button type="button" class="small-btn" id="tc-toggle">${m.enabled ? 'Hide from staff' : 'Show to staff'}</button></p>`;
    el.querySelector('#tc-toggle').addEventListener('click', async (ev) => {
      if (!m.enabled && !confirm('Show the Training tab to everyone it applies to now?')) return;
      ev.currentTarget.disabled = true;
      try { await setModuleEnabled('training', !m.enabled); } catch (e) { alert(e.message); }
      drawTabSwitch();
    });
  } catch (e) {
    el.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

function drawBody() {
  const body = host.querySelector('#tc-body');
  const prog = content.programs.find((p) => p.key === program);
  const steps = content.steps.filter((s) => s.program_key === program);
  if (!prog.enabled && !steps.length) {
    body.innerHTML = `<section class="card"><p class="muted">${esc(prog.title)} isn't built yet. It comes after ABAT.</p></section>`;
    return;
  }
  body.innerHTML = `<section class="card"><h3>⚙️ Course settings</h3>
      <form class="course-settings person-form">
        <div class="grid2">
          <label>Course name <input name="title" required value="${esc(prog.title)}"></label>
          <label>Accreditation line <input name="accr" value="${esc(prog.accreditation ?? '')}" placeholder="e.g. Qualified by QABA"></label>
        </div>
        <p class="muted small">The accreditation line shows under the course name with a small award icon. Leave it empty until it's confirmed.</p>
        <div class="grid2">
          <label>Finish within (weeks): CARE new hires <input name="weeksnew" type="number" min="1" max="104" value="${esc(prog.enrolment_weeks_new_hire ?? '')}" placeholder="same as below"></label>
          <label>Finish within (weeks): ABAT learners / everyone else <input name="weeks" type="number" min="1" max="104" value="${esc(prog.enrolment_weeks ?? '')}" placeholder="no limit"></label>
        </div>
        <p class="muted small">Each person's finish-by date is set when they start. Changing these numbers affects new starters only; change one person's date from the Trainees list in the Training tab.</p>
        <label>Short description <input name="summary" value="${esc(prog.summary ?? '')}"></label>
        <label>Certificate: issued by <input name="provider" value="${esc(prog.provider_name ?? '')}"></label>
        <label>Certificate: course title <input name="ctitle" value="${esc(prog.certificate_title ?? '')}"></label>
        <label>Certificate: small print <input name="cnote" value="${esc(prog.certificate_note ?? '')}"></label>
        <p><button type="submit" class="small-btn primary">Save course settings</button></p>
      </form></section>` + steps.map((s) => `<section class="card" data-step="${esc(s.id)}">
      <h3>${STEP_ICON[s.kind] ?? '•'} ${esc(s.title)}</h3>
      <div class="step-body"><p class="muted">Loading…</p></div>
    </section>`).join('');
  const cs = body.querySelector('.course-settings');
  cs.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await saveProgram(prog.key, {
        title: cs.title.value.trim(),
        accreditation: cs.accr.value.trim() || null,
        summary: cs.summary.value.trim() || null,
        enrolment_weeks: cs.weeks.value ? Number(cs.weeks.value) : null,
        enrolment_weeks_new_hire: cs.weeksnew.value ? Number(cs.weeksnew.value) : null,
        provider_name: cs.provider.value.trim() || null,
        certificate_title: cs.ctitle.value.trim() || null,
        certificate_note: cs.cnote.value.trim() || null,
      });
      await reloadContent();
    } catch (e) { alert(e.message); }
  });
  for (const s of steps) {
    const el = body.querySelector(`[data-step="${s.id}"] .step-body`);
    if (s.kind === 'agree') {
      el.insertAdjacentHTML('beforebegin', '<p class="muted small">Trainees read these documents and tick "I have read and agree". The exam stays locked until they do.</p>');
      drawLearn(s, el);
    } else if (s.kind === 'learn') drawLearn(s, el);
    else if (s.kind === 'exam') drawExam(s, el);
    else if (s.kind === 'session') drawSession(s, el);
    else if (s.kind === 'certificate') el.innerHTML = '<p class="muted">Issued automatically to everyone who passes the exam, with a certificate number. Trainees can save it as a PDF.</p>';
    else el.innerHTML = '<p class="muted">Editing for this kind of step comes with the Senior and QCD programmes.</p>';
  }
}

// ---------------------------------------------------------------------------
// Course modules
// ---------------------------------------------------------------------------
function drawLearn(step, el) {
  const items = content.items.filter((i) => i.step_id === step.id);
  el.innerHTML = `
    ${items.length ? `<ol class="edit-list">${items.map((it, n) => `
      <li>
        <div class="grow"><strong>${esc(it.title)}</strong> <span class="muted small">${esc(KINDS[it.kind] ?? it.kind)}</span>
          ${it.kind === 'document' ? `<div class="muted small">${it.body ? `${it.body.length.toLocaleString()} characters of text` : '<span class="error">No text yet</span>'}</div>`
            : it.url ? `<div class="muted small ellipsis">${esc(it.url)}</div>${it.kind === 'canva' && !EMBEDDABLE.test(it.url) ? '<div class="error small">⚠️ This Canva link opens in a new tab, where it can be copied. Use the full link that starts with https://www.canva.com/design/ (Share → Copy link, with "Anyone with the link" set to Can view).</div>' : ''}`
            : '<div class="error small">No link yet (trainees see "Link coming soon")</div>'}
          ${it.note ? `<div class="small">${esc(it.note)}</div>` : ''}</div>
        <span class="row-actions">
          <button type="button" class="small-btn" data-up="${esc(it.id)}"${n === 0 ? ' disabled' : ''} aria-label="Move up">↑</button>
          <button type="button" class="small-btn" data-down="${esc(it.id)}"${n === items.length - 1 ? ' disabled' : ''} aria-label="Move down">↓</button>
          <button type="button" class="small-btn" data-edit="${esc(it.id)}">Edit</button>
          <button type="button" class="small-btn" data-del="${esc(it.id)}">Remove</button>
        </span>
      </li>`).join('')}</ol>` : '<p class="muted">No lessons yet.</p>'}
    <p><button type="button" class="primary" data-add>+ Add ${step.kind === 'agree' ? 'document' : 'module'}</button></p>`;

  el.querySelector('[data-add]').addEventListener('click', () => itemDialog(step, null, items));
  for (const b of el.querySelectorAll('[data-edit]')) b.addEventListener('click', () => itemDialog(step, items.find((i) => i.id === b.dataset.edit), items));
  for (const b of el.querySelectorAll('[data-del]')) {
    b.addEventListener('click', async () => {
      const it = items.find((i) => i.id === b.dataset.del);
      if (!confirm(`Remove "${it.title}"? Trainees' ticks for it are removed too.`)) return;
      try { await removeItem(it.id); await reloadContent(); } catch (e) { alert(e.message); }
    });
  }
  const move = async (id, dir) => {
    const i = items.findIndex((x) => x.id === id);
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    // Renumber the whole list so the order is always clean.
    const order = items.map((x) => x.id);
    [order[i], order[j]] = [order[j], order[i]];
    try {
      await Promise.all(order.map((oid, n) => saveItem({ id: oid, sort_order: (n + 1) * 10 })));
      await reloadContent();
    } catch (e) { alert(e.message); }
  };
  for (const b of el.querySelectorAll('[data-up]')) b.addEventListener('click', () => move(b.dataset.up, -1));
  for (const b of el.querySelectorAll('[data-down]')) b.addEventListener('click', () => move(b.dataset.down, 1));
}

function itemDialog(step, it, items) {
  const dlg = host.querySelector('#tc-dlg');
  dlg.innerHTML = `
    <form method="dialog" class="person-form">
      <h2>${it ? 'Edit' : 'Add'} ${step.kind === 'agree' ? 'document' : 'module'}</h2>
      <label>Title <input name="title" required value="${esc(it?.title ?? '')}"></label>
      <label>Type
        <select name="kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}"${(it?.kind ?? (step.kind === 'agree' ? 'document' : 'canva')) === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label data-for="url">Link (Canva, Google Drive, YouTube…). Leave empty if it's not ready yet.
        <input name="url" type="url" placeholder="https://…" value="${esc(it?.url ?? '')}"></label>
      <label data-for="body">Document text
        <textarea name="body" rows="12" placeholder="Paste the text here.">${esc(it?.body ?? '')}</textarea>
        <span class="muted small">Start a line with <code>## </code> for a heading and <code>• </code> for a bullet point.</span></label>
      <label>Note for trainees (optional) <input name="note" value="${esc(it?.note ?? '')}" placeholder="e.g. about 30 minutes"></label>
      <p class="muted small">Make sure the link is shared so anyone with the link can view it.</p>
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions"><span class="spacer"></span>
        <button type="button" data-act="cancel">Cancel</button>
        <button type="submit" class="primary">Save</button></div>
    </form>`;
  const form = dlg.querySelector('form');
  const showFields = () => {
    const doc = form.kind.value === 'document';
    form.querySelector('[data-for="url"]').hidden = doc;
    form.querySelector('[data-for="body"]').hidden = !doc;
  };
  form.kind.addEventListener('change', showFields);
  showFields();
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const isDoc = form.kind.value === 'document';
    const url = isDoc ? '' : form.url.value.trim();
    const msg = form.querySelector('.msg');
    if (url && !/^https?:\/\//i.test(url)) { msg.hidden = false; msg.textContent = 'The link must start with https://'; return; }
    if (url && form.kind.value === 'canva' && !EMBEDDABLE.test(url)
        && !confirm('This Canva link can\'t be shown inside the Portal, so trainees would open it in a new tab (where it can be copied).\n\nBest: use the full link starting with https://www.canva.com/design/\n\nSave this link anyway?')) return;
    try {
      await saveItem({
        id: it?.id,
        step_id: step.id,
        title: form.title.value.trim(),
        url: url || null,
        body: isDoc ? (form.body.value.trim() || null) : null,
        kind: form.kind.value,
        note: form.note.value.trim() || null,
        ...(it ? {} : { sort_order: ((items.at(-1)?.sort_order) ?? 0) + 10 }),
      });
      dlg.close();
      await reloadContent();
    } catch (e) { msg.hidden = false; msg.textContent = e.message; }
  });
  dlg.showModal();
  form.title.focus();
}

// ---------------------------------------------------------------------------
// Exam: settings + questions
// ---------------------------------------------------------------------------
async function drawExam(step, el) {
  let qs;
  try { qs = await questionsAdmin(step.id); } catch (e) { el.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const total = qs.reduce((t, q) => t + Number(q.points), 0);
  const cfg = step.config || {};
  const pass = cfg.pass_mark ?? '';
  const pct = total && pass !== '' ? Math.round((Number(pass) / total) * 100) : null;

  el.innerHTML = `
    <form class="exam-settings grid2">
      <label>Time limit (minutes) <input name="time" type="number" min="5" max="600" required value="${esc(cfg.time_limit_min ?? 120)}"></label>
      <label>Pass mark (marks) <input name="pass" type="number" min="1" step="0.5" required value="${esc(pass)}"></label>
      <label>Attempts allowed <input name="max" type="number" min="1" max="10" required value="${esc(cfg.max_attempts ?? 1)}"></label>
      <label>Days between attempts <input name="wait" type="number" min="0" max="365" required value="${esc(cfg.retake_wait_days ?? 0)}"></label>
      <label class="check"><input type="checkbox" name="reqmod"${cfg.require_modules ? ' checked' : ''}> <span>All modules must be ticked before the exam</span></label>
      <p class="muted small">${qs.length} questions · ${total} marks${pct !== null ? ` · pass mark = ${pct}%` : ''}</p>
      <p><button type="submit" class="small-btn primary">Save settings</button> <span class="small" data-saved></span></p>
    </form>
    <div class="q-tools">
      <button type="button" class="primary" data-addq>+ Add question</button>
      <button type="button" data-import>Import from file…</button>
    </div>
    ${qs.length ? `<ol class="q-list">${qs.map((q) => `
      <li>
        <div class="grow">
          <p class="q-prompt">${esc(q.prompt)}</p>
          <p class="muted small">${q.tag ? `<span class="chip stage">${esc(q.tag)}</span> ` : ''}${q.type === 'mcq' ? 'One answer' : 'Select all that apply'} · ${Number(q.points)} mark${Number(q.points) === 1 ? '' : 's'}</p>
          <ul class="q-opts-view">${q.options.map((o, i) => `<li class="${isRight(q, i) ? 'right' : ''}">${isRight(q, i) ? '✓ ' : ''}${esc(o)}</li>`).join('')}</ul>
        </div>
        <span class="row-actions">
          <button type="button" class="small-btn" data-editq="${esc(q.id)}">Edit</button>
          <button type="button" class="small-btn" data-delq="${esc(q.id)}">Remove</button>
        </span>
      </li>`).join('')}</ol>` : '<p class="muted">No questions yet. Add them one by one, or import the old <code>questions.json</code>.</p>'}`;

  const settings = el.querySelector('.exam-settings');
  settings.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await saveStepConfig(step.id, {
        ...cfg,
        time_limit_min: Number(settings.time.value),
        pass_mark: Number(settings.pass.value),
        max_attempts: Number(settings.max.value),
        retake_wait_days: Number(settings.wait.value),
        require_modules: settings.reqmod.checked,
      });
      await reloadContent();
    } catch (e) { alert(e.message); }
  });
  el.querySelector('[data-addq]').addEventListener('click', () => questionDialog(step, null));
  el.querySelector('[data-import]').addEventListener('click', () => importDialog(step, qs.length));
  for (const b of el.querySelectorAll('[data-editq]')) b.addEventListener('click', () => questionDialog(step, qs.find((q) => q.id === b.dataset.editq)));
  for (const b of el.querySelectorAll('[data-delq]')) {
    b.addEventListener('click', async () => {
      if (!confirm('Remove this question? (If someone has already sat it, it is kept hidden so their result still adds up.)')) return;
      try { await questionRemove(b.dataset.delq); await reloadContent(); } catch (e) { alert(e.message); }
    });
  }
}

const isRight = (q, i) => (Array.isArray(q.answer) ? q.answer.includes(i) : q.answer === i);

function questionDialog(step, q) {
  const dlg = host.querySelector('#tc-dlg');
  let type = q?.type ?? 'mcq';
  let options = q ? [...q.options] : ['', '', '', ''];
  let right = new Set(q ? (Array.isArray(q.answer) ? q.answer : [q.answer]) : []);

  const draw = () => {
    dlg.innerHTML = `
      <form method="dialog" class="person-form">
        <h2>${q ? 'Edit question' : 'Add question'}</h2>
        <label>Type
          <select name="type">
            <option value="mcq"${type === 'mcq' ? ' selected' : ''}>One correct answer</option>
            <option value="multiselect"${type === 'multiselect' ? ' selected' : ''}>Select all that apply</option>
          </select></label>
        <label>Question <textarea name="prompt" rows="3" required>${esc(q?.prompt ?? dlg.dataset.prompt ?? '')}</textarea></label>
        <fieldset><legend>Options <span class="muted small">(tick the correct ${type === 'mcq' ? 'one' : 'ones'})</span></legend>
          ${options.map((o, i) => `
            <div class="opt-row">
              <input type="${type === 'mcq' ? 'radio' : 'checkbox'}" name="right" value="${i}"${right.has(i) ? ' checked' : ''} aria-label="Correct">
              <input name="opt" value="${esc(o)}" placeholder="Option ${i + 1}">
              <button type="button" class="small-btn" data-rm="${i}"${options.length <= 2 ? ' disabled' : ''} aria-label="Remove option">✕</button>
            </div>`).join('')}
          <button type="button" class="small-btn" data-addopt>+ Add option</button>
        </fieldset>
        <div class="grid2">
          <label>Marks <input name="points" type="number" min="0.5" step="0.5" value="${esc(q?.points ?? 1)}"></label>
          <label>Domain / competency (optional) <input name="tag" value="${esc(q?.tag ?? '')}" placeholder="e.g. C2"></label>
        </div>
        <p class="msg" role="status" hidden></p>
        <div class="dlg-actions"><span class="spacer"></span>
          <button type="button" data-act="cancel">Cancel</button>
          <button type="submit" class="primary">Save</button></div>
      </form>`;
    const form = dlg.querySelector('form');
    const keep = () => {
      dlg.dataset.prompt = form.prompt.value;
      options = [...form.querySelectorAll('input[name="opt"]')].map((x) => x.value);
      right = new Set([...form.querySelectorAll('input[name="right"]:checked')].map((x) => Number(x.value)));
    };
    form.type.addEventListener('change', () => { keep(); type = form.type.value; if (type === 'mcq' && right.size > 1) right = new Set([...right].slice(0, 1)); draw(); });
    form.querySelector('[data-addopt]').addEventListener('click', () => { keep(); options.push(''); draw(); });
    for (const b of form.querySelectorAll('[data-rm]')) {
      b.addEventListener('click', () => {
        keep();
        const i = Number(b.dataset.rm);
        options.splice(i, 1);
        right = new Set([...right].filter((r) => r !== i).map((r) => (r > i ? r - 1 : r)));
        draw();
      });
    }
    form.querySelector('[data-act="cancel"]').addEventListener('click', () => { delete dlg.dataset.prompt; dlg.close(); });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      keep();
      const msg = form.querySelector('.msg');
      const opts = options.map((o) => o.trim());
      if (opts.some((o) => !o)) { msg.hidden = false; msg.textContent = 'Fill in every option, or remove the empty ones.'; return; }
      if (!right.size) { msg.hidden = false; msg.textContent = 'Tick the correct answer.'; return; }
      const ans = [...right].sort((a, b) => a - b);
      try {
        await questionSave(step.id, {
          ...(q ? { id: q.id } : {}),
          type,
          prompt: form.prompt.value.trim(),
          options: opts,
          answer: type === 'mcq' ? ans[0] : ans,
          points: Number(form.points.value) || 1,
          tag: form.tag.value.trim() || null,
        });
        delete dlg.dataset.prompt;
        dlg.close();
        await reloadContent();
      } catch (e) { msg.hidden = false; msg.textContent = e.message; }
    });
  };
  delete dlg.dataset.prompt;
  draw();
  dlg.showModal();
}

function importDialog(step, existing) {
  const dlg = host.querySelector('#tc-dlg');
  dlg.innerHTML = `
    <form method="dialog" class="person-form">
      <h2>Import questions</h2>
      <p>Choose a <code>questions.json</code> file in the old Training portal format. One-answer and select-all questions are imported; other types are skipped. The time limit and pass mark in the file are used too.</p>
      <label>File <input name="file" type="file" accept=".json,application/json"></label>
      ${existing ? `<label class="check"><input type="checkbox" name="replace"> <span>Replace the ${existing} questions already here</span></label>` : ''}
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions"><span class="spacer"></span>
        <button type="button" data-act="cancel">Cancel</button>
        <button type="submit" class="primary">Import</button></div>
    </form>`;
  const form = dlg.querySelector('form');
  const msg = form.querySelector('.msg');
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const file = form.file.files[0];
    if (!file) { msg.hidden = false; msg.textContent = 'Choose a file first.'; return; }
    let data;
    try { data = JSON.parse(await file.text()); } catch { msg.hidden = false; msg.textContent = "This file isn't valid JSON."; return; }
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const res = await questionsImport(step.id, data, !!form.replace?.checked);
      dlg.close();
      alert(`Imported ${res.added} question${res.added === 1 ? '' : 's'}${res.skipped ? `, skipped ${res.skipped} (other types)` : ''}.`);
      await reloadContent();
    } catch (e) {
      msg.hidden = false; msg.textContent = e.message; btn.disabled = false;
    }
  });
  dlg.showModal();
}

// ---------------------------------------------------------------------------
// In-person training: hours target, chapters and their assignments
// ---------------------------------------------------------------------------
function drawSession(step, el) {
  const cfg = step.config || {};
  const topics = cfg.topics || [];
  const on = new Set(Array.isArray(cfg.assignment_chapters) ? cfg.assignment_chapters : topics.map((_, i) => i + 1));
  const notes = cfg.assignment_notes || {};
  el.innerHTML = `
    <form class="person-form session-settings">
      <label>Target hours <input name="target" type="number" min="1" max="500" value="${esc(cfg.target_hours ?? '')}"></label>
      <p class="muted small">Tick the chapters that have an assignment. Trainees upload it in the Portal; it's due 7 days after the session that covers the chapter. Instructions are optional and shown to the trainee.</p>
      <ol class="asg-admin">${topics.map((t, i) => `
        <li>
          <span class="ch-num">${i + 1}</span>
          <div class="asg-admin-main">
            <input name="t${i + 1}" value="${esc(t)}" aria-label="Chapter ${i + 1} title" maxlength="120">
            <label class="check small"><input type="checkbox" name="a${i + 1}"${on.has(i + 1) ? ' checked' : ''}> <span>Has an assignment</span></label>
            <textarea name="n${i + 1}" rows="2" maxlength="600" placeholder="Instructions (optional), e.g. Write one page on…"${on.has(i + 1) ? '' : ' hidden'}>${esc(notes[i + 1] || '')}</textarea>
          </div>
        </li>`).join('')}</ol>
      ${topics.length ? '' : '<p class="muted">No chapters yet.</p>'}
      <p><button type="submit" class="small-btn primary">Save chapters & assignments</button> <span class="msg small" role="status" hidden></span></p>
    </form>`;
  const f = el.querySelector('form');
  for (const box of f.querySelectorAll('input[type="checkbox"][name^="a"]')) {
    box.addEventListener('change', () => { f[`n${box.name.slice(1)}`].hidden = !box.checked; });
  }
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = f.querySelector('.msg');
    const newTopics = topics.map((t, i) => f[`t${i + 1}`].value.trim() || t);
    const chapters = topics.map((_, i) => i + 1).filter((n) => f[`a${n}`].checked);
    const newNotes = {};
    for (const n of chapters) { const v = f[`n${n}`].value.trim(); if (v) newNotes[n] = v; }
    try {
      await saveStepConfig(step.id, {
        ...cfg, topics: newTopics, target_hours: f.target.value ? Number(f.target.value) : cfg.target_hours,
        assignment_chapters: chapters, assignment_notes: newNotes,
      });
      msg.hidden = false; msg.className = 'msg small ok-text'; msg.textContent = 'Saved.';
      await reloadContent();
    } catch (e) { msg.hidden = false; msg.className = 'msg small error'; msg.textContent = e.message; }
  });
}
