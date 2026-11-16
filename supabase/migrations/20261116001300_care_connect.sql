-- (keep) Portal 013 – CARE Connect (messages to the team)
--
-- Therapists send an idea, concern, problem, question or thank-you to the
-- Admin team, the Supervisor & QCD team, or both. The team replies within
-- 5 working days.
--
-- ANONYMOUS MESSAGES
--   * No sender is stored at all (not even hidden).
--   * The sending time is rounded to the day, so it can't be matched to who
--     was online at that minute.
--   * The sender gets a private reference code, shown once. Only a fingerprint
--     (sha-256) of the code is stored. With the code they can read replies
--     and answer back. Nobody can recover a lost code.
--
-- WHO SEES WHAT
--   * Admin team = admin + HR: messages sent to "admin" or "both".
--   * Supervisor & QCD team = supervisor + QCD: messages sent to "sup" or "both".
--   * A named sender sees their own messages and the replies meant for them
--     (never the team's internal notes).

begin;

create or replace function private.connect_can_see(p_send_to text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (p_send_to in ('admin','both') and private.has_any_role(array['admin','hr']::public.app_role[]))
      or (p_send_to in ('sup','both')   and private.has_any_role(array['supervisor','qcd']::public.app_role[]))
$$;

create table public.connect_messages (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('idea','concern','problem','question','thanks')),
  topic            text not null default 'other'
                     check (topic in ('workplace','schedule','pay','training','team','other')),
  send_to          text not null check (send_to in ('admin','sup','both')),
  body             text not null check (char_length(body) between 1 and 4000),
  anonymous        boolean not null default false,
  sender_id        uuid references public.therapists (id) on delete set null,
  ref_hash         text unique,
  status           text not null default 'received' check (status in ('received','in_progress','resolved')),
  assigned_to      uuid references public.therapists (id) on delete set null,
  first_reply_at   timestamptz,
  last_activity_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  check (anonymous = (sender_id is null)),
  check (anonymous = (ref_hash is not null))
);
create index connect_messages_status_idx on public.connect_messages (status, created_at);
create index connect_messages_sender_idx on public.connect_messages (sender_id);

create table public.connect_replies (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.connect_messages (id) on delete cascade,
  author_kind text not null check (author_kind in ('team','sender')),
  author_id   uuid references public.therapists (id) on delete set null,  -- null for anonymous senders
  internal    boolean not null default false,                             -- team-only note
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now(),
  check (not internal or author_kind = 'team')
);
create index connect_replies_message_idx on public.connect_replies (message_id, created_at);

revoke all on public.connect_messages, public.connect_replies from anon;
-- Reading only; every change goes through the functions below.
grant select (id, kind, topic, send_to, body, anonymous, sender_id, status, assigned_to,
              first_reply_at, last_activity_at, created_at)
  on public.connect_messages to authenticated;
grant select on public.connect_replies to authenticated;

alter table public.connect_messages enable row level security;
alter table public.connect_replies  enable row level security;

create policy "connect_messages: own or team" on public.connect_messages
  for select to authenticated using (
    (sender_id is not null and sender_id = (select private.current_therapist_id()))
    or (select private.connect_can_see(send_to))
  );

create policy "connect_replies: team, or sender (not internal)" on public.connect_replies
  for select to authenticated using (
    exists (select 1 from public.connect_messages m
            where m.id = message_id
              and ( (select private.connect_can_see(m.send_to))
                    or (not internal and m.sender_id is not null
                        and m.sender_id = (select private.current_therapist_id())) ))
  );

-- Fingerprint of a reference code. Ignores dashes, spaces and letter case,
-- so "cc-abcde-12345" and "CC ABCDE 12345" both match.
create or replace function private.connect_fingerprint(p_code text)
returns text
language sql immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g'), 'UTF8')), 'hex')
$$;

-- Send a message. Returns {id, ref_code} (ref_code only for anonymous).
create or replace function public.connect_send(p_kind text, p_topic text, p_send_to text, p_body text, p_anonymous boolean)
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
  i      int;
begin
  if v_me is null then raise exception 'Please sign in again.'; end if;
  if btrim(coalesce(p_body, '')) = '' then raise exception 'Please write your message.'; end if;
  if coalesce(p_anonymous, false) then
    v_code := 'CC-';
    for i in 1..10 loop
      v_code := v_code || substr(v_abc, 1 + (get_byte(v_rand, i) % length(v_abc)), 1);
      if i = 5 then v_code := v_code || '-'; end if;
    end loop;
    insert into public.connect_messages (kind, topic, send_to, body, anonymous, sender_id, ref_hash, created_at, last_activity_at)
    values (p_kind, coalesce(p_topic, 'other'), p_send_to, btrim(p_body), true, null,
            private.connect_fingerprint(v_code),
            date_trunc('day', now()), date_trunc('day', now()))
    returning id into v_id;
    return jsonb_build_object('id', v_id, 'ref_code', v_code);
  end if;
  insert into public.connect_messages (kind, topic, send_to, body, anonymous, sender_id)
  values (p_kind, coalesce(p_topic, 'other'), p_send_to, btrim(p_body), false, v_me)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- Find an anonymous message by its code (null if no match).
create or replace function private.connect_by_code(p_code text)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select id from public.connect_messages
  where anonymous and ref_hash = private.connect_fingerprint(p_code)
$$;

-- Read an anonymous message and its replies (not internal notes) with the code.
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

-- Reply. Team members (who can see the message) may reply or add an internal
-- note; a named sender may answer on their own message; an anonymous sender
-- answers with p_code instead.
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
    if private.connect_can_see(v_msg.send_to) then v_kind := 'team';
    elsif v_msg.sender_id = v_me then v_kind := 'sender';
    else raise exception 'You can''t reply to this message.';
    end if;
  end if;
  if v_kind = 'sender' and coalesce(p_internal, false) then raise exception 'Only the team can add internal notes.'; end if;

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

-- The conversation on one message, with names. Team members see internal
-- notes; the sender doesn't. Anonymous senders use connect_check instead.
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
  v_team := private.connect_can_see(v_msg.send_to);
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

-- Team: change status and/or who is looking after it.
create or replace function public.connect_update(p_message uuid, p_status text, p_assigned uuid, p_unassign boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_msg public.connect_messages;
begin
  select * into v_msg from public.connect_messages where id = p_message;
  if not found or not private.connect_can_see(v_msg.send_to) then raise exception 'Message not found.'; end if;
  if p_status is not null and p_status not in ('received','in_progress','resolved') then raise exception 'Unknown status.'; end if;
  update public.connect_messages
     set status = coalesce(p_status, status),
         assigned_to = case when coalesce(p_unassign, false) then null else coalesce(p_assigned, assigned_to) end,
         last_activity_at = now()
   where id = p_message;
end $$;

revoke execute on function public.connect_send(text, text, text, text, boolean), public.connect_check(text),
                           public.connect_reply(uuid, text, boolean, text), public.connect_update(uuid, text, uuid, boolean),
                           public.connect_thread(uuid)
  from public, anon;
grant  execute on function public.connect_send(text, text, text, text, boolean), public.connect_check(text),
                           public.connect_reply(uuid, text, boolean, text), public.connect_update(uuid, text, uuid, boolean),
                           public.connect_thread(uuid)
  to authenticated;

revoke execute on all functions in schema private from public;
grant  execute on function private.current_therapist_id()          to authenticated;
grant  execute on function private.has_any_role(public.app_role[]) to authenticated;
grant  execute on function private.is_training_team()              to authenticated;
grant  execute on function private.is_leave_team()                 to authenticated;
grant  execute on function private.connect_can_see(text)          to authenticated;

-- The tab (hidden until you switch it on). Applicants don't get it.
insert into public.app_modules (key, label, description, sort_order, enabled, roles, phase)
values ('connect', 'CARE Connect', 'Ideas, concerns, problems, questions and thank-yous for the team', 25, false,
        array['admin','hr','supervisor','qcd','senior','therapist']::public.app_role[], 3)
on conflict (key) do nothing;

commit;
