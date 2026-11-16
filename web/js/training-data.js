// Training tab data. Row Level Security decides who sees what; exam
// questions and answers are only reachable through the exam_* functions,
// which never send answers to the browser.
import { supa } from './supabase.js';

const must = ({ data, error }) => {
  if (error) throw friendly(error);
  return data;
};

function friendly(error) {
  const msg = error?.message || String(error);
  if (/row-level security|permission denied/i.test(msg)) return new Error("You don't have permission for this.");
  if (/fetch|network/i.test(msg)) return new Error('No connection. Your answers are kept on this device; try again in a moment.');
  return new Error(msg);
}

// ---------------------------------------------------------------------------
// Content (everyone signed in)
// ---------------------------------------------------------------------------
export async function loadContent() {
  const [programs, steps, items] = await Promise.all([
    supa.from('training_programs').select('key,title,summary,accreditation,promotes_to,sort_order,enabled,certificate,certificate_title,provider_name,certificate_note,enrolment_weeks,enrolment_weeks_new_hire').order('sort_order').then(must),
    supa.from('training_steps').select('id,program_key,sort_order,kind,title,details,config').order('sort_order').then(must),
    supa.from('training_items').select('id,step_id,sort_order,title,url,kind,note,body').order('sort_order').then(must),
  ]);
  return { programs, steps, items };
}

// ---------------------------------------------------------------------------
// The signed-in trainee
// ---------------------------------------------------------------------------
const HOURS_COLS = 'id,enrollment_id,step_id,held_on,hours,topic,chapters';
const EVAL_COLS = 'id,enrollment_id,step_id,section,seq,case_code,held_on,marks,comment,assessor_id,updated_at';

export async function loadMyTraining(meId) {
  const enrollments = await supa
    .from('training_enrollments')
    .select('id,program_key,status,started_on,finished_on,due_on,extra_attempts,created_at')
    .eq('therapist_id', meId)
    .order('created_at', { ascending: false })
    .then(must);
  const ids = enrollments.map((e) => e.id);
  if (!ids.length) return { enrollments, done: [], stepsDone: [], attempts: [], certificates: [], results: [], hours: [], evals: [] };
  const [done, stepsDone, attempts, certificates, results, hours, evals] = await Promise.all([
    supa.from('training_item_done').select('enrollment_id,item_id').in('enrollment_id', ids).then(must),
    supa.from('training_step_done').select('enrollment_id,step_id,done_at').in('enrollment_id', ids).then(must),
    supa.from('exam_attempts').select('id,enrollment_id,step_id,started_at,deadline,submitted_at,status,passed').in('enrollment_id', ids).then(must),
    supa.from('certificates').select('id,code,program_key,enrollment_id,full_name,title,issued_on').eq('therapist_id', meId).then(must),
    // Recorded results (pass / not pass + date only), hours and practicum marks.
    // Older databases without these tables still load the page.
    supa.rpc('training_my_results').then(must).catch(() => []),
    supa.from('training_hours').select(HOURS_COLS).in('enrollment_id', ids).order('held_on').then(must).catch(() => []),
    supa.from('training_practicum_evals').select(EVAL_COLS).in('enrollment_id', ids).then(must).catch(() => []),
  ]);
  return { enrollments, done, stepsDone, attempts, certificates, results, hours, evals };
}

// "I have read and agree" (can't be undone by the trainee).
export async function agreeStep(enrollmentId, stepId) {
  const { error } = await supa.from('training_step_done').insert({ enrollment_id: enrollmentId, step_id: stepId });
  if (error && error.code !== '23505') throw friendly(error);
}

export async function setItemDone(enrollmentId, itemId, done) {
  const q = done
    ? supa.from('training_item_done').insert({ enrollment_id: enrollmentId, item_id: itemId })
    : supa.from('training_item_done').delete().eq('enrollment_id', enrollmentId).eq('item_id', itemId);
  const { error } = await q;
  if (error && error.code !== '23505') throw friendly(error);
}

export const examStart = (stepId) => supa.rpc('exam_start', { p_step: stepId }).then(must);
export const examSave = (attemptId, answers) => supa.rpc('exam_save', { p_attempt: attemptId, p_answers: answers }).then(must);
export const examMySummary = (attemptId) => supa.rpc('exam_my_summary', { p_attempt: attemptId }).then(must);
export const examReview = (attemptId) => supa.rpc('exam_attempt_review', { p_attempt: attemptId }).then(must);
export const examSubmit = (attemptId, answers) => supa.rpc('exam_submit', { p_attempt: attemptId, p_answers: answers }).then(must);

