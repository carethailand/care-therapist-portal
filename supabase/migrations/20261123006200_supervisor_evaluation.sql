-- (keep) Portal 062 – Supervisor evaluation (part 1)
--
-- Run AFTER 061. The supervisors' own evaluation (CARE Supervisor Performance
-- Evaluation, 103 items in 9 weighted areas, rated 1–5 or N/A).
--   * Checklist 'sup_eval' (stored like the other checklists, so old scores never change).
--   * sv_sup_evals: one row per evaluation: type (6-month / 12-month / annual / check-in /
--     extra), date, scores, an optional detail note per item, summary and goals.
--   * Scores are worked out HERE: area average = rated items only (N/A and blanks left
--     out); weighted score = areas' weights, re-shared over the rated areas; label from
--     the score bands (below 2 Does not meet · 2 Developing · 3 Meets · 3.5 Exceeds ·
--     4.5 Exceptional).
-- Steps: draft (evaluator only) → finished (admin can see it, set up the review
--        meeting and print it) → shared with the supervisor → signed.
-- Who:
--   score / edit / finish ....... ONLY the evaluator(s) in private.sv_sup_evaluators
--                                 (set with a private setup file, never on GitHub)
--   read ........................ the evaluator(s); Admin (the exact Admin role) once it
--                                 is finished; the supervisor it is about once shared.
--                                 Never other supervisors.
--   share / hide ................ the evaluator or Admin (hide only until signed)
--   acknowledge (sign) .......... the supervisor it is about (signing ≠ agreeing)
-- Safe to run again.
-- Everything goes through the functions below (RLS on, no direct table access).

begin;

-- 1. Who scores (no screen for this: set it with the private setup file) ------------------------------
create table if not exists private.sv_sup_evaluators (
  therapist_id uuid primary key references public.therapists (id) on delete cascade
);
alter table private.sv_sup_evaluators enable row level security;
revoke all on private.sv_sup_evaluators from public, anon, authenticated;

create or replace function private.sv_sup_is_evaluator()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from private.sv_sup_evaluators where therapist_id = private.current_therapist_id()) $$;
revoke execute on function private.sv_sup_is_evaluator() from public, anon;
grant  execute on function private.sv_sup_is_evaluator() to authenticated;

