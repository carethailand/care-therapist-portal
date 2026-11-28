// Intake report builder (Portal 069), inside Reports & Forms.
//   Supervisors ............ write a report: fill it in HERE, download Word / PDF.
//   Supervisors + Admin .... edit the template (standard wording + lesson library).
// PRIVACY: the report is NEVER sent to the database. The child's name, birthday and notes stay
// in this browser tab until the supervisor downloads the report (or a draft file on their own
// computer). Only the template comes from the database. Signature pictures live in the private
// 'signatures' store: each supervisor can see only their own.
import { supa } from '../supabase.js';
import { esc, todayLocal } from '../ui.js';
import { icon } from '../icons.js';

const DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@9.5.0/+esm';
const must = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };
const api = {
  role: () => supa.rpc('intake_role').then(must),
  template: () => supa.rpc('intake_template').then(must),
  wordSave: (key, lang, body) => supa.rpc('intake_wording_save', { p_key: key, p_lang: lang, p_body: body }).then(must),
  lessonSave: (p) => supa.rpc('intake_lesson_save', { p }).then(must),
  lessonActive: (id, on) => supa.rpc('intake_lesson_set_active', { p_id: id, p_active: on }).then(must),
  signer: () => supa.rpc('intake_signer_me').then(must),
  signerSave: (s) => supa.rpc('intake_signer_save', { p_name: s.sign_name, p_title: s.title, p_credentials: s.credentials, p_sig_path: s.sig_path || null }).then(must),
};

// --- Fixed labels -----------------------------------------------------------------------------------------
const AREAS = ['social', 'language', 'ef', 'cognition', 'motor', 'adaptive', 'academic', 'play'];
const AREA_UI = { social: 'Social', language: 'Language', ef: 'Executive function', cognition: 'Cognition', motor: 'Motor', adaptive: 'Adaptive', academic: 'Academic', play: 'Play' };
const AREA_LABEL = {
  en: { social: 'Social', language: 'Language', ef: 'Executive Functioning', cognition: 'Cognition', motor: 'Motor', adaptive: 'Adaptive', academic: 'Academic', play: 'Play' },
  th: { social: 'ทักษะทางสังคม (Social Skills)', language: 'ทักษะทางภาษา (Language Skills)', ef: 'ทักษะการบริหารจัดการตนเอง (Executive Function)', cognition: 'ทักษะด้านการรับรู้และความเข้าใจ (Cognition Skills)',
    motor: 'ทักษะการเคลื่อนไหว (Motor Skills)', adaptive: 'ทักษะการดูแลตนเอง (Adaptive Skills)', academic: 'ทักษะทางวิชาการ (Academic Skills)', play: 'ทักษะการเล่น (Play Skills)' },
};
const CURR_LABEL = { en: { ...AREA_LABEL.en, ef: 'Executive Function', academic: 'Academic Skills' }, th: AREA_LABEL.th };
const CURR_ORDER = ['social', 'motor', 'language', 'adaptive', 'play', 'ef', 'cognition', 'academic'];
const LESSON_ORDER = { en: AREAS, th: CURR_ORDER };
const HEAD = {
  en: { name: 'Name', dob: 'Date of Birth', age: 'Age', assess: 'Date of Assessment', report: 'Date of Report', background: 'Background', skills: 'Skills Observed',
    behav: 'Behaviors Observed', curriculum: 'Curriculum', goals: 'Treatment Goals', lessons: 'Possible Lessons', recs: 'Recommendations' },
  th: { name: 'ชื่อ', dob: 'วันเกิด', age: 'อายุ', assess: 'วันที่ทำการประเมิน', report: 'วันที่ออกรายงาน', background: 'Background', skills: 'ทักษะที่สังเกตพบ (Skills Observed)',
    behav: 'พฤติกรรมที่สังเกตพบ (Behaviors Observed)', curriculum: 'หลักสูตรการสอน (Curriculum)', goals: 'Treatment Goals', lessons: 'Possible Lessons', recs: 'Recommendations' },
};
const PRON = { he: ['he', 'his', 'him'], she: ['she', 'her', 'her'], they: ['they', 'their', 'them'] };
const SEEN = { en: { mother: '{his} mother', father: '{his} father', parents: '{his} parents' }, th: { mother: 'มารดา', father: 'บิดา', parents: 'บิดาและมารดา' } };
const PLACE = { en: { home: 'home', centre: 'the CARE center', both: 'home and the CARE center' }, th: { home: 'บ้าน', centre: 'ศูนย์ CARE', both: 'บ้านและศูนย์ CARE' } };
const SOURCES = [['questionnaire', 'Parent questionnaire'], ['interview', 'Parent interview'], ['previous', 'Previous assessments'], ['observation', 'Observation in centre']];
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Template editor: what each wording is for. {name} etc. are filled in for each report.
const WORDING = [
  ['header_line', 'Page header (under the logo)'], ['title', 'Report title'],
  ['bg_intro', 'Background: first paragraph · {name} {seen_with} {date} {assessors} {sources}'],
  ['src_questionnaire', 'Source 1'], ['src_interview', 'Source 2'], ['src_previous', 'Source 3'], ['src_observation', 'Source 4 · {name}'],
  ['bg_more', 'Background: hint for the rest (not printed)'], ['skills_hint', 'Skills observed: hint (not printed)'], ['behav_hint', 'Behaviors observed: hint (not printed)'],
  ['curr_intro', 'Curriculum: opening text · {name}'],
  ...CURR_ORDER.map((a) => [`curr_${a}`, `Curriculum: ${AREA_UI[a]}`]),
  ['goals', 'Treatment goals · {name} {areas} {behaviour} {his} {delay}'],
  ['beh_typical', 'Problem behaviours: typical'], ['beh_higher', 'Problem behaviours: higher than peers'], ['beh_lower', 'Problem behaviours: lower than peers'],
  ['further_obs', 'Possible lessons: "further observation" line'],
  ['rec_skills', 'Recommendations: SKILLS assessment · {name} {his}'], ['rec_lead', 'Recommendations: lead-in · {name}'],
  ['rec_therapy', 'Recommendations: 1:1 therapy · {hours} {location} {name}'], ['rec_supervision', 'Recommendations: supervision · {hours} {name}'],
  ['rec_school_shadow', 'Recommendations: school with a shadow · {name} {his} {he}'], ['rec_school_not_yet', 'Recommendations: school not yet · {name} {he} {delay}'],
  ['rec_contact', 'Recommendations: contact line'],
];

