-- (keep) Portal 014 – CARE Connect: more recipients + Kudos board
--
-- Run AFTER 013. Adds:
--   * new recipients: the Senior team, or ONE PERSON (only they see it; they
--     can pass it to the Admin team if it needs action)
--   * rules: a "problem" always goes to the Admin team; a message to one
--     person can be anonymous only if it's a thank-you
--   * Kudos board: a thank-you can ask Admin to post it; an admin approves
--     (and may tidy the wording); all CARE staff see the board

begin;

-- 1. New columns -------------------------------------------------------------
alter table public.connect_messages
  add column recipient_id  uuid references public.therapists (id) on delete set null,
  add column forwarded_at  timestamptz,     -- a direct message passed to the Admin team
  add column kudos_request boolean not null default false,
  add column kudos_status  text check (kudos_status in ('requested','posted','declined')),
  add column kudos_text    text check (char_length(kudos_text) <= 600),
  add column kudos_posted_at timestamptz,
  add column kudos_by      uuid references public.therapists (id) on delete set null;

do $fix$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.connect_messages'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%send_to%'
  loop
    execute format('alter table public.connect_messages drop constraint %I', c.conname);
  end loop;
end $fix$;

alter table public.connect_messages
  add constraint connect_messages_send_to_check check (send_to in ('admin','sup','senior','person','both')),
  add constraint connect_person_needs_recipient check ((send_to = 'person') = (recipient_id is not null)),
  add constraint connect_problem_to_admin check (kind <> 'problem' or send_to = 'admin'),
  add constraint connect_anon_person_thanks_only check (not (anonymous and send_to = 'person' and kind <> 'thanks')),
  add constraint connect_kudos_thanks_only check (not kudos_request or kind = 'thanks');

grant select (recipient_id, forwarded_at, kudos_request, kudos_status, kudos_text, kudos_posted_at)
  on public.connect_messages to authenticated;

-- 2. Who may see a message ------------------------------------------------------
create or replace function private.connect_visible(p_send_to text, p_recipient uuid, p_forwarded timestamptz)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (p_send_to in ('admin','both') and private.has_any_role(array['admin','hr']::public.app_role[]))
      or (p_send_to in ('sup','both')   and private.has_any_role(array['supervisor','qcd']::public.app_role[]))
      or (p_send_to = 'senior'          and private.has_any_role(array['senior']::public.app_role[]))
      or (p_send_to = 'person' and p_recipient = private.current_therapist_id())
      or (p_send_to = 'person' and p_forwarded is not null and private.has_any_role(array['admin','hr']::public.app_role[]))
$$;

alter policy "connect_messages: own or team" on public.connect_messages
  using (
    (sender_id is not null and sender_id = (select private.current_therapist_id()))
    or (select private.connect_visible(send_to, recipient_id, forwarded_at))
  );

alter policy "connect_replies: team, or sender (not internal)" on public.connect_replies
  using (
    exists (select 1 from public.connect_messages m
            where m.id = message_id
              and ( (select private.connect_visible(m.send_to, m.recipient_id, m.forwarded_at))
                    or (not internal and m.sender_id is not null
                        and m.sender_id = (select private.current_therapist_id())) ))
  );

-- 3. Names for choosing a person and showing who wrote (current CARE staff,
--    names only).
create or replace function public.connect_people()
returns table (id uuid, full_name text, nickname text)
language sql stable security definer
set search_path = ''
as $$
  select t.id, t.full_name, t.nickname
  from public.therapists t
  where (select private.current_therapist_id()) is not null
    and t.status <> 'exited' and t.track = 'care_hire'
    and exists (select 1 from public.staff_roles r
                where r.therapist_id = t.id and r.role <> 'applicant')
  order by coalesce(t.nickname, t.full_name)
$$;

-- 4. Send (new version with recipient + kudos request) --------------------------
drop function if exists public.connect_send(text, text, text, text, boolean);

