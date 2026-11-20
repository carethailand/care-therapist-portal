// CARE Connect data. Reading goes through Row Level Security (own messages,
// messages to you, or the team a message was sent to); every change goes
// through a database function.
import { supa } from './supabase.js';
import { sortByName } from './ui.js';

const must = ({ data, error }) => {
  if (error) throw new Error(error.message || String(error));
  return data;
};
const COLS = 'id,kind,topic,send_to,recipient_id,body,anonymous,sender_id,status,assigned_to,first_reply_at,'
  + 'last_activity_at,created_at,forwarded_at,kudos_request,kudos_status,kudos_text,kudos_posted_at,sticker';

export const sendMessage = (m) => supa.rpc('connect_send', {
  p_kind: m.kind, p_topic: m.topic, p_send_to: m.sendTo, p_body: m.body, p_anonymous: m.anonymous,
  p_recipient: m.recipient || null, p_kudos: !!m.kudos, p_sticker: m.sticker || null,
  p_kudos_to: m.kudos ? (m.kudosTo || null) : null,
}).then(must);

export const people = () => supa.rpc('connect_people').then(must).then(sortByName);
// Everything I sent, named and anonymous (anonymous ones come from a locked
// private link, so they follow my account to any device).
export const myMessages = () => supa.rpc('connect_my_messages').then(must);
export const visibleMessages = () => supa.from('connect_messages').select(COLS)
  .order('created_at', { ascending: false }).then(must);

export const thread = (id) => supa.rpc('connect_thread', { p_message: id }).then(must);
export const reply = (id, body, internal = false, code = null) =>
  supa.rpc('connect_reply', { p_message: id, p_body: body, p_internal: internal, p_code: code }).then(must);
export const update = (id, { status = null, assigned = null, unassign = false }) =>
  supa.rpc('connect_update', { p_message: id, p_status: status, p_assigned: assigned, p_unassign: unassign }).then(must);
export const forward = (id) => supa.rpc('connect_forward', { p_message: id }).then(must);

export const kudosRequests = () => supa.rpc('connect_kudos_requests').then(must);
export const kudosDecide = (id, post, text, to = null) => supa.rpc('connect_kudos_decide', { p_message: id, p_post: post, p_text: text, p_to: to }).then(must);
export const kudosBoard = (limit = 50) => supa.rpc('connect_kudos_board', { p_limit: limit }).then(must);

// The CARE board (Portal 058): badge news + kudos, reactions, and the red dot.
export const boardFeed = (kind = 'all', limit = 20, before = null) =>
  supa.rpc('board_feed', { p_kind: kind, p_limit: limit, p_before: before }).then(must);
export const boardReact = (type, id, emoji) => supa.rpc('board_react', { p_type: type, p_id: id, p_emoji: emoji }).then(must);
export const connectDot = () => supa.rpc('connect_dot').then(must);
export const markSeen = () => supa.rpc('connect_mark_seen').then(must);
