// Milestone badges: Passed probation, years at CARE, Longest-serving therapist.
// They unlock by themselves from what the Staff screen already keeps:
//   * Passed probation: journey stage is "Therapist" (active)
//   * 1, 2, 3, 4, 5, 7, 10 years: counted from the Start date
//   * Longest-serving: current therapist with the earliest Start date (a
//     database function decides; people who leave pass it on)
// Art: the blason set from Vecteezy.com (credit required), recoloured, with
// stars = years.
import { supa } from './supabase.js';
import { todayLocal } from './ui.js';
import { rankOf } from './labels.js';

export const YEARS = [1, 2, 3, 4, 5, 7, 10];
const WORD = { 3: 'Hat trick', 5: 'High five', 10: 'Legend' };
const THERAPIST_RANKS = ['therapist', 'senior', 'qcd', 'supervisor'];
const file = (name) => `assets/milestones/${name}.svg`;

// Achievement badges (round 2). Kudos = thank-yous GIVEN (Portal 043). They unlock from team_badges():
// { abat, safmeds, resources, logs, kudos } where the last three are the level
// reached: silver 1 / 5 / 8, gold 10 / 15 / 18, holographic 20 / 25 / 30
// (1, 2, 3 stars in each colour). ABAT and SAFMEDS are for the therapist ranks only.
const TIER = [1, 5, 8, 10, 15, 18, 20, 25, 30];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const FAMILY = [
  { key: 'resources', label: (n) => `${plural(n, 'resource', 'resources')} done`, lock: (n) => `Finish ${plural(n, 'Learning Hub resource', 'Learning Hub resources')}` },
  { key: 'logs', label: (n) => plural(n, 'reviewed study log', 'reviewed study logs'), lock: (n) => `Get ${plural(n, 'study log', 'study logs')} reviewed` },
  { key: 'kudos', label: (n) => (n === 1 ? 'Gave a kudos' : `Gave ${n} kudos`), lock: (n) => `Send ${plural(n, 'thank-you', 'thank-yous')} in CARE Connect (with your name)` },
  // Kudos received (Portal 055): thank-yous sent TO you with the sender's name
  { key: 'thanked', label: (n) => (n === 1 ? 'Received a kudos' : `Received ${n} kudos`), lock: (n) => `Receive ${plural(n, 'thank-you', 'thank-yous')} in CARE Connect (with the sender's name)` },
];
// Hand-given badges (Portal 055): Supervisor / QCD / admin give them in Our Team.
// They only appear once given — never as locked badges. (Art still to come: growth-seeker,
// shining-ray, bip-master, helping-hand.)
export const GIVEN = [
  { key: 'school-shadow', label: 'School shadow', about: 'Shadowed at school' },
  { key: 'supporter', label: 'Supporter', about: 'Always cheering people up' },
  { key: 'stimuli-master', label: 'Stimuli Master', about: 'Brings great stimuli ideas to the cases' },
  { key: 'unshakable', label: 'Unshakable', about: 'Great spirit in hard sessions; calm with big behaviour' },
];
export const givenImg = (key) => file(key);
// Every achievement for the collection: for the 1/5/10 families, the highest
// level reached plus the next one (locked). { key, label, img, earned, lockText }
function achievements(a = {}, clinical = true) {
  const out = [];
  // Newest therapist (Portal 044): like Longest-serving, always in the collection;
  // held by the therapist with the latest start date, then passed on.
  if (clinical) out.push({ key: 'newest', label: 'Newest therapist', img: file('newest'), earned: !!a.newest, on: null, lockText: 'Newest at CARE' });
  if (clinical) {
    out.push({ key: 'abat', label: 'ABAT passed', img: file('abat'), earned: !!a.abat, on: null, lockText: 'Unlocks when you pass ABAT' });
    out.push({ key: 'safmeds', label: 'SAFMEDS master', img: file('safmeds'), earned: !!a.safmeds, on: null, lockText: 'Master a SAFMEDS set' });
  }
  for (const g of GIVEN) {
    if (Number(a.gifts?.[g.key]) > 0) out.push({ key: g.key, label: g.label, img: file(g.key), earned: true, on: null, lockText: 'Given' });
  }
  for (const f of FAMILY) {
    const have = Number(a[f.key]) || 0;
    const next = TIER.find((n) => n > have);
    if (have) out.push({ key: `${f.key}-${have}`, label: f.label(have), img: file(`${f.key}-${have}`), earned: true, on: null, lockText: 'Earned' });
    if (next) out.push({ key: `${f.key}-${next}`, label: f.label(next), img: file(`${f.key}-${next}`), earned: false, on: null, lockText: f.lock(next) });
  }
  return out;
}

