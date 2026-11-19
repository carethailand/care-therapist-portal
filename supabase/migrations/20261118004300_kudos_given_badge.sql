-- (keep) Portal 043 – Kudos badge = kudos GIVEN
--
-- Run AFTER 042. The hand-with-heart badge (kudos-N) now counts the thank-yous a
-- person SENDS in CARE Connect: to one person or to a team, posted on the board
-- or not. History counts (every thank-you ever sent).
-- Thank-yous sent "without my name" never count: they are anonymous, and a badge
-- going up right after one would give the sender away. (The locked sender list
-- is never read for this.)
-- A separate "kudos received" badge will come later, when its art is chosen.
-- Levels unchanged: silver 1 / 5 / 8 · gold 10 / 15 / 18 · holographic 20 / 25 / 30.

begin;

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
      -- thank-yous sent with their name (anonymous ones have no sender here)
      (select count(*) from public.connect_messages m
        where m.sender_id = t.id and m.kind = 'thanks' and not m.anonymous) as n_kudos
    from public.therapists t
    where private.is_care_staff()
      and t.status <> 'exited' and t.track = 'care_hire'
      and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')
  )
  select id, showcase, legacy, abat, safmeds,
         private.badge_level(n_res), private.badge_level(n_logs), private.badge_level(n_kudos)
  from lvl
$$;

revoke execute on function public.team_badges() from public, anon;
grant  execute on function public.team_badges() to authenticated;

commit;
