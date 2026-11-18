// One Our Team card, shared by Our Team (everyone) and My Journey (your own
// card preview). Horizontal: photo with position badges (rank, admin/HR) and
// years on the left; name, chosen badges and "about me" in the middle; the
// Learning Hub tree on the right.
import { esc } from './ui.js';
import { rankOf, RANK_LABEL, OFFICE_ROLES, roleLabel, BADGE_FILE } from './labels.js';
import { cardBadges } from './milestones.js';
import { sceneSvg, STAGES, stageOf } from './tree.js';

export const initials = (p) => (p.nickname || p.full_name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function avatarHtml(p, url, cls = 'tm-photo') {
  return url
    ? `<img class="${cls}" src="${esc(url)}" alt="Photo of ${esc(p.nickname || p.full_name)}" width="480" height="480" loading="lazy">`
    : `<span class="${cls} tm-initials" aria-hidden="true">${esc(initials(p))}</span>`;
}

// p = a team_directory() row. opts: { url, badge (team_badges row), tree, isMe, edit (html for the edit link) }
export function cardHtml(p, { url = null, badge = {}, tree = null, isMe = false, edit = '' } = {}) {
  const rank = rankOf(p.roles);
  const office = OFFICE_ROLES.filter((r) => p.roles.includes(r));
  const rankBadges = [...(rank ? [rank] : []), ...office.slice(0, 1)];
  const { shown, more } = cardBadges(p, badge);
  const posName = (r) => (OFFICE_ROLES.includes(r) ? roleLabel(r) : RANK_LABEL[r]);
  const treeName = tree ? STAGES[stageOf(tree.points)].name : '';
  return `<li class="tm-card${isMe ? ' is-me' : ''}${tree ? '' : ' no-tree'}">
    <div class="tm-left">
      <div class="tm-avatar">
        ${avatarHtml(p, url)}
        ${rankBadges.map((r, i) => `<img class="tm-rank ${i ? 'tm-rank-2' : 'tm-rank-1'}" src="assets/badges/${BADGE_FILE[r]}" alt="${esc(posName(r))} badge" title="${esc(posName(r))}" width="40" height="40">`).join('')}
      </div>
      <p class="muted small tm-years">${p.years == null ? '' : p.years < 1 ? 'New to CARE 🌱' : `${p.years} year${p.years > 1 ? 's' : ''} at CARE`}</p>
    </div>
    <div class="tm-body">
      <p class="tm-name">${esc(p.nickname || p.full_name)}${isMe ? ' <span class="chip stage">You</span>' : ''}</p>
      ${p.nickname ? `<p class="muted small tm-full">${esc(p.full_name)}</p>` : ''}
      ${shown.length ? `<div class="tm-badges" aria-label="Achievements">
        ${shown.map((m) => `<img class="tm-ms" src="${esc(m.img)}" alt="${esc(m.label)}" title="${esc(m.label)}${m.word ? ` · ${esc(m.word)}` : ''}" width="44" height="44">`).join('')}
        ${more > 0 ? `<span class="tm-more" title="${more} more badge${more === 1 ? '' : 's'}">+${more}</span>` : ''}
      </div>` : ''}
      ${p.about ? `<p class="tm-about" tabindex="0" title="Tap to read all">${esc(p.about)}</p>` : ''}
      ${edit}
    </div>
    ${tree ? `<div class="tm-tree" title="${esc(treeName)}">${sceneSvg(tree, { label: `${p.nickname || p.full_name}’s tree: ${treeName}` })}<span class="tm-tree-name">${esc(treeName)}</span></div>` : ''}
  </li>`;
}

// "About me" opens fully on tap (or Enter).
export function wireAbout(root) {
  for (const a of root.querySelectorAll('.tm-about')) {
    const toggle = () => a.classList.toggle('open');
    a.addEventListener('click', toggle);
    a.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  }
}
