// "Close group": one .zip for CARE's Google Drive with everything about a
// finished training group — a summary spreadsheet, each person's record (an
// HTML page that prints to PDF) and every assignment file. The caller then
// clears the uploaded files from the Portal.
import { esc, fmtDate, todayLocal } from './ui.js';
import { workBlob } from './training-data.js';

const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';
const safe = (s) => String(s ?? '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'file';
const SUB = { submitted: 'Submitted (not reviewed)', reviewed: 'Reviewed', redo: 'Please redo' };
const STATUS = { active: 'In progress', passed: 'Completed', not_passed: 'Not passed', withdrawn: 'Withdrawn', recommended: 'Recommended' };

// ctx: { program, group, steps, topics, enrollments, people, data, sessions }
// Returns { filename, paths } (paths = uploaded files now safe to clear).
export async function exportGroup(c, onProgress = () => {}) {
  const [XLSXmod, JSZipMod] = await Promise.all([
    import(XLSX_URL), import(JSZIP_URL),
  ]).catch(() => { throw new Error('Could not load the export tools. Check the internet connection and try again.'); });
  const XLSX = XLSXmod.default?.utils ? XLSXmod.default : XLSXmod;
  const JSZip = JSZipMod.default || JSZipMod;
  const zip = new JSZip();
  const root = zip.folder(safe(`${c.group.name} – ${todayLocal()}`));
  const name = (e) => { const p = c.people.find((x) => x.id === e.therapist_id); return p ? (p.nickname ? `${p.nickname} (${p.full_name})` : p.full_name) : 'Unknown'; };
  const sessionStep = c.steps.find((s) => s.kind === 'session');
  const resultSteps = c.steps.filter((s) => s.kind === 'result' || s.kind === 'practicum');
  const learnItems = c.steps.filter((s) => s.kind === 'learn').flatMap((s) => c.items.filter((i) => i.step_id === s.id));
  const of = (list, e) => (list || []).filter((x) => x.enrollment_id === e.id);
  const paths = [];

  // 1. Summary spreadsheet ------------------------------------------------------------
  const people = c.enrollments.map((e) => {
    const hrs = of(c.data.hours, e).reduce((t, h) => t + Number(h.hours), 0);
    const chs = new Set(of(c.data.hours, e).flatMap((h) => h.chapters || []));
    const subs = of(c.data.subs, e);
    const row = {
      Person: name(e), Status: STATUS[e.status] ?? e.status, Started: e.started_on ?? '', Finished: e.finished_on ?? '',
      [learnItems.some((i) => i.kind === 'video') ? 'Videos watched' : 'Lessons done']: `${learnItems.filter((i) => c.data.done.some((d) => d.enrollment_id === e.id && d.item_id === i.id)).length}/${learnItems.length}`,
      'Training hours': Math.round(hrs * 10) / 10,
      Chapters: c.topics.length ? `${chs.size}/${c.topics.length}` : '',
      'Assignments submitted': c.topics.length ? `${subs.length}/${c.topics.length}` : '',
      'Assignments reviewed': subs.filter((x) => x.status === 'reviewed').length,
    };
    for (const st of resultSteps) {
      const r = of(c.data.stepResults, e).find((x) => x.step_id === st.id);
      row[st.title] = r ? `${r.passed ? 'Passed' : 'Not passed'}${r.score != null ? ` ${Number(r.score)}${r.full_score ? `/${Number(r.full_score)}` : ''}` : ''}${r.held_on ? ` (${r.held_on})` : ''}` : '';
    }
    row.Certificate = c.data.certificates.find((x) => x.enrollment_id === e.id)?.code ?? '';
    row.Promoted = e.promoted_on ?? '';
    return row;
  });
  const sessions = c.sessions.map((s) => ({
    Date: s.held_on, Time: s.start_time ? String(s.start_time).slice(0, 5) : '', Kind: s.kind, Title: s.title ?? '',
    Chapters: (s.chapters || []).join(', '), Hours: s.hours ?? '', Place: s.place ?? '',
    Supervisor: c.people.find((p) => p.id === s.trainer_id)?.nickname ?? '', Status: s.status,
    Attended: c.data.hours.filter((h) => h.session_id === s.id).map((h) => name(c.enrollments.find((e) => e.id === h.enrollment_id) || {})).join(', '),
  }));
  const assignments = c.enrollments.flatMap((e) => of(c.data.subs, e).map((x) => ({
    Person: name(e), Chapter: x.chapter, Topic: c.topics[x.chapter - 1] ?? '', Status: SUB[x.status] ?? x.status,
    Submitted: x.submitted_at?.slice(0, 10) ?? '', File: x.file_name ?? '', Comment: x.feedback ?? '',
  })));
  const prac = c.steps.find((s) => s.kind === 'practicum');
  const practicum = [];
  if (prac?.config?.practicum) {
    for (const e of c.enrollments) {
      for (const ev of of(c.data.evals, e)) {
        const sec = prac.config.practicum.sections.find((x) => x.key === ev.section);
        if (ev.section === 'skills') {
          for (const it of sec.groups.flatMap((g) => g.items)) {
            practicum.push({ Person: name(e), Form: 'Technical skills', Date: ev.held_on ?? '', Case: '', Item: `${it.n}. ${it.text}`, Mark: Object.keys(ev.marks?.[it.n] || {}).join(', ') || '—', Comment: ev.comment ?? '' });
          }
        } else {
          sec.items.forEach((t, i) => practicum.push({ Person: name(e), Form: `${sec.label} ${ev.seq}`, Date: ev.held_on ?? '', Case: ev.case_code ?? '', Item: t, Mark: ev.marks?.[i + 1] ?? '—', Comment: i === 0 ? (ev.comment ?? '') : '' }));
        }
      }
    }
  }
  const wb = XLSX.utils.book_new();
  const add = (rows, title) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'Nothing recorded' }]), title);
  add(people, 'People'); add(sessions, 'Sessions'); add(assignments, 'Assignments'); add(practicum, 'Practicum');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Group', c.group.name], ['Programme', c.program.title], ['Exported', todayLocal()],
    ['Privacy', 'Staff training records. Keep in CARE\'s Google Drive, not on personal devices. Cases appear as 3-letter codes only.'],
  ]), 'About');
  root.file('Summary.xlsx', XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));

  // 2. One record per person + their files --------------------------------------------
  let k = 0;
  const allFiles = c.enrollments.flatMap((e) => of(c.data.subs, e).filter((x) => x.file_path).map((x) => ({ e, x })));
  for (const e of c.enrollments) {
    const dir = root.folder(safe(name(e)));
    dir.file('Record.html', recordHtml(c, e, name(e), people.find((r) => r.Person === name(e)), resultSteps, prac));
    for (const { x } of allFiles.filter((f) => f.e.id === e.id)) {
      onProgress(`Downloading files… ${++k} of ${allFiles.length}`);
      const blob = await workBlob(x.file_path);
      dir.file(`Chapter ${x.chapter} – ${safe(x.file_name || x.file_path.split('/').pop())}`, blob);
      paths.push(x.file_path);
    }
  }
  onProgress('Making the .zip…');
  const out = await zip.generateAsync({ type: 'blob' });
  const filename = `${safe(c.group.name)} – ${todayLocal()}.zip`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(out);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  return { filename, paths };
}

