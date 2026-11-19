-- (keep) Portal 052 – Yearly review, step 3: clinical checklist with IOA
--
-- Run AFTER 051. Once a year (year end; any time), for each therapist / senior / QCD:
--   * An admin (e.g. Ploy) or the Portal manager ASSIGNS a lead supervisor + a second
--     supervisor, and can add the review meeting dates (mid-year and year-end) later.
--   * Lead and second each score the yearly checklist ON THEIR OWN (0-3 / N/A; items
--     from the "Half-year Supervisor Evaluation" sheet, Junior / Senior). Neither sees
--     the other's scores until they've submitted their own.
--   * The LEAD compares (IOA = % of items both scored the same) and sets the FINAL
--     score per item (where they agree it's filled in; where only one scored, that one).
--     The final checklist is the clinical score (average of the section averages).
--   * Supervisors are evaluated by Chandni alone (lead, no second) once her
--     supervisor checklist is added in the editor.
-- Who sees: the 2 assigned supervisors (their own + each other's after submitting);
-- supervisors + admin / Portal manager see the final and the IOA. QCD: none. The
-- person sees it only when the review is released (step 4).

begin;

-- 1. The checklist
insert into public.sv_forms (key, title, version) values ('yearly_clinical', 'Yearly clinical checklist', 1) on conflict (key) do nothing;
insert into public.sv_form_versions (form_key, version, body)
values ('yearly_clinical', 1, $yc${"intro": "Year-end clinical evaluation: areas that are not scored in QCD sessions. The lead and second supervisor score on their own first; then the lead sets the final score after comparing (IOA).", "levels": [{"key": "junior", "label": "Junior"}, {"key": "senior", "label": "Senior / QCD"}, {"key": "supervisor", "label": "Supervisor"}], "scale": {"min": 0, "max": 3, "na": true, "labels": [{"v": 0, "label": "Does not demonstrate"}, {"v": 1, "label": "Emerging: inconsistent or needs a lot of support"}, {"v": 2, "label": "Proficient: correct but needs refinement"}, {"v": 3, "label": "Mastered: consistent and independent"}]}, "sections": [{"key": "prof", "title": "I. Professionalism & Attitude", "items": [{"key": "y1", "text": "Communicates respectfully and professionally with all team members / families.", "group": "", "levels": ["junior", "senior"]}, {"key": "y2", "text": "Complies with requests of supervisors and office staff in a timely manner.", "group": "", "levels": ["junior", "senior"]}, {"key": "y3", "text": "Presents problems or areas of concern within the chain of command.", "group": "", "levels": ["junior", "senior"]}, {"key": "y4", "text": "Seeks opportunities for professional development and growth.", "group": "", "levels": ["junior", "senior"]}, {"key": "y5", "text": "Supports and mentors junior therapists, providing guidance when needed.", "group": "", "levels": ["senior"]}, {"key": "y6", "text": "Facilitates collaboration between therapists, families, and school staff.", "group": "", "levels": ["senior"]}]}, {"key": "oversight", "title": "II. Clinical Oversight & Documentation", "items": [{"key": "y7", "text": "Ensures logbooks and case materials are professional, organized, and up to date.", "group": "", "levels": ["junior", "senior"]}, {"key": "y8", "text": "Brings up relevant behavioral concerns.", "group": "", "levels": ["junior", "senior"]}, {"key": "y9", "text": "Identifies and reports behaviors not in the BIP and / or changes to intensity / severity of current behaviors.", "group": "", "levels": ["senior"]}, {"key": "y10", "text": "Reviews team data regularly to ensure accuracy and completeness.", "group": "", "levels": ["senior"]}, {"key": "y11", "text": "Identifies program trends and communicates them to supervisors.", "group": "", "levels": ["senior"]}]}, {"key": "clinic", "title": "III. Core Clinical Skills (clinic meetings)", "items": [{"key": "y12", "text": "Is respectful and attentive when lessons are being demonstrated by team members and supervisors.", "group": "", "levels": ["junior", "senior"]}, {"key": "y13", "text": "Takes detailed clinic notes and implements all recommendations following clinic meetings.", "group": "", "levels": ["junior", "senior"]}, {"key": "y14", "text": "Coaching skill: incorporates feedback given by supervisors when demonstrating lessons.", "group": "", "levels": ["junior", "senior"]}, {"key": "y15", "text": "Clinic meeting: discussion is relevant to the current topic / helps stay on topic.", "group": "", "levels": ["junior", "senior"]}, {"key": "y16", "text": "Volunteers to demonstrate lessons during meetings; appears prepared and knowledgeable.", "group": "", "levels": ["senior"]}, {"key": "y17", "text": "Ensures participation of all team members throughout the entire clinic.", "group": "", "levels": ["senior"]}]}], "notes": [{"key": "strengths", "label": "Strengths"}, {"key": "growth", "label": "Areas to grow"}]}$yc$::jsonb)
on conflict (form_key, version) do nothing;

-- 2. Who evaluates whom + review meeting dates
create table if not exists public.sv_yearly (
  therapist_id  uuid not null references public.therapists (id) on delete cascade,
  year          integer not null check (year between 2024 and 2100),
  lead_id       uuid references public.therapists (id) on delete set null,
  second_id     uuid references public.therapists (id) on delete set null,
  mid_review_at timestamptz,
  end_review_at timestamptz,
  assigned_by   uuid references public.therapists (id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (therapist_id, year)
);
alter table public.sv_yearly enable row level security;
revoke all on public.sv_yearly from public, anon, authenticated;

-- 3. Scores: lead, second and final
create table if not exists public.sv_clinical (
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  year         integer not null,
  role         text not null check (role in ('lead','second','final')),
  scorer_id    uuid references public.therapists (id) on delete set null,
  form_version integer not null,
  level        text not null check (level in ('junior','senior','supervisor')),
  scores       jsonb not null default '{}'::jsonb,
  sections     jsonb not null default '{}'::jsonb,
  total        numeric(4,2),
  notes        jsonb not null default '{}'::jsonb,
  ioa          numeric(5,1),                                  -- final only: % agreement lead vs second
  submitted_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (therapist_id, year, role)
);
alter table public.sv_clinical enable row level security;
revoke all on public.sv_clinical from public, anon, authenticated;

-- 4. Assign lead / second / review dates (admin / Portal manager)
create or replace function public.sv_yearly_assign(p_who uuid, p_year integer, p_lead uuid, p_second uuid,
                                                   p_mid timestamptz, p_end timestamptz)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.has_any_role(array['admin']::public.app_role[]) then raise exception 'Only the Admin team can assign evaluators.'; end if;
  if p_lead is not null and not exists (select 1 from public.staff_roles r where r.therapist_id = p_lead and r.role = 'supervisor') then
    raise exception 'The lead must be a supervisor.';
  end if;
  if p_second is not null and not exists (select 1 from public.staff_roles r where r.therapist_id = p_second and r.role = 'supervisor') then
    raise exception 'The second must be a supervisor.';
  end if;
  if p_lead = p_who or p_second = p_who then raise exception 'Nobody evaluates themselves.'; end if;
  if p_lead is not null and p_lead = p_second then raise exception 'Choose two different supervisors.'; end if;
  insert into public.sv_yearly (therapist_id, year, lead_id, second_id, mid_review_at, end_review_at, assigned_by, updated_at)
  values (p_who, p_year, p_lead, p_second, p_mid, p_end, private.current_therapist_id(), now())
  on conflict (therapist_id, year) do update
     set lead_id = excluded.lead_id, second_id = excluded.second_id, mid_review_at = excluded.mid_review_at,
         end_review_at = excluded.end_review_at, assigned_by = excluded.assigned_by, updated_at = now();
end $$;

-- 5. Read one person's clinical evaluation (what the caller may see)
create or replace function public.sv_clinical_get(p_who uuid, p_year integer)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  y public.sv_yearly; v_role text; v_mine_sub boolean; v_final boolean; v_out jsonb := '[]'::jsonb; c public.sv_clinical;
begin
  select * into y from public.sv_yearly where therapist_id = p_who and year = p_year;
  v_role := case when y.lead_id = v_me then 'lead' when y.second_id = v_me then 'second' end;
  if v_role is null and not private.sv_yearly_team() then return null; end if;
  v_mine_sub := v_role is not null and exists (select 1 from public.sv_clinical where therapist_id = p_who and year = p_year and role = v_role and submitted_at is not null);
  v_final := exists (select 1 from public.sv_clinical where therapist_id = p_who and year = p_year and role = 'final');
  for c in select * from public.sv_clinical where therapist_id = p_who and year = p_year loop
    if c.role = v_role                                              -- my own
       or c.role = 'final'                                          -- the final: assigned + team
       or (v_role is not null and v_mine_sub and c.submitted_at is not null)   -- the other one, once I've submitted
       or (v_final and private.sv_yearly_team()) then               -- after the final: everything, for the team
      v_out := v_out || jsonb_build_array(jsonb_build_object('role', c.role, 'scorer', private.onb_name(c.scorer_id),
               'form_version', c.form_version, 'level', c.level, 'scores', c.scores, 'sections', c.sections, 'total', c.total,
               'notes', c.notes, 'ioa', c.ioa, 'submitted_at', c.submitted_at, 'updated_at', c.updated_at));
    else
      v_out := v_out || jsonb_build_array(jsonb_build_object('role', c.role, 'scorer', private.onb_name(c.scorer_id),
               'submitted_at', c.submitted_at, 'hidden', true));
    end if;
  end loop;
  return jsonb_build_object('lead_id', y.lead_id, 'second_id', y.second_id, 'lead', private.onb_name(y.lead_id),
           'second', private.onb_name(y.second_id), 'mid_review_at', y.mid_review_at, 'end_review_at', y.end_review_at,
           'my_role', v_role, 'entries', v_out);
end $$;

-- 6. Save my own scores (lead or second); p_submit = done
create or replace function public.sv_clinical_save(p_who uuid, p_year integer, p_level text, p_scores jsonb, p_notes jsonb, p_submit boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id(); y public.sv_yearly; v_role text;
  v_ver integer; v_body jsonb; v_keys text[]; k text; v jsonb; v_calc jsonb;
begin
  select * into y from public.sv_yearly where therapist_id = p_who and year = p_year;
  v_role := case when y.lead_id = v_me then 'lead' when y.second_id = v_me then 'second' end;
  if v_role is null then raise exception 'Only the assigned lead or second supervisor can score this.'; end if;
  if exists (select 1 from public.sv_clinical where therapist_id = p_who and year = p_year and role = 'final') then
    raise exception 'The final score is already set. Ask the lead to change it.';
  end if;
  if p_level not in ('junior','senior','supervisor') then raise exception 'Choose the level.'; end if;
  v_ver := coalesce((select form_version from public.sv_clinical where therapist_id = p_who and year = p_year and role = v_role),
                    (select version from public.sv_forms where key = 'yearly_clinical'));
  select body into v_body from public.sv_form_versions where form_key = 'yearly_clinical' and version = v_ver;
  select array_agg(i ->> 'key') into v_keys from jsonb_array_elements(v_body -> 'sections') s, jsonb_array_elements(s -> 'items') i
   where (i -> 'levels') ? p_level;
  if v_keys is null then raise exception 'The checklist has no items for this level yet.'; end if;
  for k, v in select * from jsonb_each(coalesce(p_scores, '{}'::jsonb)) loop
    if not (k = any (v_keys)) then raise exception 'A score doesn''t match the checklist. Refresh and try again.'; end if;
    if not ((jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric in (0,1,2,3)) or (jsonb_typeof(v) = 'string' and v #>> '{}' = 'na')) then
      raise exception 'Scores are 0 to 3 or N/A.';
    end if;
  end loop;
  v_calc := private.sv_score(v_body, p_level, coalesce(p_scores, '{}'::jsonb));
  insert into public.sv_clinical (therapist_id, year, role, scorer_id, form_version, level, scores, sections, total, notes, submitted_at, updated_at)
  values (p_who, p_year, v_role, v_me, v_ver, p_level, coalesce(p_scores, '{}'::jsonb), v_calc -> 'sections', (v_calc ->> 'total')::numeric,
          coalesce(p_notes, '{}'::jsonb), case when p_submit then now() end, now())
  on conflict (therapist_id, year, role) do update
     set scorer_id = v_me, level = excluded.level, scores = excluded.scores, sections = excluded.sections, total = excluded.total,
         notes = excluded.notes, submitted_at = case when p_submit then now() else sv_clinical.submitted_at end, updated_at = now();
end $$;

-- 7. The lead sets the final (after comparing). IOA = items both scored the same / items both scored.
create or replace function public.sv_clinical_finalize(p_who uuid, p_year integer, p_scores jsonb, p_notes jsonb)
returns numeric language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id(); y public.sv_yearly; l public.sv_clinical; s2 public.sv_clinical;
  v_body jsonb; v_keys text[]; k text; v jsonb; v_calc jsonb; v_ioa numeric; v_both integer; v_same integer;
begin
  select * into y from public.sv_yearly where therapist_id = p_who and year = p_year;
  if y.lead_id is distinct from v_me and not private.has_exact_role(array['manager']::public.app_role[]) then
    raise exception 'Only the lead supervisor sets the final score.';
  end if;
  select * into l from public.sv_clinical where therapist_id = p_who and year = p_year and role = 'lead';
  if l.submitted_at is null then raise exception 'Submit the lead''s own scores first.'; end if;
  select * into s2 from public.sv_clinical where therapist_id = p_who and year = p_year and role = 'second' and submitted_at is not null;
  select body into v_body from public.sv_form_versions where form_key = 'yearly_clinical' and version = l.form_version;
  select array_agg(i ->> 'key') into v_keys from jsonb_array_elements(v_body -> 'sections') sx, jsonb_array_elements(sx -> 'items') i
   where (i -> 'levels') ? l.level;
  for k, v in select * from jsonb_each(coalesce(p_scores, '{}'::jsonb)) loop
    if not (k = any (v_keys)) then raise exception 'A score doesn''t match the checklist.'; end if;
    if not ((jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric in (0,1,2,3)) or (jsonb_typeof(v) = 'string' and v #>> '{}' = 'na')) then
      raise exception 'Scores are 0 to 3 or N/A.';
    end if;
  end loop;
  if s2.therapist_id is not null then
    select count(*), count(*) filter (where l.scores -> kk = s2.scores -> kk) into v_both, v_same
    from unnest(v_keys) kk where l.scores ? kk and s2.scores ? kk;
    v_ioa := case when v_both > 0 then round(v_same * 100.0 / v_both, 1) end;
  end if;
  v_calc := private.sv_score(v_body, l.level, coalesce(p_scores, '{}'::jsonb));
  insert into public.sv_clinical (therapist_id, year, role, scorer_id, form_version, level, scores, sections, total, notes, ioa, submitted_at, updated_at)
  values (p_who, p_year, 'final', v_me, l.form_version, l.level, coalesce(p_scores, '{}'::jsonb), v_calc -> 'sections',
          (v_calc ->> 'total')::numeric, coalesce(p_notes, '{}'::jsonb), v_ioa, now(), now())
  on conflict (therapist_id, year, role) do update
     set scorer_id = v_me, scores = excluded.scores, sections = excluded.sections, total = excluded.total,
         notes = excluded.notes, ioa = excluded.ioa, submitted_at = now(), updated_at = now();
  return (v_calc ->> 'total')::numeric;
end $$;

-- 8. Team list: + evaluators, clinical progress, review dates
drop function if exists public.sv_yearly_people(integer);
create function public.sv_yearly_people(p_year integer)
returns table (id uuid, full_name text, nickname text, rank text, reflection text, submitted_at timestamptz,
               no_yearly boolean, admin_h1 integer, admin_h2 integer,
               lead_id uuid, second_id uuid, lead text, second text, lead_done boolean, second_done boolean,
               final_total numeric, ioa numeric, mid_review_at timestamptz, end_review_at timestamptz)
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
         (select count(*)::integer from public.sv_admin_evals e where e.therapist_id = t.id and e.year = p_year and e.half = 2),
         y.lead_id, y.second_id, private.onb_name(y.lead_id), private.onb_name(y.second_id),
         exists (select 1 from public.sv_clinical c where c.therapist_id = t.id and c.year = p_year and c.role = 'lead' and c.submitted_at is not null),
         exists (select 1 from public.sv_clinical c where c.therapist_id = t.id and c.year = p_year and c.role = 'second' and c.submitted_at is not null),
         (select c.total from public.sv_clinical c where c.therapist_id = t.id and c.year = p_year and c.role = 'final'),
         (select c.ioa from public.sv_clinical c where c.therapist_id = t.id and c.year = p_year and c.role = 'final'),
         y.mid_review_at, y.end_review_at
  from public.therapists t
  left join public.sv_yearly y on y.therapist_id = t.id and y.year = p_year
  where private.sv_yearly_team() and t.status <> 'exited' and t.track = 'care_hire'
    and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')
  order by lower(coalesce(t.nickname, t.full_name))
$$;

revoke execute on function public.sv_yearly_assign(uuid, integer, uuid, uuid, timestamptz, timestamptz), public.sv_clinical_get(uuid, integer),
                           public.sv_clinical_save(uuid, integer, text, jsonb, jsonb, boolean), public.sv_clinical_finalize(uuid, integer, jsonb, jsonb),
                           public.sv_yearly_people(integer) from public, anon;
grant  execute on function public.sv_yearly_assign(uuid, integer, uuid, uuid, timestamptz, timestamptz), public.sv_clinical_get(uuid, integer),
                           public.sv_clinical_save(uuid, integer, text, jsonb, jsonb, boolean), public.sv_clinical_finalize(uuid, integer, jsonb, jsonb),
                           public.sv_yearly_people(integer) to authenticated;

commit;