-- 2. The checklist ---------------------------------------------------------------------------------------
insert into public.sv_forms (key, title, version) values ('sup_eval', 'Supervisor performance evaluation', 1)
on conflict (key) do nothing;
insert into public.sv_form_versions (form_key, version, body) values ('sup_eval', 1, $json$
{
"scale": [
{
"v": 1,
"label": "Does not meet"
},
{
"v": 2,
"label": "Developing"
},
{
"v": 3,
"label": "Meets"
},
{
"v": 4,
"label": "Exceeds"
},
{
"v": 5,
"label": "Exceptional"
}
],
"anchors": {
"1": "Does not meet expectations: significant improvement needed",
"2": "Developing: some expectations met, performance inconsistent",
"3": "Meets expectations: consistently competent for the supervisor role",
"4": "Exceeds expectations: performance above role expectations with evidence",
"5": "Exceptional: consistently outstanding; models or mentors others",
"na": "Not applicable or not observed (never for poor performance)"
},
"bands": [
{
"min": 4.5,
"label": "Exceptional"
},
{
"min": 3.5,
"label": "Exceeds"
},
{
"min": 3.0,
"label": "Meets"
},
{
"min": 2.0,
"label": "Developing"
},
{
"min": 0,
"label": "Does not meet"
}
],
"sections": [
{
"key": "s1",
"title": "Professionalism, Ethics & Collaboration",
"weight": 10,
"items": [
{
"key": "s1_1",
"no": "1.1",
"text": "Maintains professional rapport with clients, caregivers, therapists, and other professionals"
},
{
"key": "s1_2",
"no": "1.2",
"text": "Maintains appropriate professional boundaries"
},
{
"key": "s1_3",
"no": "1.3",
"text": "Communicates clearly, respectfully, and with appropriate clinical language"
},
{
"key": "s1_4",
"no": "1.4",
"text": "Maintains confidentiality and protects client information"
},
{
"key": "s1_5",
"no": "1.5",
"text": "Protects client dignity and respects individual/family preferences"
},
{
"key": "s1_6",
"no": "1.6",
"text": "Listens actively and responds thoughtfully to concerns and feedback"
},
{
"key": "s1_7",
"no": "1.7",
"text": "Promotes collaboration across team members and stakeholders"
},
{
"key": "s1_8",
"no": "1.8",
"text": "Demonstrates reliability, professionalism, and time management"
},
{
"key": "s1_9",
"no": "1.9",
"text": "Maintains focus on clients and clinical responsibilities"
},
{
"key": "s1_10",
"no": "1.10",
"text": "Explains clinical rationale accurately and clearly"
},
{
"key": "s1_11",
"no": "1.11",
"text": "Recognizes limits of competence and seeks consultation"
},
{
"key": "s1_12",
"no": "1.12",
"text": "Accepts and incorporates performance feedback"
}
]
},
{
"key": "s2",
"title": "Assessment, Program Design & Treatment Planning",
"weight": 15,
"items": [
{
"key": "s2_1",
"no": "2.1",
"text": "Makes individualized treatment recommendations using assessment and progress data"
},
{
"key": "s2_2",
"no": "2.2",
"text": "Recommends appropriate service intensity and settings"
},
{
"key": "s2_3",
"no": "2.3",
"text": "Identifies and addresses barriers to client progress"
},
{
"key": "s2_4",
"no": "2.4",
"text": "Prioritizes goals using clinical needs, data, and caregiver priorities"
},
{
"key": "s2_5",
"no": "2.5",
"text": "Develops functional, individualized, socially meaningful goals"
},
{
"key": "s2_6",
"no": "2.6",
"text": "Writes objective and measurable goals"
},
{
"key": "s2_7",
"no": "2.7",
"text": "Selects teaching methods suited to the learner and skill"
},
{
"key": "s2_8",
"no": "2.8",
"text": "Breaks complex skills into teachable components"
},
{
"key": "s2_9",
"no": "2.9",
"text": "Advances or modifies targets based on performance"
},
{
"key": "s2_10",
"no": "2.10",
"text": "Masters targets when criteria are met"
},
{
"key": "s2_11",
"no": "2.11",
"text": "Plans for maintenance of acquired skills"
},
{
"key": "s2_12",
"no": "2.12",
"text": "Plans for generalization across relevant conditions"
},
{
"key": "s2_13",
"no": "2.13",
"text": "Uses data to make timely treatment decisions"
},
{
"key": "s2_14",
"no": "2.14",
"text": "Addresses relevant skill domains based on individual needs"
}
]
},
{
"key": "s3",
"title": "Behavior Assessment & Intervention",
"weight": 15,
"items": [
{
"key": "s3_1",
"no": "3.1",
"text": "Defines target behavior clearly and observably"
},
{
"key": "s3_2",
"no": "3.2",
"text": "Selects appropriate behavior measurement systems"
},
{
"key": "s3_3",
"no": "3.3",
"text": "Establishes and documents baseline when indicated"
},
{
"key": "s3_4",
"no": "3.4",
"text": "Aligns measurable goals with baseline and measurement"
},
{
"key": "s3_5",
"no": "3.5",
"text": "Assesses behavioral function using appropriate methods"
},
{
"key": "s3_6",
"no": "3.6",
"text": "Develops individualized function-informed intervention plans"
},
{
"key": "s3_7",
"no": "3.7",
"text": "Designs appropriate antecedent/prevention strategies"
},
{
"key": "s3_8",
"no": "3.8",
"text": "Identifies and teaches functional replacement behaviors"
},
{
"key": "s3_9",
"no": "3.9",
"text": "Designs appropriate consequence strategies"
},
{
"key": "s3_10",
"no": "3.10",
"text": "Reviews behavior data and graphs regularly"
},
{
"key": "s3_11",
"no": "3.11",
"text": "Adjusts interventions when progress is insufficient"
},
{
"key": "s3_12",
"no": "3.12",
"text": "Fades, maintains, or discontinues procedures appropriately"
},
{
"key": "s3_13",
"no": "3.13",
"text": "Documents behavior plans and significant modifications"
},
{
"key": "s3_14",
"no": "3.14",
"text": "Responds clinically when expected behavior change does not occur"
}
]
},
{
"key": "s4",
"title": "Program Implementation & Clinical Modification",
"weight": 10,
"items": [
{
"key": "s4_1",
"no": "4.1",
"text": "Selects appropriate individualized teaching strategies"
},
{
"key": "s4_2",
"no": "4.2",
"text": "Probes new skills or approaches when indicated"
},
{
"key": "s4_3",
"no": "4.3",
"text": "Modifies teaching procedures in response to data"
},
{
"key": "s4_4",
"no": "4.4",
"text": "Recommends appropriate communication supports when indicated"
},
{
"key": "s4_5",
"no": "4.5",
"text": "Individualizes prompting strategies"
},
{
"key": "s4_6",
"no": "4.6",
"text": "Modifies materials, stimuli, or instructions when needed"
},
{
"key": "s4_7",
"no": "4.7",
"text": "Specifies appropriate reinforcement procedures"
},
{
"key": "s4_8",
"no": "4.8",
"text": "Specifies appropriate error-correction procedures"
},
{
"key": "s4_9",
"no": "4.9",
"text": "Uses appropriate discrimination training when relevant"
},
{
"key": "s4_10",
"no": "4.10",
"text": "Seeks referral or consultation when indicated"
},
{
"key": "s4_11",
"no": "4.11",
"text": "Practices within scope of competence"
}
]
},
{
"key": "s5",
"title": "Therapist Supervision, Coaching & Staff Development",
"weight": 20,
"items": [
{
"key": "s5_1",
"no": "5.1",
"text": "Explains treatment procedures and rationale clearly"
},
{
"key": "s5_2",
"no": "5.2",
"text": "Models new procedures and interventions when needed"
},
{
"key": "s5_3",
"no": "5.3",
"text": "Checks therapist competency through demonstration/practice"
},
{
"key": "s5_4",
"no": "5.4",
"text": "Provides timely, behavior-specific positive feedback"
},
{
"key": "s5_5",
"no": "5.5",
"text": "Provides professional, constructive corrective feedback"
},
{
"key": "s5_6",
"no": "5.6",
"text": "Identifies therapist strengths and skill gaps"
},
{
"key": "s5_7",
"no": "5.7",
"text": "Individualizes coaching to therapist needs"
},
{
"key": "s5_8",
"no": "5.8",
"text": "Checks accurate implementation of teaching procedures"
},
{
"key": "s5_9",
"no": "5.9",
"text": "Checks accurate implementation of behavior plans"
},
{
"key": "s5_10",
"no": "5.10",
"text": "Checks prompting, reinforcement, error correction, and data procedures"
},
{
"key": "s5_11",
"no": "5.11",
"text": "Responds promptly to therapist questions"
},
{
"key": "s5_12",
"no": "5.12",
"text": "Follows up on previous feedback and monitors progress"
},
{
"key": "s5_13",
"no": "5.13",
"text": "Encourages questions and collaborative clinical discussion"
},
{
"key": "s5_14",
"no": "5.14",
"text": "Supports therapist development and demonstrates leadership"
}
]
},
{
"key": "s6",
"title": "Caregiver Collaboration & Training",
"weight": 10,
"items": [
{
"key": "s6_1",
"no": "6.1",
"text": "Incorporates caregiver priorities appropriately"
},
{
"key": "s6_2",
"no": "6.2",
"text": "Develops measurable caregiver-training goals"
},
{
"key": "s6_3",
"no": "6.3",
"text": "Reviews goals, progress, and relevant data with caregivers"
},
{
"key": "s6_4",
"no": "6.4",
"text": "Explains recommendations in accessible language"
},
{
"key": "s6_5",
"no": "6.5",
"text": "Provides practical strategies for use outside sessions"
},
{
"key": "s6_6",
"no": "6.6",
"text": "Uses instruction, modeling, practice, and feedback as indicated"
},
{
"key": "s6_7",
"no": "6.7",
"text": "Assesses caregiver understanding and implementation"
},
{
"key": "s6_8",
"no": "6.8",
"text": "Monitors and adjusts caregiver-training goals"
},
{
"key": "s6_9",
"no": "6.9",
"text": "Responds respectfully to caregiver questions and concerns"
},
{
"key": "s6_10",
"no": "6.10",
"text": "Maintains collaborative professional caregiver relationships"
}
]
},
{
"key": "s7",
"title": "Data Collection, Analysis & Clinical Documentation",
"weight": 10,
"items": [
{
"key": "s7_1",
"no": "7.1",
"text": "Explains data procedures clearly to therapists"
},
{
"key": "s7_2",
"no": "7.2",
"text": "Explains relevant data procedures to caregivers"
},
{
"key": "s7_3",
"no": "7.3",
"text": "Reviews graphs and data to identify trends and needed changes"
},
{
"key": "s7_4",
"no": "7.4",
"text": "Conducts/arranges behavior-data IOA when indicated"
},
{
"key": "s7_5",
"no": "7.5",
"text": "Conducts/arranges skill-data IOA when indicated"
},
{
"key": "s7_6",
"no": "7.6",
"text": "Keeps clinical records aligned with current programming"
},
{
"key": "s7_7",
"no": "7.7",
"text": "Documents clinical decisions and significant changes"
},
{
"key": "s7_8",
"no": "7.8",
"text": "Maintains accurate, current clinical and supervision documentation"
}
]
},
{
"key": "s8",
"title": "Case Management & Leadership",
"weight": 5,
"items": [
{
"key": "s8_1",
"no": "8.1",
"text": "Oversees assigned cases, clients, and therapists effectively"
},
{
"key": "s8_2",
"no": "8.2",
"text": "Identifies operational and clinical issues proactively"
},
{
"key": "s8_3",
"no": "8.3",
"text": "Delegates appropriately while retaining accountability"
},
{
"key": "s8_4",
"no": "8.4",
"text": "Follows through on assigned and delegated responsibilities"
},
{
"key": "s8_5",
"no": "8.5",
"text": "Coordinates with families, schools, staff, and professionals"
},
{
"key": "s8_6",
"no": "8.6",
"text": "Supports continuity of care when service barriers arise"
},
{
"key": "s8_7",
"no": "8.7",
"text": "Prioritizes competing responsibilities appropriately"
},
{
"key": "s8_8",
"no": "8.8",
"text": "Solves problems independently within role"
},
{
"key": "s8_9",
"no": "8.9",
"text": "Escalates concerns appropriately"
},
{
"key": "s8_10",
"no": "8.10",
"text": "Contributes positively to team functioning and quality"
}
]
},
{
"key": "s9",
"title": "Administrative Responsibilities & Compliance",
"weight": 5,
"items": [
{
"key": "s9_1",
"no": "9.1",
"text": "Maintains required employment and administrative records"
},
{
"key": "s9_2",
"no": "9.2",
"text": "Submits required forms by deadlines"
},
{
"key": "s9_3",
"no": "9.3",
"text": "Submits accurate and timely timesheets/service records"
},
{
"key": "s9_4",
"no": "9.4",
"text": "Maintains accurate case information"
},
{
"key": "s9_5",
"no": "9.5",
"text": "Communicates schedule changes and cancellations per policy"
},
{
"key": "s9_6",
"no": "9.6",
"text": "Responds to administrative requests in a timely manner"
},
{
"key": "s9_7",
"no": "9.7",
"text": "Collaborates professionally with administrative staff"
},
{
"key": "s9_8",
"no": "9.8",
"text": "Follows CARE policies and procedures"
},
{
"key": "s9_9",
"no": "9.9",
"text": "Demonstrates punctuality and reliability"
},
{
"key": "s9_10",
"no": "9.10",
"text": "Addresses administrative/compliance concerns promptly"
}
]
}
]
}
$json$::jsonb)
on conflict (form_key, version) do nothing;