function recordHtml(c, e, who, sum, resultSteps, prac) {
  const of = (list) => (list || []).filter((x) => x.enrollment_id === e.id);
  const rows = (obj) => Object.entries(obj || {}).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const hours = of(c.data.hours).map((h) => `<tr><td>${esc(fmtDate(h.held_on))}</td><td>${esc((h.chapters || []).map((n) => `Ch ${n} ${c.topics[n - 1] ?? ''}`).join('; ') || h.topic || '')}</td><td>${esc(h.hours)} h</td></tr>`).join('');
  const subs = of(c.data.subs).sort((a, b) => a.chapter - b.chapter).map((x) => `<tr><td>Ch ${x.chapter}</td><td>${esc(c.topics[x.chapter - 1] ?? '')}</td><td>${esc(SUB[x.status] ?? x.status)}</td><td>${esc(x.feedback ?? '')}</td></tr>`).join('');
  const results = resultSteps.map((st) => { const r = of(c.data.stepResults).find((x) => x.step_id === st.id); return `<tr><th>${esc(st.title)}</th><td>${r ? `${r.passed ? 'Passed' : 'Not passed'}${r.score != null ? ` · ${Number(r.score)}${r.full_score ? `/${Number(r.full_score)}` : ''}` : ''}${r.held_on ? ` · ${esc(fmtDate(r.held_on))}` : ''}${r.note ? ` · note: ${esc(r.note)}` : ''}` : '—'}</td></tr>`; }).join('');
  let pr = '';
  if (prac?.config?.practicum) {
    for (const ev of of(c.data.evals).sort((a, b) => a.section.localeCompare(b.section) || a.seq - b.seq)) {
      const sec = prac.config.practicum.sections.find((x) => x.key === ev.section);
      const items = ev.section === 'skills'
        ? sec.groups.flatMap((g) => g.items).map((it) => `<tr><td>${it.n}. ${esc(it.text)}</td><td>${esc(Object.keys(ev.marks?.[it.n] || {}).join(', ') || '—')}</td></tr>`).join('')
        : sec.items.map((t, i) => `<tr><td>${esc(t)}</td><td>${esc(ev.marks?.[i + 1] ?? '—')}</td></tr>`).join('');
      pr += `<h3>${esc(ev.section === 'skills' ? 'Technical skills' : `${sec.label} ${ev.seq}`)}${ev.held_on ? ` · ${esc(fmtDate(ev.held_on))}` : ''}${ev.case_code ? ` · case ${esc(ev.case_code)}` : ''}</h3>
        <table>${items}</table>${ev.comment ? `<p><em>${esc(ev.comment)}</em></p>` : ''}`;
    }
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(who)} – ${esc(c.program.title)}</title>
<style>body{font:14px/1.45 -apple-system,Segoe UI,Arial,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#2c2621}
h1{font-size:22px;margin:0}h2{font-size:17px;margin:22px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px}h3{font-size:14px;margin:14px 0 4px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:4px 6px;border-bottom:1px solid #eee}th{width:34%;font-weight:600}
.muted{color:#777;font-size:12px}@media print{body{margin:0}}</style></head><body>
<p class="muted">CARE Therapist Portal · training record · exported ${esc(fmtDate(todayLocal()))} · print this page to save it as PDF</p>
<h1>${esc(who)}</h1><p>${esc(c.program.title)} · ${esc(c.group.name)}</p>
<h2>Summary</h2><table>${rows(sum)}</table>
<h2>Results</h2><table>${results}</table>
${hours ? `<h2>In-person training</h2><table>${hours}</table>` : ''}
${subs ? `<h2>Assignments</h2><table>${subs}</table>` : ''}
${pr ? `<h2>Practicum checklist</h2>${pr}` : ''}
<p class="muted">Cases appear as 3-letter codes only. Staff data: keep in CARE's Google Drive.</p></body></html>`;
}
