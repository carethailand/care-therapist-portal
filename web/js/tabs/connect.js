// CARE Connect: send an idea, concern, problem, question or thank-you to a
// team (Admin, Supervisor & QCD, Senior) or to one person — with your name or
// anonymously. Teams reply here within 5 working days. Thank-yous can go on
// the Kudos board once an admin approves them.
import {
  sendMessage, people as loadPeople, myMessages, visibleMessages, thread, reply, update, forward,
  kudosRequests, kudosDecide, kudosBoard,
} from '../connect-data.js';
import { esc, fmtDate, todayLocal } from '../ui.js';
import { icon } from '../icons.js';
import { rankOf } from '../labels.js';
import { STICKERS, stickerImg, stickerSrc, ART_CREDIT } from '../stickers.js';

const KIND = {
  idea: ['Idea', 'bulb'],
  concern: ['Concern', 'cloud-storm'],
  problem: ['Problem', 'tool'],
  question: ['Question', 'help-circle'],
  thanks: ['Thank you', 'heart-handshake'],
};
const TOPIC = {
  workplace: 'Workplace & facility', schedule: 'Schedule & sessions', pay: 'Pay & travel fee',
  training: 'Training & supervision', team: 'Team', other: 'Other',
};
const TO = { admin: 'Admin team', sup: 'Supervisor & QCD team', senior: 'Senior team', person: 'A person', both: 'Admin + Supervisor teams' };
const STATUS = { received: ['Received', ''], in_progress: ['Looking into it', 'warn'], resolved: ['Resolved', 'ok'] };
const REPLY_DAYS = 5;

let ctx;
let panelEl;
let staff = [];   // [{ id, full_name, nickname }] current CARE staff (names only)

const has = (...r) => ctx.roles.some((x) => r.includes(x));
const nameOf = (id) => { const p = staff.find((x) => x.id === id); return p ? (p.nickname || p.full_name) : ''; };
const toLabel = (m) => (m.send_to === 'person' ? (m.recipient_id === ctx.me.id ? 'you' : nameOf(m.recipient_id) || 'a colleague') : TO[m.send_to]);
const bkkDate = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
const when = (ts) => new Date(ts).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
const isStaff = () => ctx.me.track !== 'abat' && rankOf(ctx.roles) !== 'applicant';

// Same rule as the database (private.connect_visible), for sorting into inboxes.
function teamSees(m) {
  return (['admin', 'both'].includes(m.send_to) && has('admin', 'hr'))
    || (['sup', 'both'].includes(m.send_to) && has('supervisor', 'qcd'))
    || (m.send_to === 'senior' && has('senior'))
    || (m.send_to === 'person' && !!m.forwarded_at && has('admin', 'hr'));
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
  panel.innerHTML = `
    <div class="page-head"><h1 class="page-title">${icon('message-heart')} CARE Connect</h1></div>
    <p class="lead">Share anything with the team: an idea, a worry, a problem, a question, or a thank-you.
      We read every message and reply within ${REPLY_DAYS} working days.</p>
    <div class="od-stack">
    <section class="card" id="od-write"><p class="muted">Loading…</p></section>
    ${isStaff() ? '<section class="card" id="od-board"></section>' : ''}
    ${has('admin', 'manager', 'supervisor') ? '<section class="card" id="od-kudosq" hidden></section>' : ''}
    <section class="card od-inboxes">
      ${myTeams().length ? `<div class="seg od-tabs" role="tablist" aria-label="Inboxes">
        <button type="button" role="tab" data-inbox="mine">My inbox</button>
        ${myTeams().map((t) => `<button type="button" role="tab" data-inbox="${t.key}">${esc(t.label)}<span class="od-tab-n" data-n="${t.key}"></span></button>`).join('')}
      </div>` : ''}
      <div class="od-panel" id="od-mine" data-panel="mine"><p class="muted">Loading…</p></div>
      ${myTeams().map((t) => `<div class="od-panel od-team" id="od-team-${t.key}" data-panel="${t.key}" hidden><p class="muted">Loading ${esc(t.label)}…</p></div>`).join('')}
    </section>
    </div>
    <dialog id="od-dlg" class="dlg od-dlg"></dialog>`;
  for (const b of panel.querySelectorAll('[data-inbox]')) b.addEventListener('click', () => showInbox(b.dataset.inbox));
  showInbox(inboxTab);
  try { staff = await loadPeople(); } catch { staff = []; }
  drawWrite();
  await refreshAll();
}