// ---------------------------------------------------------------------------
// Training team (admin, HR, supervisor, QCD)
// ---------------------------------------------------------------------------
export async function loadTeamProgram(programKey) {
  const enrollments = await supa
    .from('training_enrollments')
    .select('id,therapist_id,program_key,status,reason,recommended_by,started_on,finished_on,due_on,extra_attempts,promoted_on,created_at')
    .eq('program_key', programKey)
    .order('created_at', { ascending: false })
    .then(must);
  const ids = enrollments.map((e) => e.id);
  const [done, stepsDone, results, certificates, stepResults, hours, evals] = await Promise.all([
    ids.length ? supa.from('training_item_done').select('enrollment_id,item_id').in('enrollment_id', ids).then(must) : [],
    ids.length ? supa.from('training_step_done').select('enrollment_id,step_id,done_at').in('enrollment_id', ids).then(must) : [],
    supa.rpc('exam_results', { p_program: programKey }).then(must),
    supa.from('certificates').select('id,code,therapist_id,program_key,enrollment_id,full_name,title,issued_on').eq('program_key', programKey).then(must),
    ids.length ? supa.from('training_step_results').select('enrollment_id,step_id,held_on,score,full_score,passed,note,recorded_by,recorded_at').in('enrollment_id', ids).then(must).catch(() => []) : [],
    ids.length ? supa.from('training_hours').select(HOURS_COLS).in('enrollment_id', ids).order('held_on').then(must).catch(() => []) : [],
    ids.length ? supa.from('training_practicum_evals').select(EVAL_COLS).in('enrollment_id', ids).then(must).catch(() => []) : [],
  ]);
  return { enrollments, done, stepsDone, results, certificates, stepResults, hours, evals };
}

export const setDueDate = (enrollmentId, dueOn) =>
  supa.from('training_enrollments').update({ due_on: dueOn }).eq('id', enrollmentId).then(must);
// Admin: give people a place on a programme (e.g. senior therapists on ABAT).
export async function assignPeople(programKey, therapistIds, dueOn, approvedBy, startedOn) {
  const rows = therapistIds.map((id) => ({
    therapist_id: id, program_key: programKey, status: 'active', approved_by: approvedBy,
    started_on: startedOn, due_on: dueOn || null,
  }));
  const { error } = await supa.from('training_enrollments').insert(rows);
  if (error) {
    if (error.code === '23505') throw new Error('Someone in your selection already has a place on this programme.');
    throw friendly(error);
  }
}
// Supervisors recommend someone; an admin approves (place becomes active) or declines.
export async function recommend(programKey, therapistId, reason, meId) {
  const { error } = await supa.from('training_enrollments').insert({
    therapist_id: therapistId, program_key: programKey, status: 'recommended', reason, recommended_by: meId, started_on: null,
  });
  if (error) {
    if (error.code === '23505') throw new Error('This person already has a place (or a recommendation) for this programme.');
    throw friendly(error);
  }
}
export const approveRecommendation = (enrollmentId, meId, today) => supa.from('training_enrollments')
  .update({ status: 'active', approved_by: meId, started_on: today }).eq('id', enrollmentId).then(must);
export const declineRecommendation = (enrollmentId) => supa.from('training_enrollments')
  .update({ status: 'withdrawn' }).eq('id', enrollmentId).then(must);

// Assessors (supervisor, QCD, admin): recorded results, hours, practicum checklist.
export const recordResult = (enrollmentId, stepId, r) => supa.rpc('training_record_result', {
  p_enrollment: enrollmentId, p_step: stepId, p_passed: r.passed, p_score: r.score ?? null,
  p_full: r.full ?? null, p_held_on: r.heldOn || null, p_note: r.note || null,
}).then(must);
export async function logHours(rows) {
  const { error } = await supa.from('training_hours').insert(rows);
  if (error) throw friendly(error);
}
export const removeHours = (id) => supa.from('training_hours').delete().eq('id', id).then(must);
export async function saveEval(row) {
  const { error } = await supa.from('training_practicum_evals')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'enrollment_id,step_id,section,seq' });
  if (error) throw friendly(error);
}
export const promote = (enrollmentId) => supa.rpc('training_promote', { p_enrollment: enrollmentId }).then(must);

export const allowRetake = (enrollmentId) => supa.rpc('exam_allow_retake', { p_enrollment: enrollmentId }).then(must);

// ---------------------------------------------------------------------------
// Admin: content editor
// ---------------------------------------------------------------------------
export function saveItem({ id, ...fields }) {
  return (id
    ? supa.from('training_items').update(fields).eq('id', id)
    : supa.from('training_items').insert(fields)).then(must);
}
export const removeItem = (id) => supa.from('training_items').delete().eq('id', id).then(must);
export const saveProgram = (key, fields) => supa.from('training_programs').update(fields).eq('key', key).then(must);
export const saveStepConfig = (stepId, config) => supa.from('training_steps').update({ config }).eq('id', stepId).then(must);

export const questionsAdmin = (stepId) => supa.rpc('exam_questions_admin', { p_step: stepId }).then(must);
export const questionSave = (stepId, q) => supa.rpc('exam_question_save', { p_step: stepId, p_q: q }).then(must);
export const questionRemove = (id) => supa.rpc('exam_question_remove', { p_id: id }).then(must);
export const questionsImport = (stepId, data, replace) =>
  supa.rpc('exam_questions_import', { p_step: stepId, p_data: data, p_replace: replace }).then(must);

// Show / hide a tab for staff (admins always see every tab).
export const setModuleEnabled = (key, enabled) =>
  supa.from('app_modules').update({ enabled }).eq('key', key).then(must);
export const loadModule = (key) =>
  supa.from('app_modules').select('key,label,enabled').eq('key', key).maybeSingle().then(must);