-- Only the evaluator may change this checklist (the other checklists keep their rule).
create or replace function public.sv_form_save(p_key text, p_title text, p_body jsonb)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_ver integer;
  v_keys text[];
begin
  if p_key = 'sup_eval' then
    if not private.sv_sup_is_evaluator() then raise exception 'Only the supervisor evaluator can edit this checklist.'; end if;
  elsif not private.has_any_role(array['admin','supervisor']::public.app_role[]) then
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

-- 3. Evaluations -------------------------------------------------------------------------------------------
create table if not exists public.sv_sup_evals (
  id           uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  evaluator_id uuid references public.therapists (id) on delete set null,
  kind         text not null check (kind in ('6_month','12_month','annual','check_in','extra')),
  eval_on      date not null,
  period       text check (char_length(period) <= 80),
  form_version integer not null,
  scores       jsonb not null default '{}'::jsonb,    -- item -> 1..5 or "na"
  notes        jsonb not null default '{}'::jsonb,    -- item -> optional detail
  review       jsonb not null default '{}'::jsonb,    -- strengths, priorities, recommendations, comments, prev_goals, new_goals
  sections     jsonb not null default '[]'::jsonb,    -- worked out here
  weighted     numeric(4,2),
  band         text,
  ready_at     timestamptz,                         -- finished by the evaluator
  released_at  timestamptz,
  signed_at    timestamptz,
  sign_comment text check (char_length(sign_comment) <= 2000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.sv_sup_evals add column if not exists ready_at timestamptz;
create index if not exists sv_sup_evals_who on public.sv_sup_evals (therapist_id, eval_on desc);
alter table public.sv_sup_evals enable row level security;     -- no policies: functions only
revoke all on public.sv_sup_evals from public, anon, authenticated;

create or replace function private.sv_sup_score(p_body jsonb, p_scores jsonb)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
  v_sec jsonb; v_item jsonb; v_val text;
  v_sum numeric; v_n integer; v_avg numeric; v_w numeric;
  v_out jsonb := '[]'::jsonb; v_wsum numeric := 0; v_wtot numeric := 0; v_score numeric; v_band text;
begin
  for v_sec in select * from jsonb_array_elements(p_body -> 'sections') loop
    v_sum := 0; v_n := 0;
    for v_item in select * from jsonb_array_elements(v_sec -> 'items') loop
      v_val := p_scores ->> (v_item ->> 'key');
      if v_val ~ '^[1-5]$' then v_sum := v_sum + v_val::integer; v_n := v_n + 1; end if;
    end loop;
    v_avg := case when v_n > 0 then v_sum / v_n end;
    v_w := coalesce((v_sec ->> 'weight')::numeric, 0);
    if v_n > 0 and v_w > 0 then v_wsum := v_wsum + v_avg * v_w; v_wtot := v_wtot + v_w; end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', v_sec ->> 'key', 'avg', round(v_avg, 2), 'n', v_n,
                                                           'of', jsonb_array_length(v_sec -> 'items')));
  end loop;
  v_score := case when v_wtot > 0 then round(v_wsum / v_wtot, 2) end;
  if v_score is not null then
    select b ->> 'label' into v_band from jsonb_array_elements(p_body -> 'bands') b
     where v_score >= (b ->> 'min')::numeric order by (b ->> 'min')::numeric desc limit 1;
  end if;
  return jsonb_build_object('sections', v_out, 'weighted', v_score, 'band', v_band);
