// My Journey — the therapist's own record and timeline, plus "My team card":
// the one place to edit your Our Team card (photo, about me, which badges show).
import { loadJourney } from '../data.js';
import { esc, fmtDate, titleCase, todayLocal } from '../ui.js';
import { milestones, isLongest, milestoneEligible, cardBadges, SHOW_MAX } from '../milestones.js';
import { ART_CREDIT } from '../stickers.js';
import { directory, setProfile, photoUrls, squarePhoto, uploadPhoto, removePhoto, badges as loadBadges, setShowcase } from '../team-data.js';
import { trees as loadTrees } from '../learning-data.js';
import { cardHtml, avatarHtml, initials, wireAbout } from '../team-card.js';

const ABOUT_MAX = 280;
// My card's data while on this page: { row, url, badge, tree, picked, chosen }
let mc = null;

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
    ${milestoneEligible(me, roles) ? `<section class="card" id="mc-card" hidden>
      <div class="mc-head"><h2>My team card</h2><span class="muted small">This is how everyone sees you on Our Team.</span></div>
      <ul class="tm-grid mc-preview" aria-live="polite"></ul>
      <details class="mc-edit"><summary>Edit photo and “about me”</summary><div class="mc-form"></div></details>
    </section>
    <section class="card" id="ms-card">
      <div class="mc-head"><h2>My badges</h2><span class="muted small" id="ms-pickinfo"></span></div>
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

  if (milestoneEligible(me, roles)) loadMyCard(panel, me, roles);

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

// ---------------------------------------------------------------------------
// My team card + My badges
// ---------------------------------------------------------------------------
async function loadMyCard(panel, me, roles) {
  const longest = await isLongest(me);
  mc = null;
  try {
    const people = await directory();
    const row = people.find((p) => p.id === me.id);
    if (row) {
      const [urls, badges, trees] = await Promise.all([
        photoUrls([row.photo_path]), loadBadges().catch(() => []), loadTrees().catch(() => [])]);
      const badge = badges.find((b) => b.id === me.id) || {};
      const card = cardBadges(row, badge);
      mc = {
        row, url: row.photo_path ? urls[row.photo_path] : null, badge, tree: trees.find((t) => t.id === me.id) || null,
        allowed: card.all.map((b) => b.key), picked: card.shown.map((b) => b.key),
      };
    }
  } catch { mc = null; }   // not on Our Team (e.g. not set up yet): just show the badges
  if (mc) {
    panel.querySelector('#mc-card').hidden = false;
    drawPreview(panel);
    drawEditForm(panel);
  }
  drawMilestones(panel, me, roles, longest);
}

function drawPreview(panel) {
  const box = panel.querySelector('#mc-card .mc-preview');
  box.innerHTML = cardHtml(mc.row, { url: mc.url, badge: { ...mc.badge, showcase: mc.picked }, tree: mc.tree, isMe: true });
  wireAbout(box);
}

function drawEditForm(panel) {
  const p = mc.row;
  const box = panel.querySelector('#mc-card .mc-form');
  let newBlob = null;     // a picture chosen here
  let dropPhoto = false;  // "Remove photo" pressed
  box.innerHTML = `
    <form class="tm-edit">
      <div class="tm-edit-photo">
        <span class="tm-preview">${avatarHtml(p, mc.url, 'tm-photo lg')}</span>
        <div>
          <label class="btn-file">Choose a photo<input type="file" name="photo" accept="image/*"></label>
          <button type="button" class="link" data-act="nophoto"${p.photo_path ? '' : ' hidden'}>Remove photo</button>
          <p class="muted small">A clear photo of <strong>you only</strong>: please no children, families or client places. It's cropped to a square and only CARE staff can see it.</p>
        </div>
      </div>
      <label>About me <span class="muted small" data-count></span>
        <textarea name="about" rows="3" maxlength="${ABOUT_MAX}" placeholder="e.g. Speaks Thai, English and a little Japanese. Loves sensory play and Sunday markets.">${esc(p.about || '')}</textarea></label>
      <p class="msg" role="status" hidden></p>
      <div class="dlg-actions"><button type="submit" class="primary">Save</button></div>
    </form>`;
  const form = box.querySelector('form');
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
    } catch { say('Could not read that picture. Try a JPG or PNG.'); }
  });
  form.querySelector('[data-act="nophoto"]').addEventListener('click', () => {
    newBlob = null;
    dropPhoto = true;
    form.photo.value = '';
    form.querySelector('.tm-preview').innerHTML = `<span class="tm-photo lg tm-initials" aria-hidden="true">${esc(initials(p))}</span>`;
    form.querySelector('[data-act="nophoto"]').hidden = true;
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      let path = p.photo_path || null;
      if (newBlob) path = await uploadPhoto(p.id, newBlob);
      else if (dropPhoto) path = null;
      const about = form.about.value.trim();
      await setProfile(about, path);
      if (path !== p.photo_path) await removePhoto(p.photo_path);
      mc.row = { ...p, about: about || null, photo_path: path };
      mc.url = path ? (newBlob ? URL.createObjectURL(newBlob) : mc.url) : null;
      drawPreview(panel);
      drawEditForm(panel);
      panel.querySelector('#mc-card .mc-edit').open = true;
      const m = panel.querySelector('#mc-card .msg');
      m.hidden = false; m.dataset.kind = 'ok'; m.textContent = 'Saved ✓';
    } catch (e) {
      say(e.message);
      btn.disabled = false;
    }
  });
}

// The collection. Earned badges can be tapped to show them on your team card
// (up to 5, in the order tapped); locked ones say how to unlock them.
function drawMilestones(panel, me, roles, longest) {
  const el = panel.querySelector('#ms-card .ms-grid');
  const list = milestones(me, roles, longest);
  const today = todayLocal();
  const canPick = (m) => mc && m.earned && mc.allowed.includes(m.key);
  const info = panel.querySelector('#ms-pickinfo');
  if (info) info.textContent = mc ? `Tap an earned badge to show it on your team card · ${mc.picked.length}/${SHOW_MAX}` : '';
  el.innerHTML = `<ul class="ms-list">${list.map((m) => {
    const when = m.earned
      ? (m.lockText ? 'Earned' : m.key === 'longest' ? 'Held now' : m.on && m.on <= today ? `Earned ${fmtDate(m.on)}` : 'Earned')
      : m.lockText ? m.lockText
      : m.key === 'longest' ? 'For the therapist who has been at CARE the longest'
        : m.on ? `Unlocks ${fmtDate(m.on)}` : m.key === 'probation' ? 'Unlocks when you pass probation' : 'Unlocks once your start date is set';
    const n = mc ? mc.picked.indexOf(m.key) : -1;
    const inner = `
      <img src="${esc(m.img)}" alt="" width="96" height="96" loading="lazy">
      <span class="ms-name">${esc(m.label)}</span>
      ${m.word ? `<span class="ms-word">${esc(m.word)}</span>` : ''}
      <span class="muted small">${m.earned ? '' : '🔒 '}${esc(when)}</span>
      ${n >= 0 ? `<span class="ms-on" aria-hidden="true">${n + 1}</span><span class="ms-onlabel">On my card</span>` : ''}`;
    return canPick(m)
      ? `<li class="ms-item earned pickable${n >= 0 ? ' on' : ''}"><button type="button" class="ms-pick" data-key="${m.key}" aria-pressed="${n >= 0}"
           title="${n >= 0 ? 'On your team card: tap to remove' : 'Tap to show on your team card'}">${inner}</button></li>`
      : `<li class="ms-item${m.earned ? ' earned' : ' locked'}">${inner}</li>`;
  }).join('')}</ul>
  <p class="msg small" id="ms-msg" role="status" hidden></p>`;
  for (const b of el.querySelectorAll('.ms-pick')) b.addEventListener('click', async () => {
    const k = b.dataset.key;
    const msg = el.querySelector('#ms-msg');
    let next = mc.picked.includes(k) ? mc.picked.filter((x) => x !== k) : [...mc.picked, k];
    if (next.length > SHOW_MAX) {
      msg.hidden = false; msg.dataset.kind = 'info'; msg.textContent = `Up to ${SHOW_MAX} on your card. Tap one that's on to remove it first.`;
      return;
    }
    try {
      await setShowcase(next);
      mc.picked = next;
      mc.badge = { ...mc.badge, showcase: next };
      drawPreview(panel);
      drawMilestones(panel, me, roles, longest);
    } catch (e) {
      msg.hidden = false; msg.dataset.kind = 'error'; msg.textContent = e.message;
    }
  });
}