// ISO date + n years (29 Feb → 1 Mar in other years).
function addYears(iso, n) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(y + n, m - 1, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// Is this person on the CARE staff badge path? (not applicants or ABAT learners)
export function milestoneEligible(me, roles) {
  return me.track !== 'abat' && rankOf(roles) !== 'applicant';
}

// Every milestone with { key, label, word, img, earned, on (date earned or due) }.
// `longest` is the result of isLongest() (true / false).
export function milestones(me, roles, longest = false, ach = null) {
  // While someone has left, time stops on the day they left.
  const today = me.stage === 'exited' && me.exited_on ? me.exited_on : todayLocal();
  const list = [{
    key: 'probation', label: 'Passed probation', img: file('probation'),
    earned: me.stage === 'active' || (me.stage === 'exited' && !!me.probation_end_date && me.probation_end_date <= today),
    on: me.probation_end_date || null,
  }];
  for (const n of YEARS) {
    const on = me.start_date ? addYears(me.start_date, n) : null;
    list.push({
      key: `year-${n}`, years: n, label: `${n} year${n > 1 ? 's' : ''} at CARE`, word: WORD[n] || '',
      img: file(`year-${n}`), earned: !!on && on <= today, on,
    });
  }
  if (THERAPIST_RANKS.includes(rankOf(roles))) {
    list.push({ key: 'longest', label: 'Longest-serving therapist', img: file('longest'), earned: !!longest, on: null });
    // Advancement badges: earned with the rank (current Seniors and above
    // count as having completed Senior training before the Portal).
    const r = rankOf(roles);
    const atLeast = (k) => THERAPIST_RANKS.indexOf(r) >= THERAPIST_RANKS.indexOf(k);
    // QCD training: automatic for QCD; supervisors only if an admin verified it.
    const qcdDone = r === 'qcd' || (me.legacy_training || []).includes('qcd');
    list.push({ key: 'senior-training', label: 'Senior Therapist Training', img: file('senior-training'), earned: atLeast('senior'), on: null, lockText: 'Unlocks with Senior Training' });
    if (atLeast('senior')) list.push({ key: 'qcd-training', label: 'QCD Training', img: file('qcd-training'), earned: qcdDone, on: null, lockText: 'Unlocks with QCD Training' });
    if (atLeast('qcd')) list.push({ key: 'supervisor', label: 'Supervisor Training', img: file('supervisor'), earned: atLeast('supervisor'), on: null, lockText: 'Unlocks with Supervisor Training' });
  }
  if (ach) list.push(...achievements(ach, THERAPIST_RANKS.includes(rankOf(roles))));
  // Newest sits right after Longest-serving (a pair).
  const ni = list.findIndex((m) => m.key === 'newest'); const li = list.findIndex((m) => m.key === 'longest');
  if (ni > -1 && li > -1) list.splice(li + 1, 0, ...list.splice(ni, 1));
  return list;
}

// What Home shows: the latest year badge (it replaces the one before), plus
// Passed probation and Longest-serving when held. And the next one coming up.
export function showcase(list) {
  const years = list.filter((m) => m.years && m.earned);
  const shown = [
    ...(years.length ? [years[years.length - 1]] : []),
    ...list.filter((m) => m.key === 'probation' && m.earned),
    ...list.filter((m) => m.key === 'longest' && m.earned),
  ];
  const next = list.find((m) => m.years && !m.earned && m.on);
  return { shown, next };
}

// Badges for someone else's card, from team_directory()'s summary
// ({ years, probation_passed, longest }): latest year badge, probation, longest.
export function summaryBadges(p) {
  const out = [];
  const y = [...YEARS].reverse().find((n) => p.years != null && p.years >= n);
  if (y) out.push({ img: file(`year-${y}`), label: `${y} year${y > 1 ? 's' : ''} at CARE`, word: WORD[y] || '' });
  if (p.probation_passed) out.push({ img: file('probation'), label: 'Passed probation' });
  if (p.longest) out.push({ img: file('longest'), label: 'Longest-serving therapist' });
  return out;
}

export async function isLongest(me) {
  try {
    const { data, error } = await supa.rpc('milestone_longest');
    if (error) return false;
    return (data || []).some((row) => (typeof row === 'string' ? row : row.milestone_longest) === me.id);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Our Team badges (P8j). Everything a person has earned, worked out from
// team_directory() ({ years, probation_passed, longest, roles }) plus
// team_badges() ({ legacy_training, showcase }). Each person may choose up to
// 5 to show; badges not earned are never shown, even if chosen.
// ---------------------------------------------------------------------------
export const SHOW_MAX = 5;
const ACH_KEY = /^(abat|safmeds|(resources|logs|kudos|thanked)-\d+|school-shadow|supporter|stimuli-master|unshakable)$/;   // newest is shown with longest
const TRAINING = [
  { key: 'supervisor', label: 'Supervisor Training' },
  { key: 'qcd-training', label: 'QCD Training' },
  { key: 'senior-training', label: 'Senior Therapist Training' },
];

// All earned badges, best first: training, longest, years (newest first), probation.
export function earnedBadges(p, extra = {}) {
  const out = [];
  const r = rankOf(p.roles || []);
  if (THERAPIST_RANKS.includes(r)) {
    const atLeast = (k) => THERAPIST_RANKS.indexOf(r) >= THERAPIST_RANKS.indexOf(k);
    const qcdDone = r === 'qcd' || (extra.legacy_training || []).includes('qcd');
    const has = { supervisor: atLeast('supervisor'), 'qcd-training': atLeast('senior') && qcdDone, 'senior-training': atLeast('senior') };
    for (const t of TRAINING) if (has[t.key]) out.push({ key: t.key, img: file(t.key), label: t.label });
    if (p.longest) out.push({ key: 'longest', img: file('longest'), label: 'Longest-serving therapist' });
  }
  for (const n of [...YEARS].reverse()) {
    if (p.years != null && p.years >= n) out.push({ key: `year-${n}`, years: n, img: file(`year-${n}`), label: `${n} year${n > 1 ? 's' : ''} at CARE`, word: WORD[n] || '' });
  }
  if (p.probation_passed) out.push({ key: 'probation', img: file('probation'), label: 'Passed probation' });
  out.push(...achievements(extra, THERAPIST_RANKS.includes(r)).filter((m) => m.earned).map(({ key, img, label, word }) => ({ key, img, label, word })));
  return out;
}

// What a card shows: the person's choice (in their order), or, if they
// haven't chosen, the latest year + probation + longest + training (max 5).
// { shown, more } where more = how many earned badges aren't shown.
export function cardBadges(p, extra = {}) {
  const all = earnedBadges(p, extra);
  const pick = (extra.showcase || []).map((k) => all.find((b) => b.key === k)).filter(Boolean);
  let shown = pick;
  if (!pick.length) {
    const latestYear = all.find((b) => b.years);
    shown = [latestYear, ...all.filter((b) => ['probation', 'longest', 'newest'].includes(b.key)),
      ...all.filter((b) => TRAINING.some((t) => t.key === b.key)),
      ...all.filter((b) => ACH_KEY.test(b.key))].filter(Boolean).slice(0, SHOW_MAX);
  }
  return { shown, more: all.length - shown.length, all };
}
