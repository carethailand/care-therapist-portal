// Leave & HR tab: my leave balance, request form, my requests; for HR/admin
// the request inbox (approve / decline, families notified) and each person's
// annual leave allowance. Children appear only as case codes (e.g. "ABC").
import {
  loadLeaveRef, loadMyLeave, submitLeave, editLeave, cancelLeave, requestCancel, withdrawCancel, decideCancel, staffPicklist, countDays, daysUntil, FIVE_DAY_RANKS,
  loadTeamLeave, decideLeave, markNotified, saveEntitlement, arrangeSession,
} from '../leave-data.js';
import { listStaff } from '../data.js';
import { esc, fmtDate, todayLocal } from '../ui.js';
import { rankOf, RANK_LABEL } from '../labels.js';
import { icon } from '../icons.js';

const STATUS = {
  pending: ['Waiting for HR', 'warn'],
  approved: ['Approved', 'ok'],
  declined: ['Declined', ''],
  cancelled: ['Cancelled', ''],
};

let ctx;
let panelEl;
let ref;          // { types, kinds }
let year;
let picklist = []; // [{ id, full_name, nickname }]

const isHR = () => ctx.roles.includes('hr');
const isAdmin = () => ctx.roles.includes('admin');
const isLeaveTeam = () => isHR() || isAdmin();
const nameOf = (list, id) => {
  const p = list.find((x) => x.id === id);
  return p ? (p.nickname || p.full_name) : '';
};
const typeLabel = (code) => ref.types.find((t) => t.code === code)?.label ?? code;
const kindLabel = (code) => ref.kinds.find((k) => k.code === code)?.label ?? code;
const fmtDays = (n) => `${Number(n)} day${Number(n) === 1 ? '' : 's'}`;
const range = (r) => (r.start_date === r.end_date
  ? `${fmtDate(r.start_date)}${r.half_day ? ` (${r.half_day === 'am' ? 'morning' : 'afternoon'})` : ''}`
  : `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}`);

export async function render(panel, context) {
  ctx = context;
  panelEl = panel;
  year = year ?? Number(todayLocal().slice(0, 4));
  panel.innerHTML = '<p class="muted">Loading…</p>';
  try {
    [ref, picklist] = await Promise.all([loadLeaveRef(), staffPicklist()]);
  } catch (e) {
    panel.innerHTML = `<section class="card"><p class="error">Could not load leave: ${esc(e.message)}</p></section>`;
    return;
  }
  await draw();
}

