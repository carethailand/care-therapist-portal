-- (keep) Portal 009 – exam score summary + answer review
--
-- Run AFTER 008.
--   * exam_my_summary(attempt)   the trainee's OWN result: score and a
--     summary by domain (e.g. "Domain C: 12 / 17"). It never says which
--     questions were wrong, so the answer key stays safe.
--   * exam_attempt_review(attempt)   for admins, supervisors and QCD: every
--     question with the trainee's answer, the correct answer and ✓/✗,
--     plus the domain summary. (HR sees scores but not the answers.)
--   * Domain names for the ABAT exam (from the QABA ABAT domains A–G).

begin;

-- Score per domain for one attempt. A question's domain is the first letter
-- of its tag ("C4" → C). Untagged questions are grouped as "Other".
create or replace function private.exam_breakdown(p_attempt uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('domain', dom, 'correct', got, 'total', tot) order by dom), '[]'::jsonb)
  from (
    select coalesce(upper(left(q.tag, 1)), 'Other') as dom,
           sum(q.points) as tot,
           coalesce(sum(q.points) filter (where private.exam_is_correct(q.answer, d.answers -> (q.id::text))), 0) as got
    from private.exam_attempt_data d
    cross join lateral jsonb_array_elements(d.paper) as p(e)
    join private.exam_questions q on q.id = (p.e ->> 'q')::uuid
    where d.attempt_id = p_attempt
    group by 1
  ) s
$$;

-- The trainee's own result (after handing in).
create or replace function public.exam_my_summary(p_attempt uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_att  public.exam_attempts;
  v_step public.training_steps;
begin
  select a.* into v_att
  from public.exam_attempts a
  join public.training_enrollments e on e.id = a.enrollment_id
  where a.id = p_attempt and e.therapist_id = private.current_therapist_id();
  if not found then raise exception 'Exam not found.'; end if;
  if v_att.status <> 'submitted' then raise exception 'This exam has not been handed in yet.'; end if;
  select * into v_step from public.training_steps where id = v_att.step_id;

  return jsonb_build_object(
    'passed', v_att.passed, 'score', v_att.score, 'total', v_att.total,
    'pass_mark', v_step.config -> 'pass_mark',
    'submitted_at', v_att.submitted_at,
    'domain_names', coalesce(v_step.config -> 'domain_names', '{}'::jsonb),
    'domains', private.exam_breakdown(p_attempt));
end $$;

-- Team: full answer review of one attempt.
create or replace function public.exam_attempt_review(p_attempt uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_att  public.exam_attempts;
  v_step public.training_steps;
  v_t    public.therapists;
begin
  if not private.has_any_role(array['admin','supervisor','qcd']::public.app_role[]) then
    raise exception 'Only admins, supervisors and QCD can review answers.';
  end if;
  select * into v_att from public.exam_attempts where id = p_attempt;
  if not found then raise exception 'Exam not found.'; end if;
  select * into v_step from public.training_steps where id = v_att.step_id;
  select t.* into v_t from public.therapists t
    join public.training_enrollments e on e.therapist_id = t.id
   where e.id = v_att.enrollment_id;

  return jsonb_build_object(
    'person', coalesce(v_t.nickname, v_t.full_name), 'full_name', v_t.full_name,
    'exam', v_step.title,
    'status', v_att.status, 'passed', v_att.passed, 'score', v_att.score, 'total', v_att.total,
    'pass_mark', v_step.config -> 'pass_mark',
    'started_at', v_att.started_at, 'submitted_at', v_att.submitted_at, 'time_used_min', v_att.time_used_min,
    'domain_names', coalesce(v_step.config -> 'domain_names', '{}'::jsonb),
    'domains', private.exam_breakdown(p_attempt),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'n', p.n, 'prompt', q.prompt, 'options', q.options, 'type', q.type,
               'given', coalesce(d.answers -> (q.id::text), '[]'::jsonb),
               'answer', q.answer, 'tag', q.tag, 'points', q.points,
               'correct', private.exam_is_correct(q.answer, d.answers -> (q.id::text)))
             order by p.n), '[]'::jsonb)
      from private.exam_attempt_data d
      cross join lateral jsonb_array_elements(d.paper) with ordinality as p(e, n)
      join private.exam_questions q on q.id = (p.e ->> 'q')::uuid
      where d.attempt_id = p_attempt));
end $$;

revoke execute on function public.exam_my_summary(uuid), public.exam_attempt_review(uuid) from public, anon;
grant  execute on function public.exam_my_summary(uuid), public.exam_attempt_review(uuid) to authenticated;

revoke execute on all functions in schema private from public;
grant  execute on function private.current_therapist_id()          to authenticated;
grant  execute on function private.has_any_role(public.app_role[]) to authenticated;
grant  execute on function private.is_training_team()              to authenticated;

-- Domain names shown in the summaries (ABAT exam).
update public.training_steps
   set config = config || jsonb_build_object('domain_names', jsonb_build_object(
         'A', 'Autism Core Knowledge',
         'B', 'Legal, Ethical & Professional Considerations',
         'C', 'Core Principles of ABA',
         'D', 'Antecedent Interventions',
         'E', 'Skill Acquisition Programming',
         'F', 'Behavior Reduction Interventions',
         'G', 'Data Collection & Analysis'))
 where program_key = 'abat' and kind = 'exam';

commit;
