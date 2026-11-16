// Our Team: everyone at CARE, grouped by rank, with photo, badges and a line
// about them. Each person edits their own card (photo + "about me").
// Children never appear here: the photo must be of the staff member only.
import { directory, setProfile, photoUrls, squarePhoto, uploadPhoto, removePhoto } from '../team-data.js';
import { esc } from '../ui.js';
import { icon } from '../icons.js';
import { rankOf, RANK_LABEL, OFFICE_ROLES, roleLabel, BADGE_FILE } from '../labels.js';
import { summaryBadges } from '../milestones.js';
import { ART_CREDIT } from '../stickers.js';

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
  const ms = summaryBadges(p);
  const me = p.id === ctx.me.id;
  const roleText = [rank ? RANK_LABEL[rank] : '', ...office.map(roleLabel)].filter(Boolean).join(' · ');
  return `<li class="tm-card${me ? ' is-me' : ''}">
    ${avatarHtml(p)}
    <div class="tm-body">
      <p class="tm-name">${esc(p.nickname || p.full_name)}${me ? ' <span class="chip stage">You</span>' : ''}</p>
      ${p.nickname ? `<p class="muted small tm-full">${esc(p.full_name)}</p>` : ''}
      <p class="small tm-role">${esc(roleText)}</p>
      <div class="tm-badges">
        ${rankBadges.map((r) => `<img class="tm-rank" src="assets/badges/${BADGE_FILE[r]}" alt="${esc(r === 'admin' || r === 'hr' ? roleLabel(r) : RANK_LABEL[r])} badge" title="${esc(r === 'admin' || r === 'hr' ? roleLabel(r) : RANK_LABEL[r])}" width="40" height="40">`).join('')}
        ${ms.map((m) => `<img class="tm-ms" src="${esc(m.img)}" alt="${esc(m.label)}" title="${esc(m.label)}${m.word ? ` · ${esc(m.word)}` : ''}" width="44" height="44">`).join('')}
      </div>
      ${p.about ? `<p class="tm-about">${esc(p.about)}</p>` : me ? '<p class="muted small">Add a line about yourself: languages, favourite activity, a fun fact…</p>' : ''}
      <p class="muted small">${p.years == null ? '' : p.years < 1 ? 'New to CARE 🌱' : `${p.years} year${p.years > 1 ? 's' : ''} at CARE`}</p>
      ${me ? '<p><button type="button" class="link" data-act="edit">Edit my card</button></p>' : ''}
    </div>
  </li>`;
}

// ---------------------------------------------------------------------------
// Edit my card
// ---------------------------------------------------------------------------
function openEditor() {
  const p = people.find((x) => x.id === ctx.me.id);
  if (!p) return;
  const dlg = panelEl.querySelector('#tm-dlg');
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
