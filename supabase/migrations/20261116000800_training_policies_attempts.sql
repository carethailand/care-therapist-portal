-- (keep) Portal 008 – training: policies to agree, module rule, attempts
--
-- Run AFTER 007. Adds what the ABAT Grading Policy needs:
--   * a "Before you start" step: read the course policies, tick "I agree"
--     (step kind 'agree'; documents are read inside the Portal)
--   * documents (text read in the Portal) as course items
--   * exam rules as settings on the exam step:
--       max_attempts      how many attempts (Grading Policy: 2)
--       retake_wait_days  days between attempts (Grading Policy: 7)
--       require_modules   all modules ticked before the exam (Grading Policy: yes)
--     plus: the policies must be agreed before the exam opens
--   * a finish-by date for each person, set when their place is created:
--       enrolment_weeks           ABAT learners (and the default): 6 weeks
--       enrolment_weeks_new_hire  CARE new hires (applicants): 2 weeks
--     Admins can change one person's date (e.g. an approved extension).
--     The exam is part of that period: after the date, no new exam attempt
--     can start (one already running can be finished).
--   * certificate provider name + note
--   * a domain/competency tag on each question (e.g. "A2")
-- Admins and supervisors can still allow an extra attempt beyond the maximum.

begin;

-- 1. New kinds ----------------------------------------------------------------
alter table public.training_steps drop constraint training_steps_kind_check;
alter table public.training_steps add constraint training_steps_kind_check
  check (kind in ('agree','learn','exam','session','gap','result','practicum','certificate'));

alter table public.training_items drop constraint training_items_kind_check;
alter table public.training_items add constraint training_items_kind_check
  check (kind in ('canva','pdf','video','link','document','other'));
alter table public.training_items add column body text;  -- 'document': the text, read in the Portal

alter table public.training_programs
  add column provider_name            text,
  add column certificate_note         text,
  add column enrolment_weeks          integer check (enrolment_weeks > 0),
  add column enrolment_weeks_new_hire integer check (enrolment_weeks_new_hire > 0);

-- Each person's own finish-by date.
alter table public.training_enrollments add column due_on date;

create or replace function private.set_enrollment_due()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_weeks integer;
begin
  if new.due_on is null then
    select case when t.track = 'care_hire' and p.enrolment_weeks_new_hire is not null
                then p.enrolment_weeks_new_hire
                else p.enrolment_weeks end
      into v_weeks
    from public.training_programs p, public.therapists t
    where p.key = new.program_key and t.id = new.therapist_id;
    if v_weeks is not null then
      new.due_on := coalesce(new.started_on, (now() at time zone 'Asia/Bangkok')::date) + v_weeks * 7;
    end if;
  end if;
  return new;
end $$;

create trigger training_enrollments_set_due
  before insert on public.training_enrollments
  for each row execute function private.set_enrollment_due();

alter table private.exam_questions add column tag text;

