// Learning Hub: study topics and links, the study log (reflections), and
// "grow your tree" — leaves from studying become skill points, the tree grows.
// Supervisors / QCD / admin also get a Team view (review reflections, give
// leaves, see skill wheels) and Manage topics (add / edit / hide topics and links).
// Leaves and points are worked out by the database; the page only shows them.
import * as L from '../learning-data.js';
import {
  SKILLS, ADMIN_SKILLS, skillsFor, stagesFor, skillLabel, STAGES, FIELD_STAGES, GUARDIAN, LEAVES_PER_POINT, BGS, LOOKS, ANIMALS, FLOWERS,
  stageOf, progress, sceneSvg, wheelSvg, artImg,
} from '../tree.js';
import { rankOf, RANK_LABEL, OFFICE_ROLES } from '../labels.js';
import { esc, fmtDate, todayLocal } from '../ui.js';
import { loadSafmeds, myTimings, setProgress, practice, saveSet, hideSet } from '../safmeds.js';
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
const tryNextHint = () => (field() ? 'At the front desk, with families, in the office…' : 'With my clients, at school…');

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
let tools = [];                // CARE tools (quick links)
let sfSets = [];               // SAFMEDS sets (with cards)
let sfTimings = [];            // my SAFMEDS timings
const TOOL_ICONS = ['link', 'clock', 'books', 'book', 'file-text', 'school', 'sparkles', 'calendar', 'users', 'heart-handshake', 'bulb', 'tool'];
let openTopic = null;          // code of the topic page being shown
const openFolds = new Set();   // Study log / Topics / Recent leaves left open
// Office-only staff (Admin / HR / Portal manager, no therapist rank) have the admin
// hub: admin skills and a flower field. The Portal manager looks after it.
let hub = 'clinical';
let fresh = null;              // a work anniversary picked up when the hub opened
let manageHub = 'clinical';    // Manage topics: clinical or admin team topics (Portal manager)
const isGM = () => ctx.roles.includes('manager');
const officeOnly = () => !rankOf(ctx.roles) && ctx.roles.some((r) => OFFICE_ROLES.includes(r));
const field = () => hub === 'admin';
const hubOfSkill = (k) => (String(k).startsWith('adm_') ? 'admin' : 'clinical');
const inHub = (t, h = hub) => hubOfSkill(t.skill) === h;
const canEditTopic = (t) => isTeam() && (hubOfSkill(t.skill) === 'clinical' || isGM());
// Experience leaves by clinical rank (the database gives them; this only explains it).
const expLeaves = () => ({ senior: 100, qcd: 200, supervisor: 300 })[rankOf(ctx.roles)] || 0;
// Full years at CARE (50 leaves each), from the start date in People.
const yearsAtCare = () => {
  const s = ctx.me.start_date; if (!s) return 0;
  const [y, m, d] = s.split('-').map(Number); const [ty, tm, td] = todayLocal().split('-').map(Number);
  return Math.max(0, ty - y - (tm < m || (tm === m && td < d) ? 1 : 0));
};
const startBonus = () => expLeaves() + yearsAtCare() * 50;
const reviewer = () => (field() ? 'the Portal manager' : 'your supervisors');

