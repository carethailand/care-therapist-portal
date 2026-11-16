-- (keep) Portal 007 – training engine + ABAT exam
--
-- The Training tab (plan §12). One engine for three programmes:
--   abat    ABAT Coursework: course modules + online exam + certificate
--   senior  Senior Therapist Training  (switched off until it is built)
--   qcd     QCD Training               (switched off until it is built)
--
-- SAFETY
--   * Exam questions and ANSWER KEYS live in the `private` schema. The app
--     can't read those tables at all; it only talks to the functions below.
--     The trainee's browser receives questions WITHOUT answers, and marking
--     happens here on the server.
--   * The timer is the server's: each attempt has a deadline. Answers sent
--     more than 2 minutes after it are ignored (the last saved ones count).
--   * One attempt per person, unless an admin or supervisor allows a retake.
--   * Trainees see pass / not pass only. Scores are for the team.
--
-- Safe to re-run? No. Run once. (If it fails, nothing is saved: it is all
-- one transaction. Send Claude the error.)

begin;

-- ---------------------------------------------------------------------------
-- 0. Helper: the training team (sees everyone's progress and results)
-- ---------------------------------------------------------------------------
create or replace function private.is_training_team()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.has_any_role(array['admin','hr','supervisor','qcd']::public.app_role[])
$$;
revoke execute on function private.is_training_team() from public;
grant  execute on function private.is_training_team() to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Programmes, steps, learning items (content: everyone signed in reads,
--    admins edit)
-- ---------------------------------------------------------------------------
create table public.training_programs (
  key               text primary key check (key ~ '^[a-z_]+$'),
  title             text not null,
  summary           text,
  sort_order        integer not null default 0,
  enabled           boolean not null default true,
  certificate       boolean not null default false,
  certificate_title text
);

insert into public.training_programs (key, title, summary, sort_order, enabled, certificate, certificate_title) values
  ('abat',   'ABAT Coursework',
             'Online course and exam. The first step for new CARE therapists, and the full course for ABAT learners.',
             10, true,  true,  'ABAT Coursework'),
  ('senior', 'Senior Therapist Training',
             'For Junior therapists recommended by a supervisor.',
             20, false, false, null),
  ('qcd',    'QCD Training',
             'Advancement to the Quality Control Department (Therapist Liaison). For Senior therapists recommended by a supervisor.',
             30, false, false, null);

create table public.training_steps (
  id          uuid primary key default gen_random_uuid(),
  program_key text not null references public.training_programs (key) on delete cascade,
  sort_order  integer not null default 0,
  kind        text not null check (kind in ('learn','exam','session','gap','result','practicum','certificate')),
  title       text not null,
  details     text,
  -- exam: { "time_limit_min": 120, "pass_mark": 53, "completes_program": true }
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index training_steps_program_idx on public.training_steps (program_key, sort_order);

insert into public.training_steps (program_key, sort_order, kind, title, details, config) values
  ('abat', 10, 'learn', 'Course modules',
   'Work through each module at your own pace. Tick each one when you have finished it.', '{}'),
  ('abat', 20, 'exam', 'ABAT exam',
   'A timed exam. You can take it once, so finish the modules first.',
   '{"time_limit_min": 120, "pass_mark": 53, "completes_program": true}'),
  ('abat', 30, 'certificate', 'Certificate',
   'Pass the exam to receive your ABAT Coursework certificate.', '{}');

create table public.training_items (
  id         uuid primary key default gen_random_uuid(),
  step_id    uuid not null references public.training_steps (id) on delete cascade,
  sort_order integer not null default 0,
  title      text not null,
  url        text,
  kind       text not null default 'link' check (kind in ('canva','pdf','video','link','other')),
  note       text,
  created_at timestamptz not null default now()
);
create index training_items_step_idx on public.training_items (step_id, sort_order);

-- ---------------------------------------------------------------------------
-- 2. Who is in which programme
-- ---------------------------------------------------------------------------
create table public.training_enrollments (
  id             uuid primary key default gen_random_uuid(),
  therapist_id   uuid not null references public.therapists (id) on delete cascade,
  program_key    text not null references public.training_programs (key),
  status         text not null default 'active'
                   check (status in ('recommended','active','passed','not_passed','withdrawn')),
  reason         text,
  recommended_by uuid references public.therapists (id) on delete set null,
  approved_by    uuid references public.therapists (id) on delete set null,
  extra_attempts integer not null default 0 check (extra_attempts >= 0),
  started_on     date default ((now() at time zone 'Asia/Bangkok')::date),
  finished_on    date,
  created_at     timestamptz not null default now()
);
-- Only one open place per person per programme.
create unique index training_enrollments_one_open
  on public.training_enrollments (therapist_id, program_key)
  where status in ('recommended','active');

create table public.training_item_done (
  enrollment_id uuid not null references public.training_enrollments (id) on delete cascade,
  item_id       uuid not null references public.training_items (id) on delete cascade,
  done_at       timestamptz not null default now(),
  primary key (enrollment_id, item_id)
);

-- ---------------------------------------------------------------------------
-- 3. Exams. Questions + answers are PRIVATE.
-- ---------------------------------------------------------------------------
create table private.exam_questions (
  id         uuid primary key default gen_random_uuid(),
  step_id    uuid not null references public.training_steps (id) on delete cascade,
  sort_order integer not null default 0,
  type       text not null check (type in ('mcq','multiselect')),
  prompt     text not null,
  options    jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) >= 2),
  answer     jsonb not null,          -- mcq: 2   multiselect: [0, 3]  (option numbers, first = 0)
  points     numeric not null default 1 check (points > 0),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index exam_questions_step_idx on private.exam_questions (step_id, sort_order);

create table public.exam_attempts (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.training_enrollments (id) on delete cascade,
  step_id       uuid not null references public.training_steps (id) on delete cascade,
  started_at    timestamptz not null default now(),
  deadline      timestamptz not null,
  submitted_at  timestamptz,
  status        text not null default 'in_progress' check (status in ('in_progress','submitted')),
  score         numeric,
  total         numeric,
  passed        boolean,
  time_used_min integer
);
create index exam_attempts_enrollment_idx on public.exam_attempts (enrollment_id);

-- The paper (question order + option order) and the saved answers.
create table private.exam_attempt_data (
  attempt_id uuid primary key references public.exam_attempts (id) on delete cascade,
  paper      jsonb not null,                    -- [{"q": "<question id>", "o": [2,0,3,1]}, …]
  answers    jsonb not null default '{}'::jsonb -- {"<question id>": [2], …}
);

alter table private.exam_questions    enable row level security;  -- no policies:
alter table private.exam_attempt_data enable row level security;  -- functions only
revoke all on private.exam_questions, private.exam_attempt_data from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Certificates
-- ---------------------------------------------------------------------------
create table public.certificates (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  therapist_id  uuid not null references public.therapists (id) on delete cascade,
  program_key   text not null references public.training_programs (key),
  enrollment_id uuid unique references public.training_enrollments (id) on delete set null,
  full_name     text not null,
  title         text not null,
  issued_on     date not null default ((now() at time zone 'Asia/Bangkok')::date),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. Privileges + Row Level Security
-- ---------------------------------------------------------------------------
revoke all on public.training_programs, public.training_steps, public.training_items,
              public.training_enrollments, public.training_item_done,
              public.exam_attempts, public.certificates
  from anon;

grant select, insert, update, delete on public.training_programs, public.training_steps, public.training_items to authenticated;
grant select, insert, update        on public.training_enrollments to authenticated;
grant select, insert, delete        on public.training_item_done   to authenticated;
-- Attempts: no score/total columns for the browser. The team reads scores
-- through exam_results(). Nobody writes attempts directly.
grant select (id, enrollment_id, step_id, started_at, deadline, submitted_at, status, passed)
  on public.exam_attempts to authenticated;
grant select on public.certificates to authenticated;

alter table public.training_programs    enable row level security;
alter table public.training_steps       enable row level security;
alter table public.training_items       enable row level security;
alter table public.training_enrollments enable row level security;
alter table public.training_item_done   enable row level security;
alter table public.exam_attempts        enable row level security;
alter table public.certificates         enable row level security;

-- Content: everyone signed in reads; admins edit.
create policy "training_programs: signed-in read" on public.training_programs
  for select to authenticated using ((select private.current_therapist_id()) is not null);
create policy "training_programs: admin add" on public.training_programs
  for insert to authenticated with check ((select private.has_any_role(array['admin']::public.app_role[])));
create policy "training_programs: admin edit" on public.training_programs
  for update to authenticated
  using      ((select private.has_any_role(array['admin']::public.app_role[])))
  with check ((select private.has_any_role(array['admin']::public.app_role[])));
create policy "training_programs: admin delete" on public.training_programs
  for delete to authenticated using ((select private.has_any_role(array['admin']::public.app_role[])));

create policy "training_steps: signed-in read" on public.training_steps
  for select to authenticated using ((select private.current_therapist_id()) is not null);
create policy "training_steps: admin add" on public.training_steps
  for insert to authenticated with check ((select private.has_any_role(array['admin']::public.app_role[])));
create policy "training_steps: admin edit" on public.training_steps
  for update to authenticated
  using      ((select private.has_any_role(array['admin']::public.app_role[])))
  with check ((select private.has_any_role(array['admin']::public.app_role[])));
create policy "training_steps: admin delete" on public.training_steps
  for delete to authenticated using ((select private.has_any_role(array['admin']::public.app_role[])));

create policy "training_items: signed-in read" on public.training_items
  for select to authenticated using ((select private.current_therapist_id()) is not null);
create policy "training_items: admin add" on public.training_items
  for insert to authenticated with check ((select private.has_any_role(array['admin']::public.app_role[])));
create policy "training_items: admin edit" on public.training_items
  for update to authenticated
  using      ((select private.has_any_role(array['admin']::public.app_role[])))
  with check ((select private.has_any_role(array['admin']::public.app_role[])));
create policy "training_items: admin delete" on public.training_items
  for delete to authenticated using ((select private.has_any_role(array['admin']::public.app_role[])));

-- Enrolments: you see your own; the training team sees all.
-- A supervisor may RECOMMEND someone; only an admin makes a place active.
create policy "training_enrollments: read own" on public.training_enrollments
  for select to authenticated using (therapist_id = (select private.current_therapist_id()));
create policy "training_enrollments: team read all" on public.training_enrollments
  for select to authenticated using ((select private.is_training_team()));
create policy "training_enrollments: admin add, supervisor recommend" on public.training_enrollments
  for insert to authenticated with check (
    (select private.has_any_role(array['admin']::public.app_role[]))
    or (status = 'recommended'
        and recommended_by = (select private.current_therapist_id())
        and (select private.has_any_role(array['supervisor']::public.app_role[])))
  );
create policy "training_enrollments: admin edit" on public.training_enrollments
  for update to authenticated
  using      ((select private.has_any_role(array['admin']::public.app_role[])))
  with check ((select private.has_any_role(array['admin']::public.app_role[])));

-- Ticked modules: your own (while your place is active); the team reads all.
create policy "training_item_done: read own or team" on public.training_item_done
  for select to authenticated using (
    (select private.is_training_team())
    or exists (select 1 from public.training_enrollments e
               where e.id = enrollment_id and e.therapist_id = (select private.current_therapist_id()))
  );
create policy "training_item_done: tick own" on public.training_item_done
  for insert to authenticated with check (
    exists (select 1 from public.training_enrollments e
            where e.id = enrollment_id and e.status = 'active'
              and e.therapist_id = (select private.current_therapist_id()))
  );
create policy "training_item_done: untick own" on public.training_item_done
  for delete to authenticated using (
    exists (select 1 from public.training_enrollments e
            where e.id = enrollment_id and e.status = 'active'
              and e.therapist_id = (select private.current_therapist_id()))
  );

create policy "exam_attempts: read own or team" on public.exam_attempts
  for select to authenticated using (
    (select private.is_training_team())
    or exists (select 1 from public.training_enrollments e
               where e.id = enrollment_id and e.therapist_id = (select private.current_therapist_id()))
  );

create policy "certificates: read own or team" on public.certificates
  for select to authenticated using (
    therapist_id = (select private.current_therapist_id()) or (select private.is_training_team())
  );

-- ---------------------------------------------------------------------------
-- 6. Marking (private)
-- ---------------------------------------------------------------------------
-- Is the given answer exactly right? Both are lists of option numbers.
create or replace function private.exam_is_correct(p_answer jsonb, p_given jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when p_given is null or jsonb_typeof(p_given) <> 'array' then false
    else
      coalesce((select array_agg(distinct x::int order by x::int)
                from jsonb_array_elements_text(p_given) as g(x)
                where x ~ '^[0-9]+$'), '{}'::int[])
      =
      coalesce((select array_agg(distinct x::int order by x::int)
                from jsonb_array_elements_text(
                       case when jsonb_typeof(p_answer) = 'array' then p_answer
                            else jsonb_build_array(p_answer) end) as a(x)
                where x ~ '^[0-9]+$'), '{}'::int[])
  end
$$;

create or replace function private.issue_certificate(p_enrollment uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_e    public.training_enrollments;
  v_t    public.therapists;
  v_p    public.training_programs;
  v_id   uuid;
begin
  select id into v_id from public.certificates where enrollment_id = p_enrollment;
  if found then return v_id; end if;

  select * into v_e from public.training_enrollments where id = p_enrollment;
  select * into v_t from public.therapists           where id = v_e.therapist_id;
  select * into v_p from public.training_programs    where key = v_e.program_key;

  insert into public.certificates (code, therapist_id, program_key, enrollment_id, full_name, title)
  values ('CARE-' || upper(v_p.key) || '-'
            || to_char(now() at time zone 'Asia/Bangkok', 'YYYY') || '-'
            || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
          v_t.id, v_p.key, p_enrollment, v_t.full_name,
          coalesce(v_p.certificate_title, v_p.title))
  returning id into v_id;

  insert into public.journey_events (therapist_id, stage, event_type, title, recorded_by)
  values (v_t.id, v_t.stage, 'certificate', 'Certificate: ' || coalesce(v_p.certificate_title, v_p.title) || ' 🎓', null);
  return v_id;
end $$;

-- Mark an attempt. Safe to call twice (the second call changes nothing).
create or replace function private.exam_grade(p_attempt uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_att    public.exam_attempts;
  v_enr    public.training_enrollments;
  v_step   public.training_steps;
  v_prog   public.training_programs;
  v_t      public.therapists;
  v_score  numeric;
  v_total  numeric;
  v_mark   numeric;
  v_passed boolean;
begin
  select * into v_att from public.exam_attempts where id = p_attempt for update;
  if not found then raise exception 'Exam not found.'; end if;
  if v_att.status = 'submitted' then
    return jsonb_build_object('passed', v_att.passed, 'already', true);
  end if;

  select * into v_enr  from public.training_enrollments where id = v_att.enrollment_id;
  select * into v_step from public.training_steps       where id = v_att.step_id;
  select * into v_prog from public.training_programs    where key = v_enr.program_key;
  select * into v_t    from public.therapists           where id = v_enr.therapist_id;

  select coalesce(sum(q.points), 0),
         coalesce(sum(q.points) filter (where private.exam_is_correct(q.answer, d.answers -> (q.id::text))), 0)
    into v_total, v_score
  from private.exam_attempt_data d
  cross join lateral jsonb_array_elements(d.paper) as p(e)
  join private.exam_questions q on q.id = (p.e ->> 'q')::uuid
  where d.attempt_id = p_attempt;

  v_mark   := coalesce((v_step.config ->> 'pass_mark')::numeric, ceil(v_total * 0.85));
  v_passed := v_score >= v_mark;

  update public.exam_attempts
     set status = 'submitted',
         submitted_at = now(),
         score = v_score,
         total = v_total,
         passed = v_passed,
         time_used_min = greatest(1, ceil(extract(epoch from (least(now(), deadline) - started_at)) / 60))::int
   where id = p_attempt;

  insert into public.journey_events (therapist_id, stage, event_type, title, details, recorded_by)
  values (v_t.id, v_t.stage,
          case when v_passed then 'exam_passed' else 'exam_not_passed' end,
          v_step.title || case when v_passed then ': passed 🎉' else ': not passed' end,
          jsonb_build_object('attempt_id', p_attempt),
          null);

  if v_passed and coalesce((v_step.config ->> 'completes_program')::boolean, false) then
    update public.training_enrollments
       set status = 'passed', finished_on = (now() at time zone 'Asia/Bangkok')::date
     where id = v_enr.id;
    if v_prog.certificate then
      perform private.issue_certificate(v_enr.id);
    end if;
    -- ABAT learners have finished their journey.
    if v_prog.key = 'abat' and v_t.track = 'abat' and v_t.stage = 'online_course' then
      update public.therapists set stage = 'certified' where id = v_t.id;
    end if;
  end if;

  return jsonb_build_object('passed', v_passed);
end $$;

revoke execute on all functions in schema private from public;
grant  execute on function private.current_therapist_id()          to authenticated;
grant  execute on function private.has_any_role(public.app_role[]) to authenticated;
grant  execute on function private.is_training_team()              to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Exam functions the app calls
-- ---------------------------------------------------------------------------
-- Start (or resume) your exam. Returns the questions WITHOUT answers.
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
    -- Time ran out while they were away: mark what was saved.
    if now() > v_att.deadline + interval '2 minutes' then
      return private.exam_grade(v_att.id) || jsonb_build_object('expired', true);
    end if;
  else
    select count(*) into v_used from public.exam_attempts
     where enrollment_id = v_enr.id and step_id = p_step;
    if v_used >= 1 + v_enr.extra_attempts then
      raise exception 'You have already taken this exam.';
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

-- Autosave answers while the exam is open.
create or replace function public.exam_save(p_attempt uuid, p_answers jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_att public.exam_attempts;
begin
  select a.* into v_att
  from public.exam_attempts a
  join public.training_enrollments e on e.id = a.enrollment_id
  where a.id = p_attempt and e.therapist_id = private.current_therapist_id();
  if not found then raise exception 'Exam not found.'; end if;
  if v_att.status <> 'in_progress' then raise exception 'This exam has already been submitted.'; end if;
  if now() > v_att.deadline + interval '2 minutes' then raise exception 'Time is up.'; end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then raise exception 'Bad answers.'; end if;
  update private.exam_attempt_data set answers = p_answers where attempt_id = p_attempt;
end $$;

-- Hand in. Late answers (over 2 minutes past the deadline) are ignored and
-- the last saved answers are marked instead.
create or replace function public.exam_submit(p_attempt uuid, p_answers jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_att public.exam_attempts;
begin
  select a.* into v_att
  from public.exam_attempts a
  join public.training_enrollments e on e.id = a.enrollment_id
  where a.id = p_attempt and e.therapist_id = private.current_therapist_id();
  if not found then raise exception 'Exam not found.'; end if;

  if v_att.status = 'in_progress'
     and now() <= v_att.deadline + interval '2 minutes'
     and jsonb_typeof(p_answers) = 'object' then
    update private.exam_attempt_data set answers = p_answers where attempt_id = p_attempt;
  end if;
  return private.exam_grade(p_attempt);
end $$;

-- Team: results for a programme, with scores. Also marks any attempt whose
-- time ran out while the trainee was away.
create or replace function public.exam_results(p_program text)
returns table (attempt_id uuid, enrollment_id uuid, therapist_id uuid, step_id uuid,
               started_at timestamptz, submitted_at timestamptz, status text,
               score numeric, total numeric, passed boolean, time_used_min integer)
language plpgsql security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  if not private.is_training_team() then raise exception 'Only the training team can see results.'; end if;

  for v_id in
    select a.id from public.exam_attempts a
    join public.training_enrollments e on e.id = a.enrollment_id
    where e.program_key = p_program and a.status = 'in_progress'
      and now() > a.deadline + interval '2 minutes'
  loop
    perform private.exam_grade(v_id);
  end loop;

  return query
    select a.id, a.enrollment_id, e.therapist_id, a.step_id, a.started_at, a.submitted_at, a.status,
           a.score, a.total, a.passed, a.time_used_min
    from public.exam_attempts a
    join public.training_enrollments e on e.id = a.enrollment_id
    where e.program_key = p_program
    order by a.started_at desc;
end $$;

-- Admin or supervisor: allow one more attempt.
create or replace function public.exam_allow_retake(p_enrollment uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_t uuid;
begin
  if not private.has_any_role(array['admin','supervisor']::public.app_role[]) then
    raise exception 'Only an admin or supervisor can allow a retake.';
  end if;
  update public.training_enrollments
     set extra_attempts = extra_attempts + 1
   where id = p_enrollment and status = 'active'
  returning therapist_id into v_t;
  if v_t is null then raise exception 'This person is not in an active programme.'; end if;

  insert into public.journey_events (therapist_id, stage, event_type, title, recorded_by)
  select t.id, t.stage, 'note', 'Exam retake allowed', private.current_therapist_id()
  from public.therapists t where t.id = v_t;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Admin: edit exam questions (answers never leave the database otherwise)
-- ---------------------------------------------------------------------------
create or replace function private.require_admin()
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_any_role(array['admin']::public.app_role[]) then
    raise exception 'Only an admin can edit exam questions.';
  end if;
end $$;

-- Check one question; raises a friendly message if something is wrong.
create or replace function private.exam_check_question(p_type text, p_options jsonb, p_answer jsonb)
returns void
language plpgsql immutable
set search_path = ''
as $$
declare
  n integer;
begin
  if p_type not in ('mcq','multiselect') then raise exception 'Question type must be mcq or multiselect.'; end if;
  if jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options) < 2 then
    raise exception 'A question needs at least 2 options.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_options) o
             where jsonb_typeof(o) <> 'string' or btrim(o #>> '{}') = '') then
    raise exception 'Every option needs some text.';
  end if;
  n := jsonb_array_length(p_options);
  if p_type = 'mcq' then
    if jsonb_typeof(p_answer) is distinct from 'number'
       or (p_answer #>> '{}') !~ '^[0-9]+$'
       or (p_answer #>> '{}')::int >= n then
      raise exception 'Choose the one correct option.';
    end if;
  else
    if jsonb_typeof(p_answer) is distinct from 'array' or jsonb_array_length(p_answer) = 0 then
      raise exception 'Tick at least one correct option.';
    end if;
    if exists (select 1 from jsonb_array_elements(p_answer) a
               where jsonb_typeof(a) <> 'number'
                  or (a #>> '{}') !~ '^[0-9]+$'
                  or (a #>> '{}')::int >= n) then
      raise exception 'A correct option is out of range.';
    end if;
  end if;
end $$;

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
             'options', q.options, 'answer', q.answer, 'points', q.points)
           order by q.sort_order, q.created_at)
    from private.exam_questions q
    where q.step_id = p_step and q.active), '[]'::jsonb);
end $$;

-- Add (no "id") or update (with "id") one question.
-- p_q = {"id"?, "type", "prompt", "options": [..], "answer": .., "points"?, "sort_order"?}
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
           sort_order = coalesce((p_q ->> 'sort_order')::int, sort_order), updated_at = now()
     where id = (p_q ->> 'id')::uuid and step_id = p_step and active
    returning id into v_id;
    if v_id is null then raise exception 'Question not found.'; end if;
  else
    insert into private.exam_questions (step_id, sort_order, type, prompt, options, answer, points)
    values (p_step,
            coalesce((p_q ->> 'sort_order')::int,
                     (select coalesce(max(sort_order), 0) + 10 from private.exam_questions where step_id = p_step)),
            p_q ->> 'type', btrim(p_q ->> 'prompt'), p_q -> 'options', p_q -> 'answer',
            coalesce((p_q ->> 'points')::numeric, 1))
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Remove a question. Kept (hidden) if anyone has already sat it, so their
-- results still add up; otherwise deleted.
create or replace function public.exam_question_remove(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if exists (select 1 from private.exam_attempt_data d
             where d.paper @> jsonb_build_array(jsonb_build_object('q', p_id))) then
    update private.exam_questions set active = false, updated_at = now() where id = p_id;
  else
    delete from private.exam_questions where id = p_id;
  end if;
end $$;

-- Import questions in the old Training portal format (questions.json):
-- {"timeLimitMinutes": 120, "passMark": 53, "questions": [{"type": "mcq", ...}]}
-- or just the list of questions. Only mcq and multiselect are imported.
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
      insert into private.exam_questions (step_id, sort_order, type, prompt, options, answer, points)
      values (p_step, v_sort, v_q ->> 'type', btrim(v_q ->> 'prompt'), v_q -> 'options', v_q -> 'answer',
              coalesce((v_q ->> 'points')::numeric, 1));
      v_added := v_added + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  -- Exam settings from the file, if present.
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

revoke execute on function public.exam_start(uuid), public.exam_save(uuid, jsonb), public.exam_submit(uuid, jsonb),
                           public.exam_results(text), public.exam_allow_retake(uuid),
                           public.exam_questions_admin(uuid), public.exam_question_save(uuid, jsonb),
                           public.exam_question_remove(uuid), public.exam_questions_import(uuid, jsonb, boolean)
  from public, anon;
grant execute on function public.exam_start(uuid), public.exam_save(uuid, jsonb), public.exam_submit(uuid, jsonb),
                          public.exam_results(text), public.exam_allow_retake(uuid),
                          public.exam_questions_admin(uuid), public.exam_question_save(uuid, jsonb),
                          public.exam_question_remove(uuid), public.exam_questions_import(uuid, jsonb, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Automatic place on ABAT Coursework at the "Online course + exam" stage
-- ---------------------------------------------------------------------------
create or replace function private.auto_enrol_abat()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.stage = 'online_course'
     and (tg_op = 'INSERT' or old.stage is distinct from new.stage)
     and not exists (select 1 from public.training_enrollments e
                     where e.therapist_id = new.id and e.program_key = 'abat'
                       and e.status in ('recommended','active','passed')) then
    insert into public.training_enrollments (therapist_id, program_key, status, approved_by)
    values (new.id, 'abat', 'active', private.current_therapist_id());
  end if;
  return new;
end $$;
revoke execute on function private.auto_enrol_abat() from public;

create trigger therapists_auto_enrol_abat
  after insert or update of stage on public.therapists
  for each row execute function private.auto_enrol_abat();

-- Lock down every private function again (some were created above), then
-- re-open only the three helpers the database rules use.
revoke execute on all functions in schema private from public;
grant  execute on function private.current_therapist_id()          to authenticated;
grant  execute on function private.has_any_role(public.app_role[]) to authenticated;
grant  execute on function private.is_training_team()              to authenticated;

-- People already at that stage get their place now.
insert into public.training_enrollments (therapist_id, program_key, status)
select t.id, 'abat', 'active'
from public.therapists t
where t.stage = 'online_course' and t.status <> 'exited'
  and not exists (select 1 from public.training_enrollments e
                  where e.therapist_id = t.id and e.program_key = 'abat');

commit;
