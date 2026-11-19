-- (keep) Portal 044 – Newest therapist badge
--
-- Run AFTER 043. The opposite of Longest-serving: the current CARE therapist
-- (Junior, Senior, QCD or Supervisor) with the LATEST start date holds it. It
-- passes on by itself when someone newer becomes a therapist. Trainees still
-- in onboarding (applicants) don't count. If two people started on the same
-- day, both hold it.
-- team_badges() gains `newest`; the badge can be picked for the team card.

begin;

drop function if exists public.team_badges();
create function public.team_badges()
returns table (id uuid, showcase text[], legacy_training text[],
               abat boolean, safmeds boolean, resources integer, logs integer, kudos integer, newest boolean)
language sql stable security definer
set search_path = ''
as $$
  with pool as (   -- current therapists with a start date (same rule as Longest-serving)
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
      exists (select 1 from pool p where p.id = t.id
              and p.start_date = (select max(start_date) from pool)) as newest
    from public.therapists t
    where private.is_care_staff()
      and t.status <> 'exited' and t.track = 'care_hire'
      and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')
  )
  select id, showcase, legacy, abat, safmeds,
         private.badge_level(n_res), private.badge_level(n_logs), private.badge_level(n_kudos), newest
  from lvl
$$;

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
             where k !~ '^(probation|longest|newest|year-(1|2|3|4|5|7|10)|senior-training|qcd-training|supervisor|abat|safmeds|(resources|logs|kudos)-(1|5|8|10|15|18|20|25|30))$') then
    raise exception 'Unknown badge.';
  end if;
  if cardinality(v_keys) <> (select count(distinct k) from unnest(v_keys) k) then raise exception 'Pick each badge once.'; end if;
  update public.therapists set showcase = v_keys where id = v_me;
end $$;

revoke execute on function public.team_badges(), public.team_set_showcase(text[]) from public, anon;
grant  execute on function public.team_badges(), public.team_set_showcase(text[]) to authenticated;

commit;
