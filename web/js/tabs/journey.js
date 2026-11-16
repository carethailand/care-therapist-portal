// My Journey — the therapist's own record and timeline.
import { loadJourney } from '../data.js';
import { esc, fmtDate, titleCase } from '../ui.js';

// Each track has its own steps (see admin/staff.js).
const TRACK_STAGES = {
  care_hire: [
    ['interview', 'Interview'],
    ['online_course', 'Online course + exam'],
    ['roleplay_orientation', 'Role-play & orientation'],
    ['field_overlap', 'Field overlap'],
    ['probation', 'Probation'],
    ['active', 'Therapist'],
  ],
  abat: [
    ['online_course', 'Online course + exam'],
    ['certified', 'Certified'],
  ],
};

export async function render(panel, { me }) {
  const staff = me.track !== 'abat'; // ABAT learners have no probation or hours
  panel.innerHTML = `
    <section class="card">
      <h2>${esc(me.nickname || me.full_name)}</h2>
      <dl class="facts">
        <div><dt>Status</dt><dd>${esc(titleCase(me.status))}</dd></div>
        <div><dt>Started</dt><dd>${esc(fmtDate(me.start_date))}</dd></div>
        ${staff ? `<div><dt>Probation ends</dt><dd>${esc(fmtDate(me.probation_end_date))}</dd></div>` : ''}
      </dl>
      ${stageTrack(me.stage, me.track)}
    </section>
    <section class="card">
      <h2>Timeline</h2>
      <div class="timeline" aria-live="polite"><p class="muted">Loading…</p></div>
    </section>
    ${staff ? `<section class="card muted-card">
      <h2>Hours summary</h2>
      <p class="muted">Your hours will appear here once the Hours module is switched on.</p>
    </section>` : ''}`;

  const list = panel.querySelector('.timeline');
  try {
    const events = await loadJourney(me.id);
    list.innerHTML = events.length
      ? `<ol>${events.map(eventItem).join('')}</ol>`
      : '<p class="muted">Nothing recorded yet.</p>';
  } catch (e) {
    list.innerHTML = `<p class="error">Could not load your timeline: ${esc(e.message)}</p>`;
  }
}

function stageTrack(current, track) {
  if (current === 'exited') return '';
  const stages = TRACK_STAGES[track] ?? TRACK_STAGES.care_hire;
  const idx = stages.findIndex(([k]) => k === current);
  return `<ol class="stages" aria-label="Journey stage">${stages.map(([k, label], i) => {
    const state = i < idx ? 'done' : i === idx ? 'current' : 'todo';
    return `<li class="${state}"${state === 'current' ? ' aria-current="step"' : ''}>${esc(label)}</li>`;
  }).join('')}</ol>`;
}

function eventItem(ev) {
  return `<li>
    <time datetime="${esc(ev.occurred_on)}">${esc(fmtDate(ev.occurred_on))}</time>
    <span class="ev-title">${esc(ev.title)}</span>
    <span class="tag">${esc(titleCase(ev.stage))}</span>
  </li>`;
}
