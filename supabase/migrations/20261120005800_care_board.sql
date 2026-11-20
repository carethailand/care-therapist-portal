-- (keep) Portal 058 – The CARE board (badge news + kudos, with reactions) and the red dot
--
-- Run AFTER 057.
--   * CARE Connect opens with the CARE board: badge news and kudos in one list.
--       - Every new badge is news. Count badges (Resources, Study logs, Kudos given,
--         Kudos received) only at a new colour: 1, 10, 20.
--       - Badges people already have are saved quietly (never shown as news), so the
--         board starts fresh. Someone new to the Portal also starts quietly.
--       - Not on the board: Longest-serving and Newest (they pass between people).
--   * Reactions ⭐ ❤️ 👍 🚀 🎉 on badges and kudos: once per person per emoji, tap
--     again to undo. All CARE staff (not applicants) see the board and can react.
--   * The red dot on the CARE Connect tab: new board news, or something new in your
--     inbox (a reply to you, a message to you, or a new message for your team).
--     "Seen" is saved per person, so phone and computer agree.

begin;

-- 1. Badges people have, with when the Portal first saw them -------------------------------
create table if not exists public.badge_awards (
  id           uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  badge_key    text not null,
  earned_at    timestamptz not null default now(),
  quiet        boolean not null default false,   -- saved quietly: never shown on the board
  unique (therapist_id, badge_key)
);
create index if not exists badge_awards_news_idx on public.badge_awards (earned_at desc) where not quiet;
alter table public.badge_awards enable row level security;
revoke all on public.badge_awards from public, anon, authenticated;

-- People the board already knows (their first badges are saved quietly)
create table if not exists public.board_people (
  therapist_id uuid primary key references public.therapists (id) on delete cascade,
  first_at     timestamptz not null default now()
);
alter table public.board_people enable row level security;
revoke all on public.board_people from public, anon, authenticated;

-- 2. Reactions (on a badge or on a kudos) ---------------------------------------------------
create table if not exists public.board_reactions (
  id           uuid primary key default gen_random_uuid(),
  award_id     uuid references public.badge_awards (id) on delete cascade,
  message_id   uuid references public.connect_messages (id) on delete cascade,
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  emoji        text not null check (emoji in ('star','heart','like','rocket','party')),
  created_at   timestamptz not null default now(),
  check (num_nonnulls(award_id, message_id) = 1)
);
create unique index if not exists board_reactions_award_once on public.board_reactions (award_id, therapist_id, emoji) where award_id is not null;
create unique index if not exists board_reactions_kudos_once on public.board_reactions (message_id, therapist_id, emoji) where message_id is not null;
alter table public.board_reactions enable row level security;
revoke all on public.board_reactions from public, anon, authenticated;

-- 3. When each person last looked (for the red dot and the "New" tags) ---------------------
create table if not exists public.connect_seen (
  therapist_id  uuid primary key references public.therapists (id) on delete cascade,
  board_seen_at timestamptz not null default now(),
  inbox_seen_at timestamptz not null default now()
);
alter table public.connect_seen enable row level security;
revoke all on public.connect_seen from public, anon, authenticated;