-- Fill in finish-by dates for places that already exist (once the
-- programme's weeks are set, e.g. by the ABAT course setup file).
create or replace function public.training_fill_due_dates(p_program text)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not private.has_any_role(array['admin']::public.app_role[]) and auth.uid() is not null then
    raise exception 'Only an admin can do this.';
  end if;
  update public.training_enrollments e
     set due_on = coalesce(e.started_on, (e.created_at at time zone 'Asia/Bangkok')::date)
                  + 7 * case when t.track = 'care_hire' and p.enrolment_weeks_new_hire is not null
                             then p.enrolment_weeks_new_hire else p.enrolment_weeks end
    from public.training_programs p, public.therapists t
   where e.program_key = p_program and p.key = e.program_key and t.id = e.therapist_id
     and e.due_on is null and e.status in ('recommended','active')
     and coalesce(p.enrolment_weeks_new_hire, p.enrolment_weeks) is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.training_fill_due_dates(text) from public, anon;
grant  execute on function public.training_fill_due_dates(text) to authenticated;

-- 2. Steps a trainee completes themselves ("I have read and agree") --------------
create table public.training_step_done (
  enrollment_id uuid not null references public.training_enrollments (id) on delete cascade,
  step_id       uuid not null references public.training_steps (id) on delete cascade,
  done_at       timestamptz not null default now(),
  primary key (enrollment_id, step_id)
);
revoke all on public.training_step_done from anon;
grant select, insert on public.training_step_done to authenticated;   -- no undo
alter table public.training_step_done enable row level security;

create policy "training_step_done: read own or team" on public.training_step_done
  for select to authenticated using (
    (select private.is_training_team())
    or exists (select 1 from public.training_enrollments e
               where e.id = enrollment_id and e.therapist_id = (select private.current_therapist_id()))
  );
create policy "training_step_done: agree own" on public.training_step_done
  for insert to authenticated with check (
    exists (select 1 from public.training_enrollments e
            where e.id = enrollment_id and e.status = 'active'
              and e.therapist_id = (select private.current_therapist_id()))
    and exists (select 1 from public.training_steps s where s.id = step_id and s.kind = 'agree')
  );

-- 3. exam_start with the new rules -------------------------------------------------
create or replace function public.exam_start(p_step uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me    uuid := private.current_therapist_id();
  v_step  public.training_steps;
  v_enr   public.training_enrollments;
  v_att   public.exam_attempts;
  v_used  integer;
  v_max   integer;
  v_wait  integer;
  v_last  timestamptz;
  v_paper jsonb;
  v_data  private.exam_attempt_data;
begin
  if v_me is null then raise exception 'Please sign in again.'; end if;

  select * into v_step from public.training_steps where id = p_step and kind = 'exam';
  if not found then raise exception 'Exam not found.'; end if;

  select * into v_enr from public.training_enrollments
   where therapist_id = v_me and program_key = v_step.program_key and status = 'active'
   order by created_at desc limit 1;
  if not found then raise exception 'You are not enrolled in this programme.'; end if;

  select * into v_att from public.exam_attempts
   where enrollment_id = v_enr.id and step_id = p_step and status = 'in_progress'
   order by started_at desc limit 1;

  if found then
    if now() > v_att.deadline + interval '2 minutes' then
      return private.exam_grade(v_att.id) || jsonb_build_object('expired', true);
    end if;
  else
    -- Course policies agreed?
    if exists (select 1 from public.training_steps s
               where s.program_key = v_step.program_key and s.kind = 'agree'
                 and not exists (select 1 from public.training_step_done d
                                 where d.enrollment_id = v_enr.id and d.step_id = s.id)) then
      raise exception 'Please read and agree to the course policies first.';
    end if;

    -- All modules finished?
    if coalesce((v_step.config ->> 'require_modules')::boolean, false)
       and exists (select 1 from public.training_items i
                   join public.training_steps s on s.id = i.step_id
                   where s.program_key = v_step.program_key and s.kind = 'learn'
                     and not exists (select 1 from public.training_item_done d
                                     where d.enrollment_id = v_enr.id and d.item_id = i.id)) then
      raise exception 'Please finish all the course modules first.';
    end if;

    -- Still inside the finish-by date? (Bangkok calendar day)
    if v_enr.due_on is not null and (now() at time zone 'Asia/Bangkok')::date > v_enr.due_on then
      raise exception 'The finish date (%) has passed. Please ask your supervisor or an admin for an extension.',
        to_char(v_enr.due_on, 'DD Mon YYYY');
    end if;

    -- Attempts left?
    select count(*), max(submitted_at) into v_used, v_last from public.exam_attempts
     where enrollment_id = v_enr.id and step_id = p_step;
    v_max := coalesce((v_step.config ->> 'max_attempts')::int, 1);
    if v_used >= v_max + v_enr.extra_attempts then
      raise exception 'You have used all your attempts for this exam.';
    end if;

    -- Waiting time between attempts
    v_wait := coalesce((v_step.config ->> 'retake_wait_days')::int, 0);
    if v_last is not null and v_wait > 0 and now() < v_last + make_interval(days => v_wait) then
      raise exception 'You can re-sit the exam from %.',
        to_char((v_last + make_interval(days => v_wait)) at time zone 'Asia/Bangkok', 'DD Mon YYYY, HH24:MI');
    end if;

    if not exists (select 1 from private.exam_questions where step_id = p_step and active) then
      raise exception 'This exam has no questions yet.';
    end if;

    insert into public.exam_attempts (enrollment_id, step_id, deadline)
    values (v_enr.id, p_step,
            now() + make_interval(mins => coalesce((v_step.config ->> 'time_limit_min')::int, 120)))
    returning * into v_att;

    select jsonb_agg(jsonb_build_object(
             'q', q.id,
             'o', (select jsonb_agg(i order by random())
                   from generate_series(0, jsonb_array_length(q.options) - 1) as i))
           order by random())
      into v_paper
    from private.exam_questions q
    where q.step_id = p_step and q.active;

    insert into private.exam_attempt_data (attempt_id, paper) values (v_att.id, v_paper);
  end if;

  select * into v_data from private.exam_attempt_data where attempt_id = v_att.id;

  return jsonb_build_object(
    'attempt_id', v_att.id,
    'deadline',   v_att.deadline,
    'server_now', now(),
    'answers',    v_data.answers,
    'questions', (
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'type', q.type, 'prompt', q.prompt, 'points', q.points,
               'options', (select jsonb_agg(jsonb_build_object('i', o.v::int, 'text', q.options ->> (o.v::int))
                                            order by o.n)
                           from jsonb_array_elements_text(p.e -> 'o') with ordinality as o(v, n)))
             order by p.n)
      from jsonb_array_elements(v_data.paper) with ordinality as p(e, n)
      join private.exam_questions q on q.id = (p.e ->> 'q')::uuid
    )
  );
end $$;