const areaOf = (k) => [...SKILLS, ...ADMIN_SKILLS].find((s) => s.key === k);
const areaColor = (k) => areaOf(k)?.color || '#6F8A69';
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
  hub = officeOnly() ? 'admin' : 'clinical';
  if (!isGM()) manageHub = 'clinical';
  panel.innerHTML = `
    <section class="lh">
      <div class="page-head">
        <h1>Learning Hub</h1>
        ${isTeam() ? `<div class="seg" role="tablist" aria-label="Learning Hub views">
          <button type="button" role="tab" data-view="me">My learning</button>
          <button type="button" role="tab" data-view="team">Team</button>
          <button type="button" role="tab" data-view="links">Manage topics</button>
        </div>` : ''}
      </div>
      <div id="lh-body" aria-live="polite"><p class="muted">Loading…</p></div>
      <p class="credit">Tree, flower, plant and animal art from <a href="https://www.vecteezy.com" target="_blank" rel="noopener">Vecteezy.com</a> (filtered to non-AI images)</p>
      <dialog id="lh-dlg" class="dlg"></dialog>
    </section>`;
  for (const b of panel.querySelectorAll('[data-view]')) b.addEventListener('click', () => { view = b.dataset.view; openTopic = null; draw(); });
  try {
    [topics, resources, tools, sfSets, fresh] = await Promise.all([L.loadTopics(), L.loadResources(), L.loadTools(), loadSafmeds(),
      L.refresh().catch(() => null)]);
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
  [me, refl, done, leaves, sfTimings] = await Promise.all([L.summary(), L.myReflections(ctx.me.id), L.myDone(ctx.me.id), L.myLeaves(ctx.me.id), myTimings(ctx.me.id)]);
  if (me.hub) hub = me.hub;
  if (fresh?.added) { const f = fresh; fresh = null; setTimeout(() => toast(`🎉 ${f.reason} · +${f.added} leaves`), 300); }
  if (openTopic && topicOf(openTopic)) return drawTopicPage(body);
  if (!me.started) return drawStart(body);
  const pr = progress(me.points);
  const ST = stagesFor(hub);
  const st = ST[pr.stage];
  const canInvest = me.balance >= LEAVES_PER_POINT;
  const fold = (key, title, extra, inner) => `<details class="card lh-fold" data-fold="${key}" ${openFolds.has(key) ? 'open' : ''}>
      <summary><h2>${title}</h2>${extra}<span class="lh-fold-ico">${icon('chevron-down')}</span></summary>${inner}</details>`;
  const nDone = done.length;
  body.innerHTML = `
    ${field() ? '' : toolsHtml()}
    <div class="lh-hero">
      <section class="card lh-tree">
        ${sceneSvg(myScene(), { label: `Your ${field() ? 'flower field' : 'tree'}: ${st.name}` })}
        <div class="lh-stage">
          <div><h2>${esc(st.name)}</h2><p class="muted small">${me.points} skill points</p></div>
          <button type="button" class="small-btn" data-act="look">${icon('plant-2')} Change look</button>
        </div>
        ${pr.next ? `<div class="bar" role="progressbar" aria-valuenow="${pr.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress to ${esc(ST[pr.stage + 1].name)}"><span style="width:${pr.pct}%"></span></div>
          <p class="small muted">${pr.next - me.points} more point${pr.next - me.points === 1 ? '' : 's'} to <strong>${esc(ST[pr.stage + 1].name)}</strong>${field() ? ` · ${ST[pr.stage + 1].n} flowers, mix ${ST[pr.stage + 1].kinds} kinds` : ''}</p>`
          : `<p class="small">You are a <strong>${esc(ST[GUARDIAN].name)}</strong>. ✨</p>`}
        <p class="muted small lh-wheel-about"><strong>Self-reflection skill wheel:</strong> your own check of where you feel strong and where you’d like to grow.
          It isn’t a score from anyone else. You choose where your skill points go, and ${reviewer()} use${field() ? 's' : ''} it to plan support and training for what you need.
          ${icon('lock')} ${field() ? 'Only you and the Portal manager / admin see the wheel; everyone sees your flower field.' : 'Only you and your supervisors / QCD / admin see the wheel; everyone sees your tree.'}</p>
      </section>
      <section class="card lh-side">
        <div class="lh-leaves">
          <span class="lh-leaf-ico">${icon('leaf')}</span>
          <div><p class="lh-big">${me.balance}</p><p class="muted small">leaves to use · ${LEAVES_PER_POINT} leaves = 1 skill point</p></div>
        </div>
        ${field() ? `<p class="muted small lh-helping">${icon('heart-handshake')} <span><strong>Helping earns leaves too:</strong> reply to a CARE Connect message sent to Admin, or answer a leave request (+1 each, up to 3 a day · ${me.helping_today ?? 0} today).</span></p>` : ''}
        <div class="lh-side-btns">
          <button type="button" class="primary" data-act="log">${icon('book')} Log a study session</button>
          <button type="button" class="${canInvest ? 'lh-ready' : ''}" data-act="invest">${icon('sparkles')} ${canInvest ? `Use your leaves · ${Math.floor(me.balance / LEAVES_PER_POINT)} skill point${me.balance >= 2 * LEAVES_PER_POINT ? 's' : ''} ready` : `${LEAVES_PER_POINT - (me.balance % LEAVES_PER_POINT)} more leaves for a skill point`}</button>
        </div>
        <div class="lh-wheel-head"><h3 class="lh-h3">Self-reflection skill wheel</h3>
          <button type="button" class="small-btn" data-act="move" title="Move points from one skill to another">Move points</button></div>
        ${wheelSvg(me.skills, hub)}
      </section>
    </div>

    ${field() ? '' : !sfSets.length ? `<section class="card muted-card"><h2>SAFMEDS</h2><p class="muted small">${sfSets.error
      ? `SAFMEDS couldn't load: ${esc(sfSets.error)}`
      : 'No SAFMEDS sets yet. Supervisors, QCD and admin can add them under Manage topics → SAFMEDS sets.'}</p></section>` : ''}
    ${!field() && sfSets.length ? fold('safmeds', 'SAFMEDS', `<span class="chip">${sfSets.length}</span><span class="muted small lh-fold-note">${sfSets.filter((s) => setProgress(s, sfTimings, todayLocal()).mastered).length} mastered · 1-minute timings</span>`, `
      <p class="muted small">Say All Fast, a Minute Every Day, Shuffled. Your first timing each day earns a leaf; meet a set’s aim on 3 different days to master it (+5 leaves).</p>
      ${safmedsHtml()}`) : ''}

    ${fold('log', 'Study log', `<span class="chip">${refl.length}</span><span class="muted small lh-fold-note">${me.logs_today} of 2 leaf logs used today</span>`, `
      <p class="muted small">Each reflection box you write properly earns a leaf (up to 5). ${field() ? 'The Portal manager’s' : 'A supervisor’s'} review adds 5 more.
        Leaves count for your first 2 logs each day.</p>
      ${reflList(refl)}`)}

    ${fold('topics', 'Topics', `<span class="chip">${topics.filter((t) => t.active && inHub(t)).length}</span><span class="muted small lh-fold-note">${nDone} resource${nDone === 1 ? '' : 's'} done</span>`, `
      <p class="muted small">Tap a topic to open it. Open a resource, then tap <strong>Done</strong> and write one line about it to earn a leaf (up to 3 a day).</p>
      ${topicsHtml()}`)}

    ${leaves.length ? fold('leaves', 'Recent leaves', '', `<ul class="lh-ledger">${leaves.slice(0, 10).map((x) => `
      <li><span class="lh-plus">+${x.amount} ${icon('leaf')}</span> ${esc(x.reason || x.source)} <span class="muted small">${fmtDate(x.created_at)}</span></li>`).join('')}</ul>`) : ''}`;

  // Remember which sections are open while on this tab.
  for (const d of body.querySelectorAll('[data-fold]')) {
    d.querySelector('summary').addEventListener('click', () => {
      setTimeout(() => (d.open ? openFolds.add(d.dataset.fold) : openFolds.delete(d.dataset.fold)));
    });
  }
  for (const b of body.querySelectorAll('[data-sf]')) b.addEventListener('click', () => openSafmeds(b.dataset.sf));
  body.querySelector('[data-act="look"]').addEventListener('click', () => (field() ? gardenDialog() : lookDialog()));
  body.querySelector('[data-act="invest"]').addEventListener('click', () => (canInvest ? investDialog() : null));
  body.querySelector('[data-act="log"]').addEventListener('click', () => logDialog());
  body.querySelector('[data-act="move"]').addEventListener('click', moveDialog);
  wireTopics(body);
  wireRefl(body);
}

