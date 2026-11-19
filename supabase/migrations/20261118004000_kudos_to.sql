-- (keep) Portal 040 – Kudos: "To everyone" + who it's for
--
-- Run AFTER 039. Before this, a thank-you sent to the Admin team (so an admin
-- can review it) showed "To the Admin team" on the board. Now:
--   - The sender can say who the kudos is for (optional, short): e.g.
--     "Pao and Ploy", "the Monday team". The admin / supervisor who reviews it
--     can change it.
--   - If they leave it empty, the board says "To everyone at CARE"
--     (a thank-you to one person still shows that person's name).
-- The inbox it is sent to only decides who reviews it; it no longer shows on the board.
-- Already-posted kudos to a team now show "To everyone at CARE".

begin;

alter table public.connect_messages
  add column if not exists kudos_to text check (char_length(kudos_to) <= 80);

grant select (kudos_to) on public.connect_messages to authenticated;

-- 1. Send: + who the kudos is for ---------------------------------------------------------
drop function if exists public.connect_send(text, text, text, text, boolean, uuid, boolean, text);

create or replace function public.connect_send(p_kind text, p_topic text, p_send_to text, p_body text,
                                               p_anonymous boolean, p_recipient uuid, p_kudos boolean,
                                               p_sticker text default null, p_kudos_to text default null)
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
  v_to      text := case when coalesce(p_kudos, false) and p_kind = 'thanks' then left(nullif(btrim(coalesce(p_kudos_to, '')), ''), 80) end;
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
     kudos_request, kudos_status, kudos_to, sticker, created_at, last_activity_at)
  values
    (p_kind, coalesce(p_topic, 'other'), p_send_to, case when p_send_to = 'person' then p_recipient end,
     btrim(p_body), v_anon, case when v_anon then null else v_me end, null,
     v_kudos, case when v_kudos then 'requested' end, v_to, v_sticker, v_when, v_when)
  returning id into v_id;

  if v_anon then
    insert into private.connect_anon_senders (message_id, sender_id) values (v_id, v_me);
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- 2. Review queue: + who it's for -----------------------------------------------------------
drop function if exists public.connect_kudos_requests();
create function public.connect_kudos_requests()
returns table (id uuid, body text, sender text, recipient text, send_to text, created_at timestamptz,
               sticker text, kudos_to text)
language sql stable security definer
set search_path = ''
as $$
  select m.id, m.body,
         case when m.anonymous then null else coalesce(s.nickname, s.full_name) end,
         coalesce(r.nickname, r.full_name), m.send_to, m.created_at, m.sticker, m.kudos_to
  from public.connect_messages m
  left join public.therapists s on s.id = m.sender_id
  left join public.therapists r on r.id = m.recipient_id
  where m.kudos_status = 'requested' and private.has_any_role(array['admin','supervisor']::public.app_role[])
  order by m.created_at
$$;

-- 3. Post / decline: the reviewer can also change who it's for ---------------------------------
drop function if exists public.connect_kudos_decide(uuid, boolean, text);
create function public.connect_kudos_decide(p_message uuid, p_post boolean, p_text text, p_to text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_any_role(array['admin','supervisor']::public.app_role[]) then
    raise exception 'Only an admin or a supervisor can post kudos.';
  end if;
  update public.connect_messages
     set kudos_status = case when p_post then 'posted' else 'declined' end,
         kudos_text = case when p_post then nullif(btrim(coalesce(p_text, '')), '') end,
         kudos_to = case when p_to is null then kudos_to else left(nullif(btrim(p_to), ''), 80) end,
         kudos_posted_at = case when p_post then now() end,
         kudos_by = private.current_therapist_id()
   where id = p_message and kudos_request;
  if not found then raise exception 'This isn''t a kudos request.'; end if;
end $$;

-- 4. Board: who it's for → the person → "everyone at CARE" ----------------------------------------
create or replace function public.connect_kudos_board(p_limit integer)
returns table (id uuid, kudos text, from_name text, to_name text, to_team text, posted_at timestamptz, sticker text)
language sql stable security definer
set search_path = ''
as $$
  select m.id, coalesce(m.kudos_text, m.body),
         case when m.anonymous then null else coalesce(s.nickname, s.full_name) end,
         coalesce(m.kudos_to, r.nickname, r.full_name),
         'everyone at CARE',
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

-- 5. Privileges ---------------------------------------------------------------------------------
revoke execute on function public.connect_send(text, text, text, text, boolean, uuid, boolean, text, text),
                           public.connect_kudos_requests(),
                           public.connect_kudos_decide(uuid, boolean, text, text),
                           public.connect_kudos_board(integer)
  from public, anon;
grant  execute on function public.connect_send(text, text, text, text, boolean, uuid, boolean, text, text),
                           public.connect_kudos_requests(),
                           public.connect_kudos_decide(uuid, boolean, text, text),
                           public.connect_kudos_board(integer)
  to authenticated;

commit;