-- 4. Question editor: carry the tag ------------------------------------------------
create or replace function public.exam_questions_admin(p_step uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', q.id, 'sort_order', q.sort_order, 'type', q.type, 'prompt', q.prompt,
             'options', q.options, 'answer', q.answer, 'points', q.points, 'tag', q.tag)
           order by q.sort_order, q.created_at)
    from private.exam_questions q
    where q.step_id = p_step and q.active), '[]'::jsonb);
end $$;

create or replace function public.exam_question_save(p_step uuid, p_q jsonb)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_admin();
  if not exists (select 1 from public.training_steps where id = p_step and kind = 'exam') then
    raise exception 'Exam not found.';
  end if;
  if btrim(coalesce(p_q ->> 'prompt', '')) = '' then raise exception 'The question needs some text.'; end if;
  perform private.exam_check_question(p_q ->> 'type', p_q -> 'options', p_q -> 'answer');

  if p_q ? 'id' and p_q ->> 'id' is not null then
    update private.exam_questions
       set type = p_q ->> 'type', prompt = btrim(p_q ->> 'prompt'), options = p_q -> 'options',
           answer = p_q -> 'answer', points = coalesce((p_q ->> 'points')::numeric, points),
           tag = nullif(btrim(coalesce(p_q ->> 'tag', '')), ''),
           sort_order = coalesce((p_q ->> 'sort_order')::int, sort_order), updated_at = now()
     where id = (p_q ->> 'id')::uuid and step_id = p_step and active
    returning id into v_id;
    if v_id is null then raise exception 'Question not found.'; end if;
  else
    insert into private.exam_questions (step_id, sort_order, type, prompt, options, answer, points, tag)
    values (p_step,
            coalesce((p_q ->> 'sort_order')::int,
                     (select coalesce(max(sort_order), 0) + 10 from private.exam_questions where step_id = p_step)),
            p_q ->> 'type', btrim(p_q ->> 'prompt'), p_q -> 'options', p_q -> 'answer',
            coalesce((p_q ->> 'points')::numeric, 1),
            nullif(btrim(coalesce(p_q ->> 'tag', '')), ''))
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.exam_questions_import(p_step uuid, p_data jsonb, p_replace boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_list    jsonb;
  v_q       jsonb;
  v_added   integer := 0;
  v_skipped integer := 0;
  v_sort    integer;
  v_id      uuid;
begin
  perform private.require_admin();
  if not exists (select 1 from public.training_steps where id = p_step and kind = 'exam') then
    raise exception 'Exam not found.';
  end if;

  v_list := case when jsonb_typeof(p_data) = 'array' then p_data else p_data -> 'questions' end;
  if jsonb_typeof(v_list) is distinct from 'array' then raise exception 'No list of questions found in this file.'; end if;

  if p_replace then
    for v_id in select id from private.exam_questions where step_id = p_step and active loop
      perform public.exam_question_remove(v_id);
    end loop;
  end if;

  select coalesce(max(sort_order), 0) into v_sort from private.exam_questions where step_id = p_step;

  for v_q in select * from jsonb_array_elements(v_list) loop
    if (v_q ->> 'type') in ('mcq','multiselect') and btrim(coalesce(v_q ->> 'prompt', '')) <> '' then
      perform private.exam_check_question(v_q ->> 'type', v_q -> 'options', v_q -> 'answer');
      v_sort := v_sort + 10;
      insert into private.exam_questions (step_id, sort_order, type, prompt, options, answer, points, tag)
      values (p_step, v_sort, v_q ->> 'type', btrim(v_q ->> 'prompt'), v_q -> 'options', v_q -> 'answer',
              coalesce((v_q ->> 'points')::numeric, 1), nullif(btrim(coalesce(v_q ->> 'tag', '')), ''));
      v_added := v_added + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  if jsonb_typeof(p_data) = 'object' and (p_data ? 'timeLimitMinutes' or p_data ? 'passMark') then
    update public.training_steps
       set config = config
                    || case when p_data ? 'timeLimitMinutes'
                            then jsonb_build_object('time_limit_min', (p_data ->> 'timeLimitMinutes')::int) else '{}'::jsonb end
                    || case when p_data ? 'passMark'
                            then jsonb_build_object('pass_mark', (p_data ->> 'passMark')::numeric) else '{}'::jsonb end
     where id = p_step;
  end if;

  return jsonb_build_object('added', v_added, 'skipped', v_skipped);
end $$;

revoke execute on function public.exam_start(uuid), public.exam_questions_admin(uuid),
                           public.exam_question_save(uuid, jsonb), public.exam_questions_import(uuid, jsonb, boolean)
  from public, anon;
grant execute on function public.exam_start(uuid), public.exam_questions_admin(uuid),
                          public.exam_question_save(uuid, jsonb), public.exam_questions_import(uuid, jsonb, boolean)
  to authenticated;

revoke execute on all functions in schema private from public;
grant  execute on function private.current_therapist_id()          to authenticated;
grant  execute on function private.has_any_role(public.app_role[]) to authenticated;
grant  execute on function private.is_training_team()              to authenticated;

commit;