create or replace function public.connect_send(p_kind text, p_topic text, p_send_to text, p_body text,
                                               p_anonymous boolean, p_recipient uuid, p_kudos boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me   uuid := private.current_therapist_id();
  v_code text;
  v_id   uuid;
  v_abc  text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_rand bytea := decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex');
  v_anon boolean := coalesce(p_anonymous, false);
  v_kudos boolean := coalesce(p_kudos, false) and p_kind = 'thanks';
  i      int;
begin
  if v_me is null then raise exception 'Please sign in again.'; end if;
  if btrim(coalesce(p_body, '')) = '' then raise exception 'Please write your message.'; end if;
  if p_kind = 'problem' and p_send_to <> 'admin' then raise exception 'Problems go to the Admin team.'; end if;
  if p_send_to = 'person' and p_recipient is null then raise exception 'Choose who the message is for.'; end if;
  if p_send_to = 'person' and p_recipient = v_me then raise exception 'You can''t send a message to yourself.'; end if;
  if v_anon and p_send_to = 'person' and p_kind <> 'thanks' then
    raise exception 'Messages to one person can be anonymous only if they''re a thank-you. Send it to a team instead.';
  end if;

  if v_anon then
    v_code := 'CC-';
    for i in 1..10 loop
      v_code := v_code || substr(v_abc, 1 + (get_byte(v_rand, i) % length(v_abc)), 1);
      if i = 5 then v_code := v_code || '-'; end if;
    end loop;
  end if;

  insert into public.connect_messages
    (kind, topic, send_to, recipient_id, body, anonymous, sender_id, ref_hash,
     kudos_request, kudos_status, created_at, last_activity_at)
  values
    (p_kind, coalesce(p_topic, 'other'), p_send_to, case when p_send_to = 'person' then p_recipient end,
     btrim(p_body), v_anon, case when v_anon then null else v_me end,
     case when v_anon then private.connect_fingerprint(v_code) end,
     v_kudos, case when v_kudos then 'requested' end,
     case when v_anon then date_trunc('day', now()) else now() end,
     case when v_anon then date_trunc('day', now()) else now() end)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'ref_code', v_code);
end $$;

-- 5. Thread / reply / update use the new visibility rule ------------------------
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
  if not v_team and (v_msg.sender_id is null or v_msg.sender_id <> private.current_therapist_id()) then
    raise exception 'Message not found.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'author_kind', r.author_kind,
             'author', case when r.author_kind = 'team' then coalesce(t.nickname, t.full_name)
                            when v_msg.anonymous then 'Anonymous sender'
                            else coalesce(t.nickname, t.full_name) end,
             'internal', r.internal, 'body', r.body, 'created_at', r.created_at) order by r.created_at)
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
    elsif v_msg.sender_id = v_me then v_kind := 'sender';
    else raise exception 'You can''t reply to this message.';
    end if;
  end if;
  if v_kind = 'sender' and coalesce(p_internal, false) then raise exception 'Only the team can add internal notes.'; end if;
  -- One person's inbox has no "team", so no internal notes there either.
  if v_kind = 'team' and coalesce(p_internal, false) and v_msg.send_to = 'person' and v_msg.forwarded_at is null then
    raise exception 'Internal notes are for team inboxes.';
  end if;

  insert into public.connect_replies (message_id, author_kind, author_id, internal, body)
  values (v_msg.id, v_kind,
          case when v_kind = 'sender' and v_msg.anonymous then null else v_me end,
          coalesce(p_internal, false) and v_kind = 'team', btrim(p_body));

  update public.connect_messages
     set last_activity_at = now(),
         first_reply_at = case when v_kind = 'team' and not coalesce(p_internal, false) and first_reply_at is null then now() else first_reply_at end,
         status = case when v_kind = 'team' and not coalesce(p_internal, false) and status = 'received' then 'in_progress'
                       when v_kind = 'sender' and status = 'resolved' then 'in_progress'
                       else status end
   where id = v_msg.id;
end $$;