async function refreshAll() {
  let visible = [];
  try { visible = await visibleMessages(); } catch { visible = []; }
  await Promise.all([drawMine(visible), drawKudosQueue(), drawBoard()]);
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
// Write a message
// ---------------------------------------------------------------------------
function drawWrite() {
  const box = panelEl.querySelector('#od-write');
  const others = staff.filter((p) => p.id !== ctx.me.id);
  box.innerHTML = `
    <h2>Write a message</h2>
    <form class="od-form">
      <fieldset class="pills"><legend>What is it?</legend>
        ${Object.entries(KIND).map(([k, [label, ic]], i) => `
          <label class="pill"><input type="radio" name="kind" value="${k}"${i === 0 ? ' checked' : ''}><span>${icon(ic)} ${esc(label)}</span></label>`).join('')}
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
        <span><strong>Ask Admin to post this on the Kudos board</strong><br>
        <span class="muted small">An admin reads it first and may tidy the wording. Everyone at CARE can then see it.</span></span></label>
      <fieldset class="sticker-pick" data-stickers hidden><legend>Add a sticker <span class="muted small">(optional)</span></legend>
        <label class="stk none"><input type="radio" name="sticker" value="" checked><span>No sticker</span></label>
        ${STICKERS.map((st) => `<label class="stk" title="${esc(st.label)}"><input type="radio" name="sticker" value="${esc(st.key)}"><img src="${stickerSrc(st.key)}" alt="${esc(st.label)}" width="256" height="256" loading="lazy"></label>`).join('')}
      </fieldset>
      <label class="check anon-box"><input type="checkbox" name="anon">
        <span><strong>Send without my name</strong><br>
        <span class="muted small" data-anonhint>Some things, like a travel fee or your own schedule, need your name so we can help. For anything else you can stay anonymous: nobody in the Portal (team, supervisors or admins) can see who sent it, and you'll see it with our reply in your Personal inbox on any device.</span></span></label>
      <p class="msg" role="status" hidden></p>
      <p><button type="submit" class="primary">Send</button></p>
    </form>`;
  const form = box.querySelector('form');
  const msg = form.querySelector('.msg');
  const sync = () => {
    const kind = form.kind.value;
    // Problems always go to the Admin team.
    for (const r of form.querySelectorAll('input[name="to"]')) {
      r.disabled = kind === 'problem' && r.value !== 'admin';
      if (r.disabled && r.checked) form.querySelector('input[name="to"][value="admin"]').checked = true;
    }
    const to = form.to.value;
    form.querySelector('[data-person]').hidden = to !== 'person';
    form.querySelector('[data-tohint]').textContent = kind === 'problem'
      ? 'Problems (facility, equipment, safety) go to the Admin team, who can fix them.'
      : to === 'person' ? 'Only this person will see it. If it\'s a concern about someone, please send it to the Admin team instead.'
        : to === 'senior' ? 'Goes to all senior therapists.' : '';
    form.querySelector('[data-kudos]').hidden = kind !== 'thanks';
    form.querySelector('[data-stickers]').hidden = kind !== 'thanks';
    if (kind !== 'thanks') {
      form.kudos.checked = false;
      form.querySelector('input[name="sticker"][value=""]').checked = true;
    }
    // To one person, anonymous is only for thank-yous.
    const anonBlocked = to === 'person' && kind !== 'thanks';
    form.anon.disabled = anonBlocked;
    if (anonBlocked) form.anon.checked = false;
    form.querySelector('[data-anonhint]').textContent = anonBlocked
      ? 'Messages to one person carry your name (anonymous is only for thank-yous). To raise something anonymously, send it to a team.'
      : 'Some things, like a travel fee or your own schedule, need your name so we can help. For anything else you can stay anonymous: nobody in the Portal (team, supervisors or admins) can see who sent it, and you\'ll see it with our reply in your Personal inbox on any device.';
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
        anonymous: form.anon.checked, recipient: form.recipient.value, kudos: form.kudos.checked,
        sticker: form.kind.value === 'thanks' ? (form.sticker.value || null) : null,
      });
      form.reset();
      sync();
      say(res && wasAnon
        ? 'Sent without your name. It\'s in your Personal inbox, where only you can see it\'s yours.'
        : 'Sent. Thank you for telling us.', 'ok');
      await refreshAll();
    } catch (e) {
      say(e.message);
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------
function rowHtml(m, { mode = 'mine' } = {}) {
  const [kl, ki] = KIND[m.kind];
  const [sl, sc] = STATUS[m.status];
  const from = mode === 'mine' ? '' : ` · <span class="muted">${m.anonymous ? 'Anonymous' : esc(nameOf(m.sender_id) || 'Staff')}</span>`;
  const tag = mode === 'mine' ? '<span class="chip">Sent</span>' : mode === 'to-me' ? '<span class="chip stage">To you</span>' : '';
  const extra = [
    m.anonymous && mode === 'mine' ? 'sent anonymously (only you can see it\'s yours)' : '',
    m.kudos_status === 'requested' ? 'kudos board: waiting for Admin' : m.kudos_status === 'posted' ? 'on the Kudos board 🎉' : '',
    mode === 'team' && m.forwarded_at ? 'passed on by the recipient' : '',
    mode === 'team' && m.assigned_to ? `${nameOf(m.assigned_to) || 'someone'} is on it` : '',
  ].filter(Boolean).join(' · ');
  return `<li class="od-row" data-open="${esc(m.id)}" data-viewer="${mode === 'mine' ? 'sender' : mode === 'to-me' ? 'recipient' : 'team'}" tabindex="0" role="button">
    <span class="od-kind">${m.sticker ? stickerImg(m.sticker, 'sticker sm') : icon(ki)}</span>
    <span class="od-main">
      <span class="od-title">${esc(kl)} · ${esc(TOPIC[m.topic])}${from}</span>
      <span class="od-snip muted small">${esc(m.body.slice(0, 120))}${m.body.length > 120 ? '…' : ''}</span>
      <span class="muted small">${esc(fmtDate(bkkDate(m.created_at)))} · to ${esc(toLabel(m))}${extra ? ` · ${esc(extra)}` : ''}</span>
    </span>
    <span class="od-side">
      ${tag}
      <span class="chip ${sc}">${esc(sl)}</span>
      ${mode === 'team' && waitingTooLong(m) ? `<span class="chip warn">Over ${REPLY_DAYS} working days</span>` : ''}
    </span>
  </li>`;
}

async function drawMine(visible) {
  const box = panelEl.querySelector('#od-mine');
  let sent = [];
  try { sent = await myMessages(); } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const toMeList = visible.filter(toMe);
  const all = [...sent.map((m) => ({ m, mode: 'mine' })), ...toMeList.map((m) => ({ m, mode: 'to-me' }))]
    .sort((a, b) => String(b.m.created_at).localeCompare(String(a.m.created_at)));
  box.innerHTML = `${myTeams().length ? '' : '<h2>My inbox</h2>'}
    ${all.length ? `<ul class="od-list">${all.map((x) => rowHtml(x.m, { mode: x.mode })).join('')}</ul>`
      : '<p class="muted">Messages you send, and messages sent to you personally, appear here with their replies.</p>'}`;
  wireOpen(box, all.map((x) => x.m));
}

const filters = {}; // per inbox: { status, kind }
function drawTeam(team, list) {
  const box = panelEl.querySelector(`#od-team-${team.key}`);
  const f = (filters[team.key] ??= { status: 'open', kind: '' });
  const open = list.filter((m) => m.status !== 'resolved');
  const late = open.filter(waitingTooLong).length;
  const shown = list.filter((m) => (f.status === 'all' || (f.status === 'open' ? m.status !== 'resolved' : m.status === 'resolved'))
    && (!f.kind || m.kind === f.kind));
  const n = panelEl.querySelector(`[data-n="${team.key}"]`);
  if (n) n.innerHTML = open.length ? ` <span class="chip${late ? ' warn' : ''}">${open.length}</span>` : '';
  box.innerHTML = `
    <div class="page-head od-team-head">
      <p class="muted small">${open.length ? `${open.length} open` : 'Nothing open'}${late ? ` · <strong>${late} waiting over ${REPLY_DAYS} days</strong>` : ''}</p>
      <span class="spacer"></span>
      <select data-f="kind" aria-label="Kind"><option value="">All kinds</option>${Object.entries(KIND).map(([k, [l]]) => `<option value="${k}"${f.kind === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <select data-f="status" aria-label="Show">
        <option value="open"${f.status === 'open' ? ' selected' : ''}>Open</option>
        <option value="resolved"${f.status === 'resolved' ? ' selected' : ''}>Resolved</option>
        <option value="all"${f.status === 'all' ? ' selected' : ''}>All</option>
      </select>
    </div>
    ${shown.length ? `<ul class="od-list">${shown.map((m) => rowHtml(m, { mode: 'team' })).join('')}</ul>` : '<p class="muted">Nothing here.</p>'}`;
  for (const sel of box.querySelectorAll('select[data-f]')) {
    sel.addEventListener('change', () => { f[sel.dataset.f] = sel.value; drawTeam(team, list); });
  }
  wireOpen(box, list);
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
// Kudos: admin approval queue + the board
// ---------------------------------------------------------------------------
async function drawKudosQueue() {
  const box = panelEl.querySelector('#od-kudosq');
  if (!box) return;
  let list = [];
  try { list = await kudosRequests(); } catch { return; }
  box.hidden = !list.length;
  if (!list.length) return;
  box.innerHTML = `<h2>Kudos waiting for the board <span class="chip warn">${list.length}</span></h2>
    <p class="muted small">Tidy the wording if needed, then post it. Everyone at CARE will see it.</p>
    ${list.map((k) => `
      <div class="kudos-q" data-k="${esc(k.id)}">
        <p class="muted small">From ${esc(k.sender || 'a teammate (anonymous)')} · to ${esc(k.recipient || TO[k.send_to] || 'the team')} · ${esc(fmtDate(bkkDate(k.created_at)))}</p>
        <div class="kudos-q-body">${stickerImg(k.sticker, 'sticker md')}<textarea rows="3" maxlength="600">${esc(k.body)}</textarea></div>
        <p class="row-actions"><button type="button" class="small-btn" data-no>Not for the board</button>
          <button type="button" class="small-btn primary" data-post>Post on the board</button></p>
      </div>`).join('')}`;
  for (const el of box.querySelectorAll('.kudos-q')) {
    const go = async (post) => {
      try { await kudosDecide(el.dataset.k, post, el.querySelector('textarea').value); await refreshAll(); } catch (e) { alert(e.message); }
    };
    el.querySelector('[data-post]').addEventListener('click', () => go(true));
    el.querySelector('[data-no]').addEventListener('click', () => go(false));
  }
}

export function kudosCardHtml(k) {
  return `<li class="kudos-card${k.sticker ? ' has-sticker' : ''}">
    ${stickerImg(k.sticker, 'sticker kudos-stk')}
    <p class="kudos-to">To ${esc(k.to_name || k.to_team || 'the team')}</p>
    <p class="kudos-text">“${esc(k.kudos)}”</p>
    <p class="muted small">From ${esc(k.from_name || 'a teammate')} · ${esc(fmtDate(bkkDate(k.posted_at)))}</p>
  </li>`;
}

async function drawBoard() {
  const box = panelEl.querySelector('#od-board');
  if (!box) return;
  let list = [];
  try { list = await kudosBoard(60); } catch { list = []; }
  box.innerHTML = `<h2>${icon('heart-handshake')} Kudos board</h2>
    ${list.length ? `<ul class="kudos-list">${list.map(kudosCardHtml).join('')}</ul>`
      : '<p class="muted">No kudos yet. Send a thank-you and tick "Ask Admin to post this on the Kudos board".</p>'}
    <p class="credit">${ART_CREDIT}</p>`;
}
