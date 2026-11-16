-- (keep) Portal 015 – CARE Connect: anonymous = hidden name (no codes)
--
-- Run AFTER 014. Decided by Songg (2026-11-16): anonymous messages now stay
-- with the sender's account, so they see them (and the replies) on any
-- device, with no backup codes.
--
-- HOW THE NAME STAYS HIDDEN
--   * The message itself still has NO sender (sender_id is empty).
--   * Who sent it is kept in a separate locked table in the private area of
--     the database. The Portal can't read that table: no screen, no admin,
--     no team member can see it. Only the database functions use it, and only
--     to show senders their own messages.
--   * The time of an anonymous message and of the sender's follow-ups is kept
--     as the day only, so it can't be matched to who was online.
--   * Someone opening the database directly (the project owner) could see the
--     link. CARE's rule (SAFEGUARDS 12): nobody ever looks.

begin;

-- 1. Conversation order by a running number (times may be day-only) -------------
alter table public.connect_replies add column if not exists seq bigint generated always as identity;

-- 2. The private link: anonymous message → sender ---------------------------------
create table private.connect_anon_senders (
  message_id uuid primary key references public.connect_messages (id) on delete cascade,
  sender_id  uuid not null references public.therapists (id) on delete cascade
);
alter table private.connect_anon_senders enable row level security;  -- no policies: functions only
revoke all on private.connect_anon_senders from public, anon, authenticated;

-- New anonymous messages don't need a code any more.
do $fix$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.connect_messages'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%ref_hash%'
  loop
    execute format('alter table public.connect_messages drop constraint %I', c.conname);
  end loop;
end $fix$;

-- Is the signed-in person the sender of this message (named or anonymous)?
create or replace function private.connect_is_sender(p_message uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.connect_messages m
                 where m.id = p_message and m.sender_id is not null
                   and m.sender_id = private.current_therapist_id())
      or exists (select 1 from private.connect_anon_senders a
                 where a.message_id = p_message and a.sender_id = private.current_therapist_id())
$$;

-- 3. Send ----------------------------------------------------------------------------
create or replace function public.connect_send(p_kind text, p_topic text, p_send_to text, p_body text,
                                               p_anonymous boolean, p_recipient uuid, p_kudos boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me    uuid := private.current_therapist_id();
  v_id    uuid;
  v_anon  boolean := coalesce(p_anonymous, false);
  v_kudos boolean := coalesce(p_kudos, false) and p_kind = 'thanks';
  v_when  timestamptz := case when coalesce(p_anonymous, false) then date_trunc('day', now()) else now() end;
begin
  if v_me is null then raise exception 'Please sign in again.'; end if;
  if btrim(coalesce(p_body, '')) = '' then raise exception 'Please write your message.'; end if;
  if p_kind = 'problem' and p_send_to <> 'admin' then raise exception 'Problems go to the Admin team.'; end if;
  if p_send_to = 'person' and p_recipient is null then raise exception 'Choose who the message is for.'; end if;
  if p_send_to = 'person' and p_recipient = v_me then raise exception 'You can''t send a message to yourself.'; end if;
  if v_anon and p_send_to = 'person' and p_kind <> 'thanks' then
    raise exception 'Messages to one person can be anonymous only if they''re a thank-you. Send it to a team instead.';
  end if;

  insert into public.connect_messages
    (kind, topic, send_to, recipient_id, body, anonymous, sender_id, ref_hash,
     kudos_request, kudos_status, created_at, last_activity_at)
  values
    (p_kind, coalesce(p_topic, 'other'), p_send_to, case when p_send_to = 'person' then p_recipient end,
     btrim(p_body), v_anon, case when v_anon then null else v_me end, null,
     v_kudos, case when v_kudos then 'requested' end, v_when, v_when)
  returning id into v_id;

  if v_anon then
    insert into private.connect_anon_senders (message_id, sender_id) values (v_id, v_me);
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- 4. My messages (named and anonymous), for the sender only --------------------------
create or replace function public.connect_my_messages()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'kind', m.kind, 'topic', m.topic, 'send_to', m.send_to, 'recipient_id', m.recipient_id,
           'body', m.body, 'anonymous', m.anonymous, 'status', m.status, 'created_at', m.created_at,
           'first_reply_at', m.first_reply_at, 'kudos_request', m.kudos_request, 'kudos_status', m.kudos_status)
         order by m.created_at desc), '[]'::jsonb)
  from public.connect_messages m
  where (m.sender_id is not null and m.sender_id = private.current_therapist_id())
     or exists (select 1 from private.connect_anon_senders a
                where a.message_id = m.id and a.sender_id = private.current_therapist_id())
