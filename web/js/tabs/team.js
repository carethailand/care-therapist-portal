// Our Team: everyone at CARE, grouped by rank, with photo, chosen badges, a line
// about them and their Learning Hub tree. Each person edits their own card
// (photo, about me, badges) in one place: My Journey → My team card.
// Children never appear here: the photo must be of the staff member only.
import { directory, photoUrls, badges as loadBadges, giveBadge, takeBackBadge } from '../team-data.js';
import { GIVEN, givenImg } from '../milestones.js';
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
  // Supervisors, QCD and admin can give hand-given badges (Portal 055); admin can take one back.
  const has = (...r) => (ctx.roles || []).some((x) => r.includes(x));
  const canGive = has('admin', 'manager', 'supervisor', 'qcd');
  const card = (p) => {
    const isMe = p.id === ctx.me.id;
    const give = !isMe && canGive && badgeOf[p.id] ? `<p class="tm-edit-link"><button type="button" class="small-btn" data-give="${esc(p.id)}">🎖️ Give a badge</button></p>` : '';
    return cardHtml(p, {
      url: p.photo_path && urls[p.photo_path], badge: badgeOf[p.id], tree: treeOf[p.id], isMe,
      edit: isMe ? '<p class="tm-edit-link"><a class="link" href="#/journey">Edit my card</a></p>' : give,
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
  box.querySelectorAll('[data-give]').forEach((b) => b.addEventListener('click', () => giveDialog(people.find((p) => p.id === b.dataset.give))));

  function giveDialog(p) {
    const held = badgeOf[p.id]?.gifts || {};
    const name = p.nickname || p.full_name;
    let dlg = panel.querySelector('#tm-give');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'tm-give'; dlg.className = 'dlg'; panel.append(dlg); }
    dlg.innerHTML = `<div class="lh-form">
      <h2>Give ${esc(name)} a badge</h2>
      <p class="muted small">Pick one. ${esc(name)} sees it on their card and in My Journey straight away. Each badge can be given once.</p>
      <ul class="tm-give">${GIVEN.map((g) => {
        const got = Number(held[g.key]) > 0;
        return `<li><img src="${givenImg(g.key)}" alt="" width="64" height="64">
          <span><strong>${esc(g.label)}</strong><br><span class="muted small">${esc(g.about)}</span></span>
          ${got ? `<span class="tm-give-side"><span class="chip ok">Has it</span>${has('admin', 'manager') ? `<button type="button" class="small-btn" data-take="${g.key}">Take back</button>` : ''}</span>`
            : `<button type="button" class="small-btn primary" data-pick="${g.key}">Give</button>`}</li>`;
      }).join('')}</ul>
      <p class="error small" data-err hidden></p>
      <div class="dlg-actions"><button type="button" data-close>Close</button></div></div>`;
    const err = dlg.querySelector('[data-err]');
    const done = async () => { badgeOf[p.id] = (await loadBadges()).find((x) => x.id === p.id) || badgeOf[p.id]; dlg.close(); render(panel, ctx); };
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    dlg.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
      const g = GIVEN.find((x) => x.key === b.dataset.pick);
      if (!confirm(`Give ${name} the ${g.label} badge?`)) return;
      b.disabled = true;
      try { await giveBadge(p.id, g.key); await done(); } catch (e) { err.textContent = e.message; err.hidden = false; b.disabled = false; }
    }));
    dlg.querySelectorAll('[data-take]').forEach((b) => b.addEventListener('click', async () => {
      const g = GIVEN.find((x) => x.key === b.dataset.take);
      if (!confirm(`Take the ${g.label} badge back from ${name}?`)) return;
      try { await takeBackBadge(p.id, g.key); await done(); } catch (e) { err.textContent = e.message; err.hidden = false; }
    }));
    if (!dlg.open) dlg.showModal();
  }
}