end $$;
revoke execute on function private.sv_sup_score(jsonb, jsonb) from public, anon;
grant  execute on function private.sv_sup_score(jsonb, jsonb) to authenticated;

-- may read this evaluation?
create or replace function private.sv_sup_can_read(p_row public.sv_sup_evals)
returns boolean language sql stable security definer set search_path = ''
as $$ select private.sv_sup_is_evaluator()
          or (p_row.ready_at is not null and private.has_exact_role(array['admin']::public.app_role[]))
          or (p_row.therapist_id = private.current_therapist_id() and p_row.released_at is not null) $$;

create or replace function private.sv_sup_is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select private.has_exact_role(array['admin']::public.app_role[]) and not private.sv_sup_is_evaluator() $$;
revoke execute on function private.sv_sup_is_admin() from public, anon;
grant  execute on function private.sv_sup_is_admin() to authenticated;
revoke execute on function private.sv_sup_can_read(public.sv_sup_evals) from public, anon;
grant  execute on function private.sv_sup_can_read(public.sv_sup_evals) to authenticated;

create or replace function private.sv_sup_summary(e public.sv_sup_evals)
returns jsonb language sql stable security definer set search_path = ''
as $$ select jsonb_build_object('id', e.id, 'who', e.therapist_id, 'kind', e.kind, 'eval_on', e.eval_on, 'period', e.period,
       'weighted', e.weighted, 'band', e.band, 'sections', e.sections, 'ready_at', e.ready_at, 'released_at', e.released_at, 'signed_at', e.signed_at,
       'rated', (select count(*) from jsonb_each_text(e.scores) s where s.value ~ '^[1-5]$'),
       'evaluator', private.onb_name(e.evaluator_id), 'updated_at', e.updated_at) $$;