function drawStart(body) {
  const SK = skillsFor(hub);
  const pts = Object.fromEntries(SK.map((s) => [s.key, 0]));
  body.innerHTML = `
    ${field() ? '' : toolsHtml()}
    <section class="card lh-start">
      <div class="lh-start-art">${sceneSvg({ points: 10, bg: 0, looks: [0, 0, 0, 0, 0, 0], hub, flowers: [0, 2] }, { label: field() ? 'Two flowers' : 'A seedling' })}</div>
      <div>
        <h2>${field() ? 'Plant your first flowers 🌷' : 'Plant your seed 🌱'}</h2>
        <p>You already have skills from your ${field() ? 'work' : 'training'}. Place <strong>10 skill points</strong> across the 7 skills to show where you feel strongest today.
          This starts your <strong>self-reflection skill wheel</strong>. It’s a self-check, not a test: be honest. It helps you see where to grow,
          and helps ${reviewer()} plan training for what you need.</p>
        <p class="muted small">After this, ${field() ? 'studying and helping therapists earn' : 'studying earns'} <strong>leaves</strong>. Every 10 leaves is 1 new skill point, and your ${field() ? 'flower field' : 'tree'} grows:
          ${stagesFor(hub).map((s) => `${esc(s.name)} ${s.at}`).join(' · ')}.</p>
        <div class="lh-alloc">${SK.map((s) => `
          <div class="lh-alloc-row"><span>${esc(s.label)}</span>
            <button type="button" class="small-btn" data-dec="${s.key}" aria-label="Less ${esc(s.label)}">−</button>
            <b data-val="${s.key}">0</b>
            <button type="button" class="small-btn" data-inc="${s.key}" aria-label="More ${esc(s.label)}">+</button></div>`).join('')}
        </div>
        <p class="small"><span id="lh-left">10</span> points left · up to 4 in one skill</p>
        ${startBonus() ? `<p class="lh-exp">${icon('sparkles')} <span>You've already learned a lot at CARE. After planting you also get
          ${[expLeaves() ? `<strong>${expLeaves()} leaves</strong> as a ${esc(RANK_LABEL[rankOf(ctx.roles)])}` : '',
             yearsAtCare() ? `<strong>${yearsAtCare() * 50} leaves</strong> for ${yearsAtCare()} year${yearsAtCare() === 1 ? '' : 's'} at CARE` : ''].filter(Boolean).join(' and ')}
          (${startBonus() / LEAVES_PER_POINT} skill points) to place where you like.</span></p>` : ''}
        <p id="lh-start-msg" class="error" hidden></p>
        <button type="button" class="primary" data-act="plant" disabled>${icon('plant-2')} ${field() ? 'Plant my flowers' : 'Plant my tree'}</button>
      </div>
    </section>
    <section class="card"><h2>Topics</h2>${topicsHtml()}</section>`;
  const used = () => Object.values(pts).reduce((a, b) => a + b, 0);
  const sync = () => {
    for (const s of SK) body.querySelector(`[data-val="${s.key}"]`).textContent = pts[s.key];
    body.querySelector('#lh-left').textContent = 10 - used();
    body.querySelector('[data-act="plant"]').disabled = used() !== 10;
  };
  body.addEventListener('click', async (e) => {
    const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]');
    if (inc && used() < 10 && pts[inc.dataset.inc] < 4) { pts[inc.dataset.inc]++; sync(); }
    if (dec && pts[dec.dataset.dec] > 0) { pts[dec.dataset.dec]--; sync(); }
    if (e.target.closest('[data-act="plant"]')) {
      const b = e.target.closest('button'); b.disabled = true;
      try {
        await L.start(pts); await draw();
        if (me.balance >= LEAVES_PER_POINT) { if (startBonus()) toast(`+${startBonus()} leaves for your experience 🍃`); investDialog(); }
      } catch (err) {
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
          <span class="lh-refl-main">${team ? `<strong>${esc(nameOf(r.therapist_id))}</strong> · ` : ''}${t ? `<span class="lh-dot" style="--area:${areaColor(t.skill)}"></span>${esc(t.title)}` : 'General study'}</span>
          <span class="muted small">${fmtDate(r.studied_on)} · ${r.minutes} min</span>
          ${r.leaves ? `<span class="lh-plus">+${r.leaves} ${icon('leaf')}</span>` : ''}
          <span class="chip ${r.status === 'reviewed' ? 'ok' : ''}">${r.status === 'reviewed' ? 'Reviewed' : 'Waiting for review'}</span>
        </summary>
        <dl class="lh-dl">
          ${BOXES.map(([k, label]) => (r[k] ? `<dt>${esc(label)}</dt><dd>${esc(r[k])}</dd>` : '')).join('')}
          ${r.feeling ? `<dt>How I feel about it</dt><dd>${r.feeling} / 5 · ${esc(FEEL[r.feeling - 1])}</dd>` : ''}
          ${r.review_note ? `<dt>Reviewer’s note</dt><dd class="lh-note">${esc(r.review_note)}</dd>` : ''}
        </dl>
        ${team ? `<button type="button" class="primary small-btn" data-review="${r.id}">${icon('check')} Review (+5 leaves)</button>` : ''}
      </details>
    </li>`;
  }).join('')}</ul>`;
}
function wireRefl() { /* details/summary needs no wiring */ }

// SAFMEDS set tiles: best score, aim days (dots), mastered, done today.
function safmedsHtml() {
  const today = todayLocal();
  return `<div class="sf-sets">${sfSets.map((s) => {
    const p = setProgress(s, sfTimings, today);
    const [num, ...rest] = s.title.split('·');
    const name = rest.join('·').trim();
    return `<button type="button" class="sf-set${p.mastered ? ' mastered' : ''}" data-sf="${s.id}">
      <span class="sf-set-top"><b>${esc(name ? num.trim() : s.title)}</b>${p.mastered ? '<span class="chip ok">Mastered</span>' : p.todayDone ? '<span class="chip">Done today</span>' : ''}</span>
      ${name ? `<span class="sf-set-name">${esc(name)}</span>` : ''}
      <span class="sf-set-meta"><span>${p.count ? `Best ${p.best}/min` : `${s.cards.length} cards`}</span>
        <span class="sf-dots" title="Aim met on ${p.aimDays} of 3 days">${[0, 1, 2].map((k) => `<i class="${k < p.aimDays ? 'on' : ''}"></i>`).join('')}</span></span>
    </button>`;
  }).join('')}</div>`;
}

function openSafmeds(id) {
  const set = sfSets.find((s) => s.id === id);
  if (!set || !set.cards.length) return toast('This set has no cards yet.');
  const d = dlg();
  let saved = false;
  practice(d, set, { timings: sfTimings, toast, onSaved: () => { saved = true; } });
  d.addEventListener('close', () => { if (saved) draw(); }, { once: true });
}

// CARE tools: a row of everyday links (timesheet, ABA Binder…), each with an optional note.
function toolsHtml() {
  if (!tools.length) return '';
  return `<section class="lh-tools" aria-label="CARE tools">${tools.map((t) => {
    const url = /^https?:\/\//i.test(t.url || '') ? t.url : null;
    const inner = `<span class="lh-tool-ico">${icon(t.icon) || icon('link')}</span>
      <span class="lh-tool-txt"><span class="lh-tool-t">${esc(t.title)}</span>${t.note ? `<span class="lh-tool-n" title="${esc(t.note)}">${esc(t.note)}</span>` : ''}</span>`;
    return url
      ? `<a class="lh-tool" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
      : `<div class="lh-tool lh-tool-off">${inner}</div>`;
  }).join('')}</section>`;
}

// Topic cards, grouped by the 7 areas. manage = edit mode for the team.
function topicsHtml(manage = false, h = hub) {
  return skillsFor(h).map((s) => {
    const list = topics.filter((t) => t.skill === s.key && t.active);
    if (!list.length && !manage) return '';
    return `<div class="lh-area" style="--area:${s.color}">
      <h3 class="lh-area-h"><span class="lh-dot"></span>${esc(s.label)} <span class="muted small">· ${list.length} topic${list.length === 1 ? '' : 's'}</span></h3>
      <div class="lh-cards">${list.map((t) => topicCard(t, manage)).join('')}
        ${manage ? `<button type="button" class="lh-card lh-card-add" data-addtopic="${s.key}">${icon('plus') || '+'} Add topic</button>` : ''}
      </div></div>`;
  }).join('');
}

function topicCard(t, manage) {
  const rs = resources.filter((r) => r.topic_code === t.code);
  const n = rs.filter((r) => done.some((d) => d.resource_id === r.id)).length;
  const kinds = [...new Set(rs.map((r) => r.kind))];
  return `<button type="button" class="lh-card" ${manage ? 'data-mtopic' : 'data-topic'}="${esc(t.code)}">
    <span class="lh-card-t">${esc(t.title)}</span>
    <span class="lh-card-meta"><span class="lh-card-kinds">${kinds.map((k) => icon(kindOf(k).icon)).join('') || '<span class="muted">No links yet</span>'}</span>
      ${manage ? `<span class="muted">${rs.length} link${rs.length === 1 ? '' : 's'}</span>` : rs.length ? `<span class="muted">${n}/${rs.length} done</span>` : ''}</span>
    ${!manage && rs.length ? `<span class="lh-card-bar"><span style="width:${Math.round((n / rs.length) * 100)}%"></span></span>` : ''}
  </button>`;
}

function wireTopics(body) {
  for (const b of body.querySelectorAll('[data-topic]')) b.addEventListener('click', () => { openTopic = b.dataset.topic; draw(); window.scrollTo(0, 0); });
  for (const b of body.querySelectorAll('[data-done]')) b.addEventListener('click', () => doneDialog(b.dataset.done));
}

// One topic's own page: description, resources (Done), log on this topic.
function drawTopicPage(body) {
  const t = topicOf(openTopic);
  const area = areaOf(t.skill);
  const rs = resources.filter((r) => r.topic_code === t.code);
  body.innerHTML = `
    <button type="button" class="link lh-back" data-back>${icon('arrow-right', 'flip')} All topics</button>
    <section class="card lh-topic-page" style="--area:${area.color}">
      <p class="lh-area-h small"><span class="lh-dot"></span>${esc(area.label)}</p>
      <h2>${esc(t.title)}</h2>
      ${t.description ? `<p class="muted">${esc(t.description)}</p>` : ''}
      ${rs.length ? `<ul class="lh-res">${rs.map((r) => {
        const d = done.find((x) => x.resource_id === r.id);
        const url = safeUrl(r.url);
        return `<li>
          <span class="lh-kind" title="${esc(kindOf(r.kind).label)}">${icon(kindOf(r.kind).icon)}</span>
          ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)} ${icon('external-link')}</a>` : esc(r.title)}
          ${d ? `<span class="chip ok" title="${esc(d.note || '')}">${icon('check')} Done</span>`
            : `<button type="button" class="small-btn" data-done="${r.id}">Done</button>`}
        </li>`;
      }).join('')}</ul>` : `<p class="muted">No links yet. ${field() ? 'The Portal manager' : 'Your supervisors'} will add some.</p>`}
      <p class="muted small">Tap <strong>Done</strong> and write one line about what you learned to earn a leaf (up to 3 a day).</p>
      <div class="dlg-actions">
        <button type="button" class="primary" data-logtopic>${icon('book')} Log a study session on this topic</button>
        ${canEditTopic(t) ? `<button type="button" data-edittopic>${icon('settings')} Edit topic</button>` : ''}
      </div>
    </section>`;
  body.querySelector('[data-back]').addEventListener('click', () => { openTopic = null; openFolds.add('topics'); draw(); });
  body.querySelector('[data-logtopic]').addEventListener('click', () => logDialog(t.code));
  body.querySelector('[data-edittopic]')?.addEventListener('click', () => topicDialog(t));
  wireTopics(body);
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

