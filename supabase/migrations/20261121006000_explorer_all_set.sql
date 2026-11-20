-- (keep) Portal 060 – Two new badges: Explorer and All set
--
-- Run AFTER 058 (the CARE board).
--   * Explorer: open every tab in your own menu at least once. The Portal keeps
--     one tick per tab per person (which tab, and when it was first opened) –
--     nothing else about what you click. Tabs only count once you have them, so
--     office staff can earn it too.
--   * All set: your team card has a photo, an "about me" line, and badges you
--     chose to show.
--   * Both are for CARE staff (not applicants), show on the card / My Journey,
--     and new ones are announced on the CARE board like other badges.
-- Existing people who already qualify for "All set" get it quietly (no news),
-- the same as the other badges did in 058.

begin;

-- 1. Which tabs each person has opened (first time only) ------------------------------
create table if not exists public.portal_tabs_seen (
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  tab          text not null check (tab ~ '^[a-z]{2,20}$'),
  first_at     timestamptz not null default now(),
  primary key (therapist_id, tab)
);
create table if not exists public.portal_explorer (
  therapist_id uuid primary key references public.therapists (id) on delete cascade,
  done_at      timestamptz not null default now()
);
alter table public.portal_tabs_seen enable row level security;
alter table public.portal_explorer  enable row level security;
revoke all on public.portal_tabs_seen, public.portal_explorer from anon, authenticated;

-- The app calls this when a tab opens, with the list of tabs in the person's menu.
-- Returns { seen: [tabs opened], done: true/false }.
create or replace function public.portal_tab_seen(p_tab text, p_tabs text[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_me uuid := private.current_therapist_id(); v_seen text[];
begin
  if v_me is null or not private.is_care_staff() then return null; end if;
  if p_tab ~ '^[a-z]{2,20}$' then
    insert into public.portal_tabs_seen (therapist_id, tab) values (v_me, p_tab) on conflict do nothing;
  end if;
  select coalesce(array_agg(tab order by first_at), '{}') into v_seen from public.portal_tabs_seen where therapist_id = v_me;
  -- Explorer: every tab in the menu (at least 3, to be safe) has been opened.
  if coalesce(cardinality(p_tabs), 0) >= 3 and cardinality(p_tabs) <= 30 and p_tabs <@ v_seen then
    insert into public.portal_explorer (therapist_id) values (v_me) on conflict do nothing;
  end if;
  return jsonb_build_object('seen', to_jsonb(v_seen),
                            'done', exists (select 1 from public.portal_explorer where therapist_id = v_me));
end $$;

-- 2. team_badges(): add explorer + all_set ----------------------------------------------
drop function if exists public.team_badges();
create function public.team_badges()
returns table (id uuid, showcase text[], legacy_training text[],
               abat boolean, safmeds boolean, resources integer, logs integer, kudos integer, newest boolean,
               thanked integer, gifts jsonb, explorer boolean, all_set boolean)
language sql stable security definer
set search_path = ''
as $$
  with pool as (
    select t.id, t.start_date
    from public.therapists t
    where t.status <> 'exited' and t.track = 'care_hire' and t.start_date is not null
      and exists (select 1 from public.staff_roles r
                  where r.therapist_id = t.id and r.role in ('therapist','senior','qcd','supervisor'))
  ),
  lvl as (
    select t.id, t.showcase, coalesce(t.legacy_training, '{}') as legacy,
      exists (select 1 from public.training_enrollments e
              where e.therapist_id = t.id and e.program_key = 'abat' and e.status = 'passed') as abat,
      exists (select 1 from public.learning_leaves l
              where l.therapist_id = t.id and l.source = 'safmeds' and l.amount = 5 and l.ref_id is not null) as safmeds,
      (select count(*) from public.learning_resource_done d where d.therapist_id = t.id) as n_res,
      (select count(*) from public.learning_reflections r where r.therapist_id = t.id and r.status = 'reviewed') as n_logs,
      (select count(*) from public.connect_messages m
        where m.sender_id = t.id and m.kind = 'thanks' and not m.anonymous) as n_kudos,
      (select count(*) from public.connect_messages m
        where m.recipient_id = t.id and m.kind = 'thanks' and not m.anonymous) as n_thanked,
      exists (select 1 from pool p where p.id = t.id
              and p.start_date = (select max(start_date) from pool)) as newest,
      coalesce((select jsonb_object_agg(g.badge_key, g.n) from
                 (select badge_key, count(*) as n from public.badge_gifts where therapist_id = t.id group by badge_key) g), '{}'::jsonb) as gifts,
      exists (select 1 from public.portal_explorer x where x.therapist_id = t.id) as explorer,
      (t.photo_path is not null and btrim(coalesce(t.about, '')) <> '' and coalesce(cardinality(t.showcase), 0) > 0) as all_set
    from public.therapists t
    where private.is_care_staff()
      and t.status <> 'exited' and t.track = 'care_hire'
      and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')
  )
  select id, showcase, legacy, abat, safmeds,
         private.badge_level(n_res), private.badge_level(n_logs), private.badge_level(n_kudos), newest,
         private.badge_level(n_thanked), gifts, explorer, all_set
  from lvl
$$;

-- 3. The CARE board: announce Explorer and All set too -----------------------------------
create or replace function private.badge_keys()
returns table (therapist_id uuid, badge_key text)
language sql stable security definer
set search_path = ''
as $$
  with staff as (
    select t.id, t.stage, t.start_date, coalesce(t.legacy_training, '{}') as legacy,
      t.photo_path, t.about, t.showcase,
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
  -- Explorer + All set (Portal 060)
  union all
  select s.id, 'explorer' from s where exists (select 1 from public.portal_explorer x where x.therapist_id = s.id)
  union all
  select s.id, 'all-set' from s
   where s.photo_path is not null and btrim(coalesce(s.about, '')) <> '' and coalesce(cardinality(s.showcase), 0) > 0
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
revoke execute on function private.badge_keys() from public, anon, authenticated;

-- Save today's "All set" cards quietly (no board news for cards that were already done).
insert into public.badge_awards (therapist_id, badge_key, quiet)
select k.therapist_id, k.badge_key, true from private.badge_keys() k
where k.badge_key = 'all-set'
on conflict (therapist_id, badge_key) do nothing;

revoke execute on function public.team_badges(), public.portal_tab_seen(text, text[]) from public, anon;
grant  execute on function public.team_badges(), public.portal_tab_seen(text, text[]) to authenticated;

commit;
