// Our Team: everyone at CARE, grouped by rank, with photo, chosen badges, a line
// about them and their Learning Hub tree. Each person edits their own card
// (photo, about me, badges) in one place: My Journey → My team card.
// Children never appear here: the photo must be of the staff member only.
import { directory, photoUrls, badges as loadBadges, giveBadge, takeBackBadge } from '../team-data.js';
import { GIVEN, givenImg } from '../milestones.js';
import { esc } from '../ui.js';
import { rankOf } from '../labels.js';
import { ART_CREDIT, STICKERS, stickerSrc } from '../stickers.js';
import { sendMessage } from '../connect-data.js';
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
  // Everyone at CARE (not applicants) can give anyone kudos: a thank-you message in CARE Connect.
  const canKudos = ctx.me.track !== 'abat' && rankOf(ctx.roles) !== 'applicant';
  const card = (p) => {
    const isMe = p.id === ctx.me.id;
    const btns = [
      canKudos ? `<button type="button" class="small-btn" data-kudos="${esc(p.id)}">💌 Give kudos</button>` : '',
      canGive && badgeOf[p.id] ? `<button type="button" class="small-btn" data-give="${esc(p.id)}">🎖️ Give a badge</button>` : '',
    ].filter(Boolean).join(' ');
    const give = !isMe && btns ? `<p class="tm-edit-link tm-actions">${btns}</p>` : '';
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
  box.querySelectorAll('[data-kudos]').forEach((b) => b.addEventListener('click', () => kudosDialog(people.find((p) => p.id === b.dataset.kudos))));

  // Give kudos = a thank-you in CARE Connect. "Just to them" → their inbox.
  // "On the CARE board" → also asks Admin to post it (Admin checks it first).
  function kudosDialog(p) {
    const name = p.nickname || p.full_name;
    let dlg = panel.querySelector('#tm-kudos');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'tm-kudos'; dlg.className = 'dlg'; panel.append(dlg); }
    dlg.innerHTML = `<form class="lh-form od-form" method="dialog">
      <h2>💌 Kudos for ${esc(name)}</h2>
      <label>Your message
        <textarea name="body" rows="5" maxlength="4000" required placeholder="Thank you for…"></textarea></label>
      <p class="muted small">Please don't write a child's name. Use the 3-letter case code (e.g. ABC) if you need to.</p>
      <fieldset class="tm-kudos-where"><legend>Who sees it?</legend>
        <label class="check"><input type="radio" name="where" value="direct" checked>
          <span><strong>Just ${esc(name)}</strong><br><span class="muted small">It goes to ${esc(name)}'s messages in CARE Connect.</span></span></label>
        <label class="check"><input type="radio" name="where" value="board">
          <span><strong>Everyone, on the CARE board</strong><br><span class="muted small">${esc(name)} gets it now. An admin reads it first (and may tidy the wording), then posts it on the board.</span></span></label>
      </fieldset>
      <fieldset class="sticker-pick"><legend>Add a sticker <span class="muted small">(optional)</span></legend>
        <label class="stk none"><input type="radio" name="sticker" value="" checked><span>No sticker</span></label>
        ${STICKERS.map((st) => `<label class="stk" title="${esc(st.label)}"><input type="radio" name="sticker" value="${esc(st.key)}"><img src="${stickerSrc(st.key)}" alt="${esc(st.label)}" width="256" height="256" loading="lazy"></label>`).join('')}
      </fieldset>
      <label class="check anon-box"><input type="checkbox" name="anon">
        <span><strong>Send without my name</strong><br><span class="muted small">Nobody in the Portal can see who sent it. Kudos without a name don't count toward badges.</span></span></label>
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions"><button type="button" data-close>Cancel</button> <button type="submit" class="primary">Send kudos</button></div>
    </form>`;
    const form = dlg.querySelector('form'); const msg = form.querySelector('.msg');
    const say = (t, k = 'error') => { msg.hidden = false; msg.dataset.kind = k; msg.textContent = t; };
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = form.body.value.trim();
      if (!body) return say('Please write your message.');
      const board = form.where.value === 'board';
      const btn = form.querySelector('[type="submit"]'); btn.disabled = true;
      try {
        await sendMessage({ kind: 'thanks', topic: 'team', sendTo: 'person', recipient: p.id, body,
          anonymous: form.anon.checked, kudos: board, kudosTo: '', sticker: form.sticker.value || null });
        form.innerHTML = `<h2>💌 Sent!</h2><p>${board ? `${esc(name)} has your kudos. It goes on the CARE board once an admin has read it.` : `${esc(name)} will find your kudos in CARE Connect.`}</p>
          <div class="dlg-actions"><button type="button" class="primary" data-close>Close</button></div>`;
        form.querySelector('[data-close]').addEventListener('click', () => dlg.close());
      } catch (e) { say(e.message); btn.disabled = false; }
    });
    if (!dlg.open) dlg.showModal();
    form.body.focus();
  }

  function giveDialog(p) {
    const held = badgeOf[p.id]?.gifts || {};
    const name = p.nickname || p.full_name;
    let dlg = panel.querySelector('#tm-give');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'tm-give'; dlg.className = 'dlg'; panel.append(dlg); }
    dlg.innerHTML = `<div class="lh-form">
      <h2>Give ${esc(name)} a badge</h2>
      <p class="muted small">Pick one. ${esc(name)} sees it on their card and in My Journey straight away. Each badge can be given once.</p>
      <ul class="tm-give">${GIVEN.filter((g) => g.by !== 'admin' || has('admin', 'manager')).map((g) => {
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
