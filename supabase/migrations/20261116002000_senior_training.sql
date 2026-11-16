-- (keep) Portal 020 – Senior Therapist Training: results, hours, practicum, promotion
--
-- Run AFTER 019. The training engine gets what Senior (and later QCD)
-- training needs:
--   * RECORDED RESULTS for steps done off-line (written exam on paper, oral
--     exam, practicum): a supervisor types score / full score + pass / not
--     pass. Trainees see pass / not pass and the date only, never the score.
--   * TRAINING HOURS for in-person training (a supervisor logs a session for
--     one person or the whole group).
--   * PRACTICUM EVALUATIONS: the supervisor fills the practicum checklist in
--     the Portal (Prep 1–4, Clinic 1–4, technical skills). The trainee can
--     read their own marks and comments. Cases appear as 3-letter codes only.
--   * PROMOTION: when someone passes, an admin can promote them (Senior
--     training → Senior therapist) with one button.
-- The course content itself (steps, videos, checklist wording) is loaded by
-- the separate file "Senior course setup – run once" kept off GitHub.

begin;

-- 1. Who can record results / hours / evaluations --------------------------------------
create or replace function private.is_assessor()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.has_any_role(array['admin','supervisor','qcd']::public.app_role[])
$$;
revoke execute on function private.is_assessor() from public, anon;
grant  execute on function private.is_assessor() to authenticated;

-- 2. Programme: which rank passing it leads to ---------------------------------------------
alter table public.training_programs
  add column if not exists promotes_to public.app_role;
alter table public.training_enrollments
  add column if not exists promoted_on date;

-- 3. Recorded results (written exam, oral exam, practicum) ------------------------------------
create table if not exists public.training_step_results (
  enrollment_id uuid not null references public.training_enrollments (id) on delete cascade,
  step_id       uuid not null references public.training_steps (id) on delete cascade,
  held_on       date,
  score         numeric check (score >= 0),
  full_score    numeric check (full_score > 0),
  passed        boolean not null,
  note          text check (char_length(note) <= 1000),   -- team only
  recorded_by   uuid references public.therapists (id) on delete set null,
  recorded_at   timestamptz not null default now(),
  primary key (enrollment_id, step_id),
  check (score is null or full_score is null or score <= full_score)
);
alter table public.training_step_results enable row level security;
revoke all on public.training_step_results from anon, authenticated;
grant select on public.training_step_results to authenticated;
drop policy if exists "training_step_results: team read" on public.training_step_results;
create policy "training_step_results: team read" on public.training_step_results
  for select to authenticated using ((select private.is_training_team()));
-- Trainees read their own results through training_my_results() (no score, no note).