let ctx; let panelEl; let onBack; let tpl = { wording: [], lessons: [] }; let signer = null; let S; let dirty = false;
const wd = (key, lang = S?.lang || 'en') => tpl.wording.find((w) => w.key === key && w.lang === lang)?.body
  ?? tpl.wording.find((w) => w.key === key)?.body ?? '';
const lessonName = (l, lang) => (lang === 'th' && l.name_th ? `${l.name_th} (${l.name_en})` : l.name_en);
const lessonExpl = (l, lang) => (lang === 'th' ? l.expl_th || l.expl_en : l.expl_en || l.expl_th) || '';
const msgEl = () => panelEl.querySelector('[data-ik-msg]');
function say(text, kind = 'error') { const m = msgEl(); if (!m) return; m.hidden = !text; m.className = kind === 'ok' ? 'muted small' : 'error'; m.textContent = text || ''; }

function blank() {
  const t = todayLocal();
  return { kind: 'care-intake-draft', v: 1, lang: 'en', name: '', pronoun: 'he', dob: '', assess_date: t, report_date: t,
    seen_with: 'mother', seen_other: '', assessors: signer?.sign_name || '', sources: { questionnaire: true, interview: true, previous: false, observation: true },
    bg_intro: '', bg_more: '', skills: '', behaviours: '', areas: [], behaviour: 'typical', delay: '', goals: '',
    lessons: [], further: [], rec_skills: true, hours: '', place: 'home', place_other: '', sup_hours: '', school: 'shadow', school_own: '', recs: '',
    edited: {} };
}

// --- Fill the blanks --------------------------------------------------------------------------------------
function fmtD(iso, lang = S.lang) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return lang === 'th' ? `${d} ${TH_MONTHS[m - 1]} ${y + 543}` : `${EN_MONTHS[m - 1]} ${d}, ${y}`;
}
function age() {
  if (!S.dob) return '';
  const at = S.assess_date || S.report_date || todayLocal();
  const [y1, m1, d1] = S.dob.split('-').map(Number); const [y2, m2, d2] = at.split('-').map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (months < 0) return '';
  const y = Math.floor(months / 12); months %= 12;
  return S.lang === 'th' ? `${y} ปี ${months} เดือน` : `${y} year${y === 1 ? '' : 's'} ${months} month${months === 1 ? '' : 's'}`;
}
const joinList = (items, lang) => (items.length < 2 ? items.join('') : lang === 'th'
  ? `${items.slice(0, -1).join(' ')} และ ${items.at(-1)}` : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
function fill(text, extra = {}) {
  const p = PRON[S.pronoun] || PRON.they;
  const map = { name: S.name.trim() || (S.lang === 'th' ? '(ชื่อ)' : '(name)'), he: p[0], his: p[1], him: p[2], delay: S.delay.trim() || '(…)', ...extra };
  // twice, so a filled value may itself hold {his} (e.g. "{his} mother")
  const once = (s) => s.replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
  return once(once(text));
}
const AUTO = {
  bg_intro() {
    const srcs = SOURCES.filter(([k]) => S.sources[k]).map(([k], i) => `(${i + 1}) ${wd(`src_${k}`)}`);
    return fill(wd('bg_intro'), { seen_with: S.seen_with === 'other' ? S.seen_other.trim() : SEEN[S.lang][S.seen_with],
      date: fmtD(S.assess_date) || '(…)', assessors: S.assessors.trim() || '(…)', sources: joinList(srcs, S.lang) });
  },
  goals() {
    const names = AREAS.filter((a) => S.areas.includes(a)).map((a) => (S.lang === 'th' ? AREA_LABEL.th[a] : AREA_LABEL.en[a].toLowerCase()));
    return fill(wd('goals'), { areas: joinList(names, S.lang) || '(…)', behaviour: fill(wd(`beh_${S.behaviour}`)) });
  },
  recs() {
    const place = S.place === 'other' ? S.place_other.trim() : PLACE[S.lang][S.place];
    const out = [];
    if (S.rec_skills) out.push(wd('rec_skills'));
    out.push(wd('rec_lead'));
    out.push(fill(wd('rec_therapy'), { hours: String(S.hours || '(…)'), location: place || '(…)' }));
    out.push(fill(wd('rec_supervision'), { hours: String(S.sup_hours || '(…)') }));
    if (S.school === 'shadow') out.push(wd('rec_school_shadow'));
    if (S.school === 'not_yet') out.push(wd('rec_school_not_yet'));
    if (S.school === 'own' && S.school_own.trim()) out.push(S.school_own.trim());
    out.push(wd('rec_contact'));
    return out.map((x) => fill(x)).join('\n');
  },
};
function refreshAuto() {
  for (const k of Object.keys(AUTO)) {
    if (S.edited[k]) continue;
    S[k] = AUTO[k]();
    const ta = panelEl.querySelector(`textarea[name="${k}"]`);
    if (ta && ta.value !== S[k]) ta.value = S[k];
  }
  const a = panelEl.querySelector('[data-age]'); if (a) a.value = age();
}

// --- Page -------------------------------------------------------------------------------------------------
export async function openBuilder(panel, context, back, draft = null) {
  ctx = context; panelEl = panel; onBack = back;
  panel.innerHTML = '<p class="muted">Loading the intake template…</p>';
  try { [tpl, signer] = await Promise.all([api.template(), api.signer()]); } catch (e) {
    panel.innerHTML = `<section class="card"><p class="error">${esc(e.message)}</p><button type="button" data-back>Back</button></section>`;
    panel.querySelector('[data-back]').addEventListener('click', back); return;
  }
  if (!tpl.wording.length) {
    panel.innerHTML = `<section class="card"><p class="error">The intake template isn’t loaded yet (Portal 069b, the private import file).</p><button type="button" data-back>Back</button></section>`;
    panel.querySelector('[data-back]').addEventListener('click', back); return;
  }
  S = { ...blank(), ...(draft || {}) };
  S.edited = S.edited || {};
  dirty = !!draft;
  drawBuilder();
  window.addEventListener('beforeunload', guard);
}
function guard(e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } }
function leave() {
  if (dirty && !confirm('Leave the intake report? Anything you haven’t downloaded is lost (nothing is saved in the Portal).')) return;
  window.removeEventListener('beforeunload', guard); dirty = false; S = null; onBack();
}

