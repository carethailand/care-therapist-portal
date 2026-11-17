// Learning Hub data. Leaves and skill points are worked out by the database
// functions (learning_log, learning_done, learning_review…); this file only
// asks for them and reads the results.
import { supa } from './supabase.js';

const must = ({ data, error }) => {
  if (error) throw new Error(error.message || String(error));
  return data;
};

export const loadTopics = () =>
  supa.from('learning_topics').select('*').order('sort_order').then(must);

export const loadResources = () =>
  supa.from('learning_resources').select('id, topic_code, kind, title, url, sort_order').order('sort_order').order('created_at').then(must);

export const summary = (who = null) => supa.rpc('learning_summary', { p_who: who }).then(must);

export const myReflections = (who) =>
  supa.from('learning_reflections').select('*').eq('therapist_id', who).order('created_at', { ascending: false }).limit(200).then(must);

export const myDone = (who) =>
  supa.from('learning_resource_done').select('resource_id, note, leaves, done_at').eq('therapist_id', who).then(must);

export const myLeaves = (who) =>
  supa.from('learning_leaves').select('amount, source, reason, created_at').eq('therapist_id', who)
    .order('created_at', { ascending: false }).limit(30).then(must);

export const start = (points) => supa.rpc('learning_start', { p_points: points }).then(must);

export const logStudy = (f) => supa.rpc('learning_log', {
  p_topic: f.topic || null, p_studied_on: f.studied_on, p_minutes: Number(f.minutes) || 30, p_resources: f.resources || null,
  p_studied: f.studied, p_clicked: f.clicked || null, p_question: f.question || null,
  p_feeling: f.feeling ? Number(f.feeling) : null, p_try_next: f.try_next || null,
}).then(must);

export const markDone = (resourceId, note) => supa.rpc('learning_done', { p_resource: resourceId, p_note: note }).then(must);

export const invest = (skill) => supa.rpc('learning_invest', { p_skill: skill }).then(must);

export const setLook = (bg, looks, animal) =>
  supa.rpc('learning_set_look', { p_bg: bg, p_looks: looks, p_animal: animal ?? null }).then(must);

// Everyone's trees (for Our Team): [{ id, points, bg, looks, animal }]
export const trees = () => supa.rpc('learning_trees').then(must);

// --- Supervisor / QCD / admin -----------------------------------------------------------------------
export const team = () => supa.rpc('learning_team').then(must);

export const toReview = () =>
  supa.from('learning_reflections').select('*').eq('status', 'submitted').order('created_at').limit(200).then(must);

export const review = (id, note) => supa.rpc('learning_review', { p_reflection: id, p_note: note || null }).then(must);

export const giveLeaves = (who, amount, reason) =>
  supa.rpc('learning_give', { p_therapist: who, p_amount: Number(amount), p_reason: reason }).then(must);

// Links (admin / supervisor / QCD)
export const saveResource = (r) => (r.id
  ? supa.from('learning_resources').update({ topic_code: r.topic_code, kind: r.kind, title: r.title, url: r.url }).eq('id', r.id)
  : supa.from('learning_resources').insert({ topic_code: r.topic_code, kind: r.kind, title: r.title, url: r.url, created_by: r.created_by })
).then(must);

export const deleteResource = (id) => supa.from('learning_resources').delete().eq('id', id).then(must);