function logDialog(preset = null) {
  const opts = skillsFor(hub).map((s) => `<optgroup label="${esc(s.label)}">${topics.filter((t) => t.skill === s.key && t.active)
    .map((t) => `<option value="${esc(t.code)}" ${t.code === preset ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</optgroup>`).join('');
  const d = openDlg(`<form class="lh-form" method="dialog">
    <h2>Log a study session</h2>
    <div class="lh-2col">
      <label>Date studied<input type="date" name="studied_on" value="${todayLocal()}" max="${todayLocal()}" required></label>
      <label>How long<select name="minutes">${MINUTES.map(([v, l]) => `<option value="${v}" ${v === 30 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <label>Topic<select name="topic"><option value="">General / other</option>${opts}</select></label>
    ${BOXES.map(([k, label, ph]) => `<label>${esc(label)}${k === 'studied' ? ' <span class="muted small">(needed)</span>' : ''}
      <textarea name="${k}" rows="${k === 'studied' ? 3 : 2}" maxlength="2000" ${k === 'studied' ? 'required' : ''} placeholder="${esc(k === 'try_next' ? tryNextHint() : ph)}"></textarea></label>`).join('')}
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

// Spend leaves 10 at a time. The window stays open while there are enough
// leaves, so someone with a big bundle (e.g. experience leaves) can place many points.
function investDialog() {
  const before = stageOf(me.points);
  let placed = 0;
  let step = me.balance >= 20 * LEAVES_PER_POINT ? 5 : 1;   // big bundles: 5 points a tap
  const d = openDlg(`<div class="lh-form">
    <h2>Use your leaves</h2>
    <p data-left></p>
    <div class="seg lh-step" role="group" aria-label="Points per tap" data-steps></div>
    <div class="lh-invest" data-skills></div>
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="button" class="primary" data-cancel>Done</button></div>
  </div>`);
  const paint = () => {
    const n = Math.floor(me.balance / LEAVES_PER_POINT);
    const k = Math.min(step, n);
    d.querySelector('[data-steps]').hidden = n < 2;
    d.querySelector('[data-steps]').innerHTML = [1, 5].map((v) => `<button type="button" data-step="${v}" aria-pressed="${step === v}" aria-selected="${step === v}">${v} point${v === 1 ? '' : 's'} a tap</button>`).join('');
    d.querySelector('[data-left]').innerHTML = n
      ? `You have <strong>${me.balance}</strong> leaves: enough for <strong>${n}</strong> skill point${n === 1 ? '' : 's'}. Tap a skill to add ${k} point${k === 1 ? '' : 's'} (10 leaves each).`
      : `All used${placed ? ` · you placed ${placed} point${placed === 1 ? '' : 's'}` : ''}. ${me.balance} leaves left.`;
    d.querySelector('[data-skills]').innerHTML = skillsFor(hub).map((s) => `<button type="button" data-skill="${s.key}" ${n ? '' : 'disabled'}>
      <span>${esc(s.label)}</span><b>${me.skills?.[s.key] ?? 0}</b></button>`).join('');
  };
  paint();
  const finish = async () => {
    closeDlg();
    if (!placed) return;
    await draw();
    const after = stageOf(me.points);
    toast(after > before ? `Your ${field() ? 'field' : 'tree'} grew into a ${stagesFor(hub)[after].name}! ${field() ? '🌸' : '🌳'}` : `+${placed} skill point${placed === 1 ? '' : 's'}`);
    if (after > before) celebrate(after);
  };
  d.querySelector('[data-cancel]').addEventListener('click', finish);
  d.querySelector('[data-steps]').addEventListener('click', (e) => { const b = e.target.closest('[data-step]'); if (b) { step = Number(b.dataset.step); paint(); } });
  d.querySelector('[data-skills]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-skill]'); if (!b || b.disabled) return;
    for (const x of d.querySelectorAll('[data-skill]')) x.disabled = true;
    try {
      const k = Math.min(step, Math.floor(me.balance / LEAVES_PER_POINT));
      for (let i = 0; i < k; i++) { await L.invest(b.dataset.skill); placed++; }
      me = await L.summary();
      paint();
      if (me.balance < LEAVES_PER_POINT) setTimeout(finish, 900);
    } catch (err) { const m = d.querySelector('[data-msg]'); m.textContent = err.message; m.hidden = false; paint(); }
  });
}

// Re-balance your own wheel: take points from one skill, give them to another.
// The total stays the same, so the tree / flower field never shrinks.
function moveDialog() {
  const SK = skillsFor(hub);
  const was = Object.fromEntries(SK.map((s) => [s.key, me.skills?.[s.key] ?? 0]));
  const pts = { ...was };
  let pool = 0;
  const d = openDlg(`<div class="lh-form">
    <h2>Move points</h2>
    <p class="muted small">Your wheel is your own view, so change it whenever your view changes. Take points from a skill with <strong>−</strong>, then give them to another with <strong>+</strong>. Your total stays the same.</p>
    <div class="lh-alloc" data-rows></div>
    <p class="small" data-pool></p>
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="button" class="primary" data-save disabled>${icon('check')} Save</button><button type="button" data-cancel>Cancel</button></div>
  </div>`);
  const paint = () => {
    d.querySelector('[data-rows]').innerHTML = SK.map((s) => `<div class="lh-alloc-row"><span>${esc(s.label)}</span>
      <button type="button" class="small-btn" data-dec="${s.key}" aria-label="Less ${esc(s.label)}" ${pts[s.key] ? '' : 'disabled'}>−</button>
      <b class="${pts[s.key] !== was[s.key] ? 'lh-changed' : ''}">${pts[s.key]}</b>
      <button type="button" class="small-btn" data-inc="${s.key}" aria-label="More ${esc(s.label)}" ${pool ? '' : 'disabled'}>+</button></div>`).join('');
    const changed = SK.some((s) => pts[s.key] !== was[s.key]);
    d.querySelector('[data-pool]').innerHTML = pool
      ? `<strong>${pool}</strong> point${pool === 1 ? '' : 's'} to place: tap <strong>+</strong> on a skill.`
      : changed ? 'All placed. Save when you’re happy.' : 'Tap <strong>−</strong> on a skill to take a point from it.';
    d.querySelector('[data-save]').disabled = pool > 0 || !changed;
  };
  paint();
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.dec) { pts[b.dataset.dec]--; pool++; paint(); }
    else if (b.dataset.inc) { pts[b.dataset.inc]++; pool--; paint(); }
    else if (b.hasAttribute('data-cancel')) closeDlg();
    else if (b.hasAttribute('data-save')) {
      try { await L.rebalance(pts); closeDlg(); await draw(); toast('Skill wheel updated'); } catch (err) {
        const m = d.querySelector('[data-msg]'); m.textContent = err.message; m.hidden = false;
      }
    }
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
  const ST = stagesFor(hub);
  openDlg(`<div class="lh-form lh-celebrate">
    <h2>Level up! 🎉</h2>
    <div class="lh-preview">${sceneSvg(myScene())}</div>
    <p>Your ${field() ? 'flower field' : 'tree'} is now a <strong>${esc(ST[stage].name)}</strong>.${stage === GUARDIAN ? ' Choose an animal friend to join it!'
      : field() ? ` You can now mix ${ST[stage].kinds} kinds of flower.` : ' New looks are unlocked.'}</p>
    <div class="dlg-actions"><button type="button" class="primary" data-look>${icon('plant-2')} Choose a look</button><button type="button" data-cancel>Later</button></div>
  </div>`);
  const d = dlg();
  d.querySelector('[data-cancel]').addEventListener('click', closeDlg);
  d.querySelector('[data-look]').addEventListener('click', () => (field() ? gardenDialog() : lookDialog()));
}

// My scene (tree or flower field) as drawn now.
const myScene = () => ({ points: me.points, bg: me.bg, looks: me.looks, animal: me.animal, hub, flowers: me.flowers });

// Admin team: choose the background, the kinds of flower to mix, and (at 100) an animal.
function gardenDialog() {
  const stage = stageOf(me.points);
  const max = FIELD_STAGES[stage].kinds;
  const pick = { bg: me.bg ?? 0, flowers: [...(me.flowers?.length ? me.flowers : [0, 2])].slice(0, max), animal: me.animal ?? null };
  let note = '';
  const opt = (sel, attr, val, inner, label) =>
    `<button type="button" class="lh-opt" ${attr}="${val}" aria-pressed="${sel}" title="${esc(label)}">${inner}<span>${esc(label)}</span></button>`;
  const paint = (d) => {
    d.querySelector('[data-preview]').innerHTML = sceneSvg({ points: me.points, hub: 'admin', ...pick });
    d.querySelector('[data-count]').textContent = `${pick.flowers.length} of ${max} chosen`;
    d.querySelector('[data-flowers]').innerHTML = FLOWERS.map((f, i) => opt(pick.flowers.includes(i), 'data-flower', i, artImg(f.file), f.name)).join('');
    d.querySelector('[data-fnote]').textContent = note;
    d.querySelector('[data-bgs]').innerHTML = BGS.map((b, i) => opt(pick.bg === i, 'data-bg', i, artImg(b.file), b.name)).join('');
    d.querySelector('[data-animals]').innerHTML = stage === GUARDIAN
      ? opt(pick.animal == null, 'data-animal', '', '<span class="lh-none">—</span>', 'No animal') + ANIMALS.map((a, i) => opt(pick.animal === i, 'data-animal', i, artImg(a.file), a.name)).join('')
      : `<p class="muted small">${icon('lock')} Animals unlock at Flower Field Keeper (100 skill points). Then one can join your field.</p>`;
  };
  const d = openDlg(`<div class="lh-form lh-look">
    <h2>Your flower field</h2>
    <div class="lh-preview" data-preview></div>
    <h3 class="lh-h3">Flowers to mix <span class="muted small" data-count></span></h3>
    <div class="lh-opts lh-flowers" data-flowers></div>
    <p class="muted small" data-fnote aria-live="polite"></p>
    <h3 class="lh-h3">Background</h3><div class="lh-opts" data-bgs></div>
    <h3 class="lh-h3">Animal friend</h3><div class="lh-opts" data-animals></div>
    <p class="muted small">As your field grows you get more flowers, and can mix more kinds (up to 6).</p>
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="button" class="primary" data-save>${icon('check')} Save</button><button type="button" data-cancel>Cancel</button></div>
  </div>`);
  paint(d);
  d.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    note = '';
    if (b.dataset.flower != null) {
      const f = Number(b.dataset.flower);
      if (pick.flowers.includes(f)) {
        if (pick.flowers.length > 1) pick.flowers = pick.flowers.filter((x) => x !== f); else note = 'Keep at least one flower.';
      } else if (pick.flowers.length < max) pick.flowers.push(f);
      else note = `You can mix ${max} kinds now. Tap one you've chosen to swap it out; more unlock as your field grows.`;
      paint(d);
    } else if (b.dataset.bg != null) { pick.bg = Number(b.dataset.bg); paint(d); }
    else if (b.dataset.animal != null) { pick.animal = b.dataset.animal === '' ? null : Number(b.dataset.animal); paint(d); }
    else if (b.hasAttribute('data-cancel')) closeDlg();
    else if (b.hasAttribute('data-save')) {
      try { await L.setGarden(pick.bg, pick.flowers, pick.animal); closeDlg(); await draw(); toast('Flower field updated 🌸'); } catch (err) {
        const m = d.querySelector('[data-msg]'); m.textContent = err.message; m.hidden = false;
      }
    }
  });
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
  // The list is already limited (the admin team only shows for the Portal manager).
  const others = waiting.filter((r) => r.therapist_id !== ctx.me.id && list.some((p) => p.id === r.therapist_id));
  body.innerHTML = `
    <section class="card">
      <h2>To review <span class="chip">${others.length}</span></h2>
      <p class="muted small">Read the reflection, add a note if you like, and mark it reviewed. They get 5 leaves.</p>
      ${reflList(others, { team: true })}
    </section>
    <section class="card">
      <h2>People</h2>
      <div class="table-wrap"><table class="lh-table">
        <thead><tr><th>Name</th><th>Tree / field</th><th>Points</th><th>Leaves</th><th>Logs</th><th>Waiting</th><th>Last study</th><th></th></tr></thead>
        <tbody>${list.map((p) => `<tr>
          <td>${esc(p.nickname || p.full_name)}${p.hub === 'admin' ? ' <span class="chip">Admin team</span>' : ''}</td>
          <td>${p.started ? esc(stagesFor(p.hub)[stageOf(p.points)].name) : '<span class="muted">Not planted</span>'}</td>
          <td>${p.started ? p.points : '—'}</td><td>${p.balance}</td><td>${p.logs}</td>
          <td>${p.to_review ? `<span class="chip warn">${p.to_review}</span>` : '0'}</td>
          <td>${p.last_study ? fmtDate(p.last_study) : '—'}</td>
          <td class="row-actions">
            ${p.started ? `<button type="button" class="small-btn" data-wheel="${p.id}" title="Self-reflection skill wheel">Skill wheel</button>` : ''}
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
      <div class="lh-preview">${sceneSvg({ points: s.points, bg: s.bg, looks: s.looks, animal: s.animal, hub: s.hub, flowers: s.flowers })}</div>
      ${wheelSvg(s.skills, s.hub)}
    </div>
    <p class="small"><strong>Self-reflection skill wheel</strong> (their own view) · ${esc(stagesFor(s.hub)[stageOf(s.points)].name)} · ${s.points} skill points · ${s.balance} leaves to use</p>
    <p class="muted small">Low areas are where they’d like to grow: a good place to offer support or training.</p>
    <div class="dlg-actions"><button type="button" data-cancel>Close</button></div>
  </div>`);
  d.querySelector('[data-cancel]').addEventListener('click', closeDlg);
}

// ---------------------------------------------------------------------------
// Manage topics (supervisor / QCD / admin): add, edit, order, hide topics; links
// ---------------------------------------------------------------------------
function drawLinks(body) {
  const adm = manageHub === 'admin';
  const hidden = topics.filter((t) => !t.active && inHub(t, manageHub));
  body.innerHTML = `
    ${isGM() ? `<div class="seg lh-hubseg" role="tablist" aria-label="Which topics">
      <button type="button" role="tab" data-mhub="clinical" aria-selected="${!adm}">Therapist topics</button>
      <button type="button" role="tab" data-mhub="admin" aria-selected="${adm}">Admin team topics</button>
    </div>` : ''}
    ${adm ? '' : `<section class="card">
      <div class="page-head"><h2>CARE tools</h2><button type="button" class="small-btn" data-addtool>${icon('plus')} Add a tool</button></div>
      <p class="muted small">Everyday links shown at the top of everyone's Learning Hub. A tool can have just a note (e.g. “Ask admin for the login”).</p>
      ${tools.length ? `<ul class="lh-res lh-res-edit">${tools.map((t) => `<li>
        <span class="lh-kind">${icon(t.icon) || icon('link')}</span>
        <span class="lh-grow"><strong>${esc(t.title)}</strong>${t.note ? ` <span class="muted small">· ${esc(t.note)}</span>` : ''}${t.url ? '' : ' <span class="chip">No link</span>'}</span>
        <span class="row-actions"><button type="button" class="small-btn" data-edittool="${t.id}">Edit</button>
        <button type="button" class="small-btn" data-deltool="${t.id}">Remove</button></span></li>`).join('')}</ul>` : '<p class="muted small">No tools yet.</p>'}
    </section>
    <section class="card">
      <div class="page-head"><h2>SAFMEDS sets</h2><button type="button" class="small-btn" data-addset>${icon('plus')} Add a set</button></div>
      <p class="muted small">Flash-card sets for 1-minute timings. Tap a set to edit its cards or its aim.</p>
      ${sfSets.length ? `<ul class="lh-res lh-res-edit">${sfSets.map((s) => `<li>
        <span class="lh-kind">${icon('bulb')}</span>
        <span class="lh-grow"><strong>${esc(s.title)}</strong> <span class="muted small">· ${s.cards.length} cards · aim ${s.aim_correct}+ / ${s.aim_missed} missed</span></span>
        <span class="row-actions"><button type="button" class="small-btn" data-editset="${s.id}">Edit</button>
        <button type="button" class="small-btn" data-hideset="${s.id}">Remove</button></span></li>`).join('')}</ul>` : '<p class="muted small">No sets yet.</p>'}
    </section>`}
    <section class="card">
      <h2>${adm ? 'Admin team topics' : 'Manage topics'}</h2>
      <p class="muted small">Tap a topic to rename it, move it to another area, add a short description, change its order or edit its links.
        ${adm ? 'The admin team (Admin / HR with no therapist rank) sees these on their Learning Hub.' : 'Therapists see these on their Learning Hub.'} Use links that open without a special login where you can.</p>
      ${topicsHtml(true, manageHub)}
    </section>
    ${hidden.length ? `<section class="card"><h2>Hidden topics</h2>
      <p class="muted small">Hidden because someone has already logged study on them. Show one again if you need it.</p>
      <ul class="lh-res">${hidden.map((t) => `<li><span class="lh-dot" style="--area:${areaColor(t.skill)}"></span><span class="lh-grow">${esc(t.title)}</span>
        <button type="button" class="small-btn" data-unhide="${esc(t.code)}">Show again</button></li>`).join('')}</ul></section>` : ''}`;
  for (const b of body.querySelectorAll('[data-mhub]')) b.addEventListener('click', () => { manageHub = b.dataset.mhub; draw(); });
  body.querySelector('[data-addset]')?.addEventListener('click', () => setDialog(null));
  for (const b of body.querySelectorAll('[data-editset]')) b.addEventListener('click', () => setDialog(sfSets.find((s) => s.id === b.dataset.editset)));
  for (const b of body.querySelectorAll('[data-hideset]')) b.addEventListener('click', async () => {
    const s = sfSets.find((x) => x.id === b.dataset.hideset);
    if (!confirm(`Remove “${s.title}”? People's past timings are kept.`)) return;
    try { await hideSet(s.id); sfSets = await loadSafmeds(); draw(); toast('Set removed'); } catch (e) { alert(e.message); }
  });
  body.querySelector('[data-addtool]')?.addEventListener('click', () => toolDialog(null));
  for (const b of body.querySelectorAll('[data-edittool]')) b.addEventListener('click', () => toolDialog(tools.find((t) => t.id === b.dataset.edittool)));
  for (const b of body.querySelectorAll('[data-deltool]')) b.addEventListener('click', async () => {
    const t = tools.find((x) => x.id === b.dataset.deltool);
    if (!confirm(`Remove “${t.title}” from CARE tools?`)) return;
    try { await L.deleteTool(t.id); tools = await L.loadTools(); draw(); toast('Tool removed'); } catch (e) { alert(e.message); }
  });
  for (const b of body.querySelectorAll('[data-mtopic]')) b.addEventListener('click', () => topicDialog(topicOf(b.dataset.mtopic)));
  for (const b of body.querySelectorAll('[data-addtopic]')) b.addEventListener('click', () => topicDialog(null, b.dataset.addtopic));
  for (const b of body.querySelectorAll('[data-unhide]')) b.addEventListener('click', async () => {
    try { await L.setTopicActive(b.dataset.unhide, true); await reloadContent(); draw(); toast('Topic shown again'); } catch (e) { alert(e.message); }
  });
}

