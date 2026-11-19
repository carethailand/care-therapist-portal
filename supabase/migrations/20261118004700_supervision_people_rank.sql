-- (keep) Portal 047 – Supervision list: no supervisors, grouped by rank
--
-- Run AFTER 046. Supervisors don't get QCD sessions, so they leave the QCD list.
-- The list now says each person's rank (qcd / senior / therapist) so the page can
-- group it QCD → Senior → Junior, names A–Z inside each group.
-- (QCD therapists are still scored on the Senior list.)

begin;

drop function if exists public.sv_people(integer);
create function public.sv_people(p_year integer)
returns table (id uuid, full_name text, nickname text, rank text, level text, sessions integer, last_on date,
               last_total numeric, prev_total numeric, flag boolean)
language sql stable security definer set search_path = ''
as $$
  with ppl as (
    select t.id, t.full_name, t.nickname,
           case when exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role = 'qcd') then 'qcd'
                when exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role = 'senior') then 'senior'
                when exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role = 'therapist') then 'therapist'
           end as rank
    from public.therapists t
    where private.sv_team() and t.status <> 'exited' and t.track = 'care_hire'
      and not exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role = 'supervisor')
  ), recs as (
    select r.therapist_id, r.held_on, r.total,
           row_number() over (partition by r.therapist_id order by r.held_on desc, r.recorded_at desc) as rn
    from public.sv_records r
    where r.form_key = 'qcd'
  )
  select p.id, p.full_name, p.nickname, p.rank,
         case when p.rank = 'therapist' then 'junior' else 'senior' end,
         (select count(*)::integer from public.sv_records r
           where r.therapist_id = p.id and r.form_key = 'qcd' and extract(year from r.held_on) = p_year),
         (select held_on from recs where recs.therapist_id = p.id and rn = 1),
         (select total from recs where recs.therapist_id = p.id and rn = 1),
         (select total from recs where recs.therapist_id = p.id and rn = 2),
         coalesce((select bool_and(total < 2.5) and count(*) = 2 from recs where recs.therapist_id = p.id and rn <= 2), false)
  from ppl p
  where p.rank is not null
  order by case p.rank when 'qcd' then 1 when 'senior' then 2 else 3 end, lower(coalesce(p.nickname, p.full_name))
$$;

revoke execute on function public.sv_people(integer) from public, anon;
grant  execute on function public.sv_people(integer) to authenticated;

commit;
