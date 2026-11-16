-- (keep) Portal 011 – leave requests
--
-- The paper "Leave Request Form" as a Portal module (Leave & HR tab).
--   * Leave types: AL annual (per-person entitlement), SL sick ≤30, PL personal ≤5,
--     BL birthday 1, LWP without pay ≤30, OL specific leave (by kind).
--   * Each person's AL entitlement per year (+ carry-over and its use-by date)
--     is set by admin/HR, because it depends on years of service.
--   * A request: type, reason, dates (half days), number of days (Mon–Sat
--     counted by the app; the person can correct it), and the sessions it
--     affects with a covering therapist or a make-up session.
--   * HR approves or declines; an admin records "families notified".
--
-- SAFETY: sessions are identified by the CASE CODE only (e.g. "ABC"), never a
-- child's name. The database accepts exactly 3 capital letters, nothing else.

begin;

-- 0. Employee number + department (printed on the leave form) ------------------
alter table public.therapists
  add column employee_no text,
  add column department  text;

create or replace function private.is_leave_team()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.has_any_role(array['admin','hr']::public.app_role[])
$$;

-- 1. Leave types and OL kinds (admins can edit later) ---------------------------
create table public.leave_types (
  code        text primary key check (code ~ '^[A-Z]{2,4}$'),
  label       text not null,
  max_days    numeric,                     -- yearly limit; null = set per person (AL) or by kind (OL)
  per_person  boolean not null default false,
  notice_days integer not null default 14, -- warn if requested later than this
  needs_kind  boolean not null default false,
  sort_order  integer not null default 0,
  active      boolean not null default true
);
insert into public.leave_types (code, label, max_days, per_person, notice_days, needs_kind, sort_order) values
  ('AL',  'Annual leave',            null, true,  14, false, 10),
  ('SL',  'Sick leave',              30,   false, 0,  false, 20),
  ('PL',  'Personal leave',          5,    false, 14, false, 30),
  ('BL',  'Birthday leave',          1,    false, 14, false, 40),
  ('LWP', 'Leave without pay',       30,   false, 14, false, 50),
  ('OL',  'Other leave (specific)',  null, false, 14, true,  60);

create table public.leave_kinds (
  code       text primary key check (code ~ '^[a-z_]+$'),
  label      text not null,
  max_days   numeric not null,
  sort_order integer not null default 0
);
insert into public.leave_kinds (code, label, max_days, sort_order) values
  ('maternity',     'Maternity',                 120, 10),
  ('ordination',    'Ordination',                 30, 20),
  ('military',      'Military',                   60, 30),
  ('bereavement',   'Bereavement',                 7, 40),
  ('sterilization', 'Sterilization',               7, 50),
  ('marriage',      'Marriage',                    5, 60),
  ('training',      'Training (work related)',    30, 70);

-- 2. Each person's annual leave per year ------------------------------------------
create table public.leave_entitlements (
  therapist_id     uuid not null references public.therapists (id) on delete cascade,
  year             integer not null check (year between 2020 and 2100),
  al_days          numeric not null default 0 check (al_days >= 0),
  carry_over_days  numeric not null default 0 check (carry_over_days >= 0),
  carry_over_until date,
  note             text,
  updated_by       uuid references public.therapists (id) on delete set null,
  updated_at       timestamptz not null default now(),
  primary key (therapist_id, year)
);

-- 3. Requests and the sessions they affect ----------------------------------------
create table public.leave_requests (
  id                   uuid primary key default gen_random_uuid(),
  therapist_id         uuid not null references public.therapists (id) on delete cascade,
  type                 text not null references public.leave_types (code),
  kind                 text references public.leave_kinds (code),
  reason               text check (char_length(reason) <= 300),
  start_date           date not null,
  end_date             date not null,
  half_day             text check (half_day in ('am','pm')),
  days                 numeric(5,1) not null check (days > 0),
  status               text not null default 'pending'
                         check (status in ('pending','approved','declined','cancelled')),
  submitted_at         timestamptz not null default now(),
  decided_by           uuid references public.therapists (id) on delete set null,
  decided_at           timestamptz,
  decision_note        text check (char_length(decision_note) <= 500),
  families_notified_on date,
  notified_by          uuid references public.therapists (id) on delete set null,
  created_at           timestamptz not null default now(),
  check (end_date >= start_date),
  check (end_date - start_date <= 366),
  check (half_day is null or start_date = end_date),
  check (days <= (end_date - start_date + 1)),
  check ((type = 'OL') = (kind is not null))
);
create index leave_requests_person_idx on public.leave_requests (therapist_id, start_date);
create index leave_requests_status_idx on public.leave_requests (status, start_date);

