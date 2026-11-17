// Our Team: everyone at CARE, grouped by rank, with photo, badges and a line
// about them. Each person edits their own card (photo + "about me").
// Children never appear here: the photo must be of the staff member only.
import { directory, setProfile, photoUrls, squarePhoto, uploadPhoto, removePhoto, badges as loadBadges, setShowcase } from '../team-data.js';
import { esc } from '../ui.js';
import { icon } from '../icons.js';
import { rankOf, RANK_LABEL, OFFICE_ROLES, roleLabel, BADGE_FILE } from '../labels.js';
import { cardBadges, SHOW_MAX } from '../milestones.js';
import { ART_CREDIT } from '../stickers.js';
import { trees as loadTrees } from '../learning-data.js';
import { sceneSvg, STAGES, stageOf } from '../tree.js';

// Groups, in page order. Office staff without a clinical rank go under Admin & HR.
const GROUPS = [
  { key: 'office', title: 'Admin & HR' },
  { key: 'supervisor', title: 'Supervisors' },
  { key: 'qcd', title: 'QCD' },
  { key: 'senior', title: 'Senior therapists' },
  { key: 'therapist', title: 'Junior therapists' },
];
const ABOUT_MAX = 280;

let ctx;
let panelEl;
let people = [];
let urls = {};
let badgeOf = {};  // therapist id → { showcase, legacy_training }
let treeOf = {};   // therapist id → Learning Hub tree

export async function render(panel, context) {
  ctx = context;
  panelEl = panel;
  panel.innerHTML = `
    <section class="team">
      <div class="page-head">
        <h1>Our Team</h1>
        <span class="spacer"></span>
        <button type="button" class="primary" data-act="edit">${icon('users')} Edit my card</button>
      </div>
      <p class="muted">Everyone at CARE. Tap <strong>Edit my card</strong> to add your photo and a line about you.</p>
      <div id="tm-groups" aria-live="polite"><p class="muted">Loading…</p></div>
      <p class="credit">Rank badges: Lorc, game-icons.net (CC BY 3.0) · ${ART_CREDIT}</p>
      <dialog id="tm-dlg" class="dlg"></dialog>
    </section>`;
  panel.querySelector('[data-act="edit"]').addEventListener('click', openEditor);
  await load();
}

async function load() {
  const box = panelEl.querySelector('#tm-groups');
  try {
    people = await directory();
    urls = await photoUrls(people.map((p) => p.photo_path));
    // Trees from the Learning Hub (empty if it isn't set up yet).
    treeOf = Object.fromEntries((await loadTrees().catch(() => [])).map((t) => [t.id, t]));
    // Chosen badges (empty if 029 isn't run yet: cards then show the usual ones).
    badgeOf = Object.fromEntries((await loadBadges().catch(() => [])).map((b) => [b.id, b]));
  } catch (e) {
    box.innerHTML = `<p class="error">Could not load the team: ${esc(e.message)}</p>`;
    return;
  }
  const mine = people.find((p) => p.id === ctx.me.id);
  panelEl.querySelector('[data-act="edit"]').hidden = !mine;
  const groupOf = (p) => rankOf(p.roles) || 'office';
  box.innerHTML = GROUPS.map((g) => {
    const list = people.filter((p) => groupOf(p) === g.key);
    if (!list.length) return '';
    return `<section class="tm-group">
      <h2>${esc(g.title)} <span class="chip">${list.length}</span></h2>
      <ul class="tm-grid">${list.map(cardHtml).join('')}</ul>
    </section>`;
  }).join('') || '<p class="muted">Nobody to show yet.</p>';
  for (const b of box.querySelectorAll('[data-act="edit"]')) b.addEventListener('click', openEditor);
  // A long "about me" shows 3 lines; tap (or Enter) to read it all.
  for (const a of box.querySelectorAll('.tm-about')) {
    const toggle = () => a.classList.toggle('open');
    a.addEventListener('click', toggle);
    a.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  }
}

