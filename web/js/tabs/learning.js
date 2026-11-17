// Learning Hub: study topics and links, the study log (reflections), and
// "grow your tree" — leaves from studying become skill points, the tree grows.
// Supervisors / QCD / admin also get a Team view (review reflections, give
// leaves, see skill wheels) and a Links view (edit resource links).
// Leaves and points are worked out by the database; the page only shows them.
import * as L from '../learning-data.js';
import {
  SKILLS, skillLabel, STAGES, GUARDIAN, LEAVES_PER_POINT, BGS, LOOKS, ANIMALS,
  stageOf, progress, sceneSvg, wheelSvg, artImg,
} from '../tree.js';
import { esc, fmtDate, todayLocal } from '../ui.js';
import { icon } from '../icons.js';

const KINDS = [
  { key: 'video', label: 'Video / webinar', icon: 'player-play' },
  { key: 'book', label: 'Book / reading', icon: 'book' },
  { key: 'podcast', label: 'Podcast', icon: 'bell' },
  { key: 'bacb', label: 'BACB / article', icon: 'file-text' },
  { key: 'quiz', label: 'Self-quiz / flashcards', icon: 'bulb' },
];
const kindOf = (k) => KINDS.find((x) => x.key === k) || KINDS[0];
const MINUTES = [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1½ hours'], [120, '2 hours']];
const FEEL = ['Still finding my footing', 'A little unsure', 'Getting there', 'Fairly confident', 'Feeling solid'];
const BOXES = [
  ['resources', 'Resources I used', 'Which video, article, podcast…'],
  ['studied', 'What did I study?', 'In my own words…'],
  ['clicked', 'One thing that clicked', ''],
  ['question', 'One question still on my mind', ''],
  ['try_next', 'One thing I’d like to try next', 'With my clients, at school…'],
];

let ctx;
let panelEl;
let view = 'me';
let topics = [];
let resources = [];
let me = null;        // summary
let refl = [];
let done = [];
let leaves = [];
let teamList = [];

const isTeam = () => ctx.roles.some((r) => ['admin', 'supervisor', 'qcd'].includes(r));
const safeUrl = (u) => (/^https:\/\//i.test(u ?? '') ? u : null);
const topicOf = (code) => topics.find((t) => t.code === code);
const boxOk = (s) => { const t = String(s ?? '').trim(); return t.length >= 15 && new Set(t.toLowerCase()).size >= 5; };
const nameOf = (id) => { const p = teamList.find((x) => x.id === id); return p ? (p.nickname || p.full_name) : 'Someone'; };
const dlg = () => panelEl.querySelector('#lh-dlg');
const openDlg = (html) => { const d = dlg(); d.innerHTML = html; if (!d.open) d.showModal(); return d; };
const closeDlg = () => { const d = dlg(); if (d.open) d.close(); };

export async function render(panel, context) {
  ctx = context;
  panelEl = panel;
  panel.innerHTML = `
    <section class="lh">
      <div class="page-head">
        <h1>Learning Hub</h1>
        ${isTeam() ? `<div class="seg" role="tablist" aria-label="Learning Hub views">
          <button type="button" role="tab" data-view="me">My learning</button>
          <button type="button" role="tab" data-view="team">Team</button>
          <button type="button" role="tab" data-view="links">Links</button>
        </div>` : ''}
      </div>
      <div id="lh-body" aria-live="polite"><p class="muted">Loading…</p></div>
      <p class="credit">Tree, plant and animal art: Vecteezy.com</p>
      <dialog id="lh-dlg" class="dlg"></dialog>
    </section>`;
  for (const b of panel.querySelectorAll('[data-view]')) b.addEventListener('click', () => { view = b.dataset.view; draw(); });
  try {
    [topics, resources] = await Promise.all([L.loadTopics(), L.loadResources()]);
  } catch (e) {
    panel.querySelector('#lh-body').innerHTML = `<p class="error">Could not load the Learning Hub: ${esc(e.message)}</p>`;
    return;
  }
  await draw();
}

async function draw() {
  for (const b of panelEl.querySelectorAll('[data-view]')) b.setAttribute('aria-selected', String(b.dataset.view === view));
  const body = panelEl.querySelector('#lh-body');
  try {
    if (view === 'team' && isTeam()) return await drawTeam(body);
    if (view === 'links' && isTeam()) return drawLinks(body);
    return await drawMe(body);
  } catch (e) {
    body.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// My learning
// ---------------------------------------------------------------------------
async function drawMe(body) {
  [me, refl, done, leaves] = await Promise.all([L.summary(), L.myReflections(ctx.me.id), L.myDone(ctx.me.id), L.myLeaves(ctx.me.id)]);
  if (!me.started) return drawStart(body);
  const pr = progress(me.points);
  const st = STAGES[pr.stage];
  const canInvest = me.balance >= LEAVES_PER_POINT;
  body.innerHTML = `
    <div class="lh-hero">
      <section class="card lh-tree">
        ${sceneSvg({ points: me.points, bg: me.bg, looks: me.looks, animal: me.animal }, { label: `Your tree: ${st.name}` })}
        <div class="lh-stage">
          <div><h2>${esc(st.name)}</h2><p class="muted small">${me.points} skill points</p></div>
          <button type="button" class="small-btn" data-act="look">${icon('plant-2')} Change look</button>
        </div>
        ${pr.next ? `<div class="bar" role="progressbar" aria-valuenow="${pr.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress to ${esc(STAGES[pr.stage + 1].name)}"><span style="width:${pr.pct}%"></span></div>
          <p class="small muted">${pr.next - me.points} more point${pr.next - me.points === 1 ? '' : 's'} to <strong>${esc(STAGES[pr.stage + 1].name)}</strong></p>`
          : '<p class="small">You are a <strong>Forest Guardian</strong>. ✨</p>'}
      </section>
      <section class="card lh-side">
        <div class="lh-leaves">
          <span class="lh-leaf-ico">${icon('leaf')}</span>
          <div><p class="lh-big">${me.balance}</p><p class="muted small">leaves to use · ${LEAVES_PER_POINT} leaves = 1 skill point</p></div>
        </div>
        <button type="button" class="${canInvest ? 'primary' : ''}" data-act="invest">${icon('sparkles')} ${canInvest ? 'Use 10 leaves on a skill' : `${LEAVES_PER_POINT - (me.balance % LEAVES_PER_POINT)} more leaves for a skill point`}</button>
        <h3 class="lh-h3">My skill wheel</h3>
        ${wheelSvg(me.skills)}
        <p class="muted small">Only you and your supervisors can see your wheel. Everyone sees your tree.</p>
      </section>
    </div>

    <section class="card">
      <div class="page-head"><h2>Study log</h2>
        <button type="button" class="primary" data-act="log">${icon('book')} Log a study session</button></div>
      <p class="muted small">Each reflection box you write properly earns a leaf (up to 5). A supervisor’s review adds 5 more.
        Leaves count for your first 2 logs each day${me.logs_today >= 2 ? ' — <strong>you’ve used both today</strong>' : ` (${me.logs_today} of 2 used today)`}.</p>
      ${reflList(refl)}
    </section>

    <section class="card">
      <h2>Topics</h2>
      <p class="muted small">Open a resource, then tap <strong>Done</strong> and write one line about it to earn a leaf (up to 3 a day).</p>
      ${topicsHtml()}
    </section>

    ${leaves.length ? `<section class="card"><h2>Recent leaves</h2><ul class="lh-ledger">${leaves.slice(0, 10).map((x) => `
      <li><span class="lh-plus">+${x.amount} ${icon('leaf')}</span> ${esc(x.reason || x.source)} <span class="muted small">${fmtDate(x.created_at)}</span></li>`).join('')}</ul></section>` : ''}`;

  body.querySelector('[data-act="look"]').addEventListener('click', lookDialog);
  body.querySelector('[data-act="invest"]').addEventListener('click', () => (canInvest ? investDialog() : null));
  body.querySelector('[data-act="log"]').addEventListener('click', logDialog);
  wireTopics(body);
  wireRefl(body);
}

function drawStart(body) {
  const pts = Object.fromEntries(SKILLS.map((s) => [s.key, 0]));
  body.innerHTML = `
    <section class="card lh-start">
      <div class="lh-start-art">${sceneSvg({ points: 10, bg: 0, looks: [0, 0, 0, 0, 0, 0] }, { label: 'A seedling' })}</div>
      <div>
        <h2>Plant your seed 🌱</h2>
        <p>You already have skills from your training. Place <strong>10 skill points</strong> across the 7 skills to show where you feel strongest today.
          It’s a self-check, not a test: be honest, it helps you see where to grow.</p>
        <p class="muted small">After this, studying earns <strong>leaves</strong>. Every 10 leaves is 1 new skill point, and your tree grows:
          ${STAGES.map((s) => `${esc(s.name)} ${s.at}`).join(' · ')}.</p>
        <div class="lh-alloc">${SKILLS.map((s) => `
          <div class="lh-alloc-row"><span>${esc(s.label)}</span>
            <button type="button" class="small-btn" data-dec="${s.key}" aria-label="Less ${esc(s.label)}">−</button>
            <b data-val="${s.key}">0</b>
            <button type="button" class="small-btn" data-inc="${s.key}" aria-label="More ${esc(s.label)}">+</button></div>`).join('')}
        </div>
        <p class="small"><span id="lh-left">10</span> points left · up to 4 in one skill</p>
        <p id="lh-start-msg" class="error" hidden></p>
        <button type="button" class="primary" data-act="plant" disabled>${icon('plant-2')} Plant my tree</button>
      </div>
    </section>
    <section class="card"><h2>Topics</h2>${topicsHtml()}</section>`;
  const used = () => Object.values(pts).reduce((a, b) => a + b, 0);
  const sync = () => {
    for (const s of SKILLS) body.querySelector(`[data-val="${s.key}"]`).textContent = pts[s.key];
    body.querySelector('#lh-left').textContent = 10 - used();
    body.querySelector('[data-act="plant"]').disabled = used() !== 10;
  };
  body.addEventListener('click', async (e) => {
    const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]');
    if (inc && used() < 10 && pts[inc.dataset.inc] < 4) { pts[inc.dataset.inc]++; sync(); }
    if (dec && pts[dec.dataset.dec] > 0) { pts[dec.dataset.dec]--; sync(); }
    if (e.target.closest('[data-act="plant"]')) {
      const b = e.target.closest('button'); b.disabled = true;
      try { await L.start(pts); await draw(); } catch (err) {
        const m = body.querySelector('#lh-start-msg'); m.textContent = err.message; m.hidden = false; b.disabled = false;
      }
    }
  });
  wireTopics(body);
}

function reflList(list, { team = false } = {}) {
  if (!list.length) return `<p class="muted">${team ? 'Nothing waiting. 🎉' : 'No study sessions yet. Log your first one!'}</p>`;
  return `<ul class="lh-refl">${list.map((r) => {
    const t = topicOf(r.topic_code);
    return `<li>
      <details>
        <summary>
          <span class="lh-refl-main">${team ? `<strong>${esc(nameOf(r.therapist_id))}</strong> · ` : ''}${t ? `<span class="chip">${esc(t.code)}</span> ${esc(t.title)}` : 'General study'}</span>
          <span class="muted small">${fmtDate(r.studied_on)} · ${r.minutes} min</span>
          ${r.leaves ? `<span class="lh-plus">+${r.leaves} ${icon('leaf')}</span>` : ''}
          <span class="chip ${r.status === 'reviewed' ? 'ok' : ''}">${r.status === 'reviewed' ? 'Reviewed' : 'Waiting for review'}</span>
        </summary>
        <dl class="lh-dl">
          ${BOXES.map(([k, label]) => (r[k] ? `<dt>${esc(label)}</dt><dd>${esc(r[k])}</dd>` : '')).join('')}
          ${r.feeling ? `<dt>How I feel about it</dt><dd>${r.feeling} / 5 · ${esc(FEEL[r.feeling - 1])}</dd>` : ''}
          ${r.review_note ? `<dt>Supervisor’s note</dt><dd class="lh-note">${esc(r.review_note)}</dd>` : ''}
        </dl>
        ${team ? `<button type="button" class="primary small-btn" data-review="${r.id}">${icon('check')} Review (+5 leaves)</button>` : ''}
      </details>
    </li>`;
  }).join('')}</ul>`;
}
function wireRefl() { /* details/summary needs no wiring */ }

function topicsHtml() {
  return SKILLS.map((s) => {
    const list = topics.filter((t) => t.skill === s.key && t.active);
    if (!list.length) return '';
    return `<div class="lh-skill"><h3 class="lh-h3">${esc(s.label)}</h3>${list.map((t) => {
      const rs = resources.filter((r) => r.topic_code === t.code);
      const n = rs.filter((r) => done.some((d) => d.resource_id === r.id)).length;
      return `<details class="lh-topic">
        <summary><span class="chip">${esc(t.code)}</span> ${esc(t.title)}
          <span class="muted small">${rs.length ? `${n}/${rs.length} done` : 'No links yet'}</span></summary>
        ${rs.length ? `<ul class="lh-res">${rs.map((r) => {
          const d = done.find((x) => x.resource_id === r.id);
          const url = safeUrl(r.url);
          return `<li>
            <span class="lh-kind" title="${esc(kindOf(r.kind).label)}">${icon(kindOf(r.kind).icon)}</span>
            ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)} ${icon('external-link')}</a>` : esc(r.title)}
            ${d ? `<span class="chip ok" title="${esc(d.note || '')}">${icon('check')} Done</span>`
              : `<button type="button" class="small-btn" data-done="${r.id}">Done</button>`}
          </li>`;
        }).join('')}</ul>` : '<p class="muted small">Your supervisors will add links here.</p>'}
      </details>`;
    }).join('')}</div>`;
  }).join('');
}

function wireTopics(body) {
  for (const b of body.querySelectorAll('[data-done]')) b.addEventListener('click', () => doneDialog(b.dataset.done));
}

function doneDialog(resId) {
  const r = resources.find((x) => x.id === resId);
  const d = openDlg(`<form class="lh-form" method="dialog">
    <h2>Finished: ${esc(r.title)}</h2>
    <label>One line: what did you learn?
      <textarea name="note" rows="3" maxlength="500" required placeholder="The main idea for me was…"></textarea></label>
    <p class="muted small" data-hint></p>
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="submit" class="primary">${icon('check')} Mark done</button><button type="button" data-cancel>Cancel</button></div>
  </form>`);
  const f = d.querySelector('form');
  const hint = () => { d.querySelector('[data-hint]').textContent = boxOk(f.note.value) ? 'This earns a leaf 🍃' : 'Write at least 15 characters to earn a leaf.'; };
  f.note.addEventListener('input', hint); hint();
  d.querySelector('[data-cancel]').addEventListener('click', closeDlg);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const got = await L.markDone(resId, f.note.value);
      closeDlg();
      await draw();
      toast(got ? '+1 leaf 🍃' : 'Done! (You’ve had today’s 3 leaves for resources.)');
    } catch (err) { const m = d.querySelector('[data-msg]'); m.textContent = err.message; m.hidden = false; }
  });
}

function logDialog() {
  const opts = SKILLS.map((s) => `<optgroup label="${esc(s.label)}">${topics.filter((t) => t.skill === s.key && t.active)
    .map((t) => `<option value="${esc(t.code)}">${esc(t.code)} · ${esc(t.title)}</option>`).join('')}</optgroup>`).join('');
  const d = openDlg(`<form class="lh-form" method="dialog">
    <h2>Log a study session</h2>
    <div class="lh-2col">
      <label>Date studied<input type="date" name="studied_on" value="${todayLocal()}" max="${todayLocal()}" required></label>
      <label>How long<select name="minutes">${MINUTES.map(([v, l]) => `<option value="${v}" ${v === 30 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <label>Topic<select name="topic"><option value="">General / other</option>${opts}</select></label>
    ${BOXES.map(([k, label, ph]) => `<label>${esc(label)}${k === 'studied' ? ' <span class="muted small">(needed)</span>' : ''}
      <textarea name="${k}" rows="${k === 'studied' ? 3 : 2}" maxlength="2000" ${k === 'studied' ? 'required' : ''} placeholder="${esc(ph)}"></textarea></label>`).join('')}
    <fieldset class="lh-feel"><legend>How do you feel about this topic now?</legend>
      ${FEEL.map((t, i) => `<label class="check"><input type="radio" name="feeling" value="${i + 1}"> ${i + 1} · ${esc(t)}</label>`).join('')}
    </fieldset>
    <p class="lh-earn" data-earn></p>
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="submit" class="primary">${icon('leaf')} Save my log</button><button type="button" data-cancel>Cancel</button></div>
  </form>`);
  const f = d.querySelector('form');
  const earn = () => {
    const n = BOXES.filter(([k]) => boxOk(f[k].value)).length;
    d.querySelector('[data-earn]').innerHTML = me.logs_today >= 2
      ? 'You’ve already had leaves for 2 logs today. You can still save this one.'
      : `This log earns <strong>${n} ${n === 1 ? 'leaf' : 'leaves'}</strong> 🍃 (1 for each box with at least 15 characters).`;
  };
  f.addEventListener('input', earn); earn();
  d.querySelector('[data-cancel]').addEventListener('click', closeDlg);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(f));
      const res = await L.logStudy(data);
      closeDlg();
      await draw();
      toast(res.leaves ? `Saved · +${res.leaves} leaves 🍃` : 'Saved');
    } catch (err) { const m = d.querySelector('[data-msg]'); m.textContent = err.message; m.hidden = false; btn.disabled = false; }
  });
}