-- 4. Training hours (in-person sessions) ----------------------------------------------------------
create table if not exists public.training_hours (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.training_enrollments (id) on delete cascade,
  step_id       uuid not null references public.training_steps (id) on delete cascade,
  held_on       date not null,
  hours         numeric(4,1) not null check (hours > 0 and hours <= 12),
  topic         text check (char_length(topic) <= 200),
  recorded_by   uuid references public.therapists (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists training_hours_enr_idx on public.training_hours (enrollment_id, step_id);
alter table public.training_hours enable row level security;
revoke all on public.training_hours from anon, authenticated;
grant select, insert, delete on public.training_hours to authenticated;
drop policy if exists "training_hours: own or team read" on public.training_hours;
drop policy if exists "training_hours: assessor add"     on public.training_hours;
drop policy if exists "training_hours: assessor remove"  on public.training_hours;
create policy "training_hours: own or team read" on public.training_hours
  for select to authenticated using (
    (select private.is_training_team())
    or exists (select 1 from public.training_enrollments e
               where e.id = enrollment_id and e.therapist_id = (select private.current_therapist_id())));
create policy "training_hours: assessor add" on public.training_hours
  for insert to authenticated with check (
    (select private.is_assessor()) and recorded_by = (select private.current_therapist_id())
    and exists (select 1 from public.training_enrollments e where e.id = enrollment_id and e.status = 'active'));
create policy "training_hours: assessor remove" on public.training_hours
  for delete to authenticated using ((select private.is_assessor()));

-- 5. Practicum evaluations (the checklist, filled in by a supervisor) ------------------------------
create table if not exists public.training_practicum_evals (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.training_enrollments (id) on delete cascade,
  step_id       uuid not null references public.training_steps (id) on delete cascade,
  section       text not null check (section in ('prep','clinic','skills')),
  seq           integer not null default 0 check (seq between 0 and 12),
  case_code     text check (case_code ~ '^[A-Z]{3}$'),           -- never a child's name
  held_on       date,
  marks         jsonb not null default '{}'::jsonb,
  comment       text check (char_length(comment) <= 2000),
  assessor_id   uuid references public.therapists (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (enrollment_id, step_id, section, seq)
);
alter table public.training_practicum_evals enable row level security;
revoke all on public.training_practicum_evals from anon, authenticated;
grant select, insert, update, delete on public.training_practicum_evals to authenticated;
drop policy if exists "practicum: own or team read" on public.training_practicum_evals;
drop policy if exists "practicum: assessor add"     on public.training_practicum_evals;
drop policy if exists "practicum: assessor edit"    on public.training_practicum_evals;
drop policy if exists "practicum: assessor remove"  on public.training_practicum_evals;
create policy "practicum: own or team read" on public.training_practicum_evals
  for select to authenticated using (
    (select private.is_training_team())
    or exists (select 1 from public.training_enrollments e
               where e.id = enrollment_id and e.therapist_id = (select private.current_therapist_id())));
create policy "practicum: assessor add" on public.training_practicum_evals
  for insert to authenticated with check (
    (select private.is_assessor()) and assessor_id = (select private.current_therapist_id()));
create policy "practicum: assessor edit" on public.training_practicum_evals
  for update to authenticated using ((select private.is_assessor())) with check ((select private.is_assessor()));
create policy "practicum: assessor remove" on public.training_practicum_evals
  for delete to authenticated using ((select private.is_assessor()));

-- 6. My results (trainee): pass / not pass and date, no score -----------------------------------
create or replace function public.training_my_results()
returns table (enrollment_id uuid, step_id uuid, held_on date, passed boolean)
language sql stable security definer
set search_path = ''
as $$
  select r.enrollment_id, r.step_id, r.held_on, r.passed
  from public.training_step_results r
  join public.training_enrollments e on e.id = r.enrollment_id
  where e.therapist_id = private.current_therapist_id()
$$;

-- 7. Record a result (assessors). When the step finishes the programme and
--    every recorded step is passed, the place is completed + certificate. ------------------------
create or replace function public.training_record_result(p_enrollment uuid, p_step uuid, p_passed boolean,
                                                         p_score numeric, p_full numeric, p_held_on date, p_note text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me   uuid := private.current_therapist_id();
  v_e    public.training_enrollments;
  v_s    public.training_steps;
  v_p    public.training_programs;
  v_t    public.therapists;
  v_done boolean := false;
begin
  if not private.is_assessor() then raise exception 'Only a supervisor, QCD or admin can record results.'; end if;
  select * into v_e from public.training_enrollments where id = p_enrollment;
  if not found then raise exception 'Training place not found.'; end if;
  if v_e.status <> 'active' then raise exception 'This training place is not active.'; end if;
  select * into v_s from public.training_steps where id = p_step and program_key = v_e.program_key;
  if not found or v_s.kind not in ('result','practicum') then raise exception 'This step does not take a recorded result.'; end if;
  if p_passed is null then raise exception 'Choose pass or not pass.'; end if;

  insert into public.training_step_results (enrollment_id, step_id, held_on, score, full_score, passed, note, recorded_by, recorded_at)
  values (p_enrollment, p_step, p_held_on, p_score, p_full, p_passed, nullif(btrim(coalesce(p_note, '')), ''), v_me, now())
  on conflict (enrollment_id, step_id) do update
    set held_on = excluded.held_on, score = excluded.score, full_score = excluded.full_score,
        passed = excluded.passed, note = excluded.note, recorded_by = excluded.recorded_by, recorded_at = now();

  select * into v_t from public.therapists where id = v_e.therapist_id;
  select * into v_p from public.training_programs where key = v_e.program_key;
  insert into public.journey_events (therapist_id, stage, event_type, title, recorded_by)
  values (v_t.id, v_t.stage, 'training',
          coalesce(v_p.title, 'Training') || ': ' || v_s.title || case when p_passed then ' passed' else ' not passed' end,
          v_me);

  -- Finished? (this step completes the programme, and every result/practicum step is passed)
  if p_passed and coalesce((v_s.config ->> 'completes_program')::boolean, false)
     and not exists (
       select 1 from public.training_steps s
       where s.program_key = v_e.program_key and s.kind in ('result','practicum')
         and not exists (select 1 from public.training_step_results r
                         where r.enrollment_id = p_enrollment and r.step_id = s.id and r.passed)) then
    update public.training_enrollments
       set status = 'passed', finished_on = coalesce(p_held_on, (now() at time zone 'Asia/Bangkok')::date)
     where id = p_enrollment;
    if v_p.certificate then perform private.issue_certificate(p_enrollment); end if;
    v_done := true;
  end if;
  return jsonb_build_object('completed', v_done);
end $$;

-- 8. Promote (admins): Senior training passed → Senior therapist ---------------------------------
create or replace function public.training_promote(p_enrollment uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_e  public.training_enrollments;
  v_p  public.training_programs;
  v_t  public.therapists;
begin
  if not private.has_any_role(array['admin']::public.app_role[]) then raise exception 'Only an admin can promote.'; end if;
  select * into v_e from public.training_enrollments where id = p_enrollment;
  if not found or v_e.status <> 'passed' then raise exception 'This person hasn''t passed the programme yet.'; end if;
  select * into v_p from public.training_programs where key = v_e.program_key;
  if v_p.promotes_to is null then raise exception 'This programme doesn''t lead to a new rank.'; end if;
  select * into v_t from public.therapists where id = v_e.therapist_id;

  -- One rank per person: remove the lower ranks, add the new one. Office roles stay.
  delete from public.staff_roles
   where therapist_id = v_t.id
     and role in ('applicant','therapist','senior','qcd')
     and role <> v_p.promotes_to;
  insert into public.staff_roles (therapist_id, role, granted_by)
  values (v_t.id, v_p.promotes_to, private.current_therapist_id())
  on conflict do nothing;

  update public.training_enrollments set promoted_on = (now() at time zone 'Asia/Bangkok')::date where id = p_enrollment;
  insert into public.journey_events (therapist_id, stage, event_type, title, recorded_by)
  values (v_t.id, v_t.stage, 'promotion',
          'Promoted to ' || case v_p.promotes_to when 'senior' then 'Senior therapist' when 'qcd' then 'QCD'
                                                 when 'supervisor' then 'Supervisor' else v_p.promotes_to::text end || ' 🎉',
          private.current_therapist_id());
end $$;

revoke execute on function public.training_my_results(), public.training_record_result(uuid, uuid, boolean, numeric, numeric, date, text),
                           public.training_promote(uuid) from public, anon;
grant  execute on function public.training_my_results(), public.training_record_result(uuid, uuid, boolean, numeric, numeric, date, text),
                           public.training_promote(uuid) to authenticated;

commit;
