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
export function milestones(me, roles, longest = false) {
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
  }
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

export async function isLongest(me) {
  try {
    const { data, error } = await supa.rpc('milestone_longest');
    if (error) return false;
    return (data || []).some((row) => (typeof row === 'string' ? row : row.milestone_longest) === me.id);
  } catch {
    return false;
  }
}