function investDialog() {
  const d = openDlg(`<div class="lh-form">
    <h2>Use 10 leaves</h2>
    <p>Which skill do you want to grow? You have <strong>${me.balance}</strong> leaves.</p>
    <div class="lh-invest">${SKILLS.map((s) => `<button type="button" data-skill="${s.key}"><span>${esc(s.label)}</span><b>${me.skills?.[s.key] ?? 0} → ${(me.skills?.[s.key] ?? 0) + 1}</b></button>`).join('')}</div>
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="button" data-cancel>Cancel</button></div>
  </div>`);
  d.querySelector('[data-cancel]').addEventListener('click', closeDlg);
  for (const b of d.querySelectorAll('[data-skill]')) b.addEventListener('click', async () => {
    const before = stageOf(me.points);
    try {
      await L.invest(b.dataset.skill);
      closeDlg();
      await draw();
      const after = stageOf(me.points);
      toast(after > before ? `Your tree grew into a ${STAGES[after].name}! 🌳` : `+1 ${skillLabel(b.dataset.skill)}`);
      if (after > before) celebrate(after);
    } catch (err) { const m = d.querySelector('[data-msg]'); m.textContent = err.message; m.hidden = false; }
  });
}

function lookDialog() {
  const stage = stageOf(me.points);
  const pick = { bg: me.bg ?? 0, looks: [...(me.looks || [0, 0, 0, 0, 0, 0])], animal: me.animal ?? null };
  const opt = (sel, attr, val, inner, label) =>
    `<button type="button" class="lh-opt" ${attr}="${val}" aria-pressed="${sel}" title="${esc(label)}">${inner}<span>${esc(label)}</span></button>`;
  const paint = (d) => {
    d.querySelector('[data-preview]').innerHTML = sceneSvg({ points: me.points, ...pick });
    d.querySelector('[data-looks]').innerHTML = LOOKS[stage].map((l, i) => opt(pick.looks[stage] === i, 'data-look', i, artImg(l.file), l.name)).join('');
    d.querySelector('[data-bgs]').innerHTML = BGS.map((b, i) => opt(pick.bg === i, 'data-bg', i, artImg(b.file), b.name)).join('');
    d.querySelector('[data-animals]').innerHTML = stage === GUARDIAN
      ? opt(pick.animal == null, 'data-animal', '', '<span class="lh-none">—</span>', 'No animal') + ANIMALS.map((a, i) => opt(pick.animal === i, 'data-animal', i, artImg(a.file), a.name)).join('')
      : `<p class="muted small">${icon('lock')} Animals unlock at Forest Guardian (100 skill points). Then one can join your tree.</p>`;
  };
  const d = openDlg(`<div class="lh-form lh-look">
    <h2>Your tree</h2>
    <div class="lh-preview" data-preview></div>
    <h3 class="lh-h3">${esc(STAGES[stage].name)} look</h3><div class="lh-opts" data-looks></div>
    <h3 class="lh-h3">Background</h3><div class="lh-opts" data-bgs></div>
    <h3 class="lh-h3">Animal friend</h3><div class="lh-opts" data-animals></div>
    <p class="muted small">New looks unlock as your tree grows.</p>
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="button" class="primary" data-save>${icon('check')} Save</button><button type="button" data-cancel>Cancel</button></div>
  </div>`);
  paint(d);
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.look != null) { pick.looks[stage] = Number(b.dataset.look); paint(d); }
    else if (b.dataset.bg != null) { pick.bg = Number(b.dataset.bg); paint(d); }
    else if (b.dataset.animal != null) { pick.animal = b.dataset.animal === '' ? null : Number(b.dataset.animal); paint(d); }
    else if (b.hasAttribute('data-cancel')) closeDlg();
    else if (b.hasAttribute('data-save')) {
      try { await L.setLook(pick.bg, pick.looks, pick.animal); closeDlg(); await draw(); toast('Tree updated 🌳'); } catch (err) {
        const m = d.querySelector('[data-msg]'); m.textContent = err.message; m.hidden = false;
      }
    }
  });
}

