// Home: greeting, level card with rank badge, training progress, shortcuts.
// Levels follow the real journey (plan §11.2); badges are Songg's artwork
// (game-icons.net by Lorc, CC BY 3.0 — the credit line below is required).
import { esc, fmtDate, todayLocal } from '../ui.js';
import { rankOf, RANK_LABEL, OFFICE_ROLES, roleLabel } from '../labels.js';
import { icon } from '../icons.js';

const LEVELS = {
  care_hire: [
    ['interview', 'Candidate'],
    ['online_course', 'Learner'],
    ['roleplay_orientation', 'Trainee'],
    ['field_overlap', 'Field trainee'],
    ['probation', 'Probation'],
    ['active', 'Therapist'],
  ],
  abat: [
    ['online_course', 'Learner'],
    ['certified', 'Certified'],
  ],
};
const BADGE_FILE = {
  applicant: 'Applicant.png', therapist: 'Junior.png', senior: 'Senior.png',
  qcd: 'QCD.png', supervisor: 'Supervisor.png', hr: 'Admin.png', admin: 'Admin.png',
};
const TAB_ICON = {
  journey: 'route', training: 'school', learning: 'book', resources: 'link', journals: 'books',
  leave: 'beach', hours: 'clock', supervision: 'user-check', documents: 'file-text',
};

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Bangkok' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export async function render(panel, { me, roles, visible = [], canAdmin = false }) {
  const name = me.nickname || me.full_name.split(' ')[0];
  const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'long' });
  const track = me.track === 'abat' ? 'abat' : 'care_hire';
  const levels = LEVELS[track];
  const idx = levels.findIndex(([k]) => k === me.stage);
  const rank = rankOf(roles);
  const office = OFFICE_ROLES.filter((r) => roles.includes(r));
  const badgeRoles = [...(rank ? [rank] : []), ...office.slice(0, 1)];
  const tiles = visible.filter((m) => m.enabled);

  panel.innerHTML = `
    <section class="home">
      <p class="home-kicker">สวัสดี · ${esc(today)}</p>
      <h1 class="home-hello">${esc(greeting())}, ${esc(name)}</h1>

      <div class="home-grid">
        <article class="card level-card">
          <div class="level-top">
            <div>
              ${me.stage === 'exited'
                ? '<p class="level-kicker">Alumni</p><h2>Thank you for being part of CARE</h2>'
                : idx >= 0
                  ? `<p class="level-kicker">Level ${idx + 1} of ${levels.length}</p><h2>${esc(levels[idx][1])}</h2>`
                  : `<p class="level-kicker">Your journey</p><h2>${esc(rank ? RANK_LABEL[rank] : 'Welcome')}</h2>`}
              ${rank ? `<p class="muted small">${esc(RANK_LABEL[rank])}${office.length ? ` · ${office.map(roleLabel).join(' · ')}` : ''}</p>` : ''}
            </div>
            ${badgeRoles.length ? `<div class="badge-stack">${badgeRoles.map((r) => `
              <img class="badge rim-${esc(r)}" src="assets/badges/${BADGE_FILE[r]}" alt="${esc(r === 'admin' || r === 'hr' ? roleLabel(r) : RANK_LABEL[r])} badge">`).join('')}</div>` : ''}
          </div>
          ${idx >= 0 && me.stage !== 'exited' ? `
            <ol class="level-track" aria-label="Journey progress">
              ${levels.map(([k, label], i) => `<li class="${i < idx ? 'done' : i === idx ? 'current' : ''}" title="${esc(label)}"${i === idx ? ' aria-current="step"' : ''}><span class="sr-only">${esc(label)}</span></li>`).join('')}
            </ol>
            <p class="muted small">${idx < levels.length - 1 ? `Next: ${esc(levels[idx + 1][1])}` : 'You have reached the top of the journey 🌿'}</p>` : ''}
          <a class="text-link" href="#/journey">See my journey ${icon('arrow-right')}</a>
        </article>

        <article class="card training-card" id="home-training" hidden></article>
      </div>

      ${tiles.length || canAdmin ? `
        <h2 class="home-h2">Shortcuts</h2>
        <nav class="tiles" aria-label="Shortcuts">
          ${tiles.map((m) => `<a class="tile" href="#/${esc(m.key)}">${icon(TAB_ICON[m.key] ?? 'sparkles')}<span>${esc(m.label)}</span></a>`).join('')}
          ${canAdmin ? `<a class="tile" href="#/admin/staff">${icon('settings')}<span>Admin</span></a>` : ''}
        </nav>` : ''}

      ${badgeRoles.length ? `<p class="credit">Badge art: Lorc, game-icons.net (CC BY 3.0)</p>` : ''}
    </section>`;

  // Training progress (only when the Training tab is open for this person).
  if (visible.some((m) => m.key === 'training')) drawTraining(panel.querySelector('#home-training'), me);
}

async function drawTraining(el, me) {
  let content;
  let mine;
  try {
    const t = await import('../training-data.js');
    [content, mine] = await Promise.all([t.loadContent(), t.loadMyTraining(me.id)]);
  } catch {
    return; // Home still works without it.
  }
  const enr = mine.enrollments.find((e) => e.status === 'active') || mine.enrollments.find((e) => e.status === 'passed');
  if (!enr) return;
  const prog = content.programs.find((p) => p.key === enr.program_key);
  const learnSteps = content.steps.filter((s) => s.program_key === enr.program_key && s.kind === 'learn');
  const items = content.items.filter((i) => learnSteps.some((s) => s.id === i.step_id));
  const done = items.filter((i) => mine.done.some((d) => d.enrollment_id === enr.id && d.item_id === i.id)).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const overdue = enr.status === 'active' && enr.due_on && enr.due_on < todayLocal();

  el.innerHTML = enr.status === 'passed'
    ? `<p class="level-kicker">Training</p><h2>${esc(prog?.title ?? 'Training')}</h2>
       <p>Completed 🎓 Well done.</p>
       <a class="btn-clay" href="#/training">View certificate ${icon('arrow-right')}</a>`
    : `<p class="level-kicker">Training</p><h2>${esc(prog?.title ?? 'Training')}</h2>
       <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
       <p class="muted small">${done} of ${items.length} modules${enr.due_on ? ` · ${overdue ? '<span class="error">finish date passed</span>' : `finish by ${esc(fmtDate(enr.due_on))}`}` : ''}</p>
       <a class="btn-clay" href="#/training">Continue training ${icon('arrow-right')}</a>`;
  el.hidden = false;
}
