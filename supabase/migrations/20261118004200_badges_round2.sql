-- (keep) Portal 042 – New badges, round 1 of the second set (the art Songg chose)
--
-- Run AFTER 041. Safe to run again (it replaces the same two functions). Five new badges that unlock by themselves:
--   abat                    ABAT passed (an ABAT place marked passed)
--   safmeds                 SAFMEDS master (mastered at least one set)
--   resources-N   Learning Hub resources done
--   logs-N        study logs reviewed by a supervisor / QCD / Portal manager
--   kudos-N       kudos to you posted on the Kudos board
-- Levels (N): silver 1 / 5 / 8 · gold 10 / 15 / 18 · holographic 20 / 25 / 30
-- (1, 2 and 3 stars in each colour).
-- team_badges() now also says which of these each person holds: only the level
-- reached (e.g. 10), never the exact counts or what was studied. Same people see
-- it as before (CARE staff), and each person can pick them for their team card.

begin;

-- The level reached for a count (0 = none yet).
create or replace function private.badge_level(p_n bigint)
returns integer
language sql immutable
set search_path = ''
as $$
  select coalesce(max(l), 0) from unnest(array[1, 5, 8, 10, 15, 18, 20, 25, 30]) l where l <= p_n
$$;
revoke execute on function private.badge_level(bigint) from public, anon;
grant  execute on function private.badge_level(bigint) to authenticated;

drop function if exists public.team_badges();
create function public.team_badges()
returns table (id uuid, showcase text[], legacy_training text[],
               abat boolean, safmeds boolean, resources integer, logs integer, kudos integer)
language sql stable security definer
set search_path = ''
as $$
  with lvl as (
    select t.id, t.showcase, coalesce(t.legacy_training, '{}') as legacy,
      exists (select 1 from public.training_enrollments e
              where e.therapist_id = t.id and e.program_key = 'abat' and e.status = 'passed') as abat,
      exists (select 1 from public.learning_leaves l
              where l.therapist_id = t.id and l.source = 'safmeds' and l.amount = 5 and l.ref_id is not null) as safmeds,
      (select count(*) from public.learning_resource_done d where d.therapist_id = t.id) as n_res,
      (select count(*) from public.learning_reflections r where r.therapist_id = t.id and r.status = 'reviewed') as n_logs,
      (select count(*) from public.connect_messages m where m.recipient_id = t.id and m.kudos_status = 'posted') as n_kudos
    from public.therapists t
    where private.is_care_staff()
      and t.status <> 'exited' and t.track = 'care_hire'
      and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')
  )
  select id, showcase, legacy, abat, safmeds,
         private.badge_level(n_res),
         private.badge_level(n_logs),
         private.badge_level(n_kudos)
  from lvl
$$;

-- Team card: the new badges can be picked too
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
             where k !~ '^(probation|longest|year-(1|2|3|4|5|7|10)|senior-training|qcd-training|supervisor|abat|safmeds|(resources|logs|kudos)-(1|5|8|10|15|18|20|25|30))$') then
    raise exception 'Unknown badge.';
  end if;
  if cardinality(v_keys) <> (select count(distinct k) from unnest(v_keys) k) then raise exception 'Pick each badge once.'; end if;
  update public.therapists set showcase = v_keys where id = v_me;
end $$;

revoke execute on function public.team_badges(), public.team_set_showcase(text[]) from public, anon;
grant  execute on function public.team_badges(), public.team_set_showcase(text[]) to authenticated;

commit;