revoke execute on function private.sv_sup_summary(public.sv_sup_evals) from public, anon, authenticated;

-- 4. Reading ---------------------------------------------------------------------------------------------
-- 'evaluator' if you score supervisors, 'admin' for Admin, otherwise null (shows the Team view).
create or replace function public.sv_sup_role()
returns text language sql stable security definer set search_path = ''
as $$ select case when private.sv_sup_is_evaluator() then 'evaluator' when private.sv_sup_is_admin() then 'admin' end $$;

-- Evaluator / Admin: every supervisor (not the evaluator, not people marked "no yearly review"),
-- with their latest shared result and the latest one not shared yet (that you can read).
drop function if exists public.sv_sup_people();
create or replace function public.sv_sup_people()
returns table (id uuid, full_name text, nickname text, last jsonb, open jsonb, total integer)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.full_name, t.nickname,
         (select private.sv_sup_summary(e) from public.sv_sup_evals e
           where e.therapist_id = t.id and e.released_at is not null and private.sv_sup_can_read(e)
           order by e.eval_on desc, e.created_at desc limit 1),
         (select private.sv_sup_summary(e) from public.sv_sup_evals e
           where e.therapist_id = t.id and e.released_at is null and private.sv_sup_can_read(e)
           order by e.eval_on desc, e.created_at desc limit 1),
         (select count(*)::integer from public.sv_sup_evals e where e.therapist_id = t.id and private.sv_sup_can_read(e))
  from public.therapists t
  where (private.sv_sup_is_evaluator() or private.sv_sup_is_admin())
    and t.status <> 'exited' and not t.no_yearly
    and t.id <> private.current_therapist_id()
    and not exists (select 1 from private.sv_sup_evaluators v where v.therapist_id = t.id)
    and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role = 'supervisor')