create or replace function public.connect_update(p_message uuid, p_status text, p_assigned uuid, p_unassign boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_msg public.connect_messages;
begin
  select * into v_msg from public.connect_messages where id = p_message;
  if not found or not private.connect_visible(v_msg.send_to, v_msg.recipient_id, v_msg.forwarded_at) then
    raise exception 'Message not found.';
  end if;
  if p_status is not null and p_status not in ('received','in_progress','resolved') then raise exception 'Unknown status.'; end if;
  update public.connect_messages
     set status = coalesce(p_status, status),
         assigned_to = case when coalesce(p_unassign, false) then null else coalesce(p_assigned, assigned_to) end,
         last_activity_at = now()
   where id = p_message;
end $$;

-- Code lookup now also says who it was for and its kudos status.
create or replace function public.connect_check(p_code text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid := private.connect_by_code(p_code);
begin
  if private.current_therapist_id() is null then raise exception 'Please sign in again.'; end if;
  if v_id is null then raise exception 'No message matches this code. Check it and try again.'; end if;
  return (
    select jsonb_build_object(
      'id', m.id, 'kind', m.kind, 'topic', m.topic, 'send_to', m.send_to, 'body', m.body,
      'recipient_id', m.recipient_id, 'kudos_status', m.kudos_status,
      'status', m.status, 'created_at', m.created_at,
      'replies', coalesce((select jsonb_agg(jsonb_build_object(
                    'author_kind', r.author_kind,
                    'author', case when r.author_kind = 'team' then coalesce(t.nickname, t.full_name) end,
                    'body', r.body, 'created_at', r.created_at) order by r.created_at)
                  from public.connect_replies r
                  left join public.therapists t on t.id = r.author_id
                  where r.message_id = m.id and not r.internal), '[]'::jsonb))
    from public.connect_messages m where m.id = v_id);
end $$;

-- 6. The recipient passes a direct message to the Admin team -------------------
create or replace function public.connect_forward(p_message uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.connect_messages
     set forwarded_at = now(), last_activity_at = now()
   where id = p_message and send_to = 'person' and recipient_id = private.current_therapist_id()
     and forwarded_at is null;
  if not found then raise exception 'This message can''t be passed on.'; end if;
end $$;

-- 7. Kudos board ------------------------------------------------------------------
-- Admin posts (with tidied wording) or declines a kudos request.
create or replace function public.connect_kudos_decide(p_message uuid, p_post boolean, p_text text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_any_role(array['admin']::public.app_role[]) then
    raise exception 'Only an admin can post to the Kudos board.';
  end if;
  update public.connect_messages
     set kudos_status = case when p_post then 'posted' else 'declined' end,
         kudos_text = case when p_post then nullif(btrim(coalesce(p_text, '')), '') end,
         kudos_posted_at = case when p_post then now() end,
         kudos_by = private.current_therapist_id()
   where id = p_message and kudos_request;
  if not found then raise exception 'This isn''t a kudos request.'; end if;
end $$;

-- Kudos waiting for an admin (admins only).
create or replace function public.connect_kudos_requests()
returns table (id uuid, body text, sender text, recipient text, send_to text, created_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select m.id, m.body,
         case when m.anonymous then null else coalesce(s.nickname, s.full_name) end,
         coalesce(r.nickname, r.full_name), m.send_to, m.created_at
  from public.connect_messages m
  left join public.therapists s on s.id = m.sender_id
  left join public.therapists r on r.id = m.recipient_id
  where m.kudos_status = 'requested' and private.has_any_role(array['admin']::public.app_role[])
  order by m.created_at
$$;

-- The board: posted kudos, for current CARE staff (not applicants / ABAT learners).
create or replace function public.connect_kudos_board(p_limit integer)
returns table (id uuid, kudos text, from_name text, to_name text, to_team text, posted_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select m.id, coalesce(m.kudos_text, m.body),
         case when m.anonymous then null else coalesce(s.nickname, s.full_name) end,
         coalesce(r.nickname, r.full_name),
         case m.send_to when 'admin' then 'the Admin team' when 'sup' then 'the Supervisor & QCD team'
                        when 'senior' then 'the Senior team' when 'both' then 'the team' end,
         m.kudos_posted_at
  from public.connect_messages m
  left join public.therapists s on s.id = m.sender_id
  left join public.therapists r on r.id = m.recipient_id
  where m.kudos_status = 'posted'
    and exists (select 1 from public.therapists me
                where me.id = private.current_therapist_id() and me.track = 'care_hire')
    and exists (select 1 from public.staff_roles x
                where x.therapist_id = private.current_therapist_id() and x.role <> 'applicant')
  order by m.kudos_posted_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

-- 8. Privileges ---------------------------------------------------------------------
revoke execute on function public.connect_send(text, text, text, text, boolean, uuid, boolean),
                           public.connect_people(), public.connect_forward(uuid),
                           public.connect_kudos_decide(uuid, boolean, text), public.connect_kudos_requests(),
                           public.connect_kudos_board(integer)
  from public, anon;
grant  execute on function public.connect_send(text, text, text, text, boolean, uuid, boolean),
                           public.connect_people(), public.connect_forward(uuid),
                           public.connect_kudos_decide(uuid, boolean, text), public.connect_kudos_requests(),
                           public.connect_kudos_board(integer)
  to authenticated;

drop function if exists private.connect_can_see(text);

revoke execute on all functions in schema private from public;
grant  execute on function private.current_therapist_id()          to authenticated;
grant  execute on function private.has_any_role(public.app_role[]) to authenticated;
grant  execute on function private.is_training_team()              to authenticated;
grant  execute on function private.is_leave_team()                 to authenticated;
grant  execute on function private.connect_visible(text, uuid, timestamptz) to authenticated;

commit;
