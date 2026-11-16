-- (keep) Portal 001 – identity, roles, journey
--
-- CARE Therapist Portal · Phase 0 foundation.
-- Run ONCE in the Portal project's SQL Editor (Project B — never the Binder).
-- Creates: one record per therapist, their roles, and their journey timeline,
-- with Row Level Security (RLS) switched on for every table.
--
-- This database holds staff / training data ONLY. No child PHI, ever.

begin;

-- ---------------------------------------------------------------------------
-- 0. A private schema for helper functions (not reachable through the API)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'hr', 'supervisor', 'senior', 'therapist');

-- The journey spine (architecture plan §3).
create type public.journey_stage as enum (
  'interview',            -- 1 · interview
  'online_course',        -- 2 · online course + exam
  'roleplay_orientation', -- 3 · role-play + written exam + orientation
  'field_overlap',        -- 4 · field overlap
  'probation',            -- 5a · 119-day probation
  'active',               -- 5b · ongoing
  'exited'                -- exit
);

create type public.staff_status as enum ('active', 'on_leave', 'exited');

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- One row per therapist, created the day they are accepted.
-- `id` IS the shared therapist_id that every module (and the Binder link) uses.
create table public.therapists (
  id                 uuid primary key default gen_random_uuid(),
  auth_user_id       uuid unique references auth.users (id) on delete set null,
  email              text not null,
  full_name          text not null,
  nickname           text,
  stage              public.journey_stage not null default 'interview',
  status             public.staff_status  not null default 'active',
  accepted_on        date,
  start_date         date,
  probation_end_date date,
  exited_on          date,
  binder_user_id     text,          -- CaRe Binder users.id — a link only, no PHI copied
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index therapists_email_key on public.therapists (lower(email));

comment on table  public.therapists is 'One record per therapist — the identity every module hangs off. Staff data only, no child PHI.';
comment on column public.therapists.binder_user_id is 'The matching users.id in the CaRe Binder project. Link only.';

-- Roles: a person can hold several (e.g. supervisor + therapist).
create table public.staff_roles (
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  role         public.app_role not null,
  granted_at   timestamptz not null default now(),
  granted_by   uuid references public.therapists (id) on delete set null,
  primary key (therapist_id, role)
);

-- The journey timeline. "My Journey" is simply a view over these rows.
create table public.journey_events (
  id           uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  stage        public.journey_stage not null,
  event_type   text not null,          -- e.g. stage_entered, exam_passed, note
  title        text not null,
  details      jsonb not null default '{}'::jsonb,
  -- Thailand date, never UTC (lesson learned in the Binder).
  occurred_on  date not null default (now() at time zone 'Asia/Bangkok')::date,
  recorded_by  uuid references public.therapists (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index journey_events_therapist_idx on public.journey_events (therapist_id, occurred_on desc);

-- ---------------------------------------------------------------------------
-- 3. Helper functions (used by the RLS policies below)
-- ---------------------------------------------------------------------------

-- The therapist record for whoever is logged in. NULL if not linked or exited.
create or replace function private.current_therapist_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select t.id
  from public.therapists t
  where t.auth_user_id = (select auth.uid())
    and t.status <> 'exited'
$$;

-- Does the logged-in (non-exited) person hold any of these roles?
create or replace function private.has_any_role(roles public.app_role[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_roles sr
    join public.therapists t on t.id = sr.therapist_id
    where t.auth_user_id = (select auth.uid())
      and t.status <> 'exited'
      and sr.role = any (roles)
  )
$$;

revoke execute on all functions in schema private from public;
grant  execute on function private.current_therapist_id()              to authenticated;
grant  execute on function private.has_any_role(public.app_role[])     to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------------

-- Keep updated_at honest.
create or replace function private.touch_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger therapists_touch_updated_at
  before update on public.therapists
  for each row execute function private.touch_updated_at();

-- When a login is created for an email that already has a therapist record, link them.
create or replace function private.link_new_auth_user()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  update public.therapists
     set auth_user_id = new.id
   where lower(email) = lower(new.email)
     and auth_user_id is null;
  return new;
end $$;

create trigger on_auth_user_created_link_therapist
  after insert on auth.users
  for each row execute function private.link_new_auth_user();

-- When a therapist record is added for an email that already has a login, link them.
create or replace function private.link_existing_auth_user()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if new.auth_user_id is null then
    select u.id into new.auth_user_id
    from auth.users u
    where lower(u.email) = lower(new.email)
    limit 1;
  end if;
  return new;
end $$;

create trigger therapists_link_existing_auth_user
  before insert on public.therapists
  for each row execute function private.link_existing_auth_user();

-- Every stage change is written to the timeline automatically,
-- so the record accumulates the journey without anyone remembering to.
create or replace function private.log_stage_change()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into public.journey_events (therapist_id, stage, event_type, title, recorded_by)
    values (new.id, new.stage, 'stage_entered',
            'Entered stage: ' || replace(new.stage::text, '_', ' '),
            private.current_therapist_id());
  end if;
  return new;
end $$;

create trigger therapists_log_stage_change
  after insert or update of stage on public.therapists
  for each row execute function private.log_stage_change();

-- ---------------------------------------------------------------------------
-- 5. Privileges + Row Level Security
-- ---------------------------------------------------------------------------
-- Nobody who isn't logged in can touch these tables at all.
revoke all on public.therapists, public.staff_roles, public.journey_events from anon;
grant select, insert, update, delete
  on public.therapists, public.staff_roles, public.journey_events to authenticated;

alter table public.therapists     enable row level security;
alter table public.staff_roles    enable row level security;
alter table public.journey_events enable row level security;

-- therapists ----------------------------------------------------------------
create policy "therapists: read own record"
  on public.therapists for select to authenticated
  using (id = (select private.current_therapist_id()));

create policy "therapists: admin/hr/supervisor read all"
  on public.therapists for select to authenticated
  using ((select private.has_any_role(array['admin','hr','supervisor']::public.app_role[])));

create policy "therapists: admin/hr add"
  on public.therapists for insert to authenticated
  with check ((select private.has_any_role(array['admin','hr']::public.app_role[])));

create policy "therapists: admin/hr edit"
  on public.therapists for update to authenticated
  using      ((select private.has_any_role(array['admin','hr']::public.app_role[])))
  with check ((select private.has_any_role(array['admin','hr']::public.app_role[])));
-- No delete policy on purpose: a record is never deleted. Leaving = status 'exited'.

-- staff_roles ---------------------------------------------------------------
create policy "staff_roles: read own"
  on public.staff_roles for select to authenticated
  using (therapist_id = (select private.current_therapist_id()));

create policy "staff_roles: admin/hr/supervisor read all"
  on public.staff_roles for select to authenticated
  using ((select private.has_any_role(array['admin','hr','supervisor']::public.app_role[])));

-- Only admins grant or remove roles (stops anyone promoting themselves).
create policy "staff_roles: admin grant"
  on public.staff_roles for insert to authenticated
  with check ((select private.has_any_role(array['admin']::public.app_role[])));

create policy "staff_roles: admin remove"
  on public.staff_roles for delete to authenticated
  using ((select private.has_any_role(array['admin']::public.app_role[])));

-- journey_events ------------------------------------------------------------
create policy "journey_events: read own"
  on public.journey_events for select to authenticated
  using (therapist_id = (select private.current_therapist_id()));

create policy "journey_events: admin/hr/supervisor read all"
  on public.journey_events for select to authenticated
  using ((select private.has_any_role(array['admin','hr','supervisor']::public.app_role[])));

create policy "journey_events: admin/hr/supervisor add"
  on public.journey_events for insert to authenticated
  with check ((select private.has_any_role(array['admin','hr','supervisor']::public.app_role[])));

create policy "journey_events: admin/hr/supervisor edit"
  on public.journey_events for update to authenticated
  using      ((select private.has_any_role(array['admin','hr','supervisor']::public.app_role[])))
  with check ((select private.has_any_role(array['admin','hr','supervisor']::public.app_role[])));

create policy "journey_events: admin delete"
  on public.journey_events for delete to authenticated
  using ((select private.has_any_role(array['admin']::public.app_role[])));

commit;