const initials = (p) => (p.nickname || p.full_name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function avatarHtml(p, cls = 'tm-photo') {
  const url = p.photo_path && urls[p.photo_path];
  return url
    ? `<img class="${cls}" src="${esc(url)}" alt="Photo of ${esc(p.nickname || p.full_name)}" width="480" height="480" loading="lazy">`
    : `<span class="${cls} tm-initials" aria-hidden="true">${esc(initials(p))}</span>`;
}

function cardHtml(p) {
  const rank = rankOf(p.roles);
  const office = OFFICE_ROLES.filter((r) => p.roles.includes(r));
  const rankBadges = [...(rank ? [rank] : []), ...office.slice(0, 1)];
  const { shown: ms, more } = cardBadges(p, badgeOf[p.id]);
  const me = p.id === ctx.me.id;
  // Horizontal card (P8c): photo with position badges (rank, admin/HR) on the left,
  // name / achievements / about in the middle, the Learning Hub tree on the right.
  // No role text line: the group heading and the badges already say it.
  const posName = (r) => (r === 'admin' || r === 'hr' ? roleLabel(r) : RANK_LABEL[r]);
  const tree = treeOf[p.id];
  const treeName = tree ? STAGES[stageOf(tree.points)].name : '';
  return `<li class="tm-card${me ? ' is-me' : ''}${tree ? '' : ' no-tree'}">
    <div class="tm-left">
      <div class="tm-avatar">
        ${avatarHtml(p)}
        ${rankBadges.map((r, i) => `<img class="tm-rank ${i ? 'tm-rank-2' : 'tm-rank-1'}" src="assets/badges/${BADGE_FILE[r]}" alt="${esc(posName(r))} badge" title="${esc(posName(r))}" width="40" height="40">`).join('')}
      </div>
      <p class="muted small tm-years">${p.years == null ? '' : p.years < 1 ? 'New to CARE 🌱' : `${p.years} year${p.years > 1 ? 's' : ''} at CARE`}</p>
    </div>
    <div class="tm-body">
      <p class="tm-name">${esc(p.nickname || p.full_name)}${me ? ' <span class="chip stage">You</span>' : ''}</p>
      ${p.nickname ? `<p class="muted small tm-full">${esc(p.full_name)}</p>` : ''}
      ${ms.length ? `<div class="tm-badges" aria-label="Achievements">
        ${ms.map((m) => `<img class="tm-ms" src="${esc(m.img)}" alt="${esc(m.label)}" title="${esc(m.label)}${m.word ? ` · ${esc(m.word)}` : ''}" width="44" height="44">`).join('')}
        ${more > 0 ? `<span class="tm-more" title="${more} more badge${more === 1 ? '' : 's'}">+${more}</span>` : ''}
      </div>` : ''}
      ${p.about ? `<p class="tm-about" tabindex="0" title="Tap to read all">${esc(p.about)}</p>` : ''}
      ${me ? '<p class="tm-edit-link"><button type="button" class="link" data-act="edit">Edit my card</button></p>' : ''}
    </div>
    ${tree ? `<div class="tm-tree" title="${esc(treeName)}">${sceneSvg(tree, { label: `${p.nickname || p.full_name}’s tree: ${treeName}` })}<span class="tm-tree-name">${esc(treeName)}</span></div>` : ''}
  </li>`;
}

// ---------------------------------------------------------------------------
// Edit my card
// ---------------------------------------------------------------------------
function openEditor() {
  const p = people.find((x) => x.id === ctx.me.id);
  if (!p) return;
  const dlg = panelEl.querySelector('#tm-dlg');
  const card = cardBadges(p, badgeOf[p.id]);
  const all = card.all;
  let picked = card.shown.map((b) => b.key);   // start from what the card shows now
  const before = picked.join(',');
  let newBlob = null;     // a picture chosen in this dialog
  let dropPhoto = false;  // "Remove photo" pressed
  dlg.innerHTML = `
    <form class="tm-edit" method="dialog">
      <h2>My team card</h2>
      <div class="tm-edit-photo">
        <span class="tm-preview">${avatarHtml(p, 'tm-photo lg')}</span>
        <div>
          <label class="btn-file">Choose a photo<input type="file" name="photo" accept="image/*"></label>
          <button type="button" class="link" data-act="nophoto"${p.photo_path ? '' : ' hidden'}>Remove photo</button>
          <p class="muted small">A clear photo of <strong>you only</strong>: please no children, families or client places. It's cropped to a square and only CARE staff can see it.</p>
        </div>
      </div>
      <label>About me <span class="muted small" data-count></span>
        <textarea name="about" rows="3" maxlength="${ABOUT_MAX}" placeholder="e.g. Speaks Thai, English and a little Japanese. Loves sensory play and Sunday markets.">${esc(p.about || '')}</textarea></label>
      ${all.length ? `<fieldset class="tm-pick"><legend>Badges on my card <span class="muted small" data-pickcount></span></legend>
        <p class="muted small">Tap up to ${SHOW_MAX}, in the order you want them. Others see only these, plus “+N” for the rest.</p>
        <div class="tm-pick-grid">${all.map((b) => `<button type="button" class="tm-pick-b" data-key="${b.key}" aria-pressed="false" title="${esc(b.label)}">
          <img src="${esc(b.img)}" alt="" width="48" height="48"><span>${esc(b.label)}</span><b class="tm-pick-n"></b></button>`).join('')}</div>
      </fieldset>` : ''}
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions"><span class="spacer"></span>
        <button type="button" data-act="close">Cancel</button>
        <button type="submit" class="primary">Save</button></div>
    </form>`;
  const form = dlg.querySelector('form');
  const msg = form.querySelector('.msg');
  const say = (t, k = 'error') => { msg.hidden = false; msg.dataset.kind = k; msg.textContent = t; };
  const count = () => { form.querySelector('[data-count]').textContent = `${form.about.value.length}/${ABOUT_MAX}`; };
  form.about.addEventListener('input', count);
  count();
  const paintPick = () => {
    for (const b of form.querySelectorAll('.tm-pick-b')) {
      const i = picked.indexOf(b.dataset.key);
      b.setAttribute('aria-pressed', String(i >= 0));
      b.querySelector('.tm-pick-n').textContent = i >= 0 ? i + 1 : '';
    }
    const c = form.querySelector('[data-pickcount]');
    if (c) c.textContent = `${picked.length}/${SHOW_MAX}`;
  };
  form.querySelectorAll('.tm-pick-b').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.key;
    if (picked.includes(k)) picked = picked.filter((x) => x !== k);
    else if (picked.length < SHOW_MAX) picked.push(k);
    else return say(`Up to ${SHOW_MAX} badges. Tap one to remove it first.`, 'info');
    msg.hidden = true;
    paintPick();
  }));
  paintPick();

  form.photo.addEventListener('change', async () => {
    const f = form.photo.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return say('Please choose a picture.');
    try {
      newBlob = await squarePhoto(f);
      dropPhoto = false;
      form.querySelector('.tm-preview').innerHTML = `<img class="tm-photo lg" src="${URL.createObjectURL(newBlob)}" alt="New photo preview">`;
      form.querySelector('[data-act="nophoto"]').hidden = false;
      msg.hidden = true;
    } catch {
      say('Could not read that picture. Try a JPG or PNG.');
    }
  });
  form.querySelector('[data-act="nophoto"]').addEventListener('click', () => {
    newBlob = null;
    dropPhoto = true;
    form.photo.value = '';
    form.querySelector('.tm-preview').innerHTML = `<span class="tm-photo lg tm-initials" aria-hidden="true">${esc(initials(p))}</span>`;
    form.querySelector('[data-act="nophoto"]').hidden = true;
  });
  form.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      let path = p.photo_path || null;
      if (newBlob) path = await uploadPhoto(ctx.me.id, newBlob);
      else if (dropPhoto) path = null;
      await setProfile(form.about.value.trim(), path);
      if (all.length && picked.join(',') !== before) await setShowcase(picked);
      if (path !== p.photo_path) await removePhoto(p.photo_path);
      dlg.close();
      await load();
    } catch (e) {
      say(e.message);
    } finally {
      btn.disabled = false;
    }
  });
  dlg.showModal();
}
