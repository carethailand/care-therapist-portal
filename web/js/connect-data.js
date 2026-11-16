// CARE Connect data. Reading goes through Row Level Security (own messages,
// messages to you, or the team a message was sent to); every change goes
// through a database function.
import { supa } from './supabase.js';

const must = ({ data, error }) => {
  if (error) throw new Error(error.message || String(error));
  return data;
};
const COLS = 'id,kind,topic,send_to,recipient_id,body,anonymous,sender_id,status,assigned_to,first_reply_at,'
  + 'last_activity_at,created_at,forwarded_at,kudos_request,kudos_status,kudos_text,kudos_posted_at';

export const sendMessage = (m) => supa.rpc('connect_send', {
  p_kind: m.kind, p_topic: m.topic, p_send_to: m.sendTo, p_body: m.body, p_anonymous: m.anonymous,
  p_recipient: m.recipient || null, p_kudos: !!m.kudos,
}).then(must);

export const people = () => supa.rpc('connect_people').then(must);
export const myMessages = (meId) => supa.from('connect_messages').select(COLS)
  .eq('sender_id', meId).order('created_at', { ascending: false }).then(must);
export const visibleMessages = () => supa.from('connect_messages').select(COLS)
  .order('created_at', { ascending: false }).then(must);

export const thread = (id) => supa.rpc('connect_thread', { p_message: id }).then(must);
export const checkCode = (code) => supa.rpc('connect_check', { p_code: code }).then(must);
export const reply = (id, body, internal = false, code = null) =>
  supa.rpc('connect_reply', { p_message: id, p_body: body, p_internal: internal, p_code: code }).then(must);
export const update = (id, { status = null, assigned = null, unassign = false }) =>
  supa.rpc('connect_update', { p_message: id, p_status: status, p_assigned: assigned, p_unassign: unassign }).then(must);
export const forward = (id) => supa.rpc('connect_forward', { p_message: id }).then(must);

export const kudosRequests = () => supa.rpc('connect_kudos_requests').then(must);
export const kudosDecide = (id, post, text) => supa.rpc('connect_kudos_decide', { p_message: id, p_post: post, p_text: text }).then(must);
export const kudosBoard = (limit = 50) => supa.rpc('connect_kudos_board', { p_limit: limit }).then(must);

// Anonymous codes are remembered on THIS device only, so the database never
// links an anonymous message to a person.
const KEY = 'care_connect_codes';
export function savedCodes() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
export function rememberCode(code) {
  try {
    const list = savedCodes().filter((c) => c.code !== code);
    list.unshift({ code, at: new Date().toISOString() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50)));
  } catch { /* storage blocked: the code is still shown to copy */ }
}
export function forgetCode(code) {
  try { localStorage.setItem(KEY, JSON.stringify(savedCodes().filter((c) => c.code !== code))); } catch { /* ignore */ }
}