create table public.leave_sessions (
  id                    uuid primary key default gen_random_uuid(),
  request_id            uuid not null references public.leave_requests (id) on delete cascade,
  case_code             text not null check (case_code ~ '^[A-Z]{3}$'),  -- 3-letter case code only, never a name
  session_date          date not null,
  session_time          text check (char_length(session_time) <= 20),
  cover_kind            text not null check (cover_kind in ('cover','makeup')),
  covering_therapist_id uuid references public.therapists (id) on delete set null,
  makeup_date           date,
  makeup_time           text check (char_length(makeup_time) <= 20),
  check ((cover_kind = 'cover') = (covering_therapist_id is not null)),
  check (cover_kind = 'cover' or makeup_date is not null)
);
create index leave_sessions_request_idx on public.leave_sessions (request_id);

-- 4. Privileges + RLS ----------------------------------------------------------------
revoke all on public.leave_types, public.leave_kinds, public.leave_entitlements,
              public.leave_requests, public.leave_sessions from anon;
grant select, insert, update, delete on public.leave_types, public.leave_kinds to authenticated;
grant select, insert, update, delete on public.leave_entitlements to authenticated;
grant select, insert                 on public.leave_requests to authenticated;  -- changes go through functions
grant select, insert, delete         on public.leave_sessions to authenticated;

alter table public.leave_types        enable row level security;
alter table public.leave_kinds        enable row level security;
alter table public.leave_entitlements enable row level security;
alter table public.leave_requests     enable row level security;
alter table public.leave_sessions     enable row level security;

create policy "leave_types: signed-in read" on public.leave_types
  for select to authenticated using ((select private.current_therapist_id()) is not null);
create policy "leave_types: admin add" on public.leave_types
  for insert to authenticated with check ((select private.has_any_role(array['admin']::public.app_role[])));
create policy "leave_types: admin edit" on public.leave_types
  for update to authenticated
  using ((select private.has_any_role(array['admin']::public.app_role[])))
  with check ((select private.has_any_role(array['admin']::public.app_role[])));
create policy "leave_types: admin delete" on public.leave_types
  for delete to authenticated using ((select private.has_any_role(array['admin']::public.app_role[])));

create policy "leave_kinds: signed-in read" on public.leave_kinds
  for select to authenticated using ((select private.current_therapist_id()) is not null);
create policy "leave_kinds: admin add" on public.leave_kinds
  for insert to authenticated with check ((select private.has_any_role(array['admin']::public.app_role[])));
create policy "leave_kinds: admin edit" on public.leave_kinds
  for update to authenticated
  using ((select private.has_any_role(array['admin']::public.app_role[])))
  with check ((select private.has_any_role(array['admin']::public.app_role[])));
create policy "leave_kinds: admin delete" on public.leave_kinds
  for delete to authenticated using ((select private.has_any_role(array['admin']::public.app_role[])));

create policy "leave_entitlements: read own or admin/hr" on public.leave_entitlements
  for select to authenticated using (
    therapist_id = (select private.current_therapist_id()) or (select private.is_leave_team()));
create policy "leave_entitlements: admin/hr add" on public.leave_entitlements
  for insert to authenticated with check ((select private.is_leave_team()));
create policy "leave_entitlements: admin/hr edit" on public.leave_entitlements
  for update to authenticated
  using ((select private.is_leave_team())) with check ((select private.is_leave_team()));
create policy "leave_entitlements: admin/hr delete" on public.leave_entitlements
  for delete to authenticated using ((select private.is_leave_team()));

