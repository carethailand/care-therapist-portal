// SAFMEDS practice (Say All Fast, a Minute Every Day, Shuffled).
// Learn: flip through a set, no timer. Timing: 1 minute, shuffled; say the
// answer, flip, mark Got it / Missed. The page sends only the two counts;
// the database (safmeds_record) decides leaves and "mastered".
import { supa } from './supabase.js';
import { esc, fmtDate, todayLocal } from './ui.js';
import { icon } from './icons.js';

const must = ({ data, error }) => {
  if (error) throw new Error(error.message || String(error));
  return data;
};

// --- data ---------------------------------------------------------------------------------------
export async function loadSafmeds() {
  try {
    const [sets, cards] = await Promise.all([
      supa.from('safmeds_sets').select('*').eq('active', true).order('sort_order').then(must),
      supa.from('safmeds_cards').select('*').order('sort_order').then(must),
    ]);
    return sets.map((s) => ({ ...s, cards: cards.filter((c) => c.set_id === s.id) }));
  } catch (e) {
    // Show why on the page (instead of quietly hiding SAFMEDS).
    console.warn('SAFMEDS did not load:', e);
    const none = [];
    none.error = e.message || String(e);
    return none;
  }
}
export const myTimings = (who) =>
  supa.from('safmeds_timings').select('set_id, correct, missed, done_on, created_at').eq('therapist_id', who)
    .order('created_at').then(must).catch(() => []);
const record = (setId, correct, missed) =>
  supa.rpc('safmeds_record', { p_set: setId, p_correct: correct, p_missed: missed }).then(must);

// Manage (supervisor / QCD / admin)
export async function saveSet(set, cards, removed) {
  let id = set.id;
  if (id) must(await supa.from('safmeds_sets').update({ title: set.title, aim_correct: set.aim_correct, aim_missed: set.aim_missed }).eq('id', id));
  else id = must(await supa.from('safmeds_sets').insert({ title: set.title, aim_correct: set.aim_correct, aim_missed: set.aim_missed, sort_order: set.sort_order }).select('id'))[0].id;
  for (const cid of removed) must(await supa.from('safmeds_cards').delete().eq('id', cid));
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const row = { front: c.front, back: c.back, sort_order: (i + 1) * 10 };
    if (c.id) must(await supa.from('safmeds_cards').update(row).eq('id', c.id));
    else must(await supa.from('safmeds_cards').insert({ ...row, set_id: id }));
  }
}
export const hideSet = (id) => supa.from('safmeds_sets').update({ active: false }).eq('id', id).then(must);

// --- progress -----------------------------------------------------------------------------------
// For one set: { best, last, aimDays (0–3), mastered, todayDone }
export function setProgress(set, timings, today) {
  const mine = timings.filter((t) => t.set_id === set.id);
  const aimDays = new Set(mine.filter((t) => t.correct >= set.aim_correct && t.missed <= set.aim_missed).map((t) => t.done_on)).size;
  return {
    best: mine.reduce((b, t) => Math.max(b, t.correct), 0),
    last: mine[mine.length - 1] || null,
    count: mine.length,
    aimDays: Math.min(3, aimDays),
    mastered: aimDays >= 3,
    todayDone: mine.some((t) => t.done_on === today),
  };
}

// Small chart of a set's timings: correct (green) and missed (red) per minute.
export function chartSvg(set, timings) {
  const pts = timings.filter((t) => t.set_id === set.id).slice(-20);
  if (!pts.length) return '';
  const W = 320, H = 120, P = 22;
  const max = Math.max(set.aim_correct + 5, ...pts.map((t) => Math.max(t.correct, t.missed)));
  const x = (i) => P + (pts.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (pts.length - 1));
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const line = (k) => pts.map((t, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(t[k]).toFixed(1)}`).join(' ');
  const dots = (k, cls) => pts.map((t, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(t[k]).toFixed(1)}" r="3" class="${cls}"><title>${fmtDate(t.done_on)}: ${t[k]}</title></circle>`).join('');
  return `<svg class="sf-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Your last ${pts.length} timings: correct and missed per minute">
    <line x1="${P}" x2="${W - P}" y1="${y(set.aim_correct)}" y2="${y(set.aim_correct)}" class="sf-aim"/>
    <text x="${W - P}" y="${y(set.aim_correct) - 4}" text-anchor="end" class="sf-aimtxt">aim ${set.aim_correct}</text>
    <path d="${line('correct')}" class="sf-line-ok"/><path d="${line('missed')}" class="sf-line-no"/>
    ${dots('correct', 'sf-dot-ok')}${dots('missed', 'sf-dot-no')}
  </svg>`;
}

