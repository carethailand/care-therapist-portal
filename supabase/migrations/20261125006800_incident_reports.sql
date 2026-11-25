-- (keep) Portal 068 – Reports & Forms: incident reports
--
-- Run AFTER 067. The old "Documents / Forms" tab becomes "Reports & Forms" (switched on
-- for all CARE staff). First form: the INCIDENT REPORT (for a therapist or a client),
-- the paper form in the Portal:
--   when / where / scheduled time · injury found before the session · body areas (front /
--   back) · what it was (bite, bruise, …) · what happened · who it was reported to and
--   when · left work / came back · medical attention · measures taken · how to prevent it ·
--   comments.
-- PRIVACY: the child is a 3-letter case code ONLY. No names, no photos, no files.
-- Steps: draft (only the writer) → submitted (signed by the writer) → reviewed (the
--        supervisor of that case adds a note) → closed (OM / HR).
-- Who:
--   write ......... any CARE staff (their own reports)
--   read .......... the writer, the supervisor they CHOSE (the supervisor of that case),
--                   Admin / HR (and the Portal manager). Never other supervisors.
--   review ........ only the chosen supervisor · close: Admin / HR
-- Slack: tx-to-admin gets "New incident report" (case code only).
-- Everything goes through the functions below (RLS on, no direct table access).
-- Safe to run again.

begin;

-- 1. The tab ---------------------------------------------------------------------------------------------
update public.app_modules
   set label = 'Reports & Forms', description = 'Incident reports and other forms', enabled = true,
       roles = array['admin','hr','manager','supervisor','qcd','senior','therapist']::public.app_role[]
 where key = 'documents';

-- 2. Reports ---------------------------------------------------------------------------------------------
create table if not exists public.incident_reports (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid not null references public.therapists (id) on delete cascade,
  for_whom       text not null default 'tx' check (for_whom in ('tx','client')),
  case_code      text check (case_code ~ '^[A-Z]{3}$'),
  schedule_time  text check (char_length(schedule_time) <= 40),
  occurred_on    date,
  occurred_time  text check (char_length(occurred_time) <= 20),
  location       text check (char_length(location) <= 120),
  before_session boolean not null default false,
  body_areas     text[] not null default '{}' check (cardinality(body_areas) <= 60),
  symptoms       text[] not null default '{}' check (cardinality(symptoms) <= 30),
  symptom_other  text check (char_length(symptom_other) <= 200),
  description    text check (char_length(description) <= 3000),
  reported_to    text[] not null default '{}' check (reported_to <@ array['supervisor','parent','om','nanny','other']),
  reported_other text check (char_length(reported_other) <= 120),
  reported_on    date,
  reported_time  text check (char_length(reported_time) <= 20),
  left_work_time text check (char_length(left_work_time) <= 20),
  returned       boolean,
  returned_time  text check (char_length(returned_time) <= 20),
  no_medical     boolean not null default false,
  measures       text check (char_length(measures) <= 2000),
  prevention     text check (char_length(prevention) <= 2000),
  comments       text check (char_length(comments) <= 2000),
  supervisor_id  uuid references public.therapists (id) on delete set null,
  status         text not null default 'draft' check (status in ('draft','submitted','reviewed','closed')),
  submitted_at   timestamptz,
  sup_note       text check (char_length(sup_note) <= 2000),
  sup_signed_at  timestamptz,
  hr_id          uuid references public.therapists (id) on delete set null,
  hr_note        text check (char_length(hr_note) <= 2000),
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists incident_reports_reporter on public.incident_reports (reporter_id, occurred_on desc);
create index if not exists incident_reports_sup on public.incident_reports (supervisor_id);
alter table public.incident_reports enable row level security;   -- no policies: functions only
revoke all on public.incident_reports from public, anon, authenticated;

create or replace function private.incident_office()
returns boolean language sql stable security definer set search_path = ''
as $$ select private.has_any_role(array['admin','hr']::public.app_role[]) $$;   -- includes the Portal manager
revoke execute on function private.incident_office() from public, anon;
grant  execute on function private.incident_office() to authenticated;

create or replace function private.incident_can_read(r public.incident_reports)
returns boolean language sql stable security definer set search_path = ''
as $$ select r.reporter_id = private.current_therapist_id()
          or (r.status <> 'draft' and (r.supervisor_id = private.current_therapist_id() or private.incident_office())) $$;
revoke execute on function private.incident_can_read(public.incident_reports) from public, anon;
grant  execute on function private.incident_can_read(public.incident_reports) to authenticated;

-- 3. Reading ---------------------------------------------------------------------------------------------
-- 'office' (Admin / HR), 'supervisor' (can be chosen for a case) or 'staff'.
create or replace function public.incident_role()
returns text language sql stable security definer set search_path = ''
as $$ select case when private.incident_office() then 'office'
                  when private.has_exact_role(array['supervisor']::public.app_role[]) then 'supervisor'
                  else 'staff' end $$;

-- Supervisors to pick from (the supervisor of that case), A–Z.
create or replace function public.incident_supervisors()
returns table (id uuid, full_name text, nickname text)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.full_name, t.nickname from public.therapists t
  where private.is_care_staff() and t.status <> 'exited'
    and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role = 'supervisor')
  order by lower(coalesce(t.nickname, t.full_name))