$$;

-- 5. Conversation + replies -------------------------------------------------------------
create or replace function public.connect_thread(p_message uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_msg  public.connect_messages;
  v_team boolean;
begin
  select * into v_msg from public.connect_messages where id = p_message;
  if not found then raise exception 'Message not found.'; end if;
  v_team := private.connect_visible(v_msg.send_to, v_msg.recipient_id, v_msg.forwarded_at);
  if not v_team and not private.connect_is_sender(p_message) then raise exception 'Message not found.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'author_kind', r.author_kind,
             'author', case when r.author_kind = 'team' then coalesce(t.nickname, t.full_name)
                            when v_msg.anonymous then 'Anonymous sender'
                            else coalesce(t.nickname, t.full_name) end,
             'internal', r.internal, 'body', r.body, 'created_at', r.created_at) order by r.seq)
    from public.connect_replies r
    left join public.therapists t on t.id = r.author_id
    where r.message_id = p_message and (v_team or not r.internal)), '[]'::jsonb);
end $$;

create or replace function public.connect_reply(p_message uuid, p_body text, p_internal boolean, p_code text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me   uuid := private.current_therapist_id();
  v_msg  public.connect_messages;
  v_kind text;
  v_anon_sender boolean;
begin
  if v_me is null then raise exception 'Please sign in again.'; end if;
  if btrim(coalesce(p_body, '')) = '' then raise exception 'Please write a reply.'; end if;
  if p_code is not null then
    select * into v_msg from public.connect_messages where id = private.connect_by_code(p_code);
    if not found then raise exception 'No message matches this code.'; end if;
    v_kind := 'sender';
  else
    select * into v_msg from public.connect_messages where id = p_message;
    if not found then raise exception 'Message not found.'; end if;
    if private.connect_visible(v_msg.send_to, v_msg.recipient_id, v_msg.forwarded_at) then v_kind := 'team';
    elsif private.connect_is_sender(v_msg.id) then v_kind := 'sender';
    else raise exception 'You can''t reply to this message.';
    end if;
  end if;
  if v_kind = 'sender' and coalesce(p_internal, false) then raise exception 'Only the team can add internal notes.'; end if;
  if v_kind = 'team' and coalesce(p_internal, false) and v_msg.send_to = 'person' and v_msg.forwarded_at is null then
    raise exception 'Internal notes are for team inboxes.';
  end if;
  v_anon_sender := v_kind = 'sender' and v_msg.anonymous;

  insert into public.connect_replies (message_id, author_kind, author_id, internal, body, created_at)
  values (v_msg.id, v_kind, case when v_anon_sender then null else v_me end,
          coalesce(p_internal, false) and v_kind = 'team', btrim(p_body),
          case when v_anon_sender then date_trunc('day', now()) else now() end);

  update public.connect_messages
     set last_activity_at = case when v_anon_sender then date_trunc('day', now()) else now() end,
         first_reply_at = case when v_kind = 'team' and not coalesce(p_internal, false) and first_reply_at is null then now() else first_reply_at end,
         status = case when v_kind = 'team' and not coalesce(p_internal, false) and status = 'received' then 'in_progress'
                       when v_kind = 'sender' and status = 'resolved' then 'in_progress'
                       else status end
   where id = v_msg.id;
end $$;

revoke execute on function public.connect_send(text, text, text, text, boolean, uuid, boolean),
                           public.connect_my_messages(), public.connect_thread(uuid),
                           public.connect_reply(uuid, text, boolean, text)
  from public, anon;
grant  execute on function public.connect_send(text, text, text, text, boolean, uuid, boolean),
                           public.connect_my_messages(), public.connect_thread(uuid),
                           public.connect_reply(uuid, text, boolean, text)
  to authenticated;

revoke execute on all functions in schema private from public;
grant  execute on function private.current_therapist_id()          to authenticated;
grant  execute on function private.has_any_role(public.app_role[]) to authenticated;
grant  execute on function private.is_training_team()              to authenticated;
grant  execute on function private.is_leave_team()                 to authenticated;
grant  execute on function private.connect_visible(text, uuid, timestamptz) to authenticated;

commit;
