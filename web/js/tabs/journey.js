// My Journey — the therapist's own record and timeline.
import { loadJourney } from '../data.js';
import { esc, fmtDate, titleCase, todayLocal } from '../ui.js';
import { milestones, isLongest, milestoneEligible } from '../milestones.js';
import { ART_CREDIT } from '../stickers.js';

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

export async function render(panel, { me, roles = [] }) {
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
    ${milestoneEligible(me, roles) ? `<section class="card" id="ms-card">
      <h2>Milestones</h2>
      <div class="ms-grid" aria-live="polite"><p class="muted">Loading…</p></div>
      <p class="credit">${ART_CREDIT}</p>
    </section>` : ''}
    <section class="card">
      <h2>Timeline</h2>
      <div class="timeline" aria-live="polite"><p class="muted">Loading…</p></div>
    </section>
    ${staff ? `<section class="card muted-card">
      <h2>Hours summary</h2>
      <p class="muted">Your hours will appear here once the Hours module is switched on.</p>
    </section>` : ''}`;

  if (milestoneEligible(me, roles)) drawMilestones(panel.querySelector('#ms-card .ms-grid'), me, roles);

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

async function drawMilestones(el, me, roles) {
  const list = milestones(me, roles, await isLongest(me));
  const today = todayLocal();
  el.innerHTML = `<ul class="ms-list">${list.map((m) => {
    const when = m.earned
      ? (m.lockText ? 'Earned' : m.key === 'longest' ? 'Held now' : m.on && m.on <= today ? `Earned ${fmtDate(m.on)}` : 'Earned')
      : m.lockText ? m.lockText
      : m.key === 'longest' ? 'For the therapist who has been at CARE the longest'
        : m.on ? `Unlocks ${fmtDate(m.on)}` : m.key === 'probation' ? 'Unlocks when you pass probation' : 'Unlocks once your start date is set';
    return `<li class="ms-item${m.earned ? ' earned' : ' locked'}">
      <img src="${esc(m.img)}" alt="" width="96" height="96" loading="lazy">
      <span class="ms-name">${esc(m.label)}</span>
      ${m.word ? `<span class="ms-word">${esc(m.word)}</span>` : ''}
      <span class="muted small">${m.earned ? '' : '🔒 '}${esc(when)}</span>
    </li>`;
  }).join('')}</ul>`;
}
