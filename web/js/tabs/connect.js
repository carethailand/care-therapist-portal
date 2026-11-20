// CARE Connect (Portal 058 layout): the CARE board first (badge news + kudos,
// with reactions), then a compact inbox and a folded "Share something" box.
// Messages: an idea, concern, question or thank-you to a team (Admin,
// Supervisor & QCD, Senior) or to one person — with your name or anonymously.
// Teams reply here within 5 working days. Thank-yous can go on the board once
// an admin approves them.
import {
  sendMessage, people as loadPeople, myMessages, visibleMessages, thread, reply, update, forward,
  kudosRequests, kudosDecide, boardFeed, boardReact, markSeen,
} from '../connect-data.js';
import { esc, fmtDate, todayLocal } from '../ui.js';
import { icon } from '../icons.js';
import { rankOf } from '../labels.js';
import { STICKERS, stickerImg, stickerSrc, ART_CREDIT } from '../stickers.js';
import { badgeInfo } from '../milestones.js';

// Problem and Concern are one kind now (Songg, 2026-11-20): new messages are
// "concern"; older "problem" messages show as Concern too.
const KIND = {
  idea: ['Idea', 'bulb'],
  concern: ['Concern', 'cloud-storm'],
  problem: ['Concern', 'cloud-storm'],
  question: ['Question', 'help-circle'],
  thanks: ['Thank you', 'heart-handshake'],
};
const WRITE_KINDS = ['idea', 'concern', 'question', 'thanks'];
const sameKind = (k) => (k === 'problem' ? 'concern' : k);
const TOPIC = {
  workplace: 'Workplace & facility', schedule: 'Schedule & sessions', pay: 'Pay & travel fee',
  training: 'Training & supervision', team: 'Team', other: 'Other',
};
const TO = { admin: 'Admin team', sup: 'Supervisor & QCD team', senior: 'Senior team', person: 'A person', both: 'Admin + Supervisor teams' };
const STATUS = { received: ['Received', ''], in_progress: ['Looking into it', 'warn'], resolved: ['Resolved', 'ok'] };
const REPLY_DAYS = 5;
// Reactions on the CARE board
const REACT = [['star', '⭐', 'Star'], ['heart', '❤️', 'Love'], ['like', '👍', 'Like'], ['rocket', '🚀', 'Rocket'], ['party', '🎉', 'Celebrate']];
const INBOX_SHOW = 5;   // inbox rows shown before "Show all"
const BOARD_PAGE = 15;  // board items per page

let ctx;
let panelEl;
let staff = [];   // [{ id, full_name, nickname }] current CARE staff (names only)

const has = (...r) => ctx.roles.some((x) => r.includes(x));
const nameOf = (id) => { const p = staff.find((x) => x.id === id); return p ? (p.nickname || p.full_name) : ''; };
const myName = () => ctx.me.nickname || ctx.me.full_name;
const toLabel = (m) => (m.send_to === 'person' ? (m.recipient_id === ctx.me.id ? 'you' : nameOf(m.recipient_id) || 'a colleague') : TO[m.send_to]);
const bkkDate = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
const when = (ts) => new Date(ts).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
const isStaff = () => ctx.me.track !== 'abat' && rankOf(ctx.roles) !== 'applicant';