function celebrate(stage) {
  openDlg(`<div class="lh-form lh-celebrate">
    <h2>Level up! 🎉</h2>
    <div class="lh-preview">${sceneSvg({ points: me.points, bg: me.bg, looks: me.looks, animal: me.animal })}</div>
    <p>Your tree is now a <strong>${esc(STAGES[stage].name)}</strong>.${stage === GUARDIAN ? ' Choose an animal friend to join it!' : ' New looks are unlocked.'}</p>
    <div class="dlg-actions"><button type="button" class="primary" data-look>${icon('plant-2')} Choose a look</button><button type="button" data-cancel>Later</button></div>
  </div>`);
  const d = dlg();
  d.querySelector('[data-cancel]').addEventListener('click', closeDlg);
  d.querySelector('[data-look]').addEventListener('click', lookDialog);
}

function toast(text) {
  const t = document.createElement('div');
  t.className = 'lh-toast'; t.setAttribute('role', 'status'); t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

// ---------------------------------------------------------------------------
// Team (supervisor / QCD / admin)
// ---------------------------------------------------------------------------
async function drawTeam(body) {
  const [list, waiting] = await Promise.all([L.team(), L.toReview()]);
  teamList = list;
  const others = waiting.filter((r) => r.therapist_id !== ctx.me.id);
  body.innerHTML = `
    <section class="card">
      <h2>To review <span class="chip">${others.length}</span></h2>
      <p class="muted small">Read the reflection, add a note if you like, and mark it reviewed. They get 5 leaves.</p>
      ${reflList(others, { team: true })}
    </section>
    <section class="card">
      <h2>People</h2>
      <div class="table-wrap"><table class="lh-table">
        <thead><tr><th>Name</th><th>Tree</th><th>Points</th><th>Leaves</th><th>Logs</th><th>Waiting</th><th>Last study</th><th></th></tr></thead>
        <tbody>${list.map((p) => `<tr>
          <td>${esc(p.nickname || p.full_name)}</td>
          <td>${p.started ? esc(STAGES[stageOf(p.points)].name) : '<span class="muted">Not planted</span>'}</td>
          <td>${p.started ? p.points : '—'}</td><td>${p.balance}</td><td>${p.logs}</td>
          <td>${p.to_review ? `<span class="chip warn">${p.to_review}</span>` : '0'}</td>
          <td>${p.last_study ? fmtDate(p.last_study) : '—'}</td>
          <td class="row-actions">
            ${p.started ? `<button type="button" class="small-btn" data-wheel="${p.id}">Wheel</button>` : ''}
            ${p.id !== ctx.me.id ? `<button type="button" class="small-btn" data-give="${p.id}">${icon('leaf')} Give</button>` : ''}
          </td></tr>`).join('')}</tbody>
      </table></div>
    </section>`;
  for (const b of body.querySelectorAll('[data-review]')) b.addEventListener('click', () => reviewDialog(others.find((r) => r.id === b.dataset.review)));
  for (const b of body.querySelectorAll('[data-give]')) b.addEventListener('click', () => giveDialog(b.dataset.give));
  for (const b of body.querySelectorAll('[data-wheel]')) b.addEventListener('click', () => wheelDialog(b.dataset.wheel));
}

function reviewDialog(r) {
  const t = topicOf(r.topic_code);
  const d = openDlg(`<form class="lh-form" method="dialog">
    <h2>${esc(nameOf(r.therapist_id))} · ${t ? esc(t.title) : 'General study'}</h2>
    <p class="muted small">${fmtDate(r.studied_on)} · ${r.minutes} min${r.feeling ? ` · feels ${r.feeling}/5` : ''}</p>
    <dl class="lh-dl">${BOXES.map(([k, label]) => (r[k] ? `<dt>${esc(label)}</dt><dd>${esc(r[k])}</dd>` : '')).join('')}</dl>
    <label>Your note (they will see it)<textarea name="note" rows="3" maxlength="2000" placeholder="Great link to your session with ABC…"></textarea></label>
    <p class="muted small">Please use case codes only (e.g. ABC), never a child’s name.</p>
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="submit" class="primary">${icon('check')} Mark reviewed (+5 leaves)</button><button type="button" data-cancel>Cancel</button></div>
  </form>`);
  const f = d.querySelector('form');
  d.querySelector('[data-cancel]').addEventListener('click', closeDlg);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await L.review(r.id, f.note.value); closeDlg(); await draw(); toast('Reviewed · +5 leaves for them 🍃'); } catch (err) {
      const m = d.querySelector('[data-msg]'); m.textContent = err.message; m.hidden = false;
    }
  });
}