// Edit a SAFMEDS set: title, aim, and its cards (front / back).
function setDialog(s) {
  let cards = (s?.cards || []).map((c) => ({ ...c }));
  const removed = [];
  const d = openDlg(`<form class="lh-form sf-edit" method="dialog">
    <h2>${s ? 'Edit set' : 'Add a set'}</h2>
    <label>Set name<input name="title" maxlength="80" required value="${esc(s?.title || '')}" placeholder="Set 9 · Reinforcement schedules"></label>
    <div class="lh-2col">
      <label>Aim: correct per minute<input name="aim_correct" type="number" min="1" max="120" value="${s?.aim_correct ?? 30}"></label>
      <label>Aim: missed at most<input name="aim_missed" type="number" min="0" max="30" value="${s?.aim_missed ?? 2}"></label>
    </div>
    <h3 class="lh-h3">Cards <span class="muted small" data-n></span></h3>
    <ol class="sf-cards" data-cards></ol>
    <button type="button" class="small-btn" data-addcard>${icon('plus')} Add a card</button>
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="submit" class="primary">${icon('check')} Save</button><button type="button" data-cancel>Cancel</button></div>
  </form>`);
  const f = d.querySelector('form');
  const box = d.querySelector('[data-cards]');
  const sync = () => box.querySelectorAll('li').forEach((li, i) => {
    cards[i].front = li.querySelector('[data-f]').value; cards[i].back = li.querySelector('[data-b]').value;
  });
  const paint = () => {
    box.innerHTML = cards.map((c, i) => `<li>
      <input data-f maxlength="200" placeholder="Front: term" value="${esc(c.front || '')}" aria-label="Card ${i + 1} front">
      <textarea data-b rows="2" maxlength="1000" placeholder="Back: definition" aria-label="Card ${i + 1} back">${esc(c.back || '')}</textarea>
      <button type="button" class="small-btn" data-rm="${i}" aria-label="Remove card ${i + 1}">✕</button></li>`).join('');
    d.querySelector('[data-n]').textContent = `(${cards.length})`;
    box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      sync(); const [c] = cards.splice(Number(b.dataset.rm), 1); if (c.id) removed.push(c.id); paint();
    }));
  };
  paint();
  d.querySelector('[data-addcard]').addEventListener('click', () => { sync(); cards.push({ front: '', back: '' }); paint(); box.lastElementChild?.querySelector('[data-f]').focus(); });
  d.querySelector('[data-cancel]').addEventListener('click', closeDlg);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    sync();
    const keep = cards.filter((c) => c.front.trim() && c.back.trim()).map((c) => ({ ...c, front: c.front.trim(), back: c.back.trim() }));
    const msg = d.querySelector('[data-msg]');
    if (!keep.length) { msg.textContent = 'Add at least one card with a front and a back.'; msg.hidden = false; return; }
    try {
      await saveSet({ id: s?.id, title: f.title.value.trim(), aim_correct: Number(f.aim_correct.value), aim_missed: Number(f.aim_missed.value),
        sort_order: Math.max(0, ...sfSets.map((x) => x.sort_order || 0)) + 10 }, keep,
      [...removed, ...cards.filter((c) => c.id && !keep.some((k) => k.id === c.id)).map((c) => c.id)]);
      sfSets = await loadSafmeds(); closeDlg(); draw(); toast('Set saved');
    } catch (err) { msg.textContent = err.message; msg.hidden = false; }
  });
}