create policy "leave_requests: read own or admin/hr" on public.leave_requests
  for select to authenticated using (
    therapist_id = (select private.current_therapist_id()) or (select private.is_leave_team()));
create policy "leave_requests: submit own" on public.leave_requests
  for insert to authenticated with check (
    therapist_id = (select private.current_therapist_id())
    and status = 'pending' and decided_by is null and decided_at is null
    and families_notified_on is null and notified_by is null
  );

create policy "leave_sessions: read own or admin/hr" on public.leave_sessions
  for select to authenticated using (
    (select private.is_leave_team())
    or exists (select 1 from public.leave_requests r
               where r.id = request_id and r.therapist_id = (select private.current_therapist_id()))
  );
create policy "leave_sessions: add own while pending" on public.leave_sessions
  for insert to authenticated with check (
    exists (select 1 from public.leave_requests r
            where r.id = request_id and r.status = 'pending'
              and r.therapist_id = (select private.current_therapist_id()))
  );
create policy "leave_sessions: remove own while pending" on public.leave_sessions
  for delete to authenticated using (
    exists (select 1 from public.leave_requests r
            where r.id = request_id and r.status = 'pending'
              and r.therapist_id = (select private.current_therapist_id()))
  );

-- 5. Actions ------------------------------------------------------------------------------
-- HR (or an admin) approves or declines a pending request.
create or replace function public.leave_decide(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_any_role(array['hr','admin']::public.app_role[]) then
    raise exception 'Only HR can approve or decline leave.';
  end if;
  update public.leave_requests
     set status = case when p_approve then 'approved' else 'declined' end,
         decided_by = private.current_therapist_id(), decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id and status = 'pending';
  if not found then raise exception 'This request is no longer waiting for a decision.'; end if;
end $$;

-- An admin records that families were notified (approved requests only).
create or replace function public.leave_mark_notified(p_id uuid, p_date date)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_any_role(array['admin']::public.app_role[]) then
    raise exception 'Only an admin can record that families were notified.';
  end if;
  update public.leave_requests
     set families_notified_on = coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date),
         notified_by = private.current_therapist_id()
   where id = p_id and status = 'approved';
  if not found then raise exception 'Only approved leave can be marked as notified.'; end if;
end $$;

-- Cancel: your own request while it's pending; HR/admin can also cancel approved leave.
create or replace function public.leave_cancel(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.leave_requests r
     set status = 'cancelled'
   where r.id = p_id
     and ((r.therapist_id = private.current_therapist_id() and r.status = 'pending')
          or (private.is_leave_team() and r.status in ('pending','approved')));
  if not found then raise exception 'This request can''t be cancelled.'; end if;
end $$;

-- People a therapist can pick as "covering therapist": current CARE staff,
-- names only (no emails, dates or anything else).
create or replace function public.staff_picklist()
returns table (id uuid, full_name text, nickname text)
language sql stable security definer
set search_path = ''
as $$
  select t.id, t.full_name, t.nickname
  from public.therapists t
  where (select private.current_therapist_id()) is not null
    and t.status <> 'exited' and t.track = 'care_hire'
    and exists (select 1 from public.staff_roles r
                where r.therapist_id = t.id and r.role in ('therapist','senior','qcd','supervisor'))
  order by coalesce(t.nickname, t.full_name)
$$;

revoke execute on function public.leave_decide(uuid, boolean, text), public.leave_mark_notified(uuid, date),
                           public.leave_cancel(uuid), public.staff_picklist() from public, anon;
grant  execute on function public.leave_decide(uuid, boolean, text), public.leave_mark_notified(uuid, date),
                           public.leave_cancel(uuid), public.staff_picklist() to authenticated;

revoke execute on all functions in schema private from public;
grant  execute on function private.current_therapist_id()          to authenticated;
grant  execute on function private.has_any_role(public.app_role[]) to authenticated;
grant  execute on function private.is_training_team()              to authenticated;
grant  execute on function private.is_leave_team()                 to authenticated;

commit;
