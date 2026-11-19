-- (keep) Portal 055 – Hand-given badges + Kudos received
--
-- Run AFTER 054.
--   * Hand-given badges: Supervisor, QCD or admin open someone's card in Our Team
--     and tap "Give a badge": School shadow, Supporter, Stimuli Master, Unshakable
--     (more later: Growth seeker, Shining ray, BIP master, Helping hand).
--       - You can't give one to yourself.
--       - Each badge once per person (Helping hand will count up: 1 / 10 / 30).
--       - Only admin (or the Portal manager) can take one back.
--       - They never show as "locked": a person only sees one once it's given.
--   * Kudos received: thank-yous sent TO you in CARE Connect, with the sender's
--     name (anonymous ones never count), at 1 / 5 / 8 / 10 / 15 / 18 / 20 / 25 / 30.
-- team_badges() gains `thanked` (level) and `gifts` ({ badge: count }).

begin;

create table if not exists public.badge_gifts (
  id           uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  badge_key    text not null check (badge_key in ('school-shadow','supporter','stimuli-master','unshakable',
                                                  'growth-seeker','shining-ray','bip-master','helping-hand')),
  given_by     uuid references public.therapists (id) on delete set null,
  given_at     timestamptz not null default now()
);
create unique index if not exists badge_gifts_once on public.badge_gifts (therapist_id, badge_key) where badge_key <> 'helping-hand';
alter table public.badge_gifts enable row level security;
revoke all on public.badge_gifts from public, anon, authenticated;

-- Give a badge (Supervisor, QCD, admin / Portal manager)
create or replace function public.badge_give(p_who uuid, p_key text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_me uuid := private.current_therapist_id();
begin
  if not private.has_any_role(array['admin','supervisor','qcd']::public.app_role[]) then
    raise exception 'Only Supervisors, QCD and admin can give badges.';
  end if;
  if p_who = v_me then raise exception 'You can''t give a badge to yourself.'; end if;
  if not exists (select 1 from public.therapists t where t.id = p_who and t.status <> 'exited' and t.track = 'care_hire'
                   and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')) then
    raise exception 'Badges can only be given to CARE staff.';
  end if;
  begin
    insert into public.badge_gifts (therapist_id, badge_key, given_by) values (p_who, p_key, v_me);
  exception
    when unique_violation then raise exception 'They already have this badge.';
    when check_violation then raise exception 'Unknown badge.';
  end;
end $$;

-- Take one back (admin / Portal manager): removes the latest one of that badge
create or replace function public.badge_take_back(p_who uuid, p_key text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.has_any_role(array['admin']::public.app_role[]) then raise exception 'Only admin can take a badge back.'; end if;
  delete from public.badge_gifts
   where id = (select id from public.badge_gifts where therapist_id = p_who and badge_key = p_key order by given_at desc limit 1);
  if not found then raise exception 'They don''t have this badge.'; end if;
end $$;

-- team_badges(): + thanked (Kudos received level) + gifts
drop function if exists public.team_badges();
create function public.team_badges()
returns table (id uuid, showcase text[], legacy_training text[],
               abat boolean, safmeds boolean, resources integer, logs integer, kudos integer, newest boolean,
               thanked integer, gifts jsonb)
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
                 (select badge_key, count(*) as n from public.badge_gifts where therapist_id = t.id group by badge_key) g), '{}'::jsonb) as gifts
    from public.therapists t
    where private.is_care_staff()
      and t.status <> 'exited' and t.track = 'care_hire'
      and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')
  )
  select id, showcase, legacy, abat, safmeds,
         private.badge_level(n_res), private.badge_level(n_logs), private.badge_level(n_kudos), newest,
         private.badge_level(n_thanked), gifts
  from lvl
$$;

-- The team card can show the new badges too
create or replace function public.team_set_showcase(p_keys text[])
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_keys text[] := coalesce(p_keys, '{}');
begin
  if v_me is null or not private.is_care_staff() then raise exception 'Only CARE staff can edit a team card.'; end if;
  if cardinality(v_keys) > 5 then raise exception 'Pick up to 5 badges.'; end if;
  if exists (select 1 from unnest(v_keys) k
             where k !~ '^(probation|longest|newest|year-(1|2|3|4|5|7|10)|senior-training|qcd-training|supervisor|abat|safmeds|(resources|logs|kudos|thanked)-(1|5|8|10|15|18|20|25|30)|school-shadow|supporter|stimuli-master|unshakable|growth-seeker|shining-ray|bip-master|helping-hand-(1|10|30))$') then
    raise exception 'Unknown badge.';
  end if;
  if cardinality(v_keys) <> (select count(distinct k) from unnest(v_keys) k) then raise exception 'Pick each badge once.'; end if;
  update public.therapists set showcase = v_keys where id = v_me;
end $$;

revoke execute on function public.team_badges(), public.team_set_showcase(text[]),
                           public.badge_give(uuid, text), public.badge_take_back(uuid, text) from public, anon;
grant  execute on function public.team_badges(), public.team_set_showcase(text[]),
                           public.badge_give(uuid, text), public.badge_take_back(uuid, text) to authenticated;

commit;
