-- (keep) Portal 050 – Yearly review, step 1: self-reflection
--
-- Run AFTER 049. Everyone at CARE (office staff too) writes the CARE Year-End
-- Reflection & Growth Review in Supervision → My supervision. It saves as they
-- go (a draft only they can see) and they tap Submit when ready; they can still
-- improve it after submitting.
-- Who reads a SUBMITTED reflection: the person, supervisors, admin / Portal manager.
-- (Drafts: only the person.) QCD don't see other people's reflections.
-- The questions are a versioned form ('self') like the QCD checklist; answers keep
-- the version they were written with. Text only: about 5–10 KB a person a year.

begin;

-- 1. The form (from "Year end Review.docx")
insert into public.sv_forms (key, title, version) values ('self', 'Year-end reflection', 1) on conflict (key) do nothing;
insert into public.sv_form_versions (form_key, version, body)
values ('self', 1, $self${"title": "CARE Year-End Reflection & Growth Review", "intro": "Take time to recognize your growth and accomplishments, identify areas you would like to keep developing, and help CARE understand how we can better support you. There are no “right” answers: we want to hear about your experience. You can answer in Thai or English.", "parts": [{"key": "celebrate", "title": "1. Celebrating your year", "questions": [{"key": "q1", "text": "What are you most proud of accomplishing this year?", "hint": "This can include accomplishments with clients, families, coworkers, your own professional development, or anything else that feels meaningful to you."}, {"key": "q2", "text": "What is something you can do now that you feel more confident or skilled at compared with the beginning of the year?"}, {"key": "q3", "text": "Was there a particular client, situation, experience, or challenge that helped you grow this year? What did you learn from it?"}]}, {"key": "growth", "title": "2. Reflecting on your growth", "questions": [{"key": "q4", "text": "What do you feel are your greatest strengths in your role right now?"}, {"key": "q5", "text": "What is one area you would like to improve or become more confident in?"}, {"key": "q6", "text": "Are there any clinical skills or topics you would like more training or experience with?", "hint": "Examples: behavior assessment, behavior support, communication, data collection, caregiver collaboration, teaching strategies, specific diagnoses or populations, ethics, or another area of interest."}]}, {"key": "support", "title": "3. Support from CARE", "intro": "We want to make sure our team members have the support they need to be successful. Please be as specific as possible.", "questions": [{"key": "q7", "text": "Clinical support: what has been helpful about the clinical support, supervision, or training you received this year?"}, {"key": "q8", "text": "Clinical support: what could we do differently to better support you clinically?"}, {"key": "q9", "text": "Clinical support: are there training, resources, mentorship opportunities, or experiences you would like CARE to provide next year?"}, {"key": "q10", "text": "Administrative support: what has worked well for you administratively this year?"}, {"key": "q11", "text": "Administrative support: what could CARE improve regarding communication, scheduling, processes, workload, resources, organization, or other administrative areas?"}, {"key": "q12", "text": "Is there anything that would make your day-to-day work easier or help you do your job more effectively?"}]}, {"key": "team", "title": "4. Your experience with the CARE team", "questions": [{"key": "q13", "text": "What do you think CARE does particularly well as a team or organization?"}, {"key": "q14", "text": "What is one thing you would like to see CARE improve in the coming year?"}, {"key": "q15", "text": "Is there anything you would like leadership to better understand about the employee experience at CARE?"}, {"key": "q16", "text": "Is there anything you would like to see more of, or less of, next year?"}]}, {"key": "ahead", "title": "5. Looking ahead", "questions": [{"key": "q17", "text": "What are 1–3 professional goals you would like to work toward next year?"}, {"key": "q18", "text": "What support from CARE would help you achieve these goals?"}, {"key": "q19", "text": "Is there a skill, responsibility, variety of client, or area of the organization you would like more opportunities to explore next year?"}]}, {"key": "final", "title": "6. Final reflection", "questions": [{"key": "q20", "text": "Choose three words that describe your year at CARE."}, {"key": "q21", "text": "What is one thing you hope to feel, accomplish, or experience by this time next year?"}, {"key": "q22", "text": "Is there anything else you would like us to know that we did not ask about?"}]}], "thanks": "Thank you for taking the time to reflect on your year and share your feedback. Your responses help us recognize your growth while also finding ways CARE can keep improving as a workplace and clinical team."}$self$::jsonb)
on conflict (form_key, version) do nothing;

