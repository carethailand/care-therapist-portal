-- (keep) Portal 061 – Office badge "Assistant" (for Oat) + Explorer / All set can go on your card
--
-- Run AFTER 060.
--   * Assistant: a hand-given office badge, like Scheduler and Centre manager. Only Admin
--     (the GM) or the Portal manager can give it.
--   * Fix: Explorer and All set (Portal 060) can now be chosen to show on your team card
--     (before this, choosing them gave "Unknown badge").

begin;

alter table public.badge_gifts drop constraint if exists badge_gifts_badge_key_check;
alter table public.badge_gifts add constraint badge_gifts_badge_key_check
  check (badge_key in ('school-shadow','supporter','stimuli-master','unshakable',
                       'growth-seeker','shining-ray','bip-master','helping-hand',
                       'scheduler','centre-manager','assistant'));

create or replace function public.badge_give(p_who uuid, p_key text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_me uuid := private.current_therapist_id();
begin
  if not private.has_any_role(array['admin','supervisor','qcd']::public.app_role[]) then
    raise exception 'Only Supervisors, QCD and admin can give badges.';
  end if;
  if p_key in ('scheduler','centre-manager','assistant') and not private.has_any_role(array['admin']::public.app_role[]) then
    raise exception 'Only admin can give the office badges.';
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
             where k !~ '^(probation|longest|newest|year-(1|2|3|4|5|7|10)|senior-training|qcd-training|supervisor|abat|safmeds|(resources|logs|kudos|thanked)-(1|5|8|10|15|18|20|25|30)|school-shadow|supporter|stimuli-master|unshakable|growth-seeker|shining-ray|bip-master|helping-hand-(1|10|30)|scheduler|centre-manager|assistant|explorer|all-set)$') then
    raise exception 'Unknown badge.';
  end if;
  if cardinality(v_keys) <> (select count(distinct k) from unnest(v_keys) k) then raise exception 'Pick each badge once.'; end if;
  update public.therapists set showcase = v_keys where id = v_me;
end $$;

revoke execute on function public.badge_give(uuid, text), public.team_set_showcase(text[]) from public, anon;
grant  execute on function public.badge_give(uuid, text), public.team_set_showcase(text[]) to authenticated;

commit;
