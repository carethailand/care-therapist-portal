// Staff record exports (admin/HR).
//   openRecord()     one person's full record, shown on screen, then
//                    "Save as PDF / Print" through the browser's print window.
//   exportEveryone() admin only: every person + every timeline entry as one
//                    Excel file, as a backup (the free Supabase plan has no
//                    downloadable backups).
// These files hold staff personal data. Save them to CARE's Google Drive,
// never into the GitHub repo.
import { loadEvents } from '../data.js';
import { esc, fmtDate, todayLocal } from '../ui.js';
import { stageLabel, trackLabel, rolesText, statusLabel } from '../labels.js';

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';

const displayName = (p) => (p ? (p.nickname ? `${p.nickname} (${p.full_name})` : p.full_name) : '');
const nameOf = (people, id) => (id ? displayName(people.find((x) => x.id === id)) || 'Someone no longer listed' : '');
const details = (d) => (d && Object.keys(d).length ? JSON.stringify(d) : '');
// A timestamp from the server is UTC; show the Bangkok calendar date.
const bkkDate = (ts) => (ts ? new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }) : '');
const nowStamp = () => new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });

// ---------------------------------------------------------------------------
// One person's record
// ---------------------------------------------------------------------------
export async function openRecord(p, { people, me, host }) {
  let dlg = host.querySelector('#rec-dlg');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'rec-dlg';
    dlg.className = 'dlg';
    host.append(dlg);
  }
  dlg.innerHTML = '<p class="muted">Loading record…</p>';
  dlg.showModal();

  let events;
  try {
    events = await loadEvents(p.id);
  } catch (e) {
    dlg.innerHTML = `<p class="error">Could not load the record: ${esc(e.message)}</p>
      <div class="dlg-actions"><span class="spacer"></span><button type="button" class="primary" data-act="close">Close</button></div>`;
    dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
    return;
  }

  const recordHtml = recordMarkup(p, events, people, me);
  dlg.innerHTML = `
    <div class="rec-dlg-body">${recordHtml}</div>
    <div class="dlg-actions">
      <span class="muted small">In the print window, choose <strong>Save as PDF</strong>.</span>
      <span class="spacer"></span>
      <button type="button" data-act="close">Close</button>
      <button type="button" class="primary" data-act="print">Save as PDF / Print</button>
    </div>`;
  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  dlg.querySelector('[data-act="print"]').addEventListener('click', () => printRecord(recordHtml, p));
}

function recordMarkup(p, events, people, me) {
  const fact = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value || '—')}</dd></div>`;
  const rows = events.map((ev) => `<tr>
      <td>${esc(fmtDate(ev.occurred_on))}</td>
      <td>${esc(stageLabel(ev.stage))}</td>
      <td>${esc(ev.title)}${details(ev.details) ? `<div class="muted small">${esc(details(ev.details))}</div>` : ''}</td>
      <td>${esc(nameOf(people, ev.recorded_by))}</td>
    </tr>`).join('');
  return `
    <article class="record">
      <p class="muted small">CARE Therapist Portal · Staff record · Confidential</p>
      <h2>${esc(displayName(p))}</h2>
      <p class="muted rec-sub">${esc(p.email)}</p>
      <dl class="facts">
        ${fact('Who', trackLabel(p.track))}
        ${fact('Status', statusLabel(p.status))}
        ${fact('Stage', stageLabel(p.stage))}
        ${fact('Roles', rolesText(p.roles))}
        ${fact('Accepted on', fmtDate(p.accepted_on))}
        ${fact('Start date', fmtDate(p.start_date))}
        ${fact('Probation ends', fmtDate(p.probation_end_date))}
        ${fact('Left on', fmtDate(p.exited_on))}
        ${fact('Portal login', p.auth_user_id ? 'Yes' : 'No')}
        ${fact('Record created', fmtDate(bkkDate(p.created_at)))}
      </dl>
      <h3>Timeline (${events.length})</h3>
      ${events.length
        ? `<table><thead><tr><th>Date</th><th>Stage</th><th>What happened</th><th>Recorded by</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p class="muted">Nothing recorded.</p>'}
      <p class="muted small rec-foot">Exported ${esc(nowStamp())} (Bangkok time) by ${esc(displayName(me))}.</p>
    </article>`;
}

function printRecord(recordHtml, p) {
  const area = document.getElementById('print-area');
  area.innerHTML = recordHtml;
  const oldTitle = document.title;
  // The PDF's suggested file name comes from the page title.
  document.title = `CARE staff record - ${p.full_name} - ${todayLocal()}`;
  const done = () => {
    area.innerHTML = '';
    document.title = oldTitle;
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

// ---------------------------------------------------------------------------
// Everyone, as one Excel file (admin only)
// ---------------------------------------------------------------------------
export async function exportEveryone(people, me) {
  const [XLSX, events] = await Promise.all([
    import(XLSX_URL).catch(() => { throw new Error('Could not load the Excel tool. Check the internet connection and try again.'); }),
    loadEvents(null),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));

  const peopleRows = people.map((p) => ({
    'Full name': p.full_name,
    Nickname: p.nickname ?? '',
    Email: p.email,
    Who: trackLabel(p.track),
    Status: statusLabel(p.status),
    Stage: stageLabel(p.stage),
    Roles: rolesText(p.roles),
    'Accepted on': p.accepted_on ?? '',
    'Start date': p.start_date ?? '',
    'Probation ends': p.probation_end_date ?? '',
    'Left on': p.exited_on ?? '',
    'Portal login': p.auth_user_id ? 'Yes' : 'No',
    'Record created': bkkDate(p.created_at),
    'Record ID': p.id,
  }));

  const eventRows = events.map((ev) => {
    const p = byId.get(ev.therapist_id);
    return {
      Person: displayName(p),
      Email: p?.email ?? '',
      Date: ev.occurred_on,
      Stage: stageLabel(ev.stage),
      Type: ev.event_type,
      'What happened': ev.title,
      Details: details(ev.details),
      'Recorded by': nameOf(people, ev.recorded_by),
      'Record ID': ev.therapist_id,
    };
  });

  const about = [
    { Item: 'Exported', Value: `${nowStamp()} (Bangkok time)` },
    { Item: 'Exported by', Value: displayName(me) },
    { Item: 'People', Value: String(peopleRows.length) },
    { Item: 'Timeline entries', Value: String(eventRows.length) },
    { Item: 'Note', Value: 'Confidential staff data. Keep in CARE Google Drive. Never upload to GitHub.' },
  ];

  const sheet = (rows, widths) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = widths.map((wch) => ({ wch }));
    return ws;
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(peopleRows, [24, 12, 28, 22, 10, 22, 26, 12, 12, 14, 12, 8, 14, 38]), 'People');
  XLSX.utils.book_append_sheet(wb, sheet(eventRows, [26, 28, 12, 22, 16, 36, 30, 22, 38]), 'Timeline');
  XLSX.utils.book_append_sheet(wb, sheet(about, [18, 70]), 'About this file');
  XLSX.writeFile(wb, `CARE-Portal-export-${todayLocal()}.xlsx`);
  return { people: peopleRows.length, events: eventRows.length };
}