$$;

-- Every report I can read (newest first), with names.
create or replace function public.incident_list()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
           'reporter', private.onb_name(r.reporter_id), 'supervisor', private.onb_name(r.supervisor_id),
           'hr', private.onb_name(r.hr_id))
         order by coalesce(r.occurred_on, r.created_at::date) desc, r.created_at desc), '[]'::jsonb)
  from public.incident_reports r
  where private.incident_can_read(r)
$$;

-- 4. Writing (the writer) ------------------------------------------------------------------------------------
-- Save a draft or a submitted report that the supervisor hasn't reviewed yet. p = the fields.
create or replace function public.incident_save(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  r public.incident_reports;
  v_id uuid;
  v_sup uuid := nullif(p ->> 'supervisor_id', '')::uuid;
  v_case text := nullif(upper(btrim(coalesce(p ->> 'case_code', ''))), '');
begin
  if v_me is null or not private.is_care_staff() then raise exception 'Only CARE staff can write incident reports.'; end if;
  if p_id is not null then
    select * into r from public.incident_reports where id = p_id for update;
    if r.id is null or r.reporter_id <> v_me then raise exception 'This isn''t your report.'; end if;
    if r.status not in ('draft','submitted') then raise exception 'Your supervisor has already reviewed this report.'; end if;
  end if;
  if v_case is not null and v_case !~ '^[A-Z]{3}$' then raise exception 'Use the 3-letter case code (e.g. ABC), never a name.'; end if;
  if v_sup is not null and not exists (select 1 from public.staff_roles where therapist_id = v_sup and role = 'supervisor') then
    raise exception 'Choose a supervisor from the list.';
  end if;
  if v_sup = v_me then raise exception 'Choose the supervisor of that case (not yourself).'; end if;

  if p_id is null then
    insert into public.incident_reports (reporter_id) values (v_me) returning id into v_id;
  else
    v_id := p_id;
  end if;
  update public.incident_reports set
    for_whom       = case when p ->> 'for_whom' = 'client' then 'client' else 'tx' end,
    case_code      = v_case,
    schedule_time  = nullif(btrim(coalesce(p ->> 'schedule_time', '')), ''),
    occurred_on    = nullif(p ->> 'occurred_on', '')::date,
    occurred_time  = nullif(btrim(coalesce(p ->> 'occurred_time', '')), ''),
    location       = nullif(btrim(coalesce(p ->> 'location', '')), ''),
    before_session = coalesce((p ->> 'before_session')::boolean, false),
    body_areas     = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'body_areas', '[]')) x where x ~ '^(front|back|face):[a-z_]{2,20}$'), '{}'),
    symptoms       = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'symptoms', '[]')) x where x ~ '^[a-z_]{2,20}$'), '{}'),
    symptom_other  = nullif(btrim(coalesce(p ->> 'symptom_other', '')), ''),
    description    = nullif(btrim(coalesce(p ->> 'description', '')), ''),
    reported_to    = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'reported_to', '[]')) x
                                where x in ('supervisor','parent','om','nanny','other')), '{}'),
    reported_other = nullif(btrim(coalesce(p ->> 'reported_other', '')), ''),
    reported_on    = nullif(p ->> 'reported_on', '')::date,
    reported_time  = nullif(btrim(coalesce(p ->> 'reported_time', '')), ''),
    left_work_time = nullif(btrim(coalesce(p ->> 'left_work_time', '')), ''),
    returned       = (p ->> 'returned')::boolean,
    returned_time  = nullif(btrim(coalesce(p ->> 'returned_time', '')), ''),
    no_medical     = coalesce((p ->> 'no_medical')::boolean, false),
    measures       = nullif(btrim(coalesce(p ->> 'measures', '')), ''),
    prevention     = nullif(btrim(coalesce(p ->> 'prevention', '')), ''),
    comments       = nullif(btrim(coalesce(p ->> 'comments', '')), ''),
    supervisor_id  = v_sup,
    updated_at     = now()
  where id = v_id;
  return v_id;