-- 4. Every badge each current staff member has now (same rules as the app's badges) --------
create or replace function private.badge_keys()
returns table (therapist_id uuid, badge_key text)
language sql stable security definer
set search_path = ''
as $$
  with staff as (
    select t.id, t.stage, t.start_date, coalesce(t.legacy_training, '{}') as legacy,
      (select r.role::text from public.staff_roles r where r.therapist_id = t.id
         and r.role::text in ('therapist','senior','qcd','supervisor','applicant')
       order by array_position(array['applicant','therapist','senior','qcd','supervisor'], r.role::text) desc limit 1) as rnk
    from public.therapists t
    where t.status <> 'exited' and t.track = 'care_hire'
      and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')
  ),
  s as (
    select staff.*, rnk in ('therapist','senior','qcd','supervisor') as clinical,
      array_position(array['therapist','senior','qcd','supervisor'], rnk) as lvl
    from staff
  ),
  counts as (
    select s.id,
      (select count(*) from public.learning_resource_done d where d.therapist_id = s.id) as resources,
      (select count(*) from public.learning_reflections r where r.therapist_id = s.id and r.status = 'reviewed') as logs,
      (select count(*) from public.connect_messages m where m.sender_id = s.id and m.kind = 'thanks' and not m.anonymous) as kudos,
      (select count(*) from public.connect_messages m where m.recipient_id = s.id and m.kind = 'thanks' and not m.anonymous) as thanked
    from s
  )
  -- Passed probation
  select id, 'probation' from s where stage = 'active'
  -- Years at CARE
  union all
  select s.id, 'year-' || n from s, unnest(array[1, 2, 3, 4, 5, 7, 10]) n
   where s.start_date is not null and (s.start_date + make_interval(years => n))::date <= (now() at time zone 'Asia/Bangkok')::date
  -- Training (with the rank)
  union all select id, 'senior-training' from s where clinical and lvl >= 2
  union all select id, 'qcd-training' from s where clinical and lvl >= 2 and (rnk = 'qcd' or 'qcd' = any (legacy))
  union all select id, 'supervisor' from s where clinical and lvl >= 4
  -- ABAT, SAFMEDS (therapist ranks)
  union all
  select s.id, 'abat' from s where clinical and exists (select 1 from public.training_enrollments e
    where e.therapist_id = s.id and e.program_key = 'abat' and e.status = 'passed')
  union all
  select s.id, 'safmeds' from s where clinical and exists (select 1 from public.learning_leaves l
    where l.therapist_id = s.id and l.source = 'safmeds' and l.amount = 5 and l.ref_id is not null)
  -- Hand-given badges
  union all
  select distinct g.therapist_id, g.badge_key from public.badge_gifts g join s on s.id = g.therapist_id
   where g.badge_key <> 'helping-hand'
  -- Count badges, only at a new colour (1, 10, 20)
  union all
  select c.id, f.key || '-' || n
  from counts c
  cross join lateral (values ('resources', c.resources), ('logs', c.logs), ('kudos', c.kudos), ('thanked', c.thanked)) f(key, cnt)
  cross join unnest(array[1, 10, 20]) n
  where f.cnt >= n
$$;
revoke execute on function private.badge_keys() from public, anon;
grant  execute on function private.badge_keys() to authenticated;

-- 5. Bring the saved badges up to date (new ones become news; taken-back ones go) ----------
create or replace function private.badge_sync()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.badge_awards (therapist_id, badge_key, quiet)
  select k.therapist_id, k.badge_key,
         not exists (select 1 from public.board_people p where p.therapist_id = k.therapist_id)
  from private.badge_keys() k
  on conflict (therapist_id, badge_key) do nothing;

  -- A badge that's gone (e.g. taken back) leaves the board, with its reactions
  delete from public.badge_awards
   where id in (select a.id from public.badge_awards a
                  join public.therapists t on t.id = a.therapist_id and t.status <> 'exited' and t.track = 'care_hire'
                  left join private.badge_keys() k on k.therapist_id = a.therapist_id and k.badge_key = a.badge_key
                 where k.therapist_id is null);

  -- Everyone on the staff list is now known to the board
  insert into public.board_people (therapist_id)
  select t.id from public.therapists t
   where t.status <> 'exited' and t.track = 'care_hire'
     and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')
  on conflict do nothing;
end $$;
revoke execute on function private.badge_sync() from public, anon;
grant  execute on function private.badge_sync() to authenticated;

-- Reactions on one item, as { star: [names], heart: [...] } (names A–Z)
create or replace function private.board_reacts(p_award uuid, p_message uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(e.emoji, e.names), '{}'::jsonb)
  from (select x.emoji, jsonb_agg(coalesce(t.nickname, t.full_name) order by lower(coalesce(t.nickname, t.full_name))) as names
        from public.board_reactions x join public.therapists t on t.id = x.therapist_id
        where (p_award is not null and x.award_id = p_award) or (p_message is not null and x.message_id = p_message)
        group by x.emoji) e
$$;
revoke execute on function private.board_reacts(uuid, uuid) from public, anon;
grant  execute on function private.board_reacts(uuid, uuid) to authenticated;

-- 6. The board: badge news + kudos, newest first ---------------------------------------------
-- p_kind: 'all' | 'badge' | 'kudos'. p_before: for "Show older".
-- Returns { seen_at, items: [...] }; seen_at = when you last opened the board (for "New").
create or replace function public.board_feed(p_kind text, p_limit integer, p_before timestamptz)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_lim integer := greatest(1, least(coalesce(p_limit, 30), 100));
  v_before timestamptz := coalesce(p_before, 'infinity'::timestamptz);
  v_seen timestamptz;
  v_items jsonb;
begin
  if v_me is null or not private.is_care_staff() then raise exception 'The CARE board is for CARE staff.'; end if;
  perform private.badge_sync();
  select board_seen_at into v_seen from public.connect_seen where therapist_id = v_me;

  select coalesce(jsonb_agg(x.item order by x.ts desc), '[]'::jsonb) into v_items
  from (
    (select a.earned_at as ts, jsonb_build_object(
              'type', 'badge', 'id', a.id, 'at', a.earned_at, 'key', a.badge_key,
              'who_id', t.id, 'who', coalesce(t.nickname, t.full_name),
              'given_by', (select coalesce(gb.nickname, gb.full_name) from public.badge_gifts g
                             join public.therapists gb on gb.id = g.given_by
                            where g.therapist_id = a.therapist_id and g.badge_key = a.badge_key
                            order by g.given_at desc limit 1),
              'reactions', private.board_reacts(a.id, null)) as item
     from public.badge_awards a
     join public.therapists t on t.id = a.therapist_id
     where not a.quiet and coalesce(p_kind, 'all') in ('all', 'badge') and a.earned_at < v_before
       and t.status <> 'exited' and t.track = 'care_hire'
     order by a.earned_at desc limit v_lim)
    union all
    (select m.kudos_posted_at, jsonb_build_object(
              'type', 'kudos', 'id', m.id, 'at', m.kudos_posted_at, 'kudos', coalesce(m.kudos_text, m.body),
              'from_name', case when m.anonymous then null else coalesce(s.nickname, s.full_name) end,
              'to_name', coalesce(m.kudos_to, r.nickname, r.full_name), 'sticker', m.sticker,
              'reactions', private.board_reacts(null, m.id))
     from public.connect_messages m
     left join public.therapists s on s.id = m.sender_id
     left join public.therapists r on r.id = m.recipient_id
     where m.kudos_status = 'posted' and coalesce(p_kind, 'all') in ('all', 'kudos') and m.kudos_posted_at < v_before
     order by m.kudos_posted_at desc limit v_lim)
    order by 1 desc limit v_lim
  ) x;

  return jsonb_build_object('seen_at', v_seen, 'items', v_items);
end $$;

-- 7. React / undo (tap again to take it back). Returns that item's reactions.
create or replace function public.board_react(p_type text, p_id uuid, p_emoji text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_me uuid := private.current_therapist_id();
begin
  if v_me is null or not private.is_care_staff() then raise exception 'Only CARE staff can react.'; end if;
  if p_emoji not in ('star','heart','like','rocket','party') then raise exception 'Unknown reaction.'; end if;
  if p_type = 'badge' then
    if not exists (select 1 from public.badge_awards where id = p_id and not quiet) then raise exception 'This news isn''t on the board any more.'; end if;
    delete from public.board_reactions where award_id = p_id and therapist_id = v_me and emoji = p_emoji;
    if not found then insert into public.board_reactions (award_id, therapist_id, emoji) values (p_id, v_me, p_emoji); end if;
    return private.board_reacts(p_id, null);
  elsif p_type = 'kudos' then
    if not exists (select 1 from public.connect_messages where id = p_id and kudos_status = 'posted') then raise exception 'This kudos isn''t on the board any more.'; end if;
    delete from public.board_reactions where message_id = p_id and therapist_id = v_me and emoji = p_emoji;
    if not found then insert into public.board_reactions (message_id, therapist_id, emoji) values (p_id, v_me, p_emoji); end if;
    return private.board_reacts(null, p_id);
  end if;
  raise exception 'Unknown item.';
end $$;

-- 8. The red dot: how much is new since you last opened CARE Connect -------------------------
-- Returns { board: n, inbox: n }. The first time, it starts counting from now.
create or replace function public.connect_dot()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_seen public.connect_seen;
  n_board integer := 0; n_inbox integer := 0;
begin
  if v_me is null or not private.is_care_staff() then return jsonb_build_object('board', 0, 'inbox', 0); end if;
  select * into v_seen from public.connect_seen where therapist_id = v_me;
  if v_seen.therapist_id is null then
    insert into public.connect_seen (therapist_id) values (v_me) on conflict do nothing;
    return jsonb_build_object('board', 0, 'inbox', 0);
  end if;
  perform private.badge_sync();

  select (select count(*) from public.badge_awards a join public.therapists t on t.id = a.therapist_id
           where not a.quiet and a.earned_at > v_seen.board_seen_at and t.status <> 'exited')
       + (select count(*) from public.connect_messages m
           where m.kudos_status = 'posted' and m.kudos_posted_at > v_seen.board_seen_at)
    into n_board;

  select
    -- the team answered something I sent (named or anonymous)
      (select count(*) from public.connect_replies x join public.connect_messages m on m.id = x.message_id
        where x.created_at > v_seen.inbox_seen_at and x.author_kind = 'team' and not x.internal
          and x.author_id is distinct from v_me
          and (m.sender_id = v_me or exists (select 1 from private.connect_anon_senders a where a.message_id = m.id and a.sender_id = v_me)))
    -- a message to me personally, or the sender added to it
    + (select count(*) from public.connect_messages m
        where m.send_to = 'person' and m.recipient_id = v_me and m.created_at > v_seen.inbox_seen_at)
    + (select count(*) from public.connect_replies x join public.connect_messages m on m.id = x.message_id
        where x.created_at > v_seen.inbox_seen_at and x.author_kind = 'sender'
          and m.send_to = 'person' and m.recipient_id = v_me)
    -- something new for a team inbox I'm in (not my own message)
    + (select count(*) from public.connect_messages m
        where m.created_at > v_seen.inbox_seen_at and m.send_to <> 'person'
          and m.sender_id is distinct from v_me
          and not exists (select 1 from private.connect_anon_senders a where a.message_id = m.id and a.sender_id = v_me)
          and private.connect_visible(m.send_to, m.recipient_id, m.forwarded_at))
    + (select count(*) from public.connect_replies x join public.connect_messages m on m.id = x.message_id
        where x.created_at > v_seen.inbox_seen_at and x.author_kind = 'sender' and m.send_to <> 'person'
          and private.connect_visible(m.send_to, m.recipient_id, m.forwarded_at))
    into n_inbox;

  return jsonb_build_object('board', n_board, 'inbox', n_inbox);
end $$;

-- 9. I've opened CARE Connect: clear the dot
create or replace function public.connect_mark_seen()
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.connect_seen (therapist_id, board_seen_at, inbox_seen_at)
  select private.current_therapist_id(), now(), now()
  where private.current_therapist_id() is not null and private.is_care_staff()
  on conflict (therapist_id) do update set board_seen_at = now(), inbox_seen_at = now()
$$;

revoke execute on function public.board_feed(text, integer, timestamptz), public.board_react(text, uuid, text),
                           public.connect_dot(), public.connect_mark_seen() from public, anon;
grant  execute on function public.board_feed(text, integer, timestamptz), public.board_react(text, uuid, text),
                           public.connect_dot(), public.connect_mark_seen() to authenticated;

-- 10. Save everyone's badges now, quietly (so the board starts fresh)
select private.badge_sync();

commit;
