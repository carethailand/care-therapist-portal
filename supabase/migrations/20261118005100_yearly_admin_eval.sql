-- (keep) Portal 051 – Yearly review, step 2: admin evaluation
--
-- Run AFTER 050. Twice a year (half 1 and half 2 — any time, not a hard limit),
-- the Admin team scores each person 0–3 (or N/A):
--   Human Resources (Pao) · Billing / Payroll (Oat) · Scheduling (Ploy)
-- Each section is scored ONLY by its owner (the Portal manager can fill any
-- section to cover). HR performance = average of the three section averages
-- (as in "Half-year Admin Evaluation"). Attendance is shown from Leave & HR and
-- is not scored. The person sees the scores later, when the review is released.
-- Who is evaluated: current therapists, seniors, QCD and supervisors, except people
-- marked "no yearly review" (e.g. P'A, Chandni) by an admin / Portal manager.
-- Who reads: supervisors + admin / Portal manager (not QCD).

begin;

-- 1. The form, with each section's owner looked up by nickname (change it in the app)
insert into public.sv_forms (key, title, version) values ('admin_eval', 'Admin evaluation', 1) on conflict (key) do nothing;
do $$
declare v_body jsonb := $adm${"title": "Admin evaluation", "intro": "HR performance evaluation: the overall assessment by the Admin team of work performance, work behaviour and working with the office. Each department scores its own section, twice a year.", "scale": {"min": 0, "max": 3, "na": true, "labels": [{"v": 0, "label": "Not meeting expectations"}, {"v": 1, "label": "Some met, some need improvement"}, {"v": 2, "label": "Meets expectations (80%)"}, {"v": 3, "label": "Exceeds expectations (100%)"}]}, "sections": [{"key": "hr", "title": "Human Resources", "owner": null, "owner_name": "Pao", "items": [{"key": "hr1", "text": "Keeps current paperwork required for employment"}, {"key": "hr2", "text": "Submits paperwork / leave form on time"}, {"key": "hr3", "text": "Is respectful to office personnel"}, {"key": "hr4", "text": "Complies with requests on time"}, {"key": "hr5", "text": "Is open to advice"}, {"key": "hr6", "text": "Time late", "note": "3 = no late arrivals in the period · 2 = 1–4 late arrivals · 1 = 5–8 late arrivals · 0 = more than 8"}]}, {"key": "billing", "title": "Billing / Payroll", "owner": null, "owner_name": "Oat", "items": [{"key": "bp1", "text": "Submits timesheets on time"}, {"key": "bp2", "text": "Submits timesheets with parents’ approval"}, {"key": "bp3", "text": "Provides an accurate amount of hours of service as recorded on timesheets"}, {"key": "bp4", "text": "Is respectful to office personnel"}, {"key": "bp5", "text": "Complies with requests on time"}]}, {"key": "scheduling", "title": "Scheduling", "owner": null, "owner_name": "Ploy", "items": [{"key": "sc1", "text": "Submits reasonable, written requests"}, {"key": "sc2", "text": "Is respectful to office personnel"}, {"key": "sc3", "text": "Cooperates with requested schedule changes"}, {"key": "sc4", "text": "Returns phone calls or replies to messages on Slack"}, {"key": "sc5", "text": "Informs about and keeps to a minimum all cancellations and changes in schedules"}, {"key": "sc6", "text": "Cooperates with instructions to fill in or cover a session"}, {"key": "sc7", "text": "Attends sessions on time"}]}]}$adm$::jsonb;
        v_out jsonb := '[]'::jsonb; v_sec jsonb; v_id uuid;
begin
  if exists (select 1 from public.sv_form_versions where form_key = 'admin_eval') then return; end if;
  for v_sec in select * from jsonb_array_elements(v_body -> 'sections') loop
    select t.id into v_id from public.therapists t
     where t.status <> 'exited' and lower(btrim(coalesce(t.nickname, ''))) = lower(v_sec ->> 'owner_name')
       and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role in ('admin','hr','manager'))
     limit 1;
    v_out := v_out || jsonb_build_array(v_sec || jsonb_build_object('owner', v_id));
  end loop;
  insert into public.sv_form_versions (form_key, version, body) values ('admin_eval', 1, jsonb_set(v_body, '{sections}', v_out));