function drawBuilder() {
  const v = (k) => esc(S[k] ?? '');
  const sel = (k, opts) => `<select name="${k}">${opts.map(([val, lab]) => `<option value="${val}"${S[k] === val ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  const auto = (k) => `<span class="spacer"></span><button type="button" class="link small" data-redo="${k}" ${S.edited[k] ? '' : 'hidden'}>Rewrite from the blanks</button>`;
  panelEl.innerHTML = `
    <div class="page-head"><button type="button" class="link" data-back>← Reports & Forms</button><span class="spacer"></span>
      <div class="seg" role="tablist" aria-label="Report language">
        <button type="button" role="tab" data-lang="en" aria-selected="${S.lang === 'en'}">English</button>
        <button type="button" role="tab" data-lang="th" aria-selected="${S.lang === 'th'}">ไทย</button></div></div>
    <h1 class="page-title">Intake report</h1>
    <p class="ik-safe">${icon('lock')} <span>Nothing you type here is saved in the Portal. It stays in this tab until you download the report.
      To finish later, use <b>Save draft file</b> (it goes to your own computer, so keep it private and don’t share it).</span></p>
    <form class="rf-form ik-form" autocomplete="off">
      <fieldset class="rf-sec"><legend>1. Child details <span class="muted small">(only in the download)</span></legend>
        <div class="rf-grid">
          <label>Name<input name="name" maxlength="80" value="${v('name')}"></label>
          <label>Pronoun (English)${sel('pronoun', [['he', 'he / his'], ['she', 'she / her'], ['they', 'they / their']])}</label>
          <label>Date of birth<input type="date" name="dob" value="${v('dob')}"></label>
          <label>Age (worked out)<input data-age readonly tabindex="-1" value="${esc(age())}"></label>
          <label>Date of assessment<input type="date" name="assess_date" value="${v('assess_date')}"></label>
          <label>Date of report<input type="date" name="report_date" value="${v('report_date')}"></label>
        </div></fieldset>

      <fieldset class="rf-sec"><legend>2. Background</legend>
        <div class="rf-grid">
          <label>Seen with${sel('seen_with', [['mother', 'Mother'], ['father', 'Father'], ['parents', 'Both parents'], ['other', 'Someone else…']])}</label>
          <label data-show="seen_with=other"${S.seen_with === 'other' ? '' : ' hidden'}>Who<input name="seen_other" maxlength="80" value="${v('seen_other')}" placeholder="${S.lang === 'th' ? 'คุณยาย' : 'his grandmother'}"></label>
          <label class="rf-wide">Assessed by<input name="assessors" maxlength="200" value="${v('assessors')}" placeholder="Your name, assisted by …"></label>
        </div>
        <div class="rf-checks">${SOURCES.map(([k, l]) => `<label class="check"><input type="checkbox" name="src_${k}"${S.sources[k] ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div>
        <label><span class="ik-row">First paragraph (written for you) ${auto('bg_intro')}</span><textarea name="bg_intro" rows="4">${v('bg_intro')}</textarea></label>
        <label>The rest of the background<textarea name="bg_more" rows="6" placeholder="${esc(wd('bg_more'))}">${v('bg_more')}</textarea></label>
      </fieldset>

      <fieldset class="rf-sec"><legend>3. Skills and behaviours observed</legend>
        <label>Skills observed<textarea name="skills" rows="6" placeholder="${esc(wd('skills_hint'))}">${v('skills')}</textarea></label>
        <label>Behaviours observed<textarea name="behaviours" rows="6" placeholder="${esc(wd('behav_hint'))}">${v('behaviours')}</textarea></label>
        <p class="muted small">${icon('check')} The curriculum section (8 areas) is added from the template.</p>
      </fieldset>

      <fieldset class="rf-sec"><legend>4. Treatment goals</legend>
        <div><span class="muted small">Areas with deficits</span><div class="ik-chips" data-areas>${AREAS.map((a) => `<button type="button" class="small-btn${S.areas.includes(a) ? ' on' : ''}" data-area="${a}" aria-pressed="${S.areas.includes(a)}">${AREA_UI[a]}</button>`).join('')}</div></div>
        <div class="rf-grid">
          <label>Problem behaviours${sel('behaviour', [['typical', 'Typical for age'], ['higher', 'Higher than same-age peers'], ['lower', 'Lower than same-age peers']])}</label>
          <label>Most significant delay<input name="delay" maxlength="200" value="${v('delay')}" placeholder="${S.lang === 'th' ? 'ทักษะทางภาษา' : 'receptive and expressive language'}"></label>
        </div>
        <label><span class="ik-row">Treatment goals (written for you) ${auto('goals')}</span><textarea name="goals" rows="5">${v('goals')}</textarea></label>
      </fieldset>

      <fieldset class="rf-sec"><legend>5. Possible lessons <span class="muted small">(${tpl.lessons.filter((l) => l.active).length} in the library)</span></legend>
        <div class="ik-row"><select data-pick-area>${AREAS.map((a) => `<option value="${a}">${AREA_UI[a]}</option>`).join('')}</select>
          <input type="search" data-pick-q placeholder="Search lessons" aria-label="Search lessons"></div>
        <div class="ik-chips" data-pick-list></div>
        <div data-picked></div>
        <div><span class="muted small">Add “${esc(wd('further_obs'))}” for</span>
          <div class="ik-chips" data-further>${AREAS.map((a) => `<button type="button" class="small-btn${S.further.includes(a) ? ' on' : ''}" data-fa="${a}" aria-pressed="${S.further.includes(a)}">${AREA_UI[a]}</button>`).join('')}</div></div>
      </fieldset>

      <fieldset class="rf-sec"><legend>6. Recommendations</legend>
        <div class="rf-grid">
          <label>1:1 therapy (hours / week)<input type="number" name="hours" min="0" max="60" step="0.5" value="${v('hours')}"></label>
          <label>Where${sel('place', [['home', 'Home'], ['centre', 'CARE centre'], ['both', 'Home and centre'], ['other', 'Somewhere else…']])}</label>
          <label data-show="place=other"${S.place === 'other' ? '' : ' hidden'}>Where else<input name="place_other" maxlength="80" value="${v('place_other')}"></label>
          <label>Supervision (hours / month)<input type="number" name="sup_hours" min="0" max="80" step="0.5" value="${v('sup_hours')}"></label>
          <label>School${sel('school', [['shadow', 'With a school shadow'], ['not_yet', 'Not recommended yet'], ['own', 'Write my own'], ['none', 'Leave out']])}</label>
        </div>
        <label data-show="school=own"${S.school === 'own' ? '' : ' hidden'}>School recommendation<textarea name="school_own" rows="3">${v('school_own')}</textarea></label>
        <label class="check"><input type="checkbox" name="rec_skills"${S.rec_skills ? ' checked' : ''}> Recommend the SKILLS assessment</label>
        <label><span class="ik-row">Recommendations (written for you, one paragraph per line) ${auto('recs')}</span><textarea name="recs" rows="9">${v('recs')}</textarea></label>
      </fieldset>

      <fieldset class="rf-sec"><legend>Signed by</legend>
        <div class="ik-row">${signer?.sig_path ? '<img class="ik-sig" data-sig alt="Your signature">' : '<span class="muted small">No signature picture yet.</span>'}
          <span><b>${esc(signer?.sign_name || '')}</b><br><span class="muted small">${esc([signer?.title, signer?.credentials].filter(Boolean).join(' · '))}</span></span>
          <span class="spacer"></span><button type="button" class="small-btn" data-signer>Change</button></div>
      </fieldset>
    </form>
    <p data-ik-msg hidden></p>
    <div class="ik-bar">
      <button type="button" data-save-draft>Save draft file</button>
      <span class="spacer"></span>
      <button type="button" data-preview>Preview</button>
      <button type="button" data-pdf>PDF</button>
      <button type="button" class="primary" data-word>Download Word</button>
    </div>
    <dialog id="ik-dlg" class="dlg rf-dlg rf-full"></dialog>`;
  wire();
  refreshAuto();
  drawPickList(); drawPicked();
  showSig();
}

async function showSig() {
  const img = panelEl.querySelector('[data-sig]');
  if (!img || !signer?.sig_path) return;
  const url = await sigUrl(); if (url) img.src = url;
}
async function sigUrl() {
  if (!signer?.sig_path) return null;
  const { data } = await supa.storage.from('signatures').createSignedUrl(signer.sig_path, 600);
  return data?.signedUrl || null;
}

function wire() {
  const form = panelEl.querySelector('.ik-form');
  panelEl.querySelector('[data-back]').addEventListener('click', leave);
  form.addEventListener('submit', (e) => e.preventDefault());
  const onField = (e) => {
    const el = e.target; const k = el.name; if (!k) return;
    dirty = true; say('');
    if (k.startsWith('src_')) S.sources[k.slice(4)] = el.checked;
    else if (el.type === 'checkbox') S[k] = el.checked;
    else S[k] = el.value;
    if (k in AUTO && e.type === 'input') { S.edited[k] = true; panelEl.querySelector(`[data-redo="${k}"]`).hidden = false; }
    for (const box of panelEl.querySelectorAll('[data-show]')) { const [f, val] = box.dataset.show.split('='); box.hidden = S[f] !== val; }
    if (!(k in AUTO)) refreshAuto();
  };
  form.addEventListener('input', onField);
  form.addEventListener('change', onField);
  panelEl.querySelector('[data-areas]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-area]'); if (!b) return;
    const a = b.dataset.area; S.areas = S.areas.includes(a) ? S.areas.filter((x) => x !== a) : [...S.areas, a];
    b.classList.toggle('on'); b.setAttribute('aria-pressed', S.areas.includes(a)); dirty = true; refreshAuto();
  });
  panelEl.querySelector('[data-further]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fa]'); if (!b) return;
    const a = b.dataset.fa; S.further = S.further.includes(a) ? S.further.filter((x) => x !== a) : [...S.further, a];
    b.classList.toggle('on'); b.setAttribute('aria-pressed', S.further.includes(a)); dirty = true;
  });
  for (const b of panelEl.querySelectorAll('[data-redo]')) b.addEventListener('click', () => { S.edited[b.dataset.redo] = false; b.hidden = true; refreshAuto(); });
  panelEl.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
  panelEl.querySelector('[data-pick-area]').addEventListener('change', drawPickList);
  panelEl.querySelector('[data-pick-q]').addEventListener('input', drawPickList);
  panelEl.querySelector('[data-pick-list]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]'); if (!b) return;
    const l = tpl.lessons.find((x) => x.id === b.dataset.add);
    S.lessons.push({ id: l.id, area: l.area, name: lessonName(l, S.lang), expl: lessonExpl(l, S.lang), edited: false });
    dirty = true; drawPickList(); drawPicked();
  });
  const picked = panelEl.querySelector('[data-picked]');
  picked.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { S.lessons.splice(+b.dataset.rm, 1); drawPickList(); drawPicked(); } });
  picked.addEventListener('input', (e) => {
    const i = e.target.dataset.li; if (i === undefined) return;
    S.lessons[+i][e.target.dataset.f] = e.target.value; S.lessons[+i].edited = true; dirty = true;
  });
  panelEl.querySelector('[data-save-draft]').addEventListener('click', saveDraft);
  panelEl.querySelector('[data-preview]').addEventListener('click', preview);
  panelEl.querySelector('[data-pdf]').addEventListener('click', () => printPdf().catch((e) => say(e.message)));
  panelEl.querySelector('[data-word]').addEventListener('click', () => downloadWord().catch((e) => say(`Couldn’t make the Word file: ${e.message}`)));
  panelEl.querySelector('[data-signer]').addEventListener('click', () => signerDialog(() => { drawBuilder(); }));
}

function setLang(lang) {
  if (lang === S.lang) return;
  S.lang = lang;
  for (const p of S.lessons) {
    if (p.edited) continue;
    const l = tpl.lessons.find((x) => x.id === p.id); if (l) { p.name = lessonName(l, lang); p.expl = lessonExpl(l, lang); }
  }
  drawBuilder();
}

function drawPickList() {
  const area = panelEl.querySelector('[data-pick-area]').value;
  const q = panelEl.querySelector('[data-pick-q]').value.trim().toLowerCase();
  const have = new Set(S.lessons.map((p) => p.id));
  const list = tpl.lessons.filter((l) => l.active && !have.has(l.id) && (q ? `${l.name_en} ${l.name_th || ''}`.toLowerCase().includes(q) : l.area === area));
  panelEl.querySelector('[data-pick-list]').innerHTML = list.length
    ? list.slice(0, 60).map((l) => `<button type="button" class="small-btn" data-add="${esc(l.id)}" title="${esc(lessonExpl(l, S.lang))}">${icon('plus')} ${esc(lessonName(l, S.lang))}${q ? ` <span class="muted">· ${AREA_UI[l.area]}</span>` : ''}</button>`).join('')
    : '<span class="muted small">No more lessons here.</span>';
}
function drawPicked() {
  const box = panelEl.querySelector('[data-picked]');
  if (!S.lessons.length) { box.innerHTML = '<p class="muted small">Pick lessons above. Each one brings its explanation, which you can change for this child.</p>'; return; }
  box.innerHTML = AREAS.filter((a) => S.lessons.some((p) => p.area === a)).map((a) => `<div class="ik-group"><b>${AREA_UI[a]}</b>
    ${S.lessons.map((p, i) => (p.area !== a ? '' : `<div class="ik-lesson">
      <div class="ik-row"><input data-li="${i}" data-f="name" value="${esc(p.name)}" aria-label="Lesson name"><button type="button" class="link small" data-rm="${i}">Remove</button></div>
      <textarea data-li="${i}" data-f="expl" rows="2" aria-label="What this lesson teaches">${esc(p.expl)}</textarea></div>`)).join('')}</div>`).join('');
}

// --- Draft file (on the supervisor's own computer) ---------------------------------------------------------
function saveDraft() {
  const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
  saveBlob(blob, `Intake draft ${S.name.trim() || ''} ${todayLocal()}.json`.replace(/\s+/g, ' '));
  dirty = false; say('Draft saved to your computer. Use “Open draft file” to carry on.', 'ok');
}
export function pickDraft(onDraft) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d?.kind !== 'care-intake-draft') throw new Error('This isn’t an intake draft file.');
      onDraft(d);
    } catch (e) { alert(e.message.includes('JSON') ? 'This isn’t an intake draft file.' : e.message); }
  });
  inp.click();
}
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name.trim();
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// --- The report as blocks (shared by preview, PDF and Word) ------------------------------------------------
// Lines starting with •, - or * become bullets; other lines are paragraphs.
function textBlocks(text, leads = false) {
  return String(text || '').split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^[•\-*]\s*(.*)$/);
    if (m) return { t: 'li', text: m[1] };
    const lead = leads && s.match(/^(1:1 Therapy:|[^:]{2,60}?:)\s/);
    return lead ? { t: 'p', lead: lead[1], text: s.slice(lead[1].length).trim() } : { t: 'p', text: s };
  });
}
function blocks() {
  const L = S.lang; const H = HEAD[L];
  const b = [{ t: 'title', text: wd('title') },
    { t: 'fields', rows: [[H.name, S.name], [H.dob, fmtD(S.dob)], [H.age, age()], [H.assess, fmtD(S.assess_date)], [H.report, fmtD(S.report_date)]] },
    { t: 'h', text: H.background }, ...textBlocks(S.bg_intro), ...textBlocks(S.bg_more),
    { t: 'h', text: H.skills }, ...textBlocks(S.skills),
    { t: 'h', text: H.behav }, ...textBlocks(S.behaviours),
    { t: 'h', text: H.curriculum }, ...textBlocks(fill(wd('curr_intro'))),
    ...CURR_ORDER.map((a) => ({ t: 'li', lead: L === 'th' ? `${CURR_LABEL.th[a]} -` : `${CURR_LABEL.en[a]}:`, text: fill(wd(`curr_${a}`)) })),
    { t: 'h', text: H.goals }, ...textBlocks(S.goals),
    { t: 'h', text: H.lessons }];
  for (const a of LESSON_ORDER[L]) {
    const ls = S.lessons.filter((p) => p.area === a);
    if (!ls.length && !S.further.includes(a)) continue;
    b.push({ t: 'sub', text: AREA_LABEL[L][a] });
    for (const p of ls) b.push({ t: 'li', lead: `${p.name.trim()}:`, text: fill(p.expl.trim()) });
    if (S.further.includes(a)) b.push({ t: 'li', text: wd('further_obs') });
  }
  b.push({ t: 'h', text: H.recs }, ...textBlocks(S.recs, true), { t: 'sig' });
  return b;
}
function checkReady() {
  if (!S.name.trim()) throw new Error('Add the child’s name first (it stays only in the download).');
}

// --- Preview + PDF (the browser's print → Save as PDF) -----------------------------------------------------
function reportHtml(sig) {
  const one = (x) => {
    const lead = x.lead ? `<b>${esc(x.lead)}</b> ` : '';
    switch (x.t) {
      case 'title': return `<h2 class="ik-title">${esc(x.text)}</h2>`;
      case 'fields': return `<div class="ik-fields">${x.rows.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v || '')}</div>`).join('')}</div>`;
      case 'h': return `<h3>${esc(x.text)}</h3>`;
      case 'sub': return `<h4>${esc(x.text)}</h4>`;
      case 'li': return `<ul><li>${lead}${esc(x.text)}</li></ul>`;
      case 'sig': return `<div class="ik-sign">${sig ? `<img src="${esc(sig)}" alt="">` : '<div class="ik-sigline"></div>'}
        <div>${esc(signer?.sign_name || '')}</div><div>${esc(signer?.title || '')}</div><div>${esc(signer?.credentials || '')}</div></div>`;
      default: return `<p>${lead}${esc(x.text)}</p>`;
    }
  };
  return `<article class="ik-report" lang="${S.lang}"><header class="ik-head"><img src="assets/care-logo.png" alt="CARE"><div>${esc(wd('header_line'))}</div></header>
    ${blocks().map(one).join('').replace(/<\/ul><ul>/g, '')}</article>`;
}
async function preview() {
  const d = panelEl.querySelector('#ik-dlg');
  d.innerHTML = `<div class="rf-head"><h2>Preview</h2><span class="spacer"></span><button type="button" data-x>Close</button></div>${reportHtml(await sigUrl())}`;
  d.querySelector('[data-x]').addEventListener('click', () => d.close());
  d.showModal();
}
async function printPdf() {
  checkReady();
  const area = document.getElementById('print-area');
  area.innerHTML = reportHtml(await sigUrl());
  await Promise.all([...area.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
  const page = document.createElement('style');
  page.textContent = '@page { size: A4 portrait; margin: 18mm 20mm; }';
  document.head.append(page);
  const oldTitle = document.title;
  document.title = `Intake report ${S.name.trim()} ${S.report_date}`;
  const done = () => { area.innerHTML = ''; page.remove(); document.title = oldTitle; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  say('In the print window, choose “Save as PDF”.', 'ok');
  window.print();
}

// --- Word (.docx), made in the browser ---------------------------------------------------------------------
async function imageData(url) {
  const res = await fetch(url); if (!res.ok) throw new Error('image not found');
  const buf = await res.arrayBuffer();
  const img = await createImageBitmap(new Blob([buf]));
  return { buf, w: img.width, h: img.height, type: (res.headers.get('content-type') || '').includes('jp') ? 'jpg' : 'png' };
}
async function downloadWord() {
  checkReady();
  say('Making the Word file…', 'ok');
  const d = await import(DOCX_URL);
  const th = S.lang === 'th';
  // Thai needs the complex-script (cs) font slot set on every run, or Thai marks overlap.
  const font = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', cs: th ? 'TH Sarabun New' : 'Times New Roman', eastAsia: th ? 'TH Sarabun New' : 'Times New Roman' };
  const csSize = (half) => (th ? Math.round(half * 16 / 11) : half);
  const run = (text, o = {}) => new d.TextRun({ text, font, size: o.size || 22, sizeComplexScript: csSize(o.size || 22), bold: o.bold, underline: o.underline });
  const para = (children, o = {}) => new d.Paragraph({ children, ...o });
  const runs = (x) => [...(x.lead ? [run(`${x.lead} `, { bold: true })] : []), run(x.text || '')];
  const sigSrc = await sigUrl();
  const [logo, sig] = await Promise.all([imageData('assets/care-logo.png').catch(() => null), sigSrc ? imageData(sigSrc).catch(() => null) : null]);
  const children = [];
  for (const x of blocks()) {
    if (x.t === 'title') children.push(para([run(x.text, { bold: true, size: 28 })], { alignment: d.AlignmentType.CENTER, spacing: { after: 240 } }));
    else if (x.t === 'fields') x.rows.forEach(([k, v]) => children.push(para([run(`${k}: `, { bold: true }), run(v || '')], { spacing: { after: 40 } })));
    else if (x.t === 'h') children.push(para([run(`${x.text}:`, { bold: true, underline: {} })], { spacing: { before: 280, after: 120 } }));
    else if (x.t === 'sub') children.push(para([run(x.text, { bold: true })], { spacing: { before: 160, after: 60 } }));
    else if (x.t === 'li') children.push(para(runs(x), { bullet: { level: 0 } }));
    else if (x.t === 'p') children.push(para(runs(x), { alignment: d.AlignmentType.JUSTIFIED }));
    else if (x.t === 'sig') {
      children.push(para([], { spacing: { before: 360 } }));
      if (sig) { const w = 160; children.push(para([new d.ImageRun({ type: sig.type, data: sig.buf, transformation: { width: w, height: Math.round(w * sig.h / sig.w) } })])); }
      else children.push(para([run('______________________')]));
      [signer?.sign_name, signer?.title, signer?.credentials].filter(Boolean).forEach((t) => children.push(para([run(t, { bold: true })], { spacing: { after: 0 } })));
    }
  }
  const header = new d.Header({ children: [
    ...(logo ? [para([new d.ImageRun({ type: logo.type, data: logo.buf, transformation: { width: 110, height: Math.round(110 * logo.h / logo.w) } })], { alignment: d.AlignmentType.CENTER })] : []),
    para([run(wd('header_line'), { bold: true, size: 20 })], { alignment: d.AlignmentType.CENTER }),
  ] });
  const doc = new d.Document({
    styles: { default: { document: { run: { font, size: 22, sizeComplexScript: csSize(22) }, paragraph: { spacing: { line: th ? 360 : 276, after: 120 } } } } },
    sections: [{ properties: { page: { margin: { top: 1440, right: 1440, bottom: 993, left: 1440, header: 426, footer: 192 } } }, headers: { default: header }, children }],
  });
  saveBlob(await d.Packer.toBlob(doc), `Intake report ${S.name.trim()} ${S.report_date}.docx`);
  say('Word file downloaded. Keep it in CARE’s Drive, not on GitHub or in chats.', 'ok');
}

// --- My signature (each supervisor: their own only) --------------------------------------------------------
export async function signerDialog(after, host = panelEl, context = ctx) {
  ctx = context;
  if (!signer) signer = await api.signer();
  let d = host.querySelector('#ik-sdlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'ik-sdlg'; d.className = 'dlg'; host.append(d); }
  const me = ctx.me.id;
  d.innerHTML = `<form class="rf-form" method="dialog">
    <div class="rf-head"><h2>My signature</h2></div>
    <p class="muted small">${icon('lock')} Only you can see your signature picture. It is added to intake reports you download.</p>
    <label>Name as signed<input name="sign_name" maxlength="120" value="${esc(signer?.sign_name || '')}"></label>
    <label>Title<input name="title" maxlength="120" value="${esc(signer?.title || '')}"></label>
    <label>Credentials<input name="credentials" maxlength="120" value="${esc(signer?.credentials || '')}" placeholder="M.A., BCBA"></label>
    <div class="ik-row">${signer?.sig_path ? '<img class="ik-sig" data-sigp alt="Your signature">' : '<span class="muted small">No picture yet.</span>'}
      <span class="spacer"></span><label class="small-btn">Choose picture<input type="file" accept="image/png,image/jpeg" data-file hidden></label>
      ${signer?.sig_path ? '<button type="button" class="link small" data-rmsig>Remove picture</button>' : ''}</div>
    <p class="muted small">A photo or scan of your signature on white paper (PNG or JPG).</p>
    <p class="error" data-m hidden></p>
    <div class="dlg-actions"><span class="spacer"></span><button type="button" data-cancel>Cancel</button><button type="button" class="primary" data-ok>Save</button></div></form>`;
  const err = (t) => { const m = d.querySelector('[data-m]'); m.hidden = !t; m.textContent = t || ''; };
  let newPath = signer?.sig_path || null; let oldPath = null;
  if (newPath) sigUrl().then((u) => { const i = d.querySelector('[data-sigp]'); if (u && i) i.src = u; });
  d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
  d.querySelector('[data-rmsig]')?.addEventListener('click', () => { oldPath = newPath; newPath = null; d.querySelector('[data-sigp]')?.remove(); });
  d.querySelector('[data-file]').addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const png = await toPng(f);
      const path = `${me}/sig-${Date.now()}.png`;
      const { error } = await supa.storage.from('signatures').upload(path, png, { contentType: 'image/png', upsert: false });
      if (error) throw error;
      if (newPath && newPath !== signer?.sig_path) await supa.storage.from('signatures').remove([newPath]);
      if (signer?.sig_path && !oldPath) oldPath = signer.sig_path;
      newPath = path; err('');
      let i = d.querySelector('[data-sigp]');
      if (!i) { i = document.createElement('img'); i.className = 'ik-sig'; i.dataset.sigp = ''; d.querySelector('.ik-row').prepend(i); }
      i.src = URL.createObjectURL(png);
    } catch (x) { err(`Couldn’t upload the picture: ${x.message}`); }
  });
  d.querySelector('[data-ok]').addEventListener('click', async () => {
    const f = d.querySelector('form');
    const el = f.elements; const s = { sign_name: el.sign_name.value, title: el.title.value, credentials: el.credentials.value, sig_path: newPath };
    try {
      await api.signerSave(s);
      if (oldPath && oldPath !== newPath) await supa.storage.from('signatures').remove([oldPath]);
      signer = await api.signer(); d.close(); after?.();
    } catch (x) { err(x.message); }
  });
  d.showModal();
}
// Shrink to max 600 px wide and save as PNG (so Word and PDF both take it).
async function toPng(file) {
  if (file.size > 8 * 1024 * 1024) throw new Error('That picture is too big.');
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 600 / img.width);
  const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

// --- Template editor (Supervisors + Admin) -----------------------------------------------------------------
export async function openTemplateEditor(panel, context, back) {
  ctx = context; panelEl = panel;
  panel.innerHTML = '<p class="muted">Loading the intake template…</p>';
  try { tpl = await api.template(); } catch (e) { panel.innerHTML = `<section class="card"><p class="error">${esc(e.message)}</p></section>`; return; }
  let area = 'social'; let q = '';
  const draw = () => {
    const lessons = tpl.lessons.filter((l) => (q ? `${l.name_en} ${l.name_th || ''}`.toLowerCase().includes(q) : l.area === area));
    panel.innerHTML = `
      <div class="page-head"><button type="button" class="link" data-back>← Reports & Forms</button></div>
      <h1 class="page-title">Intake template</h1>
      <p class="muted small">Supervisors and Admin can change this. Changes are used in every new intake report. Words in {curly brackets} are filled in for each child.</p>
      <section class="card"><div class="page-head"><h2>Lesson library</h2><span class="spacer"></span><button type="button" class="primary" data-addl>${icon('plus')} Add lesson</button></div>
        <div class="ik-row"><select data-area>${AREAS.map((a) => `<option value="${a}"${a === area ? ' selected' : ''}>${AREA_UI[a]} (${tpl.lessons.filter((l) => l.area === a && l.active).length})</option>`).join('')}</select>
          <input type="search" data-q value="${esc(q)}" placeholder="Search all areas" aria-label="Search lessons"></div>
        <ul class="rf-list">${lessons.map((l) => `<li><button type="button" data-edit="${esc(l.id)}"><span><b>${esc(l.name_en)}</b>${l.name_th ? ` · ${esc(l.name_th)}` : ''}${q ? ` <span class="muted small">· ${AREA_UI[l.area]}</span>` : ''}<br>
          <span class="muted small">${esc((l.expl_en || '').slice(0, 140))}</span></span>${l.active ? '' : '<span class="chip">Hidden</span>'}</button></li>`).join('') || '<li class="muted small">No lessons.</li>'}</ul></section>
      <section class="card"><h2>Standard wording</h2>
        ${WORDING.map(([k, label]) => `<details class="ik-word"><summary>${esc(label)}</summary>
          <label>English<textarea data-w="${k}" data-lang="en" rows="3">${esc(wd(k, 'en'))}</textarea></label>
          <label>ไทย<textarea data-w="${k}" data-lang="th" rows="3">${esc(wd(k, 'th'))}</textarea></label>
          <div class="ik-row"><span class="muted small" data-wm="${k}"></span><span class="spacer"></span><button type="button" class="small-btn" data-wsave="${k}">Save</button></div></details>`).join('')}
      </section>
      <dialog id="ik-ldlg" class="dlg"></dialog>`;
    panel.querySelector('[data-back]').addEventListener('click', back);
    panel.querySelector('[data-area]').addEventListener('change', (e) => { area = e.target.value; q = ''; draw(); });
    const qi = panel.querySelector('[data-q]');
    qi.addEventListener('change', () => { q = qi.value.trim().toLowerCase(); draw(); });
    panel.querySelector('[data-addl]').addEventListener('click', () => lessonDialog({ area, active: true }));
    for (const b of panel.querySelectorAll('[data-edit]')) b.addEventListener('click', () => lessonDialog(tpl.lessons.find((l) => l.id === b.dataset.edit)));
    for (const b of panel.querySelectorAll('[data-wsave]')) b.addEventListener('click', async () => {
      const k = b.dataset.wsave; const m = panel.querySelector(`[data-wm="${k}"]`);
      try {
        for (const lang of ['en', 'th']) await api.wordSave(k, lang, panel.querySelector(`[data-w="${k}"][data-lang="${lang}"]`).value);
        tpl = await api.template(); m.textContent = 'Saved'; m.className = 'muted small';
      } catch (e) { m.textContent = e.message; m.className = 'error small'; }
    });
  };
  const lessonDialog = (l) => {
    const d = panel.querySelector('#ik-ldlg');
    d.innerHTML = `<form class="rf-form" method="dialog"><div class="rf-head"><h2>${l.id ? 'Edit lesson' : 'Add lesson'}</h2></div>
      <label>Area<select name="area">${AREAS.map((a) => `<option value="${a}"${a === l.area ? ' selected' : ''}>${AREA_UI[a]}</option>`).join('')}</select></label>
      <label>Name (English)<input name="name_en" maxlength="120" required value="${esc(l.name_en || '')}"></label>
      <label>Name (Thai, optional)<input name="name_th" maxlength="160" value="${esc(l.name_th || '')}"></label>
      <label>What it teaches (English)<textarea name="expl_en" rows="4" maxlength="2000">${esc(l.expl_en || '')}</textarea></label>
      <label>What it teaches (Thai)<textarea name="expl_th" rows="4" maxlength="2000">${esc(l.expl_th || '')}</textarea></label>
      <p class="error" data-m hidden></p>
      <div class="dlg-actions">${l.id ? `<button type="button" class="link small" data-hide>${l.active ? 'Hide from the builder' : 'Show again'}</button>` : ''}<span class="spacer"></span>
        <button type="button" data-cancel>Cancel</button><button type="button" class="primary" data-ok>Save</button></div></form>`;
    const f = d.querySelector('form'); const err = (t) => { const m = d.querySelector('[data-m]'); m.hidden = !t; m.textContent = t; };
    d.querySelector('[data-cancel]').addEventListener('click', () => d.close());
    d.querySelector('[data-hide]')?.addEventListener('click', async () => {
      try { await api.lessonActive(l.id, !l.active); tpl = await api.template(); d.close(); draw(); } catch (e) { err(e.message); }
    });
    d.querySelector('[data-ok]').addEventListener('click', async () => {
      const p = { id: l.id || null, area: f.area.value, name_en: f.name_en.value, name_th: f.name_th.value, expl_en: f.expl_en.value, expl_th: f.expl_th.value };
      try { await api.lessonSave(p); tpl = await api.template(); area = p.area; d.close(); draw(); } catch (e) { err(e.message); }
    });
    d.showModal();
  };
  draw();
}

export const intakeRole = () => api.role();
