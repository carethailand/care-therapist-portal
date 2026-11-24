// Leave & HR data. Row Level Security decides who sees what: everyone sees
// their own leave; admin/HR see everyone's. Decisions go through functions.
import { supa } from './supabase.js';

const must = ({ data, error }) => {
  if (error) throw friendly(error);
  return data;
};
function friendly(error) {
  const msg = error?.message || String(error);
  if (/row-level security|permission denied/i.test(msg)) return new Error("You don't have permission for this.");
  if (/case_code/i.test(msg)) return new Error('Use the 3-letter case code only (e.g. ABC), never a name.');
  if (/leave_requests_check|days/i.test(msg) && /check/i.test(msg)) return new Error('Please check the dates and the number of days.');
  return new Error(msg);
}

// ---------------------------------------------------------------------------
// Days: 6-day staff count Monday–Saturday; 5-day staff (senior, QCD,
// supervisor) count Monday–Friday. Sundays never count. Half day = 0.5,
// quarter day ('am_q' / 'pm_q' in the form) = 0.25.
// ---------------------------------------------------------------------------
export const FIVE_DAY_RANKS = ['senior', 'qcd', 'supervisor'];
export function countDays(startIso, endIso, halfDay, fiveDayWeek = false) {
  if (!startIso || !endIso || endIso < startIso) return 0;
  if (halfDay) return String(halfDay).endsWith('_q') ? 0.25 : 0.5;
  const [y1, m1, d1] = startIso.split('-').map(Number);
  const [y2, m2, d2] = endIso.split('-').map(Number);
  const end = new Date(y2, m2 - 1, d2);
  let n = 0;
  for (let d = new Date(y1, m1 - 1, d1); d <= end; d.setDate(d.getDate() + 1)) {
    const wd = d.getDay();
    if (wd !== 0 && !(fiveDayWeek && wd === 6)) n += 1;
  }
  return n;
}

// Calendar days from today (Bangkok) until a date; negative if past.
export function daysUntil(iso, todayIso) {
  const a = Date.UTC(...todayIso.split('-').map((v, i) => (i === 1 ? v - 1 : +v)));
  const b = Date.UTC(...iso.split('-').map((v, i) => (i === 1 ? v - 1 : +v)));
  return Math.round((b - a) / 86400000);
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
export async function loadLeaveRef() {
  const [types, kinds] = await Promise.all([
    supa.from('leave_types').select('code,label,max_days,per_person,notice_days,needs_kind,sort_order,active').order('sort_order').then(must),
    supa.from('leave_kinds').select('code,label,max_days,sort_order').order('sort_order').then(must),
  ]);
  return { types: types.filter((t) => t.active), kinds };
}

export const staffPicklist = () => supa.rpc('staff_picklist').then(must);

const REQ_COLS = 'id,therapist_id,type,kind,reason,start_date,end_date,half_day,days,status,submitted_at,decided_by,decided_at,decision_note,families_notified_on,notified_by,cancel_requested_at,cancel_reason,cancel_note,edited_at';
const SES_COLS = 'id,request_id,case_code,session_date,session_time,cover_kind,covering_therapist_id,makeup_date,makeup_time,arranged_by,arranged_at';

async function withSessions(requests) {
  const ids = requests.map((r) => r.id);
  const sessions = ids.length
    ? await supa.from('leave_sessions').select(SES_COLS).in('request_id', ids).order('session_date').then(must)
    : [];
  return requests.map((r) => ({ ...r, sessions: sessions.filter((s) => s.request_id === r.id) }));
}

// ---------------------------------------------------------------------------
// Mine
// ---------------------------------------------------------------------------
export async function loadMyLeave(meId, year) {
  const [ent, requests] = await Promise.all([
    supa.from('leave_entitlements').select('therapist_id,year,al_days,carry_over_days,carry_over_until,note')
      .eq('therapist_id', meId).eq('year', year).maybeSingle().then(must),
    supa.from('leave_requests').select(REQ_COLS).eq('therapist_id', meId)
      .gte('start_date', `${year}-01-01`).lte('start_date', `${year}-12-31`)
      .order('start_date', { ascending: false }).then(must),
  ]);
  return { entitlement: ent, requests: await withSessions(requests) };
}

export async function submitLeave(request, sessions) {
  const { data, error } = await supa.from('leave_requests').insert(request).select('id').single();
  if (error) throw friendly(error);
  if (sessions.length) {
    const { error: e2 } = await supa.from('leave_sessions').insert(sessions.map((s) => ({ ...s, request_id: data.id })));
    if (e2) {
      await supa.rpc('leave_cancel', { p_id: data.id }); // don't leave half a request behind
      throw friendly(e2);
    }
  }
  return data.id;
}

// Change a request while it's still pending (Portal 057): fields + the sessions list.
export const editLeave = (id, r, sessions) => supa.rpc('leave_request_edit', {
  p_id: id, p_type: r.type, p_kind: r.kind, p_reason: r.reason, p_start: r.start_date, p_end: r.end_date,
  p_half: r.half_day, p_days: r.days, p_sessions: sessions,
}).then(must);
export const cancelLeave = (id) => supa.rpc('leave_cancel', { p_id: id }).then(must);
// Approved leave: the therapist asks Admin / HR to cancel it (Portal 046).
export const requestCancel = (id, reason) => supa.rpc('leave_request_cancel', { p_id: id, p_reason: reason }).then(must);
export const withdrawCancel = (id) => supa.rpc('leave_request_cancel_withdraw', { p_id: id }).then(must);
export const decideCancel = (id, approve, note) => supa.rpc('leave_cancel_decide', { p_id: id, p_approve: approve, p_note: note }).then(must);

// ---------------------------------------------------------------------------
// Admin / HR
// ---------------------------------------------------------------------------
export async function loadTeamLeave(year) {
  const [requests, entitlements] = await Promise.all([
    supa.from('leave_requests').select(REQ_COLS)
      .gte('start_date', `${year}-01-01`).lte('start_date', `${year}-12-31`)
      .order('start_date', { ascending: true }).then(must),
    supa.from('leave_entitlements').select('therapist_id,year,al_days,carry_over_days,carry_over_until,note').eq('year', year).then(must),
  ]);
  return { requests: await withSessions(requests), entitlements };
}

export const decideLeave = (id, approve, note) => supa.rpc('leave_decide', { p_id: id, p_approve: approve, p_note: note }).then(must);
export const markNotified = (id, date) => supa.rpc('leave_mark_notified', { p_id: id, p_date: date }).then(must);
// Admin: what happens to one missed session ('cancelled' | 'cover' | 'makeup' | null).
export const arrangeSession = (id, kind, cover, makeupDate, makeupTime) =>
  supa.rpc('leave_session_arrange', { p_session: id, p_kind: kind, p_cover: cover, p_makeup_date: makeupDate, p_makeup_time: makeupTime }).then(must);
export const saveEntitlement = (row) =>
  supa.from('leave_entitlements').upsert(row, { onConflict: 'therapist_id,year' }).then(must);
