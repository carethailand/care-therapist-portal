-- (keep) Portal 005b – QCD access
--
-- Run AFTER 005a. Gives QCD the same view as supervisors for now:
-- they can see every staff record and timeline, and add timeline entries
-- (needed for role-play, overlap and QCD evaluations).
-- QCD can't add or edit staff records or roles; that stays with admin/HR.
-- When the overlap and role-play forms are built (Phases 3–5), their own
-- tables will give QCD exactly the rights those forms need.

begin;

alter policy "therapists: admin/hr/supervisor read all" on public.therapists
  using ((select private.has_any_role(array['admin','hr','supervisor','qcd']::public.app_role[])));

alter policy "staff_roles: admin/hr/supervisor read all" on public.staff_roles
  using ((select private.has_any_role(array['admin','hr','supervisor','qcd']::public.app_role[])));

alter policy "journey_events: admin/hr/supervisor read all" on public.journey_events
  using ((select private.has_any_role(array['admin','hr','supervisor','qcd']::public.app_role[])));

alter policy "journey_events: admin/hr/supervisor add" on public.journey_events
  with check ((select private.has_any_role(array['admin','hr','supervisor','qcd']::public.app_role[])));

alter policy "journey_events: admin/hr/supervisor edit" on public.journey_events
  using      ((select private.has_any_role(array['admin','hr','supervisor','qcd']::public.app_role[])))
  with check ((select private.has_any_role(array['admin','hr','supervisor','qcd']::public.app_role[])));

-- Tabs: QCD sees every tab that is open to everyone.
alter table public.app_modules
  alter column roles set default array['admin','hr','supervisor','qcd','senior','therapist']::public.app_role[];

update public.app_modules
   set roles = array_append(roles, 'qcd'::public.app_role)
 where 'therapist' = any (roles)
   and not ('qcd' = any (roles));

commit;