async function draw() {
  const thisYear = Number(todayLocal().slice(0, 4));
  panelEl.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Leave</h1>
      <select id="lv-year" aria-label="Year">${[thisYear - 1, thisYear, thisYear + 1].map((y) => `<option${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select>
    </div>
    <div id="lv-mine"><p class="muted">Loading…</p></div>
    ${isLeaveTeam() ? '<div id="lv-team"></div>' : ''}
    <dialog id="lv-dlg" class="dlg leave-dlg"></dialog>`;
  panelEl.querySelector('#lv-year').addEventListener('change', (e) => { year = Number(e.target.value); draw(); });
  await drawMine();
  if (isLeaveTeam()) await drawTeam();
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------
function balances(ent, requests) {
  const today = todayLocal();
  const sum = (code, status, kind) => requests
    .filter((r) => r.type === code && r.status === status && (!kind || r.kind === kind))
    .reduce((t, r) => t + Number(r.days), 0);
  return ref.types.map((t) => {
    let allowance = t.max_days != null ? Number(t.max_days) : null;
    let carry = 0;
    if (t.per_person) {
      if (!ent) allowance = null;
      else {
        carry = ent.carry_over_until && ent.carry_over_until < today ? 0 : Number(ent.carry_over_days || 0);
        allowance = Number(ent.al_days) + carry;
      }
    }
    return {
      ...t,
      allowance,
      carry,
      used: sum(t.code, 'approved'),
      waiting: sum(t.code, 'pending'),
      kinds: t.needs_kind
        ? ref.kinds.map((k) => ({ ...k, used: sum(t.code, 'approved', k.code) })).filter((k) => k.used > 0)
        : [],
    };
  });
}

function balanceHtml(bal, ent, perPersonMissingText) {
  return `<div class="balances">${bal.map((b) => {
    const left = b.allowance != null ? b.allowance - b.used : null;
    // Compact summary tile: big code + days left on top, the full name small underneath.
    return `<div class="bal" title="${esc(b.label)}">
      <div class="bal-top">
        <p class="bal-code">${esc(b.code)}</p>
        ${b.per_person && b.allowance == null ? ''
          : b.allowance != null
            ? `<p class="bal-num" aria-label="${left} of ${b.allowance} days left"><strong>${left}</strong><span> / ${b.allowance}<span class="bal-left"> left</span></span></p>`
            : `<p class="bal-num" aria-label="${b.used} days used"><strong>${b.used}</strong><span> used</span></p>`}
      </div>
      <p class="bal-label">${esc(b.label)}</p>
      ${b.per_person && b.allowance == null
        ? `<p class="muted small">${esc(perPersonMissingText)}</p>`
        : b.allowance != null
          ? `<div class="progress"><span style="width:${b.allowance ? Math.min(100, Math.round((b.used / b.allowance) * 100)) : 0}%"></span></div>`
          : ''}
      ${b.waiting ? `<p class="small warn-text">${b.waiting} waiting for HR</p>` : ''}
      ${b.carry ? `<p class="muted small">Includes ${b.carry} carried over${ent?.carry_over_until ? `, use by ${esc(fmtDate(ent.carry_over_until))}` : ''}</p>` : ''}
      ${b.kinds.map((k) => `<p class="muted small">${esc(k.label)}: ${k.used} of ${k.max_days}</p>`).join('')}
    </div>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Mine
// ---------------------------------------------------------------------------
async function drawMine() {
  const box = panelEl.querySelector('#lv-mine');
  let mine;
  try {
    mine = await loadMyLeave(ctx.me.id, year);
  } catch (e) {
    box.innerHTML = `<section class="card"><p class="error">${esc(e.message)}</p></section>`;
    return;
  }
  const bal = balances(mine.entitlement, mine.requests);
  box.innerHTML = `
    <section class="card">
      <div class="page-head">
        <h2>My leave ${year}</h2>
        <span class="spacer"></span>
        <button type="button" data-act="print-mine">${icon('file-text')} Save form as PDF</button>
        <button type="button" class="primary" data-act="new">+ Request leave</button>
      </div>
      ${balanceHtml(bal, mine.entitlement, `Your ${year} annual leave hasn't been set yet. HR will add it.`)}
    </section>
    <section class="card">
      <h2>My requests</h2>
      ${mine.requests.length ? `<ul class="lv-list">${mine.requests.map((r) => requestRow(r, { mine: true })).join('')}</ul>`
        : `<p class="muted">No leave requested for ${year} yet.</p>`}
    </section>`;
  box.querySelector('[data-act="new"]').addEventListener('click', () => requestDialog(bal));
  box.querySelector('[data-act="print-mine"]').addEventListener('click', () =>
    printForm({ ...ctx.me, roles: ctx.roles }, mine.entitlement, mine.requests, picklist));
  for (const b of box.querySelectorAll('[data-editreq]')) {
    b.addEventListener('click', () => requestDialog(bal, mine.requests.find((r) => r.id === b.dataset.editreq)));
  }
  for (const b of box.querySelectorAll('[data-cancel]')) {
    b.addEventListener('click', async () => {
      if (!confirm('Cancel this leave request?')) return;
      try { await cancelLeave(b.dataset.cancel); await drawMine(); } catch (e) { alert(e.message); }
    });
  }
  for (const b of box.querySelectorAll('[data-askcancel]')) {
    b.addEventListener('click', async () => {
      const reason = prompt('This leave is already approved, so Admin / HR will decide. Why do you want to cancel it?');
      if (reason === null) return;
      try { await requestCancel(b.dataset.askcancel, reason); await drawMine(); if (isLeaveTeam()) await drawTeam(); } catch (e) { alert(e.message); }
    });
  }
  for (const b of box.querySelectorAll('[data-withdraw]')) {
    b.addEventListener('click', async () => {
      if (!confirm('Withdraw your cancel request and keep this leave?')) return;
      try { await withdrawCancel(b.dataset.withdraw); await drawMine(); if (isLeaveTeam()) await drawTeam(); } catch (e) { alert(e.message); }
    });
  }
}

function sessionsText(r, people) {
  if (!r.sessions?.length) return '';
  return `<ul class="lv-sessions">${r.sessions.map((s) => `<li><strong>${esc(s.case_code)}</strong> · ${esc(fmtDate(s.session_date))}${s.session_time ? ` ${esc(s.session_time)}` : ''} → ${esc(arrangementText(s, people))}</li>`).join('')}</ul>`;
}

function arrangementText(s, people) {
  if (s.cover_kind === 'cover') return `covered by ${nameOf(people, s.covering_therapist_id) || 'a colleague'}`;
  if (s.cover_kind === 'makeup') return `make-up ${fmtDate(s.makeup_date)}${s.makeup_time ? ` ${s.makeup_time}` : ''}`;
  if (s.cover_kind === 'cancelled') return 'cancelled';
  return 'waiting for admin';
}
const unarranged = (r) => r.sessions.filter((s) => !s.cover_kind).length;

function requestRow(r, { mine = false, people = picklist, team = false } = {}) {
  const [label, cls] = STATUS[r.status];
  const who = team ? `<strong>${esc(nameOf(people, r.therapist_id) || 'Unknown')}</strong> · ` : '';
  return `<li class="lv-row">
    <div class="lv-main">
      <p class="lv-title">${who}<span class="chip">${esc(r.type)}</span> ${esc(r.type === 'OL' ? kindLabel(r.kind) : typeLabel(r.type))} · ${esc(fmtDays(r.days))}</p>
      <p class="muted small">${esc(range(r))}${r.reason ? ` · ${esc(r.reason)}` : ''}</p>
      ${sessionsText(r, people)}
      ${r.status === 'pending' && r.edited_at ? `<p class="small muted">✏️ Changed ${esc(fmtDate(String(r.edited_at).slice(0, 10)))}</p>` : ''}
      ${r.decision_note ? `<p class="small">HR note: ${esc(r.decision_note)}</p>` : ''}
      ${r.status === 'approved' && r.cancel_requested_at ? `<p class="small lv-cancelreq">🙋 ${mine ? 'You asked' : 'Asked'} to cancel ${esc(fmtDate(String(r.cancel_requested_at).slice(0, 10)))}${r.cancel_reason ? `: “${esc(r.cancel_reason)}”` : ''}</p>` : ''}
      ${r.cancel_note ? `<p class="small">${r.status === 'cancelled' ? 'Cancel approved' : 'Leave kept'}: ${esc(r.cancel_note)}</p>` : ''}
      ${r.status === 'approved' ? `<p class="small muted">Approved ${esc(fmtDate(String(r.decided_at).slice(0, 10)))}${nameOf(people, r.decided_by) ? ` by ${esc(nameOf(people, r.decided_by))}` : ''}${r.families_notified_on ? ` · families notified ${esc(fmtDate(r.families_notified_on))}` : r.sessions?.length ? ' · families not yet notified' : ''}</p>` : ''}
    </div>
    <div class="lv-side">
      <span class="chip ${cls}">${esc(label)}</span>
      ${r.status === 'approved' && r.sessions?.length
        ? (r.families_notified_on ? '<span class="chip ok">Families notified ✓</span>' : '<span class="chip warn">Families: to notify</span>') : ''}
      ${mine && r.status === 'pending' ? `<button type="button" class="small-btn" data-editreq="${esc(r.id)}">Edit</button><button type="button" class="small-btn" data-cancel="${esc(r.id)}">Cancel</button>` : ''}
      ${mine && r.status === 'approved' && r.cancel_requested_at ? `<span class="chip warn">Cancel requested</span><button type="button" class="link small" data-withdraw="${esc(r.id)}">Keep my leave</button>` : ''}
      ${mine && r.status === 'approved' && !r.cancel_requested_at && r.end_date >= todayLocal() ? `<button type="button" class="small-btn" data-askcancel="${esc(r.id)}">Ask to cancel</button>` : ''}
      ${team ? teamActions(r) : ''}
    </div>
  </li>`;
}

// ---------------------------------------------------------------------------
// Request form
// ---------------------------------------------------------------------------
// editing = a pending request to change (Portal 057), or nothing for a new one.
function requestDialog(bal, editing = null) {
  const dlg = panelEl.querySelector('#lv-dlg');
  const fiveDay = FIVE_DAY_RANKS.includes(rankOf(ctx.roles));
  const today = todayLocal();
  dlg.innerHTML = `
    <form method="dialog" class="person-form">
      <h2>${editing ? 'Change my leave request' : 'Request leave'}</h2>
      ${editing ? '<p class="muted small">You can change this until HR decides. HR will see that it was changed.</p>' : ''}
      <div class="grid2">
        <label>Type of leave
          <select name="type" required>${ref.types.map((t) => `<option value="${esc(t.code)}">${esc(t.code)} · ${esc(t.label)}</option>`).join('')}</select></label>
        <label data-kind hidden>Which specific leave?
          <select name="kind">${ref.kinds.map((k) => `<option value="${esc(k.code)}">${esc(k.label)} (up to ${k.max_days} days)</option>`).join('')}</select></label>
      </div>
      <p class="hint muted small" data-kindnote hidden>Specific leave needs discussion and approval from the Center Manager in advance.</p>
      <label>Reason <input name="reason" maxlength="300" placeholder="e.g. family visit"></label>
      <div class="grid2">
        <label>First day <input name="start" type="date" required value="${today}"></label>
        <label>Last day <input name="end" type="date" required value="${today}"></label>
      </div>
      <div class="grid2">
        <label data-half>Half day?
          <select name="half"><option value="">Full day</option><option value="am">Morning only</option><option value="pm">Afternoon only</option></select></label>
        <label>Number of leave days <input name="days" type="number" min="0.5" step="0.5" required></label>
      </div>
      <p class="muted small">${fiveDay
        ? 'Counted Monday to Friday (your 5-day week). If you were scheduled on a Saturday inside these dates, add it. Change the number for public holidays too.'
        : 'Counted Monday to Saturday (Sundays skipped). Change it if a public holiday falls inside.'}</p>
      <p class="msg" data-warn hidden></p>

      <fieldset>
        <legend>Sessions you'll miss</legend>
        <p class="muted small">List each session you'll miss. An admin will decide what happens to it: <strong>cancelled</strong>, <strong>covered</strong> by a colleague, or a <strong>make-up</strong> session.
          Use the <strong>3-letter case code only</strong> (e.g. ABC), never a child's name.</p>
        <div data-sessions></div>
        <button type="button" class="small-btn" data-addsession>+ Add a session</button>
      </fieldset>

      <details class="small muted"><summary>The 4 steps (CARE leave policy)</summary>
        <ol>
          <li>Discuss with your team or the scheduler, and fill in who covers your sessions or your make-up sessions.</li>
          <li>Submit this form to HR (at least 2 weeks before your first day of leave).</li>
          <li>Once approved, the families are notified.</li>
          <li>You inform the families about your leave and who will cover your sessions.</li>
        </ol></details>

      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions"><span class="spacer"></span>
        <button type="button" data-act="cancel">Cancel</button>
        <button type="submit" class="primary">${editing ? 'Save changes' : 'Send to HR'}</button></div>
    </form>`;
  const form = dlg.querySelector('form');
  const warn = form.querySelector('[data-warn]');
  const msg = form.querySelector('.msg[role="status"]');
  let daysTouched = false;

  const refresh = () => {
    const t = ref.types.find((x) => x.code === form.type.value);
    form.querySelector('[data-kind]').hidden = !t?.needs_kind;
    form.querySelector('[data-kindnote]').hidden = !t?.needs_kind;
    if (form.end.value < form.start.value) form.end.value = form.start.value;
    const single = form.start.value === form.end.value;
    form.querySelector('[data-half]').hidden = !single;
    if (!single) form.half.value = '';
    if (!daysTouched) form.days.value = countDays(form.start.value, form.end.value, form.half.value, fiveDay) || '';
    const notes = [];
    const lead = daysUntil(form.start.value, todayLocal());
    if (t?.notice_days && lead < t.notice_days) notes.push(`⚠️ Leave should be requested at least ${t.notice_days} days before the first day (this is ${lead < 0 ? 'in the past' : `${lead} day${lead === 1 ? '' : 's'} away`}). You can still send it.`);
    const b = bal.find((x) => x.code === t?.code);
    const want = Number(form.days.value || 0);
    const waiting = (b?.waiting || 0) - (editing && editing.type === t?.code ? Number(editing.days) : 0);   // don't count this request twice
    if (b?.allowance != null && b.used + waiting + want > b.allowance) {
      notes.push(`⚠️ This is more than your remaining ${t.code} (${Math.max(0, b.allowance - b.used - waiting)} left, counting requests waiting for HR).`);
    }
    if (t?.needs_kind) {
      const k = ref.kinds.find((x) => x.code === form.kind.value);
      if (k && want > k.max_days) notes.push(`⚠️ ${k.label} leave is up to ${k.max_days} days.`);
    }
    warn.textContent = notes.join(' ');
    warn.hidden = !notes.length;
  };
  for (const n of ['type', 'kind', 'start', 'end', 'half']) form[n].addEventListener('change', refresh);
  form.days.addEventListener('input', () => { daysTouched = true; refresh(); });

  const box = form.querySelector('[data-sessions]');
  const addSession = (s = null) => {
    const row = document.createElement('div');
    row.className = 'session-row';
    row.innerHTML = `
      <input name="case" placeholder="ABC" maxlength="3" minlength="3" pattern="[A-Z]{3}" required aria-label="Case code (3 letters)" title="3-letter case code, e.g. ABC" class="case-input" value="${esc(s?.case_code || '')}">
      <input name="sdate" type="date" required aria-label="Session date" value="${esc(s?.session_date || form.start.value)}">
      <input name="stime" placeholder="10:15–12:15" maxlength="20" aria-label="Session time" value="${esc(s?.session_time || '')}">
      <button type="button" class="small-btn" aria-label="Remove session">✕</button>`;
    row.querySelector('button').addEventListener('click', () => row.remove());
    row.querySelector('[name="case"]').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3); });
    box.append(row);
  };
  form.querySelector('[data-addsession]').addEventListener('click', () => addSession());
  if (editing) {                                         // fill the form with the request being changed
    form.type.value = editing.type; if (editing.kind) form.kind.value = editing.kind;
    form.reason.value = editing.reason || ''; form.start.value = editing.start_date; form.end.value = editing.end_date;
    form.half.value = editing.half_day || ''; form.days.value = Number(editing.days);
    daysTouched = Number(editing.days) !== countDays(editing.start_date, editing.end_date, editing.half_day || '', fiveDay);   // keep a number they typed
    for (const s of editing.sessions || []) addSession(s);
  }
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const t = ref.types.find((x) => x.code === form.type.value);
    const sessions = [];
    for (const row of box.querySelectorAll('.session-row')) {
      const g = (n) => row.querySelector(`[name="${n}"]`).value.trim();
      if (!/^[A-Z]{3}$/.test(g('case'))) { msg.hidden = false; msg.dataset.kind = 'error'; msg.textContent = 'Each session needs a 3-letter case code (e.g. ABC).'; return; }
      sessions.push({ case_code: g('case'), session_date: g('sdate'), session_time: g('stime') || null });
    }
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const req = {
        therapist_id: ctx.me.id, type: t.code, kind: t.needs_kind ? form.kind.value : null,
        reason: form.reason.value.trim() || null, start_date: form.start.value, end_date: form.end.value,
        half_day: form.half.value || null, days: Number(form.days.value),
      };
      if (editing) await editLeave(editing.id, req, sessions);
      else await submitLeave(req, sessions);
      dlg.close();
      await drawMine();
      if (isLeaveTeam()) await drawTeam();
    } catch (e) {
      msg.hidden = false; msg.dataset.kind = 'error'; msg.textContent = e.message; btn.disabled = false;
    }
  });
  refresh();
  dlg.showModal();
}

// ---------------------------------------------------------------------------
// HR / admin
// ---------------------------------------------------------------------------
let teamFilter = 'pending';

function teamActions(r) {
  const out = [];
  if (r.status === 'pending' && (isHR() || isAdmin())) {
    out.push(`<button type="button" class="small-btn primary" data-approve="${esc(r.id)}">Approve</button>`);
    out.push(`<button type="button" class="small-btn" data-decline="${esc(r.id)}">Decline</button>`);
  }
  if (isAdmin() && ['pending', 'approved'].includes(r.status) && r.sessions?.length) {
    const n = unarranged(r);
    out.push(`<button type="button" class="small-btn" data-arrange="${esc(r.id)}">${n ? `Arrange sessions (${n})` : 'Change sessions'}</button>`);
  }
  if (r.status === 'approved' && isAdmin() && !r.families_notified_on && r.sessions?.length) {
    out.push(`<button type="button" class="small-btn" data-notified="${esc(r.id)}">Families notified</button>`);
  }
  if (r.status === 'approved' && r.cancel_requested_at) {
    out.push(`<button type="button" class="small-btn primary" data-cancelok="${esc(r.id)}">Approve cancel</button>`);
    out.push(`<button type="button" class="small-btn" data-cancelno="${esc(r.id)}">Keep leave</button>`);
  } else if (r.status === 'approved') out.push(`<button type="button" class="link small" data-tcancel="${esc(r.id)}">Cancel leave</button>`);
  return out.join('');
}

async function drawTeam() {
  const box = panelEl.querySelector('#lv-team');
  box.innerHTML = '<section class="card"><p class="muted">Loading team leave…</p></section>';
  let people;
  let data;
  try {
    [people, data] = await Promise.all([listStaff(), loadTeamLeave(year)]);
  } catch (e) {
    box.innerHTML = `<section class="card"><p class="error">${esc(e.message)}</p></section>`;
    return;
  }
  const staff = people.filter((p) => p.status !== 'exited' && p.track !== 'abat' && rankOf(p.roles) !== 'applicant');
  const shown = data.requests.filter((r) => teamFilter === 'all' || r.status === teamFilter
    || ((teamFilter === 'cancelreq' || teamFilter === 'pending') && r.status === 'approved' && r.cancel_requested_at)
    || (teamFilter === 'notify' && r.status === 'approved' && !r.families_notified_on && r.sessions.length)
    || (teamFilter === 'arrange' && ['pending', 'approved'].includes(r.status) && unarranged(r) > 0));
  const waiting = data.requests.filter((r) => r.status === 'pending').length;
  const cancelReqs = data.requests.filter((r) => r.status === 'approved' && r.cancel_requested_at).length;

  box.innerHTML = `
    <section class="card">
      <div class="page-head">
        <h2>Team requests ${waiting ? `<span class="chip warn">${waiting} waiting</span>` : ''}${cancelReqs ? ` <span class="chip warn">${cancelReqs} to cancel</span>` : ''}</h2>
        <select id="lv-filter" aria-label="Show">
          <option value="pending"${teamFilter === 'pending' ? ' selected' : ''}>Waiting for HR</option>
          <option value="cancelreq"${teamFilter === 'cancelreq' ? ' selected' : ''}>Cancel requests${cancelReqs ? ` (${cancelReqs})` : ''}</option>
          <option value="arrange"${teamFilter === 'arrange' ? ' selected' : ''}>Sessions to arrange</option>
          <option value="notify"${teamFilter === 'notify' ? ' selected' : ''}>Families not yet notified</option>
          <option value="approved"${teamFilter === 'approved' ? ' selected' : ''}>Approved</option>
          <option value="all"${teamFilter === 'all' ? ' selected' : ''}>All ${year}</option>
        </select>
      </div>
      ${shown.length ? `<ul class="lv-list">${shown.map((r) => requestRow(r, { people, team: true })).join('')}</ul>` : '<p class="muted">Nothing here.</p>'}
    </section>
    <section class="card">
      <h2>Annual leave allowances ${year}</h2>
      <p class="muted small">Set each person's annual leave (AL) for ${year}. It depends on how long they've worked at CARE.</p>
      <div class="table-wrap"><table class="team-table">
        <thead><tr><th>Person</th><th>Joined</th><th>AL days</th><th>Carried over</th><th>AL used</th><th></th></tr></thead>
        <tbody>${staff.map((p) => {
          const ent = data.entitlements.find((e) => e.therapist_id === p.id);
          const used = data.requests.filter((r) => r.therapist_id === p.id && r.type === 'AL' && r.status === 'approved').reduce((t, r) => t + Number(r.days), 0);
          return `<tr>
            <td><strong>${esc(p.nickname || p.full_name)}</strong>${p.employee_no ? ` <span class="muted small">${esc(p.employee_no)}</span>` : ''}</td>
            <td>${esc(fmtDate(p.start_date))}</td>
            <td>${ent ? Number(ent.al_days) : '<span class="warn-text">Not set</span>'}</td>
            <td>${ent && Number(ent.carry_over_days) ? `${Number(ent.carry_over_days)}${ent.carry_over_until ? ` <span class="muted small">until ${esc(fmtDate(ent.carry_over_until))}</span>` : ''}` : '—'}</td>
            <td>${used}</td>
            <td class="nowrap"><button type="button" class="small-btn" data-ent="${esc(p.id)}">Edit</button>
              <button type="button" class="small-btn" data-print="${esc(p.id)}" aria-label="Save leave form as PDF">${icon('file-text')}</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>`;

  box.querySelector('#lv-filter').addEventListener('change', (e) => { teamFilter = e.target.value; drawTeam(); });
  const act = async (fn) => { try { await fn(); await drawTeam(); } catch (e) { alert(e.message); } };
  for (const b of box.querySelectorAll('[data-approve]')) b.addEventListener('click', () => act(() => decideLeave(b.dataset.approve, true, prompt('Note for the therapist (optional):') || null)));
  for (const b of box.querySelectorAll('[data-decline]')) {
    b.addEventListener('click', () => {
      const note = prompt('Why is this declined? (The therapist will see this note.)');
      if (note === null) return;
      act(() => decideLeave(b.dataset.decline, false, note));
    });
  }
  for (const b of box.querySelectorAll('[data-arrange]')) {
    b.addEventListener('click', () => arrangeDialog(data.requests.find((r) => r.id === b.dataset.arrange), people));
  }
  for (const b of box.querySelectorAll('[data-notified]')) {
    b.addEventListener('click', () => {
      const r = data.requests.find((x) => x.id === b.dataset.notified);
      if (unarranged(r) && !confirm(`${unarranged(r)} session(s) aren't arranged yet. Mark the families as notified anyway?`)) return;
      const d = prompt('Date the families were notified (YYYY-MM-DD):', todayLocal());
      if (d === null) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { alert('Please use the format YYYY-MM-DD.'); return; }
      act(() => markNotified(b.dataset.notified, d));
    });
  }
  for (const b of box.querySelectorAll('[data-cancelok]')) {
    b.addEventListener('click', () => {
      if (!confirm('Approve the cancel? The leave is cancelled and the days come back to their balance.')) return;
      act(() => decideCancel(b.dataset.cancelok, true, prompt('Note for the therapist (optional):') || null));
    });
  }
  for (const b of box.querySelectorAll('[data-cancelno]')) {
    b.addEventListener('click', () => {
      const note = prompt('Why does the leave stay? (The therapist will see this note.)');
      if (note === null) return;
      act(() => decideCancel(b.dataset.cancelno, false, note));
    });
  }
  for (const b of box.querySelectorAll('[data-tcancel]')) {
    b.addEventListener('click', () => { if (confirm('Cancel this approved leave?')) act(() => cancelLeave(b.dataset.tcancel)); });
  }
  for (const b of box.querySelectorAll('[data-ent]')) {
    b.addEventListener('click', () => entitlementDialog(people.find((p) => p.id === b.dataset.ent), data.entitlements.find((e) => e.therapist_id === b.dataset.ent)));
  }
  for (const b of box.querySelectorAll('[data-print]')) {
    b.addEventListener('click', () => {
      const p = people.find((x) => x.id === b.dataset.print);
      printForm(p, data.entitlements.find((e) => e.therapist_id === p.id), data.requests.filter((r) => r.therapist_id === p.id), people);
    });
  }
}

// Admin: decide what happens to each missed session.
function arrangeDialog(r, people) {
  const dlg = panelEl.querySelector('#lv-dlg');
  const who = nameOf(people, r.therapist_id);
  const staff = people.filter((p) => p.id !== r.therapist_id && p.status !== 'exited' && p.track !== 'abat'
    && ['therapist', 'senior', 'qcd', 'supervisor'].some((x) => p.roles.includes(x)));
  const options = (sel) => staff.map((p) => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.nickname ? `${p.nickname} (${p.full_name})` : p.full_name)}</option>`).join('');
  dlg.innerHTML = `
    <form method="dialog" class="person-form">
      <h2>Missed sessions: ${esc(who)}</h2>
      <p class="muted small">${esc(r.type)} · ${esc(range(r))}. Decide what happens to each session.</p>
      ${r.sessions.map((s) => `
        <div class="arrange-row" data-sid="${esc(s.id)}">
          <p class="arrange-what"><strong>${esc(s.case_code)}</strong> · ${esc(fmtDate(s.session_date))}${s.session_time ? ` · ${esc(s.session_time)}` : ''}</p>
          <div class="arrange-how">
            <select name="kind" aria-label="What happens">
              <option value=""${!s.cover_kind ? ' selected' : ''}>Not decided yet</option>
              <option value="cancelled"${s.cover_kind === 'cancelled' ? ' selected' : ''}>Cancelled</option>
              <option value="cover"${s.cover_kind === 'cover' ? ' selected' : ''}>Covered by</option>
              <option value="makeup"${s.cover_kind === 'makeup' ? ' selected' : ''}>Make-up session</option>
            </select>
            <select name="who" aria-label="Covering therapist"><option value="">Choose…</option>${options(s.covering_therapist_id)}</select>
            <input name="mdate" type="date" aria-label="Make-up date" value="${esc(s.makeup_date ?? '')}">
            <input name="mtime" placeholder="Make-up time" maxlength="20" aria-label="Make-up time" value="${esc(s.makeup_time ?? '')}">
          </div>
        </div>`).join('')}
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions"><span class="spacer"></span>
        <button type="button" data-act="cancel">Cancel</button>
        <button type="submit" class="primary">Save</button></div>
    </form>`;
  const form = dlg.querySelector('form');
  const show = (row) => {
    const k = row.querySelector('[name="kind"]').value;
    row.querySelector('[name="who"]').hidden = k !== 'cover';
    row.querySelector('[name="mdate"]').hidden = k !== 'makeup';
    row.querySelector('[name="mtime"]').hidden = k !== 'makeup';
  };
  for (const row of form.querySelectorAll('.arrange-row')) {
    show(row);
    row.querySelector('[name="kind"]').addEventListener('change', () => show(row));
  }
  form.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = form.querySelector('.msg');
    const btn = form.querySelector('[type="submit"]');
    const changes = [];
    for (const row of form.querySelectorAll('.arrange-row')) {
      const s = r.sessions.find((x) => x.id === row.dataset.sid);
      const g = (n) => row.querySelector(`[name="${n}"]`).value.trim();
      const kind = g('kind') || null;
      if (kind === 'cover' && !g('who')) { msg.hidden = false; msg.dataset.kind = 'error'; msg.textContent = `Choose who covers ${s.case_code} on ${fmtDate(s.session_date)}.`; return; }
      if (kind === 'makeup' && !g('mdate')) { msg.hidden = false; msg.dataset.kind = 'error'; msg.textContent = `Give the make-up date for ${s.case_code}.`; return; }
      const next = { kind, cover: kind === 'cover' ? g('who') : null, mdate: kind === 'makeup' ? g('mdate') : null, mtime: kind === 'makeup' ? (g('mtime') || null) : null };
      const same = (s.cover_kind || null) === next.kind && (s.covering_therapist_id || null) === next.cover
        && (s.makeup_date || null) === next.mdate && (s.makeup_time || null) === next.mtime;
      if (!same) changes.push([s.id, next]);
    }
    btn.disabled = true;
    try {
      for (const [id, n] of changes) await arrangeSession(id, n.kind, n.cover, n.mdate, n.mtime);
      dlg.close();
      await drawTeam();
    } catch (e) {
      msg.hidden = false; msg.dataset.kind = 'error'; msg.textContent = e.message; btn.disabled = false;
    }
  });
  dlg.showModal();
}

function entitlementDialog(p, ent) {
  const dlg = panelEl.querySelector('#lv-dlg');
  dlg.innerHTML = `
    <form method="dialog" class="person-form">
      <h2>Annual leave ${year}: ${esc(p.nickname || p.full_name)}</h2>
      <p class="muted small">Joined ${esc(fmtDate(p.start_date))}</p>
      <label>Annual leave (AL) days for ${year} <input name="al" type="number" min="0" step="0.5" required value="${esc(ent?.al_days ?? '')}"></label>
      <div class="grid2">
        <label>Days carried over from ${year - 1} <input name="carry" type="number" min="0" step="0.5" value="${esc(ent?.carry_over_days ?? 0)}"></label>
        <label>Carried-over days must be used by <input name="until" type="date" value="${esc(ent?.carry_over_until ?? `${year}-03-31`)}"></label>
      </div>
      <p class="muted small">Carry-over is for the admin team only (CARE policy).</p>
      <label>Note (optional) <input name="note" maxlength="200" value="${esc(ent?.note ?? '')}"></label>
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
      await saveEntitlement({
        therapist_id: p.id, year, al_days: Number(form.al.value), carry_over_days: Number(form.carry.value || 0),
        carry_over_until: Number(form.carry.value || 0) ? (form.until.value || null) : null,
        note: form.note.value.trim() || null, updated_by: ctx.me.id, updated_at: new Date().toISOString(),
      });
      dlg.close();
      await drawTeam();
    } catch (e) {
      const m = form.querySelector('.msg'); m.hidden = false; m.dataset.kind = 'error'; m.textContent = e.message;
    }
  });
  dlg.showModal();
}

// ---------------------------------------------------------------------------
// The year's leave form, laid out like the paper one (Save as PDF)
// ---------------------------------------------------------------------------
function printForm(person, ent, requests, people) {
  const rows = requests.filter((r) => r.status !== 'cancelled').slice().sort((a, b) => a.start_date.localeCompare(b.start_date));
  const totals = ref.types.map((t) => ({
    code: t.code,
    days: requests.filter((r) => r.type === t.code && r.status === 'approved').reduce((s, r) => s + Number(r.days), 0),
  }));
  const rank = rankOf(person.roles || []);
  const html = `
    <article class="leave-form">
      <h2>Leave Request Form of ${year}</h2>
      <table class="lf-head"><tr>
        <td>Name: <strong>${esc(person.full_name)}</strong></td>
        <td>Emp. No: <strong>${esc(person.employee_no || '—')}</strong></td>
        <td>Joined on: <strong>${esc(fmtDate(person.start_date))}</strong></td></tr><tr>
        <td colspan="3">Position: <strong>${esc(rank ? RANK_LABEL[rank] : '—')}</strong></td></tr></table>
      <p class="small">Annual leave entitlement ${year}: <strong>${ent ? Number(ent.al_days) : '—'}</strong> days${ent && Number(ent.carry_over_days) ? ` (+ ${Number(ent.carry_over_days)} carried over, use by ${esc(fmtDate(ent.carry_over_until))})` : ''}
        · Total leave taken: ${totals.map((t) => `${esc(t.code)} ${t.days}`).join(' · ')}</p>
      <table class="lf-table">
        <thead><tr><th>Submitted</th><th>Type</th><th>Reason</th><th>Start</th><th>End</th><th>Days</th><th>Sessions (case · date · time → arranged)</th><th>Status · approved by / date</th><th>Families notified</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${esc(fmtDate(String(r.submitted_at).slice(0, 10)))}</td>
          <td>${esc(r.type)}${r.kind ? ` (${esc(kindLabel(r.kind))})` : ''}</td>
          <td>${esc(r.reason || '')}</td>
          <td>${esc(fmtDate(r.start_date))}${r.half_day ? ` ${r.half_day === 'am' ? 'am' : 'pm'}` : ''}</td>
          <td>${esc(fmtDate(r.end_date))}</td>
          <td>${Number(r.days)}</td>
          <td>${r.sessions.map((s) => `${esc(s.case_code)} · ${esc(fmtDate(s.session_date))} ${esc(s.session_time || '')} → ${esc(arrangementText(s, people))}`).join('<br>') || '—'}</td>
          <td>${esc(STATUS[r.status][0])}${r.decided_at ? ` · ${esc(nameOf(people, r.decided_by))} ${esc(fmtDate(String(r.decided_at).slice(0, 10)))}` : ''}</td>
          <td>${r.families_notified_on ? `${esc(fmtDate(r.families_notified_on))}${r.notified_by ? ` · ${esc(nameOf(people, r.notified_by))}` : ''}` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="9">No leave recorded.</td></tr>'}</tbody>
      </table>
      <p class="small muted">CARE Therapist Portal · printed ${esc(fmtDate(todayLocal()))}</p>
    </article>`;
  const area = document.getElementById('print-area');
  area.innerHTML = html;
  const page = document.createElement('style');
  page.textContent = '@page { size: A4 landscape; margin: 10mm; }';
  document.head.append(page);
  const oldTitle = document.title;
  document.title = `Leave ${year} - ${person.full_name}`;
  const done = () => { area.innerHTML = ''; page.remove(); document.title = oldTitle; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}