end $$;

-- 2. Who has no yearly review
alter table public.therapists add column if not exists no_yearly boolean not null default false;

-- 3. Scores: one row per person / year / half / section
create table if not exists public.sv_admin_evals (
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  year         integer not null check (year between 2024 and 2100),
  half         smallint not null check (half in (1, 2)),
  section      text not null,
  form_version integer not null,
  scores       jsonb not null default '{}'::jsonb,
  average      numeric(4,2),
  note         text check (char_length(note) <= 1500),
  scored_by    uuid references public.therapists (id) on delete set null,
  scored_at    timestamptz not null default now(),
  primary key (therapist_id, year, half, section)
);
alter table public.sv_admin_evals enable row level security;
revoke all on public.sv_admin_evals from public, anon, authenticated;

-- 4. Read one person's admin evaluation for a year (both halves)
create or replace function public.sv_admin_eval_get(p_who uuid, p_year integer)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('half', e.half, 'section', e.section, 'form_version', e.form_version,
           'scores', e.scores, 'average', e.average, 'note', e.note, 'scored_by', e.scored_by,
           'scorer', private.onb_name(e.scored_by), 'scored_at', e.scored_at) order by e.half, e.section), '[]'::jsonb)
  from public.sv_admin_evals e
  where e.therapist_id = p_who and e.year = p_year and private.sv_yearly_team()
$$;

-- 5. Save one section (its owner, or the Portal manager)
create or replace function public.sv_admin_eval_save(p_who uuid, p_year integer, p_half integer, p_section text,
                                                     p_scores jsonb, p_note text)
