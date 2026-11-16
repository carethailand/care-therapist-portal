-- (keep) Portal 016 – Kudos stickers + milestone badges
--
-- Run AFTER 015. Adds:
--   * a sticker on a thank-you (picked from the Portal's sticker set; shown on
--     the message, the Kudos board and the Home card)
--   * "Longest-serving therapist": a small function that says who holds the
--     badge (current CARE therapist with the earliest Start date; ties share it)
-- Year badges and "Passed probation" need no database change: they come from
-- the Start date and the journey stage the Staff screen already keeps.

begin;

-- 1. Sticker on a thank-you ----------------------------------------------------------
alter table public.connect_messages
  add column if not exists sticker text;

alter table public.connect_messages
  drop constraint if exists connect_sticker_ok,
  add constraint connect_sticker_ok
    check (sticker is null or (kind = 'thanks' and sticker ~ '^[a-z][a-z0-9-]{1,30}$'));

grant select (sticker) on public.connect_messages to authenticated;

-- 2. Send (now with a sticker) --------------------------------------------------------
drop function if exists public.connect_send(text, text, text, text, boolean, uuid, boolean);

create or replace function public.connect_send(p_kind text, p_topic text, p_send_to text, p_body text,
                                               p_anonymous boolean, p_recipient uuid, p_kudos boolean,
                                               p_sticker text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me      uuid := private.current_therapist_id();
  v_id      uuid;
  v_anon    boolean := coalesce(p_anonymous, false);
  v_kudos   boolean := coalesce(p_kudos, false) and p_kind = 'thanks';
  v_sticker text := case when p_kind = 'thanks' then nullif(btrim(coalesce(p_sticker, '')), '') end;
  v_when    timestamptz := case when coalesce(p_anonymous, false) then date_trunc('day', now()) else now() end;
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
     kudos_request, kudos_status, sticker, created_at, last_activity_at)
  values
    (p_kind, coalesce(p_topic, 'other'), p_send_to, case when p_send_to = 'person' then p_recipient end,
     btrim(p_body), v_anon, case when v_anon then null else v_me end, null,
     v_kudos, case when v_kudos then 'requested' end, v_sticker, v_when, v_when)
  returning id into v_id;

  if v_anon then
    insert into private.connect_anon_senders (message_id, sender_id) values (v_id, v_me);
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- 3. My messages: include the sticker --------------------------------------------------
create or replace function public.connect_my_messages()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'kind', m.kind, 'topic', m.topic, 'send_to', m.send_to, 'recipient_id', m.recipient_id,
           'body', m.body, 'anonymous', m.anonymous, 'status', m.status, 'created_at', m.created_at,
           'first_reply_at', m.first_reply_at, 'kudos_request', m.kudos_request, 'kudos_status', m.kudos_status,
           'sticker', m.sticker)
         order by m.created_at desc), '[]'::jsonb)
  from public.connect_messages m
  where (m.sender_id is not null and m.sender_id = private.current_therapist_id())
     or exists (select 1 from private.connect_anon_senders a
                where a.message_id = m.id and a.sender_id = private.current_therapist_id())
$$;

-- 4. Kudos requests + board: include the sticker -----------------------------------------
drop function if exists public.connect_kudos_requests();
create function public.connect_kudos_requests()
returns table (id uuid, body text, sender text, recipient text, send_to text, created_at timestamptz, sticker text)
language sql stable security definer
set search_path = ''
as $$
  select m.id, m.body,
         case when m.anonymous then null else coalesce(s.nickname, s.full_name) end,
         coalesce(r.nickname, r.full_name), m.send_to, m.created_at, m.sticker
  from public.connect_messages m
  left join public.therapists s on s.id = m.sender_id
  left join public.therapists r on r.id = m.recipient_id
  where m.kudos_status = 'requested' and private.has_any_role(array['admin']::public.app_role[])
  order by m.created_at
$$;

drop function if exists public.connect_kudos_board(integer);
create function public.connect_kudos_board(p_limit integer)
returns table (id uuid, kudos text, from_name text, to_name text, to_team text, posted_at timestamptz, sticker text)
language sql stable security definer
set search_path = ''
as $$
  select m.id, coalesce(m.kudos_text, m.body),
         case when m.anonymous then null else coalesce(s.nickname, s.full_name) end,
         coalesce(r.nickname, r.full_name),
         case m.send_to when 'admin' then 'the Admin team' when 'sup' then 'the Supervisor & QCD team'
                        when 'senior' then 'the Senior team' when 'both' then 'the team' end,
         m.kudos_posted_at, m.sticker
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

-- 5. Longest-serving therapist ----------------------------------------------------------
-- Current CARE staff with a therapist rank (Junior, Senior, QCD, Supervisor),
-- earliest Start date wins; people who have left don't count, so the badge
-- passes on by itself. Returns only ids — no dates or other details.
create or replace function public.milestone_longest()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  with pool as (
    select t.id, t.start_date
    from public.therapists t
    where t.status <> 'exited' and t.track = 'care_hire' and t.start_date is not null
      and exists (select 1 from public.staff_roles r
                  where r.therapist_id = t.id and r.role in ('therapist','senior','qcd','supervisor'))
  )
  select id from pool
  where start_date = (select min(start_date) from pool)
    and private.current_therapist_id() is not null
$$;

-- 6. Privileges ---------------------------------------------------------------------------
revoke execute on function public.connect_send(text, text, text, text, boolean, uuid, boolean, text),
                           public.connect_my_messages(), public.connect_kudos_requests(),
                           public.connect_kudos_board(integer), public.milestone_longest()
  from public, anon;
grant  execute on function public.connect_send(text, text, text, text, boolean, uuid, boolean, text),
                           public.connect_my_messages(), public.connect_kudos_requests(),
                           public.connect_kudos_board(integer), public.milestone_longest()
  to authenticated;

commit;
