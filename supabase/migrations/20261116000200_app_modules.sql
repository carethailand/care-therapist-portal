-- (keep) Portal 002 – app modules (tab switches)
--
-- One row per tab. A tab only shows to staff when `enabled` is true AND the
-- person holds one of `roles`. Admins also see switched-off tabs (marked
-- "hidden") so they can preview them before release.
-- Turning a tab on = flip `enabled` in the Table Editor. No redeploy needed.

begin;

create table public.app_modules (
  key         text primary key,
  label       text not null,
  description text,
  sort_order  integer not null,
  enabled     boolean not null default false,
  roles       public.app_role[] not null
                default array['admin','hr','supervisor','senior','therapist']::public.app_role[],
  phase       smallint
);

insert into public.app_modules (key, label, description, sort_order, enabled, phase) values
  ('journey',     'My Journey',        'Your timeline and hours summary',                 10, true,  0),
  ('training',    'Training & Exam',   'Onboarding course and exams',                     20, false, 1),
  ('learning',    'Learning Hub',      'Study topics, resources, reflection log',         30, false, 2),
  ('resources',   'Resource Links',    'Canva, Twinkl, timesheet tool and other tools',   40, false, 3),
  ('journals',    'Journal Library',   'Curated reading by topic',                        50, false, 3),
  ('leave',       'Leave & HR',        'Leave requests, approvals, balances, HR forms',   60, false, 3),
  ('hours',       'Hours',             'Logged hours and category dashboard',             70, false, 4),
  ('supervision', 'Supervision',       'Supervision log, QCD evaluations, PIP',           80, false, 5),
  ('documents',   'Documents / Forms', 'Overlap forms, field evaluation, orientation',    90, false, 5)
on conflict (key) do nothing;

revoke all on public.app_modules from anon;
grant select, insert, update, delete on public.app_modules to authenticated;

alter table public.app_modules enable row level security;

create policy "app_modules: logged-in staff read"
  on public.app_modules for select to authenticated
  using ((select private.current_therapist_id()) is not null);

create policy "app_modules: admin add"
  on public.app_modules for insert to authenticated
  with check ((select private.has_any_role(array['admin']::public.app_role[])));

create policy "app_modules: admin edit"
  on public.app_modules for update to authenticated
  using      ((select private.has_any_role(array['admin']::public.app_role[])))
  with check ((select private.has_any_role(array['admin']::public.app_role[])));

create policy "app_modules: admin delete"
  on public.app_modules for delete to authenticated
  using ((select private.has_any_role(array['admin']::public.app_role[])));

commit;