function toolDialog(t) {
  const d = openDlg(`<form class="lh-form" method="dialog">
    <h2>${t ? 'Edit tool' : 'Add a tool'}</h2>
    <label>Name<input name="title" maxlength="60" required value="${esc(t?.title || '')}" placeholder="CARE Timesheet"></label>
    <label>Link <span class="muted small">(optional)</span><input name="url" type="url" pattern="https?://.*" maxlength="500" value="${esc(t?.url || '')}" placeholder="https://…"></label>
    <label>Note <span class="muted small">(optional, shown under the name)</span><input name="note" maxlength="200" value="${esc(t?.note || '')}" placeholder="Ask admin for the login"></label>
    <fieldset class="lh-iconpick"><legend>Icon</legend>${TOOL_ICONS.map((k) => `<label class="lh-iconopt"><input type="radio" name="icon" value="${k}" ${(t?.icon || 'link') === k ? 'checked' : ''}><span>${icon(k)}</span></label>`).join('')}</fieldset>
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="submit" class="primary">${icon('check')} Save</button><button type="button" data-cancel>Cancel</button></div>
  </form>`);
  const f = d.querySelector('form');
  d.querySelector('[data-cancel]').addEventListener('click', closeDlg);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await L.saveTool({ id: t?.id, title: f.title.value.trim(), url: f.url.value.trim(), note: f.note.value.trim(), icon: f.icon.value,
        sort_order: Math.max(0, ...tools.map((x) => x.sort_order || 0)) + 10 });
      tools = await L.loadTools(); closeDlg(); draw(); toast('Tool saved');
    } catch (err) { const m = d.querySelector('[data-msg]'); m.textContent = err.message; m.hidden = false; }
  });
}