returns numeric language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_ver integer; v_body jsonb; v_sec jsonb; v_keys text[]; k text; v jsonb; v_avg numeric;
begin
  if not private.has_any_role(array['admin']::public.app_role[]) then raise exception 'Only the Admin team can score this.'; end if;
  if p_who = v_me then raise exception 'You can''t score yourself.'; end if;
  if p_half not in (1, 2) then raise exception 'Choose half 1 or half 2.'; end if;
  if exists (select 1 from public.therapists t where t.id = p_who and t.no_yearly) then raise exception 'This person has no yearly review.'; end if;
  select version into v_ver from public.sv_forms where key = 'admin_eval';
  select body into v_body from public.sv_form_versions where form_key = 'admin_eval' and version = v_ver;
  select s into v_sec from jsonb_array_elements(v_body -> 'sections') s where s ->> 'key' = p_section;
  if v_sec is null then raise exception 'Section not found.'; end if;
  if coalesce(v_sec ->> 'owner', '') <> v_me::text and not private.has_exact_role(array['manager']::public.app_role[]) then
    raise exception 'Only % (this section''s owner) or the Portal manager can score it.', coalesce(private.onb_name((v_sec ->> 'owner')::uuid), 'its owner');
  end if;
  select array_agg(i ->> 'key') into v_keys from jsonb_array_elements(v_sec -> 'items') i;
  for k, v in select * from jsonb_each(coalesce(p_scores, '{}'::jsonb)) loop
    if not (k = any (v_keys)) then raise exception 'A score doesn''t match the form. Refresh and try again.'; end if;
    if not ((jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric in (0,1,2,3)) or (jsonb_typeof(v) = 'string' and v #>> '{}' = 'na')) then
      raise exception 'Scores are 0 to 3 or N/A.';
    end if;
  end loop;
  select round(avg((v2 #>> '{}')::numeric), 2) into v_avg
  from jsonb_each(coalesce(p_scores, '{}'::jsonb)) as e(k2, v2) where jsonb_typeof(v2) = 'number';
  if v_avg is null then raise exception 'Score at least one item.'; end if;
  insert into public.sv_admin_evals (therapist_id, year, half, section, form_version, scores, average, note, scored_by, scored_at)
  values (p_who, p_year, p_half, p_section, v_ver, p_scores, v_avg, nullif(btrim(coalesce(p_note, '')), ''), v_me, now())
  on conflict (therapist_id, year, half, section) do update
     set form_version = excluded.form_version, scores = excluded.scores, average = excluded.average,
         note = excluded.note, scored_by = excluded.scored_by, scored_at = now();
  return v_avg;
end $$;

-- 6. Section owners (admin / Portal manager): makes a new form version
create or replace function public.sv_admin_eval_owners(p_owners jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_ver integer; v_body jsonb; v_new jsonb;
begin
  if not private.has_any_role(array['admin']::public.app_role[]) then raise exception 'Only admins can change this.'; end if;
  select version into v_ver from public.sv_forms where key = 'admin_eval';
  select body into v_body from public.sv_form_versions where form_key = 'admin_eval' and version = v_ver;
  select jsonb_agg(case when p_owners ? (s ->> 'key')
                        then s || jsonb_build_object('owner', nullif(p_owners ->> (s ->> 'key'), ''),
                                                     'owner_name', private.onb_name(nullif(p_owners ->> (s ->> 'key'), '')::uuid))
                        else s end order by ord)
    into v_new from jsonb_array_elements(v_body -> 'sections') with ordinality as x(s, ord);
  update public.sv_forms set version = v_ver + 1, updated_by = private.current_therapist_id(), updated_at = now() where key = 'admin_eval';
  insert into public.sv_form_versions (form_key, version, body, created_by)
  values ('admin_eval', v_ver + 1, jsonb_set(v_body, '{sections}', v_new), private.current_therapist_id());
end $$;

-- 7. Mark someone as having no yearly review (admin / Portal manager)
create or replace function public.sv_set_no_yearly(p_who uuid, p_none boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.has_any_role(array['admin']::public.app_role[]) then raise exception 'Only admins can change this.'; end if;
  update public.therapists set no_yearly = coalesce(p_none, false) where id = p_who;
end $$;

-- 8. Team list: + admin evaluation progress (sections done per half) and "no yearly review"
drop function if exists public.sv_yearly_people(integer);
create function public.sv_yearly_people(p_year integer)
returns table (id uuid, full_name text, nickname text, rank text, reflection text, submitted_at timestamptz,
               no_yearly boolean, admin_h1 integer, admin_h2 integer)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.full_name, t.nickname,
         case when exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role = 'supervisor') then 'supervisor'
              when exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role = 'qcd') then 'qcd'
              when exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role = 'senior') then 'senior'
              when exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role = 'therapist') then 'therapist'
              else 'office' end,
         coalesce((select case when x.status = 'submitted' then 'submitted' else 'started' end
                   from public.sv_reflections x where x.therapist_id = t.id and x.year = p_year), 'none'),
         (select x.submitted_at from public.sv_reflections x where x.therapist_id = t.id and x.year = p_year),
         t.no_yearly,
         (select count(*)::integer from public.sv_admin_evals e where e.therapist_id = t.id and e.year = p_year and e.half = 1),
         (select count(*)::integer from public.sv_admin_evals e where e.therapist_id = t.id and e.year = p_year and e.half = 2)
  from public.therapists t
  where private.sv_yearly_team() and t.status <> 'exited' and t.track = 'care_hire'
    and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')
  order by lower(coalesce(t.nickname, t.full_name))
$$;

revoke execute on function public.sv_admin_eval_get(uuid, integer), public.sv_admin_eval_save(uuid, integer, integer, text, jsonb, text),
                           public.sv_admin_eval_owners(jsonb), public.sv_set_no_yearly(uuid, boolean), public.sv_yearly_people(integer) from public, anon;
grant  execute on function public.sv_admin_eval_get(uuid, integer), public.sv_admin_eval_save(uuid, integer, integer, text, jsonb, text),
                           public.sv_admin_eval_owners(jsonb), public.sv_set_no_yearly(uuid, boolean), public.sv_yearly_people(integer) to authenticated;

commit;