// --- practice -----------------------------------------------------------------------------------
const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);

// dlg: the page's <dialog>; onSaved(result) after a saved timing.
export function practice(dlg, set, { timings = [], onSaved = () => {}, toast = () => {} } = {}) {
  let deck = [], i = 0, flipped = false, ok = 0, no = 0, timer = null, end = 0, mode = 'pick';
  const stop = () => { clearInterval(timer); timer = null; };
  const close = () => { stop(); document.removeEventListener('keydown', onKey); if (dlg.open) dlg.close(); };
  const left = () => Math.max(0, Math.ceil((end - Date.now()) / 1000));

  function pick() {
    mode = 'pick';
    stop();
    dlg.innerHTML = `<div class="sf">
      <div class="sf-head"><h2>${esc(set.title)}</h2><button type="button" class="link" data-x>Close</button></div>
      <p class="muted small">${set.cards.length} cards · aim: ${set.aim_correct}+ correct with ${set.aim_missed} or fewer missed in 1 minute.</p>
      ${chartSvg(set, timings)}
      <div class="sf-modes">
        <button type="button" data-learn>${icon('book')} Learn<span>Flip through the cards, no timer</span></button>
        <button type="button" class="primary" data-time>${icon('clock')} 1-minute timing<span>Shuffled · counts toward your leaves</span></button>
      </div>
    </div>`;
    dlg.querySelector('[data-x]').addEventListener('click', close);
    dlg.querySelector('[data-learn]').addEventListener('click', () => begin('learn'));
    dlg.querySelector('[data-time]').addEventListener('click', () => begin('time'));
  }

  function begin(m) {
    mode = m;
    deck = m === 'time' ? shuffle(set.cards) : [...set.cards];
    i = 0; ok = 0; no = 0; flipped = false;
    if (m === 'time') {
      end = Date.now() + 60_000;
      timer = setInterval(() => {
        const t = dlg.querySelector('[data-left]');
        if (t) t.textContent = `0:${String(left()).padStart(2, '0')}`;
        if (left() <= 0) finish();
      }, 250);
    }
    draw();
  }

  function draw() {
    const c = deck[i % deck.length];
    const time = mode === 'time';
    dlg.innerHTML = `<div class="sf">
      <div class="sf-head">
        ${time ? `<span class="sf-score"><span class="sf-ok">✓ ${ok}</span><span class="sf-no">✗ ${no}</span></span><span class="sf-timer" data-left>0:${String(left()).padStart(2, '0')}</span>`
          : `<span class="muted small">Card ${(i % deck.length) + 1} of ${deck.length}</span><button type="button" class="link" data-back>Done</button>`}
      </div>
      <button type="button" class="sf-card${flipped ? ' back' : ''}" data-flip aria-label="${flipped ? 'Answer' : 'Tap to see the answer'}">
        <span>${esc(flipped ? c.back : c.front)}</span></button>
      ${time
        ? (flipped ? `<div class="sf-marks"><button type="button" data-no>✗ Missed</button><button type="button" class="primary" data-ok>✓ Got it</button></div>`
          : '<p class="sf-hint">Say the answer out loud, then tap the card</p>')
        : `<div class="sf-marks"><button type="button" data-prev>← Back</button><button type="button" data-next>Next →</button></div>`}
    </div>`;
    dlg.querySelector('[data-flip]').addEventListener('click', () => { if (mode === 'time' && flipped) return; flipped = !flipped; draw(); });
    dlg.querySelector('[data-ok]')?.addEventListener('click', () => mark(true));
    dlg.querySelector('[data-no]')?.addEventListener('click', () => mark(false));
    dlg.querySelector('[data-next]')?.addEventListener('click', () => { i = (i + 1) % deck.length; flipped = false; draw(); });
    dlg.querySelector('[data-prev]')?.addEventListener('click', () => { i = (i - 1 + deck.length) % deck.length; flipped = false; draw(); });
    dlg.querySelector('[data-back]')?.addEventListener('click', pick);
  }

  function mark(got) {
    if (got) ok++; else no++;
    i++;
    if (i % deck.length === 0) deck = shuffle(deck);   // went through the set: reshuffle and keep going
    flipped = false;
    draw();
  }

  async function finish() {
    stop();
    mode = 'result';
    if (ok + no === 0) {
      dlg.innerHTML = `<div class="sf"><h2>Time's up</h2><p>No cards were marked, so nothing was saved.</p>
        <div class="sf-marks"><button type="button" data-again>Try again</button><button type="button" data-x>Close</button></div></div>`;
    } else {
      let res = null, err = '';
      try { res = await record(set.id, ok, no); } catch (e) { err = e.message; }
      if (res) timings.push({ set_id: set.id, correct: ok, missed: no, done_on: todayLocal(), created_at: new Date().toISOString() });
      const best = timings.filter((t) => t.set_id === set.id).reduce((b, t) => Math.max(b, t.correct), 0);
      dlg.innerHTML = `<div class="sf">
        <div class="sf-head"><h2>${esc(set.title)}</h2><button type="button" class="link" data-x>Close</button></div>
        <div class="sf-res">
          <div><b class="sf-ok">${ok}</b><span>correct</span></div>
          <div><b class="sf-no">${no}</b><span>missed</span></div>
          <div><b>${best}</b><span>your best</span></div>
        </div>
        ${err ? `<p class="error">Couldn't save: ${esc(err)}</p>` : `<p class="small">${res.aim_met ? '🎯 Aim met today! ' : ''}${res.mastered
          ? (res.new_master ? '🏆 <strong>Set mastered!</strong> +5 leaves.' : '✅ You’ve mastered this set. Keep it fresh!')
          : `Aim met on <strong>${res.aim_days} of 3</strong> days for mastery.`} ${res.leaves && !res.new_master ? '+1 leaf for today’s timing 🍃' : ''}</p>`}
        ${chartSvg(set, timings)}
        <div class="sf-marks"><button type="button" data-again>Again</button><button type="button" class="primary" data-x>Done</button></div>
      </div>`;
      if (res) { onSaved(res); if (res.leaves) toast(`+${res.leaves} ${res.leaves === 1 ? 'leaf' : 'leaves'} 🍃`); }
    }
    dlg.querySelector('[data-again]').addEventListener('click', () => begin('time'));
    dlg.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', close));
  }

  // Keyboard: Space flips; → / Enter = got it; ← = missed (timing) or previous (learn).
  function onKey(e) {
    if (!dlg.open || mode === 'pick' || mode === 'result') return;
    if (e.key === ' ') { e.preventDefault(); if (!(mode === 'time' && flipped)) { flipped = !flipped; draw(); } }
    else if (mode === 'time' && flipped && (e.key === 'ArrowRight' || e.key === 'Enter')) { e.preventDefault(); mark(true); }
    else if (mode === 'time' && flipped && e.key === 'ArrowLeft') { e.preventDefault(); mark(false); }
    else if (mode === 'learn' && e.key === 'ArrowRight') { i = (i + 1) % deck.length; flipped = false; draw(); }
    else if (mode === 'learn' && e.key === 'ArrowLeft') { i = (i - 1 + deck.length) % deck.length; flipped = false; draw(); }
  }
  document.addEventListener('keydown', onKey);
  dlg.addEventListener('close', () => { stop(); document.removeEventListener('keydown', onKey); }, { once: true });
  pick();
  if (!dlg.open) dlg.showModal();
}