$$;

-- One person's evaluations (newest first): the evaluator sees all, the person sees released ones.
create or replace function public.sv_sup_list(p_who uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(private.sv_sup_summary(e) order by e.eval_on desc, e.created_at desc), '[]'::jsonb)
  from public.sv_sup_evals e
  where e.therapist_id = p_who and private.sv_sup_can_read(e)
$$;

-- One evaluation in full, with the previous released one (for "growth since last time").
create or replace function public.sv_sup_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  e public.sv_sup_evals;
  p public.sv_sup_evals;
begin
  select * into e from public.sv_sup_evals where id = p_id;
  if not found or not private.sv_sup_can_read(e) then raise exception 'Evaluation not found.'; end if;
  select * into p from public.sv_sup_evals x
   where x.therapist_id = e.therapist_id and x.id <> e.id and x.released_at is not null
     and (x.eval_on, x.created_at) < (e.eval_on, e.created_at)
   order by x.eval_on desc, x.created_at desc limit 1;
  return private.sv_sup_summary(e) || jsonb_build_object(
    'form_version', e.form_version, 'scores', e.scores, 'notes', e.notes, 'review', e.review,
    'sign_comment', e.sign_comment,
    'name', (select coalesce(nickname, full_name) from public.therapists where id = e.therapist_id),
    'previous', case when p.id is null then null else private.sv_sup_summary(p) || jsonb_build_object('review', p.review) end);