async function reloadContent() {
  [topics, resources] = await Promise.all([L.loadTopics(), L.loadResources()]);
}

// Edit (or add) a topic, its order and its links.
function topicDialog(t, newSkill = null) {
  const isNew = !t;
  const skill = t?.skill || newSkill;
  const rs = isNew ? [] : resources.filter((r) => r.topic_code === t.code);
  const d = openDlg(`<form class="lh-form" method="dialog">
    <h2>${isNew ? 'Add a topic' : 'Edit topic'}</h2>
    <label>Topic name<input name="title" maxlength="120" required value="${esc(t?.title || '')}" placeholder="Prompting & prompt fading"></label>
    <label>Area<select name="skill">${skillsFor(hubOfSkill(skill)).map((s) => `<option value="${s.key}" ${s.key === skill ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
    <label>Short description <span class="muted small">(optional)</span><textarea name="description" rows="2" maxlength="300" placeholder="What this topic covers, in one or two lines">${esc(t?.description || '')}</textarea></label>
    ${isNew ? '' : `
      <div class="lh-row-btns"><span class="muted small">Order in its area</span>
        <button type="button" class="small-btn" data-tmove="-1">${icon('arrow-right', 'up')} Earlier</button>
        <button type="button" class="small-btn" data-tmove="1">${icon('arrow-right', 'down')} Later</button></div>
      <h3 class="lh-h3">Links</h3>
      ${rs.length ? `<ul class="lh-res lh-res-edit">${rs.map((r, i) => `<li>
        <span class="lh-kind">${icon(kindOf(r.kind).icon)}</span><span class="lh-grow">${esc(r.title)}</span>
        <span class="row-actions">
          <button type="button" class="small-btn" data-rmove="${i}" data-dir="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="small-btn" data-rmove="${i}" data-dir="1" aria-label="Move down" ${i === rs.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="small-btn" data-redit="${r.id}">Edit</button>
          <button type="button" class="small-btn" data-rdel="${r.id}">Remove</button></span></li>`).join('')}</ul>` : '<p class="muted small">No links yet.</p>'}
      <button type="button" class="small-btn" data-radd>${icon('link')} Add a link</button>`}
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions">
      <button type="submit" class="primary">${icon('check')} ${isNew ? 'Add topic' : 'Save'}</button>
      <button type="button" data-cancel>${isNew ? 'Cancel' : 'Close'}</button>
      ${isNew ? '' : `<span class="spacer"></span><button type="button" class="small-btn" data-tremove>Remove topic</button>`}
    </div>
  </form>`);
  const f = d.querySelector('form');
  const msg = (text) => { const m = d.querySelector('[data-msg]'); m.textContent = text; m.hidden = false; };
  const after = async (text) => { await reloadContent(); const fresh = isNew ? null : topicOf(t.code); draw(); if (fresh) topicDialog(fresh); else closeDlg(); if (text) toast(text); };
  d.querySelector('[data-cancel]').addEventListener('click', closeDlg);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = f.title.value.trim();
    if (!title) return msg('Give the topic a name.');
    try {
      const same = topics.filter((x) => x.skill === f.skill.value && x.active);
      await L.saveTopic({
        isNew, code: isNew ? L.newCode(f.skill.value, topics.map((x) => x.code)) : t.code,
        title, skill: f.skill.value, description: f.description.value.trim(),
        sort_order: Math.max(0, ...same.map((x) => x.sort_order || 0)) + 10,
      });
      await reloadContent(); closeDlg(); draw(); toast(isNew ? 'Topic added' : 'Topic saved');
    } catch (err) { msg(err.message); }
  });
  if (isNew) return;
  d.querySelectorAll('[data-tmove]').forEach((b) => b.addEventListener('click', async () => {
    const list = topics.filter((x) => x.skill === t.skill && x.active);
    const i = list.findIndex((x) => x.code === t.code), j = i + Number(b.dataset.tmove);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    try { await L.reorder('learning_topics', 'code', list.map((x) => x.code)); await after('Order saved'); } catch (err) { msg(err.message); }
  }));
  d.querySelectorAll('[data-rmove]').forEach((b) => b.addEventListener('click', async () => {
    const list = [...rs];
    const i = Number(b.dataset.rmove), j = i + Number(b.dataset.dir);
    [list[i], list[j]] = [list[j], list[i]];
    try { await L.reorder('learning_resources', 'id', list.map((x) => x.id)); await after(); } catch (err) { msg(err.message); }
  }));
  d.querySelectorAll('[data-redit]').forEach((b) => b.addEventListener('click', () => linkDialog(resources.find((r) => r.id === b.dataset.redit), t)));
  d.querySelector('[data-radd]').addEventListener('click', () => linkDialog(null, t));
  d.querySelectorAll('[data-rdel]').forEach((b) => b.addEventListener('click', async () => {
    const r = resources.find((x) => x.id === b.dataset.rdel);
    if (!confirm(`Remove the link “${r.title}”?`)) return;
    try { await L.deleteResource(r.id); await after('Link removed'); } catch (err) { msg(err.message); }
  }));
  d.querySelector('[data-tremove]').addEventListener('click', async () => {
    try {
      if (await L.topicUsed(t.code)) {
        if (!confirm(`Hide “${t.title}”? Someone has logged study on it, so it will be hidden (not deleted) to keep their history. You can show it again later.`)) return;
        await L.setTopicActive(t.code, false);
      } else {
        if (!confirm(`Delete “${t.title}”${rs.length ? ` and its ${rs.length} link${rs.length === 1 ? '' : 's'}` : ''}? This can’t be undone.`)) return;
        await L.deleteTopic(t.code);
      }
      if (openTopic === t.code) openTopic = null;
      await reloadContent(); closeDlg(); draw(); toast('Topic removed');
    } catch (err) { msg(err.message); }
  });
}

// Add or edit one link of a topic, then go back to that topic.
function linkDialog(r, t) {
  const d = openDlg(`<form class="lh-form" method="dialog">
    <h2>${r ? 'Edit link' : 'Add a link'} · ${esc(t.title)}</h2>
    <label>Type<select name="kind">${KINDS.map((k) => `<option value="${k.key}" ${r?.kind === k.key ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</select></label>
    <label>Title<input name="title" maxlength="160" required value="${esc(r?.title || '')}"></label>
    <label>Link (https://…)<input name="url" type="url" pattern="https://.*" maxlength="500" required value="${esc(r?.url || '')}"></label>
    <p class="error" data-msg hidden></p>
    <div class="dlg-actions"><button type="submit" class="primary">${icon('check')} Save</button><button type="button" data-cancel>Back</button></div>
  </form>`);
  const f = d.querySelector('form');
  d.querySelector('[data-cancel]').addEventListener('click', () => topicDialog(t));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const same = resources.filter((x) => x.topic_code === t.code);
      await L.saveResource({ id: r?.id, topic_code: t.code, kind: f.kind.value, title: f.title.value.trim(), url: f.url.value.trim(),
        created_by: ctx.me.id, sort_order: Math.max(0, ...same.map((x) => x.sort_order || 0)) + 10 });
      await reloadContent(); draw(); topicDialog(topicOf(t.code)); toast('Link saved');
    } catch (err) { const m = d.querySelector('[data-msg]'); m.textContent = err.message; m.hidden = false; }
  });
}
