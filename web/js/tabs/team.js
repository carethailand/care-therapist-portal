// Our Team: everyone at CARE, grouped by rank, with photo, chosen badges, a line
// about them and their Learning Hub tree. Each person edits their own card
// (photo, about me, badges) in one place: My Journey → My team card.
// Children never appear here: the photo must be of the staff member only.
import { directory, photoUrls, badges as loadBadges } from '../team-data.js';
import { esc } from '../ui.js';
import { rankOf } from '../labels.js';
import { ART_CREDIT } from '../stickers.js';
import { trees as loadTrees } from '../learning-data.js';
import { cardHtml, wireAbout } from '../team-card.js';

// Groups, in page order. Office staff without a clinical rank go under Admin & HR.
const GROUPS = [
  { key: 'office', title: 'Admin & HR' },
  { key: 'supervisor', title: 'Supervisors' },
  { key: 'qcd', title: 'QCD' },
  { key: 'senior', title: 'Senior therapists' },
  { key: 'therapist', title: 'Junior therapists' },
];

export async function render(panel, ctx) {
  panel.innerHTML = `
    <section class="team">
      <div class="page-head"><h1>Our Team</h1></div>
      <p class="muted">Everyone at CARE. To change your photo, “about me” or badges, go to <a href="#/journey">My Journey → My team card</a>.</p>
      <div id="tm-groups" aria-live="polite"><p class="muted">Loading…</p></div>
      <p class="credit">Rank badges: Lorc, game-icons.net (CC BY 3.0) · ${ART_CREDIT}</p>
    </section>`;
  const box = panel.querySelector('#tm-groups');
  let people, urls, badgeOf, treeOf;
  try {
    people = await directory();
    urls = await photoUrls(people.map((p) => p.photo_path));
    // Trees and chosen badges (empty if their SQL isn't run: cards show the usual).
    treeOf = Object.fromEntries((await loadTrees().catch(() => [])).map((t) => [t.id, t]));
    badgeOf = Object.fromEntries((await loadBadges().catch(() => [])).map((b) => [b.id, b]));
  } catch (e) {
    box.innerHTML = `<p class="error">Could not load the team: ${esc(e.message)}</p>`;
    return;
  }
  const groupOf = (p) => rankOf(p.roles) || 'office';
  const card = (p) => {
    const isMe = p.id === ctx.me.id;
    return cardHtml(p, {
      url: p.photo_path && urls[p.photo_path], badge: badgeOf[p.id], tree: treeOf[p.id], isMe,
      edit: isMe ? '<p class="tm-edit-link"><a class="link" href="#/journey">Edit my card</a></p>' : '',
    });
  };
  box.innerHTML = GROUPS.map((g) => {
    const list = people.filter((p) => groupOf(p) === g.key);
    if (!list.length) return '';
    return `<section class="tm-group">
      <h2>${esc(g.title)} <span class="chip">${list.length}</span></h2>
      <ul class="tm-grid">${list.map(card).join('')}</ul>
    </section>`;
  }).join('') || '<p class="muted">Nobody to show yet.</p>';
  wireAbout(box);
}