// "today", "yesterday", "3 days ago", then the date
function ago(ts) {
  const days = Math.round((Date.parse(`${todayLocal()}T00:00:00`) - Date.parse(`${bkkDate(ts)}T00:00:00`)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return fmtDate(bkkDate(ts));
}

const toMe = (m) => m.send_to === 'person' && m.recipient_id === ctx.me.id;

function workingDaysSince(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const [ty, tm, td] = todayLocal().split('-').map(Number);
  const end = new Date(ty, tm - 1, td);
  let n = 0;
  for (let x = new Date(y, m - 1, d + 1); x <= end; x.setDate(x.getDate() + 1)) if (x.getDay() !== 0 && x.getDay() !== 6) n += 1;
  return n;
}
const waitingTooLong = (m) => m.status !== 'resolved' && !m.first_reply_at && m.send_to !== 'person'
  && workingDaysSince(bkkDate(m.created_at)) > REPLY_DAYS;

export async function render(panel, context) {
  ctx = context;
  panelEl = panel;
  board = { kind: 'all', items: [], seen: null, more: false };
  writeOpen = false;
  panel.innerHTML = `
    <div class="page-head"><h1 class="page-title">${icon('message-heart')} CARE Connect</h1></div>
    <p class="lead">CARE news, kudos, and your messages to the team. We read every message and reply within ${REPLY_DAYS} working days.</p>
    <div class="od-stack">
    ${has('admin', 'manager', 'supervisor') ? '<section class="card od-kudosq" id="od-kudosq" hidden></section>' : ''}
    ${isStaff() ? '<section class="card od-board" id="od-board"><p class="muted">Loading the CARE board…</p></section>' : ''}
    <div class="od-pair">
    <section class="card od-inboxes">
      ${myTeams().length ? `<div class="seg od-tabs" role="tablist" aria-label="Inboxes">
        <button type="button" role="tab" data-inbox="mine">My inbox</button>
        ${myTeams().map((t) => `<button type="button" role="tab" data-inbox="${t.key}">${esc(t.label)}<span class="od-tab-n" data-n="${t.key}"></span></button>`).join('')}
      </div>` : ''}
      <div class="od-panel" id="od-mine" data-panel="mine"><p class="muted">Loading…</p></div>
      ${myTeams().map((t) => `<div class="od-panel od-team" id="od-team-${t.key}" data-panel="${t.key}" hidden><p class="muted">Loading ${esc(t.label)}…</p></div>`).join('')}
    </section>
    <section class="card od-write" id="od-write"><p class="muted">Loading…</p></section>
    </div>
    </div>
    <dialog id="od-dlg" class="dlg od-dlg"></dialog>`;
  for (const b of panel.querySelectorAll('[data-inbox]')) b.addEventListener('click', () => showInbox(b.dataset.inbox));
  showInbox(inboxTab);
  try { staff = await loadPeople(); } catch { staff = []; }
  drawWrite();
  await refreshAll();
  // Opening CARE Connect clears the red dot on the tab.
  try { await markSeen(); } catch { /* not on Portal 058 yet */ }
  window.dispatchEvent(new CustomEvent('connect-seen'));
}

async function refreshAll() {
  let visible = [];
  try { visible = await visibleMessages(); } catch { visible = []; }
  await Promise.all([drawMine(visible), drawKudosQueue(), loadBoard()]);
  for (const t of myTeams()) drawTeam(t, visible.filter(t.match));
}

// Inboxes are tabs: My inbox, then each team inbox this person belongs to.
let inboxTab = 'mine';
function showInbox(key) {
  if (key !== 'mine' && !myTeams().some((t) => t.key === key)) key = 'mine';
  inboxTab = key;
  for (const b of panelEl.querySelectorAll('[data-inbox]')) b.setAttribute('aria-selected', String(b.dataset.inbox === key));
  for (const p of panelEl.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== key;
}

// The team inboxes this person has, in this order.
function myTeams() {
  return [
    { key: 'admin', label: 'Admin inbox', member: has('admin', 'hr'),
      match: (m) => ['admin', 'both'].includes(m.send_to) || (m.send_to === 'person' && !!m.forwarded_at) },
    { key: 'sup', label: 'Supervisor & QCD inbox', member: has('supervisor', 'qcd'),
      match: (m) => ['sup', 'both'].includes(m.send_to) },
    { key: 'senior', label: 'Senior inbox', member: has('senior'),
      match: (m) => m.send_to === 'senior' },
  ].filter((t) => t.member);
}

// ---------------------------------------------------------------------------
// The CARE board: badge news + kudos, newest first, with reactions
// ---------------------------------------------------------------------------
let board = { kind: 'all', items: [], seen: null, more: false };

async function loadBoard(older = false) {
  const box = panelEl.querySelector('#od-board');
  if (!box) return;
  try {
    const before = older && board.items.length ? board.items[board.items.length - 1].at : null;
    const res = await boardFeed(board.kind, BOARD_PAGE, before);
    const items = res?.items || [];
    if (!older) board.seen = res?.seen_at || null;
    board.items = older ? [...board.items, ...items] : items;
    board.more = items.length === BOARD_PAGE;
  } catch (e) {
    if (!older) board.items = [];
    board.error = e.message;
  }
  drawBoard();
}

function reactionsHtml(it) {
  const r = it.reactions || {};
  const me = myName();
  const names = REACT.filter(([k]) => r[k]?.length).map(([k, e]) => `${e} ${r[k].join(', ')}`);
  return `<div class="bd-react" role="group" aria-label="Reactions">
    ${REACT.map(([k, e, label]) => {
    const who = r[k] || [];
    const mine = who.includes(me);
    return `<button type="button" class="bd-r${mine ? ' on' : ''}${who.length ? '' : ' zero'}" data-react="${k}" aria-pressed="${mine}"
      title="${esc(who.length ? `${label}: ${who.join(', ')}` : label)}"><span aria-hidden="true">${e}</span>${who.length ? `<span class="bd-n">${who.length}</span>` : ''}<span class="sr-only">${label}</span></button>`;
  }).join('')}
    ${names.length ? '<button type="button" class="link bd-who-btn" data-who>Who reacted</button>' : ''}
  </div>
  ${names.length ? `<p class="muted small bd-who" hidden>${names.map(esc).join(' · ')}</p>` : ''}`;
}

function boardItemHtml(it) {
  const isNew = board.seen && Date.parse(it.at) > Date.parse(board.seen);
  const newTag = isNew ? ' <span class="chip stage bd-new">New</span>' : '';
  if (it.type === 'badge') {
    const b = badgeInfo(it.key);
    const mine = it.who_id === ctx.me.id;
    return `<li class="bd-item" data-type="badge" data-id="${esc(it.id)}">
      <img class="bd-art" src="${esc(b.img)}" alt="" width="56" height="56" loading="lazy">
      <div class="bd-main">
        <p class="bd-line"><strong>${mine ? 'You' : esc(it.who)}</strong> earned <strong>${esc(b.label)}</strong>${b.word ? ` · ${esc(b.word)}` : ''}${newTag}</p>
        ${b.about ? `<p class="muted small">${esc(b.about)}</p>` : ''}
        <p class="muted small">${it.given_by ? `Given by ${esc(it.given_by)} · ` : ''}${esc(ago(it.at))}</p>
        ${reactionsHtml(it)}
      </div>
    </li>`;
  }
  return `<li class="bd-item bd-kudos" data-type="kudos" data-id="${esc(it.id)}">
    ${it.sticker ? stickerImg(it.sticker, 'sticker bd-art') : `<span class="bd-art bd-icon">${icon('heart-handshake')}</span>`}
    <div class="bd-main">
      <p class="bd-line"><strong>Kudos</strong> to ${esc(it.to_name || 'everyone at CARE')}${newTag}</p>
      <p class="kudos-text">“${esc(it.kudos)}”</p>
      <p class="muted small">From ${esc(it.from_name || 'a teammate')} · ${esc(ago(it.at))}</p>
      ${reactionsHtml(it)}
    </div>
  </li>`;
}

function drawBoard() {
  const box = panelEl.querySelector('#od-board');
  if (!box) return;
  const empty = board.kind === 'kudos'
    ? 'No kudos yet. Send a thank-you below and tick "Ask Admin to post this on the board".'
    : board.kind === 'badge' ? 'No badge news yet. New badges will show up here.'
      : 'Nothing on the board yet. New badges and kudos will show up here.';
  box.innerHTML = `
    <div class="bd-head">
      <h2>${icon('sparkles')} CARE board</h2>
      <div class="seg" role="tablist" aria-label="Show">
        ${[['all', 'All'], ['badge', 'Badges'], ['kudos', 'Kudos']].map(([k, l]) =>
    `<button type="button" role="tab" data-bk="${k}" aria-selected="${board.kind === k}">${l}</button>`).join('')}
      </div>
    </div>
    ${board.error && !board.items.length ? `<p class="muted">The board isn't ready yet. ${esc(board.error)}</p>`
    : board.items.length ? `<ul class="bd-list">${board.items.map(boardItemHtml).join('')}</ul>` : `<p class="muted">${empty}</p>`}
    ${board.more ? '<p class="bd-more"><button type="button" data-older>Show older</button></p>' : ''}
    <p class="credit">${ART_CREDIT}</p>`;
  for (const b of box.querySelectorAll('[data-bk]')) {
    b.addEventListener('click', () => { if (board.kind !== b.dataset.bk) { board.kind = b.dataset.bk; loadBoard(); } });
  }
  box.querySelector('[data-older]')?.addEventListener('click', (e) => { e.target.disabled = true; loadBoard(true); });
  for (const li of box.querySelectorAll('.bd-item')) wireItem(li);
}

function wireItem(li) {
  const it = board.items.find((x) => x.id === li.dataset.id && x.type === li.dataset.type);
  if (!it) return;
  for (const btn of li.querySelectorAll('[data-react]')) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        it.reactions = await boardReact(it.type, it.id, btn.dataset.react);
        const holder = li.querySelector('.bd-main');
        for (const el of holder.querySelectorAll('.bd-react, .bd-who')) el.remove();
        holder.insertAdjacentHTML('beforeend', reactionsHtml(it));
        wireItem(li);
      } catch (e) { alert(e.message); btn.disabled = false; }
    });
  }
  li.querySelector('[data-who]')?.addEventListener('click', () => {
    const w = li.querySelector('.bd-who');
    if (w) w.hidden = !w.hidden;
  });
}

// ---------------------------------------------------------------------------
// Share something (folded until you pick what it is)
// ---------------------------------------------------------------------------
let writeOpen = false;
function drawWrite(kind = null) {
  const box = panelEl.querySelector('#od-write');
  box.classList.toggle('open', !!kind);
  writeOpen = !!kind;
  if (!kind) {
    box.innerHTML = `
      <h2>Share something</h2>
      <p class="muted small">An idea, a worry, a question, or a thank-you. Pick one to start.</p>
      <div class="od-kinds">
        ${WRITE_KINDS.map((k) => `<button type="button" data-start="${k}">${icon(KIND[k][1])}<span>${esc(KIND[k][0])}</span></button>`).join('')}
      </div>`;
    for (const b of box.querySelectorAll('[data-start]')) {
      b.addEventListener('click', () => {
        drawWrite(b.dataset.start);
        box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        box.querySelector('textarea')?.focus({ preventScroll: true });
      });
    }
    return;
  }
  const others = staff.filter((p) => p.id !== ctx.me.id);
  box.innerHTML = `
    <div class="od-write-head"><h2>Share something</h2><button type="button" class="link" data-act="fold">Cancel</button></div>
    <form class="od-form">
      <fieldset class="pills"><legend>What is it?</legend>
        ${WRITE_KINDS.map((k) => `
          <label class="pill"><input type="radio" name="kind" value="${k}"${k === kind ? ' checked' : ''}><span>${icon(KIND[k][1])} ${esc(KIND[k][0])}</span></label>`).join('')}
      </fieldset>
      <label>Topic
        <select name="topic">${Object.entries(TOPIC).map(([k, l]) => `<option value="${k}"${k === 'other' ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <fieldset class="pills"><legend>Send to</legend>
        ${['admin', 'sup', 'senior', 'person'].map((k) => `
          <label class="pill"><input type="radio" name="to" value="${k}"${k === 'admin' ? ' checked' : ''}><span>${esc(TO[k])}</span></label>`).join('')}
      </fieldset>
      <label data-person hidden>Who is it for?
        <select name="recipient"><option value="">Choose a person…</option>${others.map((p) => `<option value="${esc(p.id)}">${esc(p.nickname ? `${p.nickname} (${p.full_name})` : p.full_name)}</option>`).join('')}</select></label>
      <p class="muted small" data-tohint></p>
      <label>Your message
        <textarea name="body" rows="6" maxlength="4000" required placeholder="Tell us what's on your mind."></textarea></label>
      <p class="muted small">Please don't write a child's name. Use the 3-letter case code (e.g. ABC) if you need to.</p>
      <label class="check kudos-box" data-kudos hidden><input type="checkbox" name="kudos">
        <span><strong>Ask Admin to post this on the CARE board</strong><br>
        <span class="muted small">An admin reads it first and may tidy the wording. Everyone at CARE can then see it.</span></span></label>
      <label class="kudos-to-field" data-kudosto hidden>Who is this kudos for? <span class="muted small">(optional)</span>
        <input name="kudosTo" maxlength="80" placeholder="e.g. Pao and Ploy, the Monday team. Leave empty for everyone at CARE"></label>
      <fieldset class="sticker-pick" data-stickers hidden><legend>Add a sticker <span class="muted small">(optional)</span></legend>
        <label class="stk none"><input type="radio" name="sticker" value="" checked><span>No sticker</span></label>
        ${STICKERS.map((st) => `<label class="stk" title="${esc(st.label)}"><input type="radio" name="sticker" value="${esc(st.key)}"><img src="${stickerSrc(st.key)}" alt="${esc(st.label)}" width="256" height="256" loading="lazy"></label>`).join('')}
      </fieldset>
      <label class="check anon-box"><input type="checkbox" name="anon">
        <span><strong>Send without my name</strong><br>
        <span class="muted small" data-anonhint></span></span></label>
      <p class="msg" role="status" hidden></p>
      <p class="row-actions"><button type="button" data-act="fold">Cancel</button> <button type="submit" class="primary">Send</button></p>
    </form>`;
  for (const b of box.querySelectorAll('[data-act="fold"]')) b.addEventListener('click', () => drawWrite(null));
  const form = box.querySelector('form');
  const msg = form.querySelector('.msg');
  const ANON_HINT = 'Some things, like a travel fee or your own schedule, need your name so we can help. For anything else you can stay anonymous: nobody in the Portal (team, supervisors or admins) can see who sent it, and you\'ll see it with our reply in My inbox on any device.';
  const sync = () => {
    const k = form.kind.value;
    const to = form.to.value;
    form.querySelector('[data-person]').hidden = to !== 'person';
    form.querySelector('[data-tohint]').textContent = to === 'person'
      ? 'Only this person will see it. If it\'s a concern about someone, please send it to the Admin team instead.'
      : to === 'senior' ? 'Goes to all senior therapists.'
        : k === 'concern' && to !== 'admin' ? 'Something broken, or a safety problem? Send it to the Admin team so they can fix it.' : '';
    form.querySelector('[data-kudos]').hidden = k !== 'thanks';
    form.querySelector('[data-kudosto]').hidden = k !== 'thanks' || !form.kudos.checked;
    form.kudosTo.placeholder = to === 'person'
      ? 'e.g. Pao and Ploy. Leave empty to use the name of the person you chose'
      : 'e.g. Pao and Ploy, the Monday team. Leave empty for everyone at CARE';
    form.querySelector('[data-stickers]').hidden = k !== 'thanks';
    if (k !== 'thanks') {
      form.kudos.checked = false;
      form.querySelector('input[name="sticker"][value=""]').checked = true;
    }
    // To one person, anonymous is only for thank-yous.
    const anonBlocked = to === 'person' && k !== 'thanks';
    form.anon.disabled = anonBlocked;
    if (anonBlocked) form.anon.checked = false;
    form.querySelector('[data-anonhint]').textContent = anonBlocked
      ? 'Messages to one person carry your name (anonymous is only for thank-yous). To raise something anonymously, send it to a team.'
      : ANON_HINT;
  };
  form.addEventListener('change', sync);
  sync();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = form.body.value.trim();
    const say = (t, k = 'error') => { msg.hidden = false; msg.dataset.kind = k; msg.textContent = t; };
    if (!body) return say('Please write your message.');
    if (form.to.value === 'person' && !form.recipient.value) return say('Choose who the message is for.');
    const btn = form.querySelector('[type="submit"]');
    const wasAnon = form.anon.checked;
    btn.disabled = true;
    try {
      const res = await sendMessage({
        kind: form.kind.value, topic: form.topic.value, sendTo: form.to.value, body,
        anonymous: form.anon.checked, recipient: form.recipient.value, kudos: form.kudos.checked, kudosTo: form.kudosTo.value.trim(),
        sticker: form.kind.value === 'thanks' ? (form.sticker.value || null) : null,
      });
      drawWrite(null);
      const done = document.createElement('p');
      done.className = 'msg'; done.dataset.kind = 'ok'; done.setAttribute('role', 'status');
      done.textContent = res && wasAnon
        ? 'Sent without your name. It\'s in My inbox, where only you can see it\'s yours.'
        : 'Sent. Thank you for telling us.';
      box.append(done);
      await refreshAll();
    } catch (e) {
      say(e.message);
      btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Inbox lists (one line per message)
// ---------------------------------------------------------------------------
function rowHtml(m, { mode = 'mine' } = {}) {
  const [kl, ki] = KIND[m.kind];
  const [sl, sc] = STATUS[m.status];
  const who = mode === 'mine' ? `to ${toLabel(m)}`
    : mode === 'to-me' ? `from ${m.anonymous ? 'someone (anonymous)' : (nameOf(m.sender_id) || 'Staff')}`
      : `from ${m.anonymous ? 'Anonymous' : (nameOf(m.sender_id) || 'Staff')}`;
  const extra = [
    m.anonymous && mode === 'mine' ? 'anonymous' : '',
    m.kudos_status === 'requested' ? 'board: waiting for Admin' : m.kudos_status === 'posted' ? 'on the board 🎉' : '',
    mode === 'team' && m.forwarded_at ? 'passed on' : '',
    mode === 'team' && m.assigned_to ? `${nameOf(m.assigned_to) || 'someone'} is on it` : '',
  ].filter(Boolean).join(' · ');
  return `<li class="od-row od-compact" data-open="${esc(m.id)}" data-viewer="${mode === 'mine' ? 'sender' : mode === 'to-me' ? 'recipient' : 'team'}" tabindex="0" role="button">
    <span class="od-kind">${m.sticker ? stickerImg(m.sticker, 'sticker sm') : icon(ki)}</span>
    <span class="od-main">
      <span class="od-snip"><strong>${esc(kl)}</strong> · ${esc(m.body.slice(0, 140))}</span>
      <span class="muted small od-meta">${esc(fmtDate(bkkDate(m.created_at)))} · ${esc(who)}${extra ? ` · ${esc(extra)}` : ''}</span>
    </span>
    <span class="od-side">
      ${mode === 'to-me' ? '<span class="chip stage">To you</span>' : ''}
      ${mode === 'team' && waitingTooLong(m) ? `<span class="chip warn">Over ${REPLY_DAYS} days</span>` : ''}
      <span class="chip ${sc}">${esc(sl)}</span>
    </span>
  </li>`;
}

// A list that shows the first few rows, then "Show all (N)".
function shortList(rows, key) {
  if (!rows.length) return '';
  const open = expanded.has(key);
  const shown = open ? rows : rows.slice(0, INBOX_SHOW);
  return `<ul class="od-list">${shown.join('')}</ul>
    ${rows.length > INBOX_SHOW ? `<p class="od-all"><button type="button" class="link" data-all="${key}">${open ? 'Show fewer' : `Show all (${rows.length})`}</button></p>` : ''}`;
}
const expanded = new Set();
function wireShowAll(box, redraw) {
  for (const b of box.querySelectorAll('[data-all]')) {
    b.addEventListener('click', () => {
      const k = b.dataset.all;
      if (expanded.has(k)) expanded.delete(k); else expanded.add(k);
      redraw();
    });
  }
}

let mineCache = null;
async function drawMine(visible) {
  const box = panelEl.querySelector('#od-mine');
  let sent = [];
  try { sent = await myMessages(); } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const toMeList = visible.filter(toMe);
  mineCache = [...sent.map((m) => ({ m, mode: 'mine' })), ...toMeList.map((m) => ({ m, mode: 'to-me' }))]
    .sort((a, b) => String(b.m.created_at).localeCompare(String(a.m.created_at)));
  paintMine();
}
function paintMine() {
  const box = panelEl.querySelector('#od-mine');
  const all = mineCache || [];
  box.innerHTML = `${myTeams().length ? '' : '<h2>My inbox</h2>'}
    ${all.length ? shortList(all.map((x) => rowHtml(x.m, { mode: x.mode })), 'mine')
    : '<p class="muted">Messages you send, and messages sent to you personally, show up here with their replies.</p>'}`;
  wireOpen(box, all.map((x) => x.m));
  wireShowAll(box, paintMine);
}

const filters = {}; // per inbox: { status, kind }
function drawTeam(team, list) {
  const box = panelEl.querySelector(`#od-team-${team.key}`);
  const f = (filters[team.key] ??= { status: 'open', kind: '' });
  const open = list.filter((m) => m.status !== 'resolved');
  const late = open.filter(waitingTooLong).length;
  const shown = list.filter((m) => (f.status === 'all' || (f.status === 'open' ? m.status !== 'resolved' : m.status === 'resolved'))
    && (!f.kind || sameKind(m.kind) === f.kind));
  const n = panelEl.querySelector(`[data-n="${team.key}"]`);
  if (n) n.innerHTML = open.length ? ` <span class="chip${late ? ' warn' : ''}">${open.length}</span>` : '';
  box.innerHTML = `
    <div class="page-head od-team-head">
      <p class="muted small">${open.length ? `${open.length} open` : 'Nothing open'}${late ? ` · <strong>${late} waiting over ${REPLY_DAYS} days</strong>` : ''}</p>
      <span class="spacer"></span>
      <select data-f="kind" aria-label="Kind"><option value="">All kinds</option>${WRITE_KINDS.map((k) => `<option value="${k}"${f.kind === k ? ' selected' : ''}>${esc(KIND[k][0])}</option>`).join('')}</select>
      <select data-f="status" aria-label="Show">
        <option value="open"${f.status === 'open' ? ' selected' : ''}>Open</option>
        <option value="resolved"${f.status === 'resolved' ? ' selected' : ''}>Resolved</option>
        <option value="all"${f.status === 'all' ? ' selected' : ''}>All</option>
      </select>
    </div>
    ${shown.length ? shortList(shown.map((m) => rowHtml(m, { mode: 'team' })), `team-${team.key}`) : '<p class="muted">Nothing here.</p>'}`;
  for (const sel of box.querySelectorAll('select[data-f]')) {
    sel.addEventListener('change', () => { f[sel.dataset.f] = sel.value; drawTeam(team, list); });
  }
  wireOpen(box, list);
  wireShowAll(box, () => drawTeam(team, list));
}

function wireOpen(box, list) {
  for (const li of box.querySelectorAll('[data-open]')) {
    const go = () => openThread(list.find((m) => m.id === li.dataset.open), li.dataset.viewer);
    li.addEventListener('click', go);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  }
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------
function convoHtml(m, replies, viewer) {
  const [kl] = KIND[m.kind];
  const from = viewer === 'sender' ? (m.anonymous ? 'You (sent anonymously)' : 'You')
    : m.anonymous ? 'Anonymous' : (nameOf(m.sender_id) || 'Staff');
  return `
    <article class="od-msg">
      <p class="muted small">${esc(kl)} · ${esc(TOPIC[m.topic])} · to ${esc(toLabel(m))} · ${esc(fmtDate(bkkDate(m.created_at)))}</p>
      <p class="od-from">${esc(from)}</p>
      ${m.sticker ? stickerImg(m.sticker, 'sticker lg') : ''}
      <p class="od-body">${esc(m.body)}</p>
    </article>
    ${replies.map((r) => `
      <article class="od-reply ${r.author_kind === 'team' ? 'from-team' : 'from-sender'}${r.internal ? ' internal' : ''}">
        <p class="muted small">${r.internal ? '🔒 Internal note · ' : ''}${esc(r.author_kind === 'team' ? (r.author || 'CARE team') : (viewer === 'sender' ? 'You' : (r.author || 'Sender')))} · ${esc(r.author_kind === 'sender' && m.anonymous ? fmtDate(bkkDate(r.created_at)) : when(r.created_at))}</p>
        <p class="od-body">${esc(r.body)}</p>
      </article>`).join('') || '<p class="muted small">No replies yet.</p>'}`;
}

// viewer: 'sender' (my own message), 'recipient' (sent to me), 'team'
async function openThread(m, viewer) {
  const dlg = panelEl.querySelector('#od-dlg');
  dlg.innerHTML = '<p class="muted">Loading…</p>';
  if (!dlg.open) dlg.showModal();
  let replies;
  try { replies = await thread(m.id); } catch (e) { dlg.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const answering = viewer === 'team' || viewer === 'recipient';
  const canNote = viewer === 'team';
  const shownStatus = m.status;
  const shownAssigned = m.assigned_to || null;
  const teamPeople = viewer === 'team' ? staff : [];
  dlg.innerHTML = `
    <div class="od-thread">${convoHtml(m, replies, viewer)}</div>
    <form class="od-replyform">
      <label>${answering ? 'Reply' : 'Add to the conversation'}
        <textarea name="body" rows="3" maxlength="4000"></textarea></label>
      ${canNote ? '<label class="check"><input type="checkbox" name="internal"> <span>Internal note (team only, the sender won\'t see it)</span></label>' : ''}
      ${answering ? `<div class="grid2">
          <label>Status <select name="status">${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}"${m.status === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          ${viewer === 'team' ? `<label>Looked after by <select name="assigned"><option value="">Nobody yet</option>${teamPeople.map((p) => `<option value="${esc(p.id)}"${m.assigned_to === p.id ? ' selected' : ''}>${esc(p.nickname || p.full_name)}</option>`).join('')}</select></label>` : ''}
        </div>` : ''}
      ${viewer === 'recipient' && !m.forwarded_at ? '<p><button type="button" class="link" data-act="forward">Pass this to the Admin team</button> <span class="muted small">if it needs action or isn\'t OK.</span></p>' : ''}
      ${viewer === 'recipient' && m.forwarded_at ? '<p class="muted small">You passed this to the Admin team.</p>' : ''}
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions"><span class="spacer"></span>
        <button type="button" data-act="close">Close</button>
        <button type="submit" class="primary">${answering ? 'Save' : 'Send'}</button></div>
    </form>`;
  const form = dlg.querySelector('form');
  const msg = form.querySelector('.msg');
  form.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  form.querySelector('[data-act="forward"]')?.addEventListener('click', async () => {
    if (!confirm('Pass this message to the Admin team? They will be able to read it and the replies.')) return;
    try { await forward(m.id); dlg.close(); await refreshAll(); } catch (e) { msg.hidden = false; msg.dataset.kind = 'error'; msg.textContent = e.message; }
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = form.body.value.trim();
    try {
      if (body) await reply(m.id, body, canNote && form.internal.checked);
      if (answering) {
        const status = form.status.value;
        const assigned = form.assigned ? form.assigned.value : shownAssigned;
        const statusChanged = status !== shownStatus;
        const assignChanged = (assigned || null) !== shownAssigned;
        if (statusChanged || assignChanged) {
          await update(m.id, {
            status: statusChanged ? status : null,
            assigned: assignChanged ? (assigned || null) : null,
            unassign: assignChanged && !assigned,
          });
        }
      } else if (!body) { msg.hidden = false; msg.dataset.kind = 'error'; msg.textContent = 'Please write something first.'; return; }
      dlg.close();
      await refreshAll();
    } catch (e) { msg.hidden = false; msg.dataset.kind = 'error'; msg.textContent = e.message; }
  });
}

// ---------------------------------------------------------------------------
// Kudos waiting for the board (Admin, Portal manager, Supervisors): a small bar
// that opens the list.
// ---------------------------------------------------------------------------
let queueOpen = false;
async function drawKudosQueue() {
  const box = panelEl.querySelector('#od-kudosq');
  if (!box) return;
  let list = [];
  try { list = await kudosRequests(); } catch { return; }
  box.hidden = !list.length;
  if (!list.length) { queueOpen = false; return; }
  box.innerHTML = `
    <div class="kq-bar">
      <span>${icon('heart-handshake')} <strong>Kudos waiting for the board</strong> <span class="chip warn">${list.length}</span></span>
      <button type="button" data-toggle>${queueOpen ? 'Close' : 'Review'}</button>
    </div>
    <div class="kq-list"${queueOpen ? '' : ' hidden'}>
    <p class="muted small">Check who it’s for and tidy the wording if needed, then post it. Everyone at CARE will see it. Leave “To” empty for everyone at CARE.</p>
    ${list.map((k) => `
      <div class="kudos-q" data-k="${esc(k.id)}">
        <p class="muted small">From ${esc(k.sender || 'a teammate (anonymous)')} · sent to ${esc(k.recipient || TO[k.send_to] || 'the team')} · ${esc(fmtDate(bkkDate(k.created_at)))}</p>
        <label class="kudos-q-to">On the board it says “To …”
          <input data-to maxlength="80" value="${esc(k.kudos_to || '')}" placeholder="${esc(k.recipient || 'everyone at CARE')}"></label>
        <div class="kudos-q-body">${stickerImg(k.sticker, 'sticker md')}<textarea rows="3" maxlength="600">${esc(k.body)}</textarea></div>
        <p class="row-actions"><button type="button" class="small-btn" data-no>Not for the board</button>
          <button type="button" class="small-btn primary" data-post>Post on the board</button></p>
      </div>`).join('')}
    </div>`;
  box.querySelector('[data-toggle]').addEventListener('click', (e) => {
    queueOpen = !queueOpen;
    box.querySelector('.kq-list').hidden = !queueOpen;
    e.target.textContent = queueOpen ? 'Close' : 'Review';
  });
  for (const el of box.querySelectorAll('.kudos-q')) {
    const go = async (post) => {
      try { await kudosDecide(el.dataset.k, post, el.querySelector('textarea').value, el.querySelector('[data-to]').value.trim()); await refreshAll(); } catch (e) { alert(e.message); }
    };
    el.querySelector('[data-post]').addEventListener('click', () => go(true));
    el.querySelector('[data-no]').addEventListener('click', () => go(false));
  }
}

// Used by Home (latest kudos)
export function kudosCardHtml(k) {
  return `<li class="kudos-card${k.sticker ? ' has-sticker' : ''}">
    ${stickerImg(k.sticker, 'sticker kudos-stk')}
    <p class="kudos-to">To ${esc(k.to_name || k.to_team || 'everyone at CARE')}</p>
    <p class="kudos-text">“${esc(k.kudos)}”</p>
    <p class="muted small">From ${esc(k.from_name || 'a teammate')} · ${esc(fmtDate(bkkDate(k.posted_at)))}</p>
  </li>`;
}
