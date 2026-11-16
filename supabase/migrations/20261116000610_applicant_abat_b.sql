-- (keep) Portal 006b – applicants and ABAT learners
--
-- Run AFTER 006a.
--
-- 1. Every person gets a "track":
--      care_hire = CARE staff and new hires (interview → … → therapist)
--      abat      = ABAT course learner, not CARE staff (course + exam → certified)
-- 2. HR may give or remove 'applicant' as well as 'therapist'.
-- 3. Applicants see only My Journey and Training & Exam.
--    They can't see other people: the "read all" rules are for admin/HR/
--    supervisor/QCD only, so an applicant only ever sees their own record.
-- 4. Automatic switch: when a CARE new hire is moved to Probation (they passed
--    field overlap session 8 with the supervisor and signed their contract),
--    they lose 'applicant' and get 'therapist', with a note on their timeline.

begin;

-- 1. Track ---------------------------------------------------------------------
create type public.person_track as enum ('care_hire', 'abat');

alter table public.therapists
  add column track public.person_track not null default 'care_hire';

comment on column public.therapists.track is
  'care_hire = CARE staff / new hire; abat = ABAT course learner, not CARE staff';

-- 2. HR can manage 'applicant' too ----------------------------------------------
alter policy "staff_roles: admin grant any, hr grant therapist" on public.staff_roles
  with check (
    (select private.has_any_role(array['admin']::public.app_role[]))
    or (role in ('therapist', 'applicant')
        and (select private.has_any_role(array['hr']::public.app_role[])))
  );

alter policy "staff_roles: admin remove any, hr remove therapist" on public.staff_roles
  using (
    (select private.has_any_role(array['admin']::public.app_role[]))
    or (role in ('therapist', 'applicant')
        and (select private.has_any_role(array['hr']::public.app_role[])))
  );

-- 3. Tabs applicants can see -----------------------------------------------------
update public.app_modules
   set roles = array_append(roles, 'applicant'::public.app_role)
 where key in ('journey', 'training')
   and not ('applicant' = any (roles));

-- 4. Applicant → Therapist at Probation ------------------------------------------
create or replace function private.promote_to_therapist()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if new.track = 'care_hire'
     and new.stage in ('probation', 'active')
     and old.stage not in ('probation', 'active')
     and exists (select 1 from public.staff_roles
                 where therapist_id = new.id and role = 'applicant') then

    insert into public.staff_roles (therapist_id, role, granted_by)
    values (new.id, 'therapist', private.current_therapist_id())
    on conflict do nothing;

    delete from public.staff_roles
     where therapist_id = new.id and role = 'applicant';

    insert into public.journey_events (therapist_id, stage, event_type, title, recorded_by)
    values (new.id, new.stage, 'became_therapist',
            'Became a CARE therapist 🎉', private.current_therapist_id());
  end if;
  return new;
end $$;

create trigger therapists_promote_to_therapist
  after update of stage on public.therapists
  for each row execute function private.promote_to_therapist();

commit;