-- 2. Answers: one per person per year
create table if not exists public.sv_reflections (
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  year         integer not null check (year between 2024 and 2100),
  form_version integer not null,
  answers      jsonb not null default '{}'::jsonb,           -- { question key: text }
  status       text not null default 'draft' check (status in ('draft','submitted')),
  submitted_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (therapist_id, year)
);
alter table public.sv_reflections enable row level security;
revoke all on public.sv_reflections from public, anon, authenticated;

-- may read others' submitted reflections (and, later, the yearly review): supervisors + admin / Portal manager
create or replace function private.sv_yearly_team()
returns boolean language sql stable security definer set search_path = ''
as $$ select private.has_any_role(array['admin','supervisor']::public.app_role[]) $$;
revoke execute on function private.sv_yearly_team() from public, anon;
grant  execute on function private.sv_yearly_team() to authenticated;

-- 3. Read one (own: any state; supervisors / admin: submitted only)
create or replace function public.sv_reflection_get(p_who uuid, p_year integer)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('therapist_id', r.therapist_id, 'year', r.year, 'form_version', r.form_version,
                            'answers', r.answers, 'status', r.status, 'submitted_at', r.submitted_at, 'updated_at', r.updated_at)
  from public.sv_reflections r
  where r.therapist_id = p_who and r.year = p_year
    and (p_who = private.current_therapist_id() or (r.status = 'submitted' and private.sv_yearly_team()))
$$;

-- 4. Save (own only; p_submit = true marks it submitted)
create or replace function public.sv_reflection_save(p_year integer, p_answers jsonb, p_submit boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_ver integer; v_body jsonb; v_keys text[]; k text; v jsonb;
  v_now integer := extract(year from (now() at time zone 'Asia/Bangkok'))::integer;
  v_old public.sv_reflections;
begin
  if v_me is null or not private.is_care_staff() then raise exception 'Only CARE staff can write a reflection.'; end if;
  if p_year not in (v_now, v_now - 1) then raise exception 'You can write this year''s (or last year''s) reflection.'; end if;
  select * into v_old from public.sv_reflections where therapist_id = v_me and year = p_year;
  v_ver := coalesce(v_old.form_version, (select version from public.sv_forms where key = 'self'));
  select body into v_body from public.sv_form_versions where form_key = 'self' and version = v_ver;
  select array_agg(qq ->> 'key') into v_keys
  from jsonb_array_elements(v_body -> 'parts') pp, jsonb_array_elements(pp -> 'questions') qq;
  for k, v in select * from jsonb_each(coalesce(p_answers, '{}'::jsonb)) loop
    if not (k = any (v_keys)) then raise exception 'An answer doesn''t match the questions. Refresh and try again.'; end if;
    if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 4000 then raise exception 'Each answer can be up to 4,000 characters.'; end if;
  end loop;
  if coalesce(p_submit, false) and not exists (select 1 from jsonb_each_text(coalesce(p_answers, '{}'::jsonb)) a where btrim(a.value) <> '') then
    raise exception 'Answer at least one question before you submit.';
  end if;
  insert into public.sv_reflections (therapist_id, year, form_version, answers, status, submitted_at, updated_at)
  values (v_me, p_year, v_ver, coalesce(p_answers, '{}'::jsonb),
          case when coalesce(p_submit, false) then 'submitted' else 'draft' end,
          case when coalesce(p_submit, false) then now() end, now())
  on conflict (therapist_id, year) do update
     set answers = excluded.answers,
         status = case when coalesce(p_submit, false) or sv_reflections.status = 'submitted' then 'submitted' else 'draft' end,
         submitted_at = case when coalesce(p_submit, false) then now() else sv_reflections.submitted_at end,
         updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- 5. Team list: everyone with their reflection status (no answers) — supervisors + admin
create or replace function public.sv_yearly_people(p_year integer)
returns table (id uuid, full_name text, nickname text, rank text, reflection text, submitted_at timestamptz)
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
         (select x.submitted_at from public.sv_reflections x where x.therapist_id = t.id and x.year = p_year)
  from public.therapists t
  where private.sv_yearly_team() and t.status <> 'exited' and t.track = 'care_hire'
    and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')
  order by lower(coalesce(t.nickname, t.full_name))
$$;

revoke execute on function public.sv_reflection_get(uuid, integer), public.sv_reflection_save(integer, jsonb, boolean),
                           public.sv_yearly_people(integer) from public, anon;
grant  execute on function public.sv_reflection_get(uuid, integer), public.sv_reflection_save(integer, jsonb, boolean),
                           public.sv_yearly_people(integer) to authenticated;

-- 6. Everyone writes a reflection, so HR (office staff) can open the tab too.
update public.app_modules
   set roles = array['admin','hr','supervisor','qcd','senior','therapist']::public.app_role[]
 where key = 'supervision';

commit;
