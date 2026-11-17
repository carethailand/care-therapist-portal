-- (keep) Portal 029 – Our Team: choose up to 5 badges to show
--
-- Run AFTER 028. Each person picks up to 5 of their badges for their Our Team
-- card. Others see only those (plus "+N more"); a badge someone hasn't earned
-- is never shown, even if picked. Nobody picks = the Portal's usual choice.
--   * therapists.showcase: the chosen badge keys, in order (max 5)
--   * team_badges(): what Our Team needs to work out everyone's badges:
--     the chosen keys and "completed before the Portal" training ticks
--   * team_set_showcase(): save my own choice

begin;

alter table public.therapists
  add column if not exists showcase text[] not null default '{}';
alter table public.therapists drop constraint if exists therapists_showcase_check;
alter table public.therapists add constraint therapists_showcase_check check (cardinality(showcase) <= 5);

create or replace function public.team_badges()
returns table (id uuid, showcase text[], legacy_training text[])
language sql stable security definer
set search_path = ''
as $$
  select t.id, t.showcase, coalesce(t.legacy_training, '{}')
  from public.therapists t
  where private.is_care_staff()
    and t.status <> 'exited' and t.track = 'care_hire'
    and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')
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
             where k !~ '^(probation|longest|year-(1|2|3|4|5|7|10)|senior-training|qcd-training|supervisor)$') then
    raise exception 'Unknown badge.';
  end if;
  if cardinality(v_keys) <> (select count(distinct k) from unnest(v_keys) k) then raise exception 'Pick each badge once.'; end if;
  update public.therapists set showcase = v_keys where id = v_me;
end $$;

revoke execute on function public.team_badges(), public.team_set_showcase(text[]) from public, anon;
grant  execute on function public.team_badges(), public.team_set_showcase(text[]) to authenticated;

commit;