end $$;

-- Sign and send (draft → submitted).
create or replace function public.incident_submit(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.incident_reports;
begin
  select * into r from public.incident_reports where id = p_id for update;
  if r.id is null or r.reporter_id <> private.current_therapist_id() then raise exception 'This isn''t your report.'; end if;
  if r.status <> 'draft' then raise exception 'This report has already been sent.'; end if;
  if r.occurred_on is null then raise exception 'Add the date of the incident.'; end if;
  if r.case_code is null then raise exception 'Add the 3-letter case code.'; end if;
  if r.supervisor_id is null then raise exception 'Choose the supervisor of that case.'; end if;
  if char_length(coalesce(r.description, '')) < 10 then raise exception 'Please describe what happened.'; end if;
  update public.incident_reports set status = 'submitted', submitted_at = now(), updated_at = now() where id = p_id;
  begin
    perform private.slack_post('tx-to-admin', '🩹 *New incident report* · ' || private.slack_name(r.reporter_id)
      || ' · ' || case when r.for_whom = 'client' then 'client' else 'therapist' end || ' incident · case ' || r.case_code
      || ' · ' || to_char(r.occurred_on, 'DD Mon') || ' · ' || private.slack_link('documents'));
  exception when others then null;   -- Slack is optional
  end;
end $$;

-- Delete a draft.
create or replace function public.incident_delete(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.incident_reports where id = p_id and reporter_id = private.current_therapist_id() and status = 'draft';
  if not found then raise exception 'Only your own draft can be deleted.'; end if;
end $$;

-- 5. Sign-off -----------------------------------------------------------------------------------------------
-- The chosen supervisor reviews (submitted → reviewed).
create or replace function public.incident_review(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Please add a short note.'; end if;
  update public.incident_reports
     set status = 'reviewed', sup_note = left(btrim(p_note), 2000), sup_signed_at = now(), updated_at = now()
   where id = p_id and status = 'submitted' and supervisor_id = private.current_therapist_id();
  if not found then raise exception 'Only the chosen supervisor can review this report, once it''s sent.'; end if;
end $$;

-- OM / HR close it (after the supervisor's review).
create or replace function public.incident_close(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.incident_office() then raise exception 'Only Admin / HR can close a report.'; end if;
  update public.incident_reports
     set status = 'closed', hr_id = private.current_therapist_id(), hr_note = nullif(left(btrim(coalesce(p_note, '')), 2000), ''),
         closed_at = now(), updated_at = now()
   where id = p_id and status = 'reviewed';
  if not found then raise exception 'A report can be closed after the supervisor has reviewed it.'; end if;
end $$;

revoke execute on function public.incident_role(), public.incident_supervisors(), public.incident_list(),
  public.incident_save(uuid, jsonb), public.incident_submit(uuid), public.incident_delete(uuid),
  public.incident_review(uuid, text), public.incident_close(uuid, text) from public, anon;
grant execute on function public.incident_role(), public.incident_supervisors(), public.incident_list(),
  public.incident_save(uuid, jsonb), public.incident_submit(uuid), public.incident_delete(uuid),
  public.incident_review(uuid, text), public.incident_close(uuid, text) to authenticated;

commit;
