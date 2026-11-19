-- (keep) Portal 045 – Supervision: checklists + QCD sessions (part 1)
--
-- Run AFTER 044. The Supervision tab, part 1: QCD sessions.
--   * sv_forms / sv_form_versions: editable checklists. Each save is a new
--     version; a record keeps the version it was scored with, so old scores
--     never change when a checklist is edited. Seeded: the QCD form (Junior /
--     Senior items from "0 Master file to copy.xlsx", scale 0-3 + N/A).
--   * sv_records: one row per QCD session: therapist, level, date, case code
--     (3 letters, never a name), scores, section averages, total, notes.
--     Scores and short text only: no files (keeps the database small).
-- Who:
--   record a QCD session ......... QCD and Supervisors (not on themselves)
--   see QCD sessions ............. the therapist (own), QCD, Supervisors, Admin / Portal manager
--   edit the checklists .......... Supervisors and Admin / Portal manager
--   Supervisor-level form ........ items come later (from Chandni, head of training)
-- Everything goes through the functions below (RLS on, no direct table access).

begin;

-- 1. Checklists -------------------------------------------------------------------------------------
create table if not exists public.sv_forms (
  key        text primary key check (key ~ '^[a-z_]{2,30}$'),
  title      text not null,
  version    integer not null default 1,
  updated_by uuid references public.therapists (id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.sv_form_versions (
  form_key   text not null references public.sv_forms (key) on delete cascade,
  version    integer not null,
  body       jsonb not null,
  created_by uuid references public.therapists (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (form_key, version)
);

-- 2. Records (QCD sessions now; yearly reviews and PIP stages later) ------------------------------------
create table if not exists public.sv_records (
  id           uuid primary key default gen_random_uuid(),
  form_key     text not null,
  form_version integer not null,
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  level        text not null check (level in ('junior','senior','supervisor')),
  held_on      date not null,
  case_code    text check (case_code ~ '^[A-Z]{3}$'),            -- never a child's name
  scores       jsonb not null default '{}'::jsonb,                -- { item key: 0..max or "na" }
  sections     jsonb not null default '{}'::jsonb,                -- { section key: average }
  total        numeric(4,2),
  notes        jsonb not null default '{}'::jsonb,                -- { strengths, prev_goals, new_goals }
  recorded_by  uuid references public.therapists (id) on delete set null,
  recorded_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (form_key, form_version) references public.sv_form_versions (form_key, version)
);
create index if not exists sv_records_person on public.sv_records (therapist_id, held_on desc);

alter table public.sv_forms enable row level security;
alter table public.sv_form_versions enable row level security;
alter table public.sv_records enable row level security;
revoke all on public.sv_forms, public.sv_form_versions, public.sv_records from public, anon, authenticated;

-- 3. Helpers --------------------------------------------------------------------------------------------
create or replace function private.sv_team()            -- may see everyone's QCD sessions
returns boolean language sql stable security definer set search_path = ''
as $$ select private.has_any_role(array['admin','supervisor','qcd']::public.app_role[]) $$;

create or replace function private.sv_level(p_who uuid)  -- which QCD level a person is scored on
returns text language sql stable security definer set search_path = ''
as $$
  select case
    when exists (select 1 from public.staff_roles r where r.therapist_id = p_who and r.role = 'supervisor') then 'supervisor'
    when exists (select 1 from public.staff_roles r where r.therapist_id = p_who and r.role in ('senior','qcd')) then 'senior'
    when exists (select 1 from public.staff_roles r where r.therapist_id = p_who and r.role = 'therapist') then 'junior'
  end
$$;

-- Section averages + total (= average of the section averages), for one level.
create or replace function private.sv_score(p_body jsonb, p_level text, p_scores jsonb)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
  v_sec jsonb; v_item jsonb; v_val jsonb;
  v_sum numeric; v_n integer; v_out jsonb := '{}'::jsonb;
  v_tot numeric := 0; v_tn integer := 0;
begin
  for v_sec in select * from jsonb_array_elements(p_body -> 'sections') loop
    v_sum := 0; v_n := 0;
    for v_item in select * from jsonb_array_elements(v_sec -> 'items') loop
      if not (v_item -> 'levels') ? p_level then continue; end if;
      v_val := p_scores -> (v_item ->> 'key');
      if v_val is not null and jsonb_typeof(v_val) = 'number' then
        v_sum := v_sum + (v_val #>> '{}')::numeric; v_n := v_n + 1;
      end if;
    end loop;
    if v_n > 0 then
      v_out := v_out || jsonb_build_object(v_sec ->> 'key', round(v_sum / v_n, 2));
      v_tot := v_tot + v_sum / v_n; v_tn := v_tn + 1;
    end if;
  end loop;
  return jsonb_build_object('sections', v_out, 'total', case when v_tn > 0 then round(v_tot / v_tn, 2) end);
end $$;

revoke execute on function private.sv_team(), private.sv_level(uuid), private.sv_score(jsonb, text, jsonb) from public, anon;
grant  execute on function private.sv_team(), private.sv_level(uuid), private.sv_score(jsonb, text, jsonb) to authenticated;

-- 4. Read -----------------------------------------------------------------------------------------------
-- A checklist (latest, or a given version: records show the version they were scored with).
create or replace function public.sv_form(p_key text, p_version integer default null)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('key', f.key, 'title', f.title, 'version', v.version, 'latest', f.version, 'body', v.body,
                            'updated_at', f.updated_at, 'updated_by', private.onb_name(f.updated_by))
  from public.sv_forms f
  join public.sv_form_versions v on v.form_key = f.key and v.version = coalesce(p_version, f.version)
  where f.key = p_key and private.is_care_staff()
$$;

-- The team list: current therapists with this year's QCD summary.
create or replace function public.sv_people(p_year integer)
returns table (id uuid, full_name text, nickname text, level text, sessions integer, last_on date,
               last_total numeric, prev_total numeric, flag boolean)
language sql stable security definer set search_path = ''
as $$
  with ppl as (
    select t.id, t.full_name, t.nickname, private.sv_level(t.id) as level
    from public.therapists t
    where private.sv_team() and t.status <> 'exited' and t.track = 'care_hire'
  ), recs as (
    select r.therapist_id, r.held_on, r.total,
           row_number() over (partition by r.therapist_id order by r.held_on desc, r.recorded_at desc) as rn
    from public.sv_records r
    where r.form_key = 'qcd'
  )
  select p.id, p.full_name, p.nickname, p.level,
         (select count(*)::integer from public.sv_records r
           where r.therapist_id = p.id and r.form_key = 'qcd' and extract(year from r.held_on) = p_year),
         (select held_on from recs where recs.therapist_id = p.id and rn = 1),
         (select total from recs where recs.therapist_id = p.id and rn = 1),
         (select total from recs where recs.therapist_id = p.id and rn = 2),
         -- PIP trigger: the last 2 QCD sessions (any case) both below 2.5
         coalesce((select bool_and(total < 2.5) and count(*) = 2 from recs where recs.therapist_id = p.id and rn <= 2), false)
  from ppl p
  where p.level is not null
  order by coalesce(p.nickname, p.full_name)
$$;

-- One person's QCD sessions in a year (the person themselves, or the team).
create or replace function public.sv_records(p_who uuid, p_year integer)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'form_key', r.form_key, 'form_version', r.form_version, 'level', r.level,
           'held_on', r.held_on, 'case_code', r.case_code, 'scores', r.scores, 'sections', r.sections,
           'total', r.total, 'notes', r.notes, 'recorded_by', r.recorded_by,
           'recorder', private.onb_name(r.recorded_by), 'recorded_at', r.recorded_at)
         order by r.held_on desc, r.recorded_at desc), '[]'::jsonb)
  from public.sv_records r
  where r.therapist_id = p_who and r.form_key = 'qcd'
    and extract(year from r.held_on) = p_year
    and (p_who = private.current_therapist_id() or private.sv_team())
$$;

-- 5. Write ----------------------------------------------------------------------------------------------
-- Record or edit a QCD session (QCD / Supervisors; not on yourself).
create or replace function public.sv_record_save(p_id uuid, p_who uuid, p_held_on date, p_case text,
                                                 p_level text, p_scores jsonb, p_notes jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_ver integer; v_body jsonb; v_calc jsonb; v_id uuid;
  v_case text := nullif(upper(btrim(coalesce(p_case, ''))), '');
  v_old public.sv_records;
  k text; v jsonb; v_max integer; v_keys text[];
begin
  if not private.has_exact_role(array['qcd','supervisor']::public.app_role[]) then
    raise exception 'Only QCD and supervisors can record a QCD session.';
  end if;
  if p_who = v_me then raise exception 'Ask another QCD or supervisor to score your own session.'; end if;
  if p_level not in ('junior','senior','supervisor') then raise exception 'Choose the level.'; end if;
  if p_held_on is null or p_held_on > (now() at time zone 'Asia/Bangkok')::date then raise exception 'Choose the session date (not in the future).'; end if;
  if v_case is not null and v_case !~ '^[A-Z]{3}$' then raise exception 'Case code: 3 letters (e.g. ABC), never a name.'; end if;
  if not exists (select 1 from public.therapists t where t.id = p_who and t.status <> 'exited' and t.track = 'care_hire') then
    raise exception 'Person not found.';
  end if;

  if p_id is not null then
    select * into v_old from public.sv_records where id = p_id;
    if not found then raise exception 'Session not found.'; end if;
    if v_old.recorded_by <> v_me and not private.has_exact_role(array['supervisor']::public.app_role[]) then
      raise exception 'Only the person who recorded it (or a supervisor) can change it.';
    end if;
    v_ver := v_old.form_version;           -- keep the checklist it was scored with
  else
    select version into v_ver from public.sv_forms where key = 'qcd';
  end if;
  select body into v_body from public.sv_form_versions where form_key = 'qcd' and version = v_ver;

  -- every score must be an item for this level, 0..max or "na"
  v_max := coalesce((v_body #>> '{scale,max}')::integer, 3);
  select array_agg(i ->> 'key') into v_keys
  from jsonb_array_elements(v_body -> 'sections') s, jsonb_array_elements(s -> 'items') i
  where (i -> 'levels') ? p_level;
  if v_keys is null then raise exception 'This checklist has no items for this level yet.'; end if;
  for k, v in select * from jsonb_each(coalesce(p_scores, '{}'::jsonb)) loop
    if not (k = any (v_keys)) then raise exception 'A score doesn''t match the checklist. Refresh and try again.'; end if;
    if not ((jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric in (0,1,2,3,4) and (v #>> '{}')::numeric <= v_max)
            or (jsonb_typeof(v) = 'string' and v #>> '{}' = 'na')) then
      raise exception 'Scores are 0 to % or N/A.', v_max;
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(coalesce(p_scores, '{}'::jsonb))) = 0 then raise exception 'Score at least one item.'; end if;

  v_calc := private.sv_score(v_body, p_level, p_scores);
  if p_id is null then
    insert into public.sv_records (form_key, form_version, therapist_id, level, held_on, case_code, scores, sections, total, notes, recorded_by)
    values ('qcd', v_ver, p_who, p_level, p_held_on, v_case, p_scores, v_calc -> 'sections', (v_calc ->> 'total')::numeric,
            coalesce(p_notes, '{}'::jsonb), v_me)
    returning id into v_id;
  else
    update public.sv_records
       set level = p_level, held_on = p_held_on, case_code = v_case, scores = p_scores,
           sections = v_calc -> 'sections', total = (v_calc ->> 'total')::numeric,
           notes = coalesce(p_notes, '{}'::jsonb), updated_at = now()
     where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.sv_record_delete(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.sv_records r
   where r.id = p_id
     and (r.recorded_by = private.current_therapist_id() or private.has_any_role(array['admin','supervisor']::public.app_role[]));
  if not found then raise exception 'Only the person who recorded it, a supervisor or an admin can remove it.'; end if;
end $$;

-- Save a checklist (Supervisors / Admin / Portal manager). Each save = a new version.
create or replace function public.sv_form_save(p_key text, p_title text, p_body jsonb)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_ver integer;
  v_keys text[];
begin
  if not private.has_any_role(array['admin','supervisor']::public.app_role[]) then
    raise exception 'Only supervisors and admins can edit checklists.';
  end if;
  if jsonb_typeof(p_body -> 'sections') <> 'array' or jsonb_array_length(p_body -> 'sections') = 0 then
    raise exception 'A checklist needs at least one section.';
  end if;
  select array_agg(i ->> 'key') into v_keys
  from jsonb_array_elements(p_body -> 'sections') s, jsonb_array_elements(s -> 'items') i;
  if exists (select 1 from unnest(v_keys) k where k is null or k !~ '^[a-z0-9_]{1,20}$') then raise exception 'Item keys look wrong.'; end if;
  if cardinality(v_keys) <> (select count(distinct k) from unnest(v_keys) k) then raise exception 'Two items share a key.'; end if;
  if exists (select 1 from jsonb_array_elements(p_body -> 'sections') s, jsonb_array_elements(s -> 'items') i
             where char_length(btrim(coalesce(i ->> 'text', ''))) < 3 or char_length(i ->> 'text') > 400) then
    raise exception 'Each item needs its wording (up to 400 characters).';
  end if;
  update public.sv_forms set version = version + 1, title = coalesce(nullif(btrim(p_title), ''), title),
                             updated_by = v_me, updated_at = now()
   where key = p_key returning version into v_ver;
  if not found then raise exception 'Checklist not found.'; end if;
  insert into public.sv_form_versions (form_key, version, body, created_by) values (p_key, v_ver, p_body, v_me);
  return v_ver;
end $$;

revoke execute on function public.sv_form(text, integer), public.sv_people(integer), public.sv_records(uuid, integer),
                           public.sv_record_save(uuid, uuid, date, text, text, jsonb, jsonb), public.sv_record_delete(uuid),
                           public.sv_form_save(text, text, jsonb) from public, anon;
grant  execute on function public.sv_form(text, integer), public.sv_people(integer), public.sv_records(uuid, integer),
                           public.sv_record_save(uuid, uuid, date, text, text, jsonb, jsonb), public.sv_record_delete(uuid),
                           public.sv_form_save(text, text, jsonb) to authenticated;

-- 6. Seed the QCD checklist (version 1) -------------------------------------------------------------
insert into public.sv_forms (key, title, version) values ('qcd', 'QCD session', 1) on conflict (key) do nothing;
insert into public.sv_form_versions (form_key, version, body)
values ('qcd', 1, $qcd${"intro": "Direct observation of in-session clinical and professional skills, by level. Senior-level staff are scored on all items.", "levels": [{"key": "junior", "label": "Junior"}, {"key": "senior", "label": "Senior / QCD"}, {"key": "supervisor", "label": "Supervisor"}], "scale": {"min": 0, "max": 3, "na": true, "labels": [{"v": 0, "label": "Does not demonstrate", "hint": "Junior 0/10 · Senior 0/10"}, {"v": 1, "label": "Emerging", "hint": "Inconsistent or needs a lot of support · Junior 3/10 · Senior 5/10"}, {"v": 2, "label": "Proficient", "hint": "Correct but needs refinement · Junior 5/10 · Senior 7/10"}, {"v": 3, "label": "Mastered", "hint": "Consistent and independent · Junior 7/10 · Senior 9/10"}]}, "sections": [{"key": "prof", "title": "I. In-Session Professionalism", "items": [{"key": "p1", "text": "Demonstrates positive rapport with client/caregiver.", "group": "Professionalism", "levels": ["junior", "senior"]}, {"key": "p2", "text": "Maintains client confidentiality.", "group": "Professionalism", "levels": ["junior", "senior"]}, {"key": "p3", "text": "Attends sessions consistently and arrives on time.", "group": "Professionalism", "levels": ["junior", "senior"]}, {"key": "p4", "text": "Ensures stimuli and materials are professional, organized, ready before/after presenting lesson.", "group": "Professionalism", "levels": ["junior", "senior"]}, {"key": "p5", "text": "Ensures logbook/materials are professional and organized throughout the team.", "group": "Professionalism", "levels": ["senior"]}, {"key": "p6", "text": "Ensures client is occupied throughout entire clinic/session (if applicable).", "group": "Professionalism", "levels": ["senior"]}, {"key": "p7", "text": "Remained responsive to problem behaviors throughout session (if applicable).", "group": "Professionalism", "levels": ["senior"]}, {"key": "p8", "text": "Appears confident in session and eager to engage with learner.", "group": "Professionalism", "levels": ["senior"]}]}, {"key": "core", "title": "II. Core Clinical Skills (The Overlap)", "items": [{"key": "c1", "text": "Accurately conducts preference assessments to establish effective reinforcers.", "group": "Reinforcement", "levels": ["junior", "senior"]}, {"key": "c2", "text": "Provide reinforcer within 0.5 seconds following correct response.", "group": "Reinforcement", "levels": ["junior", "senior"]}, {"key": "c3", "text": "Recognizes when reinforcers lose effectiveness and responds appropriately.", "group": "Reinforcement", "levels": ["junior", "senior"]}, {"key": "c4", "text": "Delivers clear and concise SDs.", "group": "DTT Delivery", "levels": ["junior", "senior"]}, {"key": "c5", "text": "Fades prompts systematically and appropriately across trials.", "group": "Prompting", "levels": ["junior", "senior"]}, {"key": "c6", "text": "Accurately uses errorless learning.", "group": "Prompting", "levels": ["junior", "senior"]}, {"key": "c7", "text": "Uses error correction procedures correctly.", "group": "Prompting", "levels": ["junior", "senior"]}, {"key": "c8", "text": "Progresses drills when criteria are met.", "group": "Progression", "levels": ["junior", "senior"]}, {"key": "c9", "text": "Uses informational \"no\"s with supportive and natural tone.", "group": "Error Procedures", "levels": ["junior", "senior"]}, {"key": "c10", "text": "Implements antecedent strategies according to the BIP.", "group": "Behavior Implement", "levels": ["junior", "senior"]}, {"key": "c11", "text": "Implements consequence strategies according to the BIP.", "group": "Behavior Implement", "levels": ["junior", "senior"]}, {"key": "c12", "text": "Correctly implements kind extinction for behavior states in current BIP (if applicable).", "group": "Behavior Implement", "levels": ["junior", "senior"]}, {"key": "c13", "text": "Records data accurately and in real-time.", "group": "Data Accuracy", "levels": ["junior", "senior"]}, {"key": "c14", "text": "Uses effective and dynamic reinforcement, incorporating social reinforcement and tangible items.", "group": "Reinforcement", "levels": ["senior"]}, {"key": "c15", "text": "Imitate and model new appropriate play to establish a new potential preferred activity.", "group": "Reinforcement", "levels": ["senior"]}, {"key": "c16", "text": "Uses differential reinforcement effectively when teaching new skills.", "group": "DTT Delivery", "levels": ["senior"]}, {"key": "c17", "text": "Fades prompts successfully, back stepping when needed.", "group": "Prompting", "levels": ["senior"]}, {"key": "c18", "text": "Monitors the flow of targets / ensures programs are moving forward appropriately.", "group": "Progression", "levels": ["senior"]}, {"key": "c19", "text": "Accurately uses errorless learning and error correction procedures (if applicable).", "group": "Error Procedures", "levels": ["senior"]}, {"key": "c20", "text": "Provides coaching on consistent BIP implementation to team members (if applicable).", "group": "Behavior Implement", "levels": ["senior"]}, {"key": "c21", "text": "Correctly implements planned ignoring for attention function (if applicable).", "group": "Behavior Implement", "levels": ["senior"]}, {"key": "c22", "text": "Accurately records narrative / NET data.", "group": "Data Accuracy", "levels": ["senior"]}]}, {"key": "found", "title": "III. Foundation Skills (Expected Mastery for ALL)", "items": [{"key": "f1", "text": "Gains attention effectively using a variety of strategies.", "group": "DTT", "levels": ["junior", "senior"]}, {"key": "f2", "text": "Follows discrete trial format and sets up the lesson appropriately.", "group": "DTT", "levels": ["junior", "senior"]}, {"key": "f3", "text": "Identifies response types correctly.", "group": "DTT", "levels": ["junior", "senior"]}, {"key": "f4", "text": "Engages client in age appropriate functional, adaptive and / or leisure activities.", "group": "NET", "levels": ["junior", "senior"]}, {"key": "f5", "text": "Correctly presents SDs within functional / NET setting.", "group": "NET", "levels": ["junior", "senior"]}, {"key": "f6", "text": "Engages client in age-appropriate functional activities.", "group": "NET", "levels": ["senior"]}, {"key": "f7", "text": "Effectively utilizes natural reinforcers.", "group": "NET", "levels": ["senior"]}, {"key": "f8", "text": "Maintains calm and consistent behavior management during sessions.", "group": "Behavior", "levels": ["senior"]}]}, {"key": "adv", "title": "IV. Senior-Specific / Advanced Skills", "items": [{"key": "a1", "text": "Provides opportunities for generalization to new materials, is creative and presents SDs with a variety of stimuli.", "group": "Maintenance", "levels": ["senior"]}, {"key": "a2", "text": "Contrives opportunities for skill targets with appropriate pacing / frequency.", "group": "NET", "levels": ["senior"]}, {"key": "a3", "text": "Correctly identifies the function(s) of a given behavior.", "group": "Behavior", "levels": ["senior"]}, {"key": "a4", "text": "Provides appropriate co-regulation during an occurrence of emotional reaction.", "group": "Behavior", "levels": ["senior"]}, {"key": "a5", "text": "Responds appropriately toward unexpected behavior which is not in the BIP (if applicable).", "group": "Behavior", "levels": ["senior"]}]}], "notes": [{"key": "strengths", "label": "Strengths observed"}, {"key": "prev_goals", "label": "Goals from the previous QCD / overlap / evaluation, and were they accomplished?"}, {"key": "new_goals", "label": "New goals"}]}$qcd$::jsonb)
on conflict (form_key, version) do nothing;

-- 7. The tab: therapists, QCD, supervisors, admin (not HR). Still switched off until an admin turns it on.
update public.app_modules
   set description = 'QCD sessions, yearly review, supervision log, PIP',
       roles = array['admin','supervisor','qcd','senior','therapist']::public.app_role[]
 where key = 'supervision';

commit;