end $$;

-- 5. Writing (evaluator only) -------------------------------------------------------------------------------
create or replace function public.sv_sup_save(p_id uuid, p_who uuid, p_kind text, p_on date, p_period text,
                                              p_scores jsonb, p_notes jsonb, p_review jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_old public.sv_sup_evals;
  v_ver integer;
  v_body jsonb;
  v_keys text[];
  v_calc jsonb;
  v_id uuid;
begin
  if not private.sv_sup_is_evaluator() then raise exception 'Only the supervisor evaluator can do this.'; end if;
  if p_who = v_me then raise exception 'You can’t evaluate yourself.'; end if;
  if not exists (select 1 from public.staff_roles r join public.therapists t on t.id = r.therapist_id
                  where r.therapist_id = p_who and r.role = 'supervisor' and t.status <> 'exited') then
    raise exception 'This person isn’t a supervisor.';
  end if;
  if p_kind is null or p_kind not in ('6_month','12_month','annual','check_in','extra') then raise exception 'Choose the type of evaluation.'; end if;
  if p_on is null or p_on > current_date + 60 or p_on < date '2020-01-01' then raise exception 'Check the evaluation date.'; end if;

  if p_id is not null then
    select * into v_old from public.sv_sup_evals where id = p_id for update;
    if not found or v_old.therapist_id <> p_who then raise exception 'Evaluation not found.'; end if;
    if v_old.released_at is not null then raise exception 'This evaluation is shared. Hide it first to make changes.'; end if;
    if v_old.ready_at is not null then raise exception 'This evaluation is finished. Reopen it to make changes.'; end if;
    v_ver := v_old.form_version;
  else
    select version into v_ver from public.sv_forms where key = 'sup_eval';
  end if;
  select body into v_body from public.sv_form_versions where form_key = 'sup_eval' and version = v_ver;
  if v_body is null then raise exception 'The checklist isn’t set up yet (Portal 062).'; end if;

  p_scores := coalesce(p_scores, '{}'::jsonb);
  p_notes := coalesce(p_notes, '{}'::jsonb);
  p_review := coalesce(p_review, '{}'::jsonb);
  if jsonb_typeof(p_scores) <> 'object' or jsonb_typeof(p_notes) <> 'object' or jsonb_typeof(p_review) <> 'object' then
    raise exception 'Bad request.';
  end if;
  select array_agg(i ->> 'key') into v_keys
    from jsonb_array_elements(v_body -> 'sections') s, jsonb_array_elements(s -> 'items') i;
  if exists (select 1 from jsonb_each_text(p_scores) x where not (x.key = any (v_keys)) or x.value !~ '^([1-5]|na)$') then
    raise exception 'A rating looks wrong (1–5 or N/A).';
  end if;
  if exists (select 1 from jsonb_each(p_notes) x where not (x.key = any (v_keys)) or jsonb_typeof(x.value) <> 'string'
                                                    or char_length(x.value #>> '{}') > 1000) then
    raise exception 'Each item detail can be up to 1000 characters.';
  end if;
  p_notes := coalesce((select jsonb_object_agg(x.key, btrim(x.value #>> '{}')) from jsonb_each(p_notes) x
                        where btrim(x.value #>> '{}') <> ''), '{}'::jsonb);
  if exists (select 1 from jsonb_object_keys(p_review) k
              where k not in ('strengths','priorities','recommendations','comments','prev_goals','new_goals'))
     or char_length(p_review::text) > 20000 then
    raise exception 'The summary and goals are too long.';
  end if;

  v_calc := private.sv_sup_score(v_body, p_scores);
  if p_id is null then
    insert into public.sv_sup_evals (therapist_id, evaluator_id, kind, eval_on, period, form_version, scores, notes, review,
                                     sections, weighted, band)
    values (p_who, v_me, p_kind, p_on, nullif(btrim(coalesce(p_period, '')), ''), v_ver, p_scores, p_notes, p_review,
            v_calc -> 'sections', (v_calc ->> 'weighted')::numeric, v_calc ->> 'band')
    returning id into v_id;
  else
    update public.sv_sup_evals
       set kind = p_kind, eval_on = p_on, period = nullif(btrim(coalesce(p_period, '')), ''),
           scores = p_scores, notes = p_notes, review = p_review, evaluator_id = v_me,
           sections = v_calc -> 'sections', weighted = (v_calc ->> 'weighted')::numeric, band = v_calc ->> 'band',
           updated_at = now()
     where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

-- Evaluator: mark finished (Admin can then see it) or reopen to edit (until shared).
create or replace function public.sv_sup_finish(p_id uuid, p_ready boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare e public.sv_sup_evals;
begin
  if not private.sv_sup_is_evaluator() then raise exception 'Only the supervisor evaluator can do this.'; end if;
  select * into e from public.sv_sup_evals where id = p_id for update;
  if not found then raise exception 'Evaluation not found.'; end if;
  if e.released_at is not null then raise exception 'It’s shared already. Hide it first.'; end if;
  if coalesce(p_ready, false) and e.kind <> 'check_in' and e.weighted is null then raise exception 'Rate at least one item first.'; end if;
  update public.sv_sup_evals set ready_at = case when p_ready then coalesce(ready_at, now()) end, updated_at = now() where id = p_id;
end $$;

-- Evaluator or Admin: share with the supervisor (or hide again, until they have signed).
create or replace function public.sv_sup_release(p_id uuid, p_show boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare e public.sv_sup_evals;
begin
  if not (private.sv_sup_is_evaluator() or private.sv_sup_is_admin()) then raise exception 'Only the evaluator or Admin can do this.'; end if;
  select * into e from public.sv_sup_evals where id = p_id for update;
  if not found then raise exception 'Evaluation not found.'; end if;
  if not coalesce(p_show, false) and e.signed_at is not null then raise exception 'Already signed: it can’t be hidden now.'; end if;
  if coalesce(p_show, false) and e.ready_at is null then raise exception 'The evaluator hasn’t finished it yet.'; end if;
  update public.sv_sup_evals set released_at = case when p_show then coalesce(released_at, now()) end, updated_at = now()
   where id = p_id;
end $$;

-- Delete an unshared evaluation.
create or replace function public.sv_sup_delete(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.sv_sup_is_evaluator() then raise exception 'Only the supervisor evaluator can do this.'; end if;
  delete from public.sv_sup_evals where id = p_id and released_at is null;
  if not found then raise exception 'Only an evaluation that isn’t shared yet can be deleted.'; end if;
end $$;

-- The supervisor acknowledges it (signing shows they've seen it; it isn't agreement).
create or replace function public.sv_sup_sign(p_id uuid, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.sv_sup_evals
     set signed_at = now(), sign_comment = nullif(btrim(coalesce(p_comment, '')), ''), updated_at = now()
   where id = p_id and therapist_id = private.current_therapist_id() and released_at is not null and signed_at is null;
  if not found then raise exception 'Nothing to sign.'; end if;
end $$;

revoke execute on function public.sv_sup_role(), public.sv_sup_people(), public.sv_sup_list(uuid), public.sv_sup_get(uuid),
  public.sv_sup_save(uuid, uuid, text, date, text, jsonb, jsonb, jsonb), public.sv_sup_finish(uuid, boolean), public.sv_sup_release(uuid, boolean),
  public.sv_sup_delete(uuid), public.sv_sup_sign(uuid, text) from public, anon;
grant execute on function public.sv_sup_role(), public.sv_sup_people(), public.sv_sup_list(uuid), public.sv_sup_get(uuid),
  public.sv_sup_save(uuid, uuid, text, date, text, jsonb, jsonb, jsonb), public.sv_sup_finish(uuid, boolean), public.sv_sup_release(uuid, boolean),
  public.sv_sup_delete(uuid), public.sv_sup_sign(uuid, text) to authenticated;

commit;