function giveDialog(who) {
  const d = openDlg(`<form class="lh-form" method="dialog">
    <h2>Give leaves to ${esc(nameOf(who))}</h2>
    <label>How many<select name="amount">${[2, 3, 5, 10, 15, 20].map((n) => `<option ${n === 5 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label>What for<input name="reason" maxlength="200" required placeholder="Role-play session, QCD training, helping a colleague…"></label>
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="submit" class="primary">${icon('leaf')} Give leaves</button><button type="button" data-cancel>Cancel</button></div>
  </form>`);
  const f = d.querySelector('form');
  d.querySelector('[data-cancel]').addEventListener('click', closeDlg);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await L.giveLeaves(who, f.amount.value, f.reason.value); closeDlg(); await draw(); toast('Leaves given 🍃'); } catch (err) {
      const m = d.querySelector('[data-msg]'); m.textContent = err.message; m.hidden = false;
    }
  });
}

async function wheelDialog(who) {
  const s = await L.summary(who);
  const d = openDlg(`<div class="lh-form">
    <h2>${esc(nameOf(who))}</h2>
    <div class="lh-wheelpair">
      <div class="lh-preview">${sceneSvg({ points: s.points, bg: s.bg, looks: s.looks, animal: s.animal })}</div>
      ${wheelSvg(s.skills)}
    </div>
    <p class="small">${esc(STAGES[stageOf(s.points)].name)} · ${s.points} skill points · ${s.balance} leaves to use</p>
    <div class="dlg-actions"><button type="button" data-cancel>Close</button></div>
  </div>`);
  d.querySelector('[data-cancel]').addEventListener('click', closeDlg);
}

// ---------------------------------------------------------------------------
// Links (supervisor / QCD / admin)
// ---------------------------------------------------------------------------
function drawLinks(body) {
  body.innerHTML = `
    <section class="card">
      <div class="page-head"><h2>Resource links</h2>
        <button type="button" class="primary" data-add>${icon('link')} Add a link</button></div>
      <p class="muted small">Everyone at CARE sees these under Topics. Use links that open without a special login where you can.</p>
      ${SKILLS.map((s) => {
        const list = topics.filter((t) => t.skill === s.key);
        return `<div class="lh-skill"><h3 class="lh-h3">${esc(s.label)}</h3>${list.map((t) => {
          const rs = resources.filter((r) => r.topic_code === t.code);
          return `<div class="lh-linktopic"><p><span class="chip">${esc(t.code)}</span> ${esc(t.title)}</p>
            ${rs.length ? `<ul class="lh-res">${rs.map((r) => `<li>
              <span class="lh-kind">${icon(kindOf(r.kind).icon)}</span>
              <a href="${esc(safeUrl(r.url) || '#')}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>
              <span class="row-actions"><button type="button" class="small-btn" data-edit="${r.id}">Edit</button>
              <button type="button" class="small-btn" data-del="${r.id}">Remove</button></span></li>`).join('')}</ul>` : '<p class="muted small">No links yet.</p>'}
          </div>`;
        }).join('')}</div>`;
      }).join('')}
    </section>`;
  body.querySelector('[data-add]').addEventListener('click', () => linkDialog(null));
  for (const b of body.querySelectorAll('[data-edit]')) b.addEventListener('click', () => linkDialog(resources.find((r) => r.id === b.dataset.edit)));
  for (const b of body.querySelectorAll('[data-del]')) b.addEventListener('click', async () => {
    const r = resources.find((x) => x.id === b.dataset.del);
    if (!confirm(`Remove “${r.title}”?`)) return;
    try { await L.deleteResource(r.id); resources = await L.loadResources(); draw(); } catch (e) { alert(e.message); }
  });
}

function linkDialog(r) {
  const d = openDlg(`<form class="lh-form" method="dialog">
    <h2>${r ? 'Edit link' : 'Add a link'}</h2>
    <label>Topic<select name="topic_code" required>${topics.map((t) => `<option value="${esc(t.code)}" ${r?.topic_code === t.code ? 'selected' : ''}>${esc(t.code)} · ${esc(t.title)}</option>`).join('')}</select></label>
    <label>Type<select name="kind">${KINDS.map((k) => `<option value="${k.key}" ${r?.kind === k.key ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</select></label>
    <label>Title<input name="title" maxlength="160" required value="${esc(r?.title || '')}"></label>
    <label>Link (https://…)<input name="url" type="url" pattern="https://.*" maxlength="500" required value="${esc(r?.url || '')}"></label>
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="submit" class="primary">${icon('check')} Save</button><button type="button" data-cancel>Cancel</button></div>
  </form>`);
  const f = d.querySelector('form');
  d.querySelector('[data-cancel]').addEventListener('click', closeDlg);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await L.saveResource({ id: r?.id, topic_code: f.topic_code.value, kind: f.kind.value, title: f.title.value.trim(), url: f.url.value.trim(), created_by: ctx.me.id });
      resources = await L.loadResources();
      closeDlg(); draw();
    } catch (err) { const m = d.querySelector('[data-msg]'); m.textContent = err.message; m.hidden = false; }
  });
}
