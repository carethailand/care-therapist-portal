-- (keep) Portal 039 – New therapist onboarding path
--
-- Run AFTER 038. One plan per new therapist (CARE staff in the hire track):
--   1 Interview        admin sets the date
--   2 Online course    ABAT + CARE Way (from the Training tab, nothing stored here)
--   3 Orientation      admin sets date + who runs it; attendance recorded
--   4 Role-play        9 topics; admin sets date + trainer (supervisor / QCD);
--                      the trainer records attendance, "% Independent" (pass flag at 80%) and signs off
--   5 Written exam     in person, on paper; admin sets date + proctor; score recorded (pass 80%)
--   6 Field overlap    sessions 1–7: admin sets date, trainer (any therapist) and case code;
--                      the trainer signs off with a short note. Session 8 = field evaluation:
--                      the supervisor records the average (0–4); pass = 3 or more
--   7 Probation        the supervisor passes it; admin then moves them to Thriving
-- The checklists themselves stay on paper. Who can see: the trainee (no scores or
-- notes), the training team (admin, HR, supervisors, QCD, Portal manager) and each
-- trainer (their own sessions). Admin plans; trainers / supervisors record.
-- Case codes are 3 capital letters (e.g. ABC), never a child's name.

begin;

create table if not exists public.onboarding_items (
  id           uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.therapists (id) on delete cascade,     -- the new therapist
  step         text not null check (step in ('interview','orientation','roleplay','written_exam','overlap','field_eval','probation')),
  seq          smallint not null default 0 check (seq between 0 and 20),                -- role-play topic 1–9, overlap session 1–7
  title        text check (char_length(title) <= 120),
  held_on      date,
  start_time   time,
  place        text check (char_length(place) <= 120),
  trainer_id   uuid references public.therapists (id) on delete set null,              -- trainer / proctor / supervisor
  case_code    text check (case_code ~ '^[A-Z]{3}$'),                                   -- never a child's name
  status       text not null default 'planned' check (status in ('planned','attended','done','missed')),
  score        numeric check (score >= 0),
  full_score   numeric check (full_score > 0),
  passed       boolean,
  reviewed_on  date,                                                                    -- field evaluation reviewed with the trainee
  note         text check (char_length(note) <= 500),                                   -- team / trainer only
  recorded_by  uuid references public.therapists (id) on delete set null,
  recorded_at  timestamptz,
  created_by   uuid references public.therapists (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (therapist_id, step, seq)
);
create index if not exists onboarding_items_trainer_idx on public.onboarding_items (trainer_id);

-- Everything goes through the functions below (they decide who sees and does what).
alter table public.onboarding_items enable row level security;
revoke all on public.onboarding_items from public, anon, authenticated;

create or replace function private.onb_name(p_id uuid)
returns text
language sql stable security definer
set search_path = ''
as $$ select coalesce(nickname, full_name) from public.therapists where id = p_id $$;
revoke execute on function private.onb_name(uuid) from public, anon, authenticated;

-- 1. Read ---------------------------------------------------------------------------------------------------
-- One person's plan. The trainee sees dates, people and pass / done (no scores or notes);
-- the training team sees everything; a trainer sees only the sessions they lead.
create or replace function public.onboarding_items(p_who uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_who uuid := coalesce(p_who, v_me);
  v_team boolean := private.is_training_team();
  v_self boolean := v_who = v_me;
begin
  if v_me is null then raise exception 'Not signed in.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id, 'therapist_id', i.therapist_id, 'step', i.step, 'seq', i.seq, 'title', i.title,
             'held_on', i.held_on, 'start_time', i.start_time, 'place', i.place,
             'trainer_id', i.trainer_id, 'trainer', private.onb_name(i.trainer_id), 'case_code', i.case_code,
             'status', i.status, 'passed', i.passed, 'reviewed_on', i.reviewed_on, 'recorded_at', i.recorded_at,
             'score',      case when v_team or i.trainer_id = v_me then i.score end,
             'full_score', case when v_team or i.trainer_id = v_me then i.full_score end,
             'note',       case when v_team or i.trainer_id = v_me then i.note end,
             'recorded_by', case when v_team or i.trainer_id = v_me then private.onb_name(i.recorded_by) end)
           order by i.step, i.seq)
    from public.onboarding_items i
    where i.therapist_id = v_who
      and (v_self or v_team or i.trainer_id = v_me)), '[]'::jsonb);
end $$;

-- Everyone in onboarding (training team only).
create or replace function public.onboarding_people()
returns table (id uuid, full_name text, nickname text, stage text, start_date date, probation_end_date date)
language sql stable security definer
set search_path = ''
as $$
  select t.id, t.full_name, t.nickname, t.stage::text, t.start_date, t.probation_end_date
  from public.therapists t
  where private.is_training_team()
    and t.track = 'care_hire' and t.status <> 'exited'
    and t.stage::text in ('interview','online_course','roleplay_orientation','field_overlap','probation')
  order by coalesce(t.nickname, t.full_name)
$$;

-- Sessions the signed-in person leads as a trainer (with the trainee's name).
create or replace function public.onboarding_led()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'therapist_id', i.therapist_id, 'trainee', private.onb_name(i.therapist_id),
           'step', i.step, 'seq', i.seq, 'title', i.title, 'held_on', i.held_on, 'start_time', i.start_time,
           'place', i.place, 'case_code', i.case_code, 'status', i.status, 'passed', i.passed,
           'score', i.score, 'full_score', i.full_score, 'note', i.note, 'reviewed_on', i.reviewed_on)
         order by i.held_on nulls last, i.step, i.seq), '[]'::jsonb)
  from public.onboarding_items i
  join public.therapists t on t.id = i.therapist_id and t.status <> 'exited'
  where i.trainer_id = private.current_therapist_id()
    and t.stage::text in ('interview','online_course','roleplay_orientation','field_overlap','probation')
$$;

-- 2. Plan (admin / Portal manager) ---------------------------------------------------------------------------------
create or replace function public.onboarding_plan(p_who uuid, p_step text, p_seq integer, p_title text,
                                                  p_held_on date, p_start time, p_place text, p_trainer uuid, p_case text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_id uuid;
  v_case text := nullif(upper(btrim(coalesce(p_case, ''))), '');
begin
  if not private.has_any_role(array['admin']::public.app_role[]) then raise exception 'Only an admin or the Portal manager plans onboarding.'; end if;
  if not exists (select 1 from public.therapists where id = p_who and track = 'care_hire' and status <> 'exited') then raise exception 'Person not found.'; end if;
  if p_step not in ('interview','orientation','roleplay','written_exam','overlap','field_eval','probation') then raise exception 'Unknown step.'; end if;
  if p_step = 'roleplay' and (p_seq is null or p_seq not between 1 and 9) then raise exception 'Role-play topics are numbered 1 to 9.'; end if;
  if p_step = 'overlap' and (p_seq is null or p_seq not between 1 and 7) then raise exception 'Overlap sessions are numbered 1 to 7.'; end if;
  if v_case is not null and v_case !~ '^[A-Z]{3}$' then raise exception 'Use the 3-letter case code (e.g. ABC), never a name.'; end if;
  if p_trainer is not null then
    if p_trainer = p_who then raise exception 'The trainee can''t be their own trainer.'; end if;
    if p_step = 'roleplay' and not exists (select 1 from public.staff_roles where therapist_id = p_trainer and role in ('supervisor','qcd')) then
      raise exception 'Role-play trainers are supervisors or QCD.';
    end if;
    if p_step in ('field_eval','probation') and not exists (select 1 from public.staff_roles where therapist_id = p_trainer and role = 'supervisor') then
      raise exception 'The field evaluation and probation are with a supervisor.';
    end if;
    if not exists (select 1 from public.therapists t where t.id = p_trainer and t.status <> 'exited' and t.track = 'care_hire'
                     and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')) then
      raise exception 'Choose a CARE staff member.';
    end if;
  end if;
  insert into public.onboarding_items (therapist_id, step, seq, title, held_on, start_time, place, trainer_id, case_code, created_by,
                                       full_score)
  values (p_who, p_step, case when p_step in ('roleplay','overlap') then p_seq else 0 end,
          nullif(btrim(coalesce(p_title, '')), ''), p_held_on, p_start, nullif(btrim(coalesce(p_place, '')), ''), p_trainer, v_case, v_me,
          case p_step when 'written_exam' then 130 when 'field_eval' then 4 when 'roleplay' then 100 end)
  on conflict (therapist_id, step, seq) do update
    set title = excluded.title, held_on = excluded.held_on, start_time = excluded.start_time, place = excluded.place,
        trainer_id = excluded.trainer_id, case_code = excluded.case_code
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.onboarding_remove(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_any_role(array['admin']::public.app_role[]) then raise exception 'Only an admin or the Portal manager plans onboarding.'; end if;
  if exists (select 1 from public.onboarding_items where id = p_id and recorded_at is not null) then
    raise exception 'This has a recorded result. Clear the result first, or keep it for the record.';
  end if;
  delete from public.onboarding_items where id = p_id;
end $$;

-- 3. Record (trainer / supervisor) ----------------------------------------------------------------------------------
-- p_status: 'attended', 'done' (signed off / passed / completed), 'missed', or 'planned' (clear the record).
create or replace function public.onboarding_record(p_id uuid, p_status text, p_score numeric, p_passed boolean,
                                                    p_reviewed_on date, p_note text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_i public.onboarding_items;
  v_sup boolean := private.has_any_role(array['admin','supervisor']::public.app_role[]);
  v_passed boolean;
begin
  select * into v_i from public.onboarding_items where id = p_id for update;
  if not found then raise exception 'Not found.'; end if;
  if v_i.therapist_id = v_me then raise exception 'You can''t record your own onboarding.'; end if;
  if v_i.step in ('field_eval','probation') then
    if not (v_sup or v_i.trainer_id = v_me) then raise exception 'A supervisor records this.'; end if;
  elsif not (v_i.trainer_id = v_me or private.is_assessor()) then
    raise exception 'Only the trainer, a supervisor, QCD or an admin can record this.';
  end if;
  if p_status not in ('planned','attended','done','missed') then raise exception 'Unknown status.'; end if;

  if p_status = 'planned' then
    update public.onboarding_items
       set status = 'planned', score = null, passed = null, reviewed_on = null, note = null, recorded_by = null, recorded_at = null
     where id = p_id;
    return;
  end if;

  v_passed := case
    when p_status = 'missed' then null
    when v_i.step = 'roleplay' then case when p_score is null then null else p_score >= 80 end
    when v_i.step = 'written_exam' then case when p_score is null then null else p_score >= 0.8 * coalesce(v_i.full_score, 130) end
    when v_i.step = 'field_eval' then case when p_score is null then null else p_score >= 3 end
    when v_i.step = 'probation' then p_passed
    else null end;
  if v_i.step = 'roleplay' and p_score is not null and p_score > 100 then raise exception 'Percent independent is 0 to 100.'; end if;
  if v_i.step = 'field_eval' and p_status = 'done' and (p_score is null or p_score > 4) then raise exception 'Enter the average score (0 to 4).'; end if;
  if v_i.step = 'written_exam' and p_status = 'done' and (p_score is null or p_score > coalesce(v_i.full_score, 130)) then
    raise exception 'Enter the score (0 to %).', coalesce(v_i.full_score, 130);
  end if;
  if v_i.step = 'probation' and p_status = 'done' and p_passed is null then raise exception 'Choose pass or not yet.'; end if;

  update public.onboarding_items
     set status = p_status,
         score = case when v_i.step in ('roleplay','written_exam','field_eval') then p_score else null end,
         passed = v_passed,
         reviewed_on = case when v_i.step = 'field_eval' then p_reviewed_on end,
         note = nullif(btrim(coalesce(p_note, '')), ''),
         recorded_by = v_me, recorded_at = now(),
         held_on = coalesce(held_on, private.learning_today())
   where id = p_id;
end $$;

revoke execute on function public.onboarding_items(uuid), public.onboarding_people(), public.onboarding_led(),
  public.onboarding_plan(uuid, text, integer, text, date, time, text, uuid, text), public.onboarding_remove(uuid),
  public.onboarding_record(uuid, text, numeric, boolean, date, text) from public, anon;
grant execute on function public.onboarding_items(uuid), public.onboarding_people(), public.onboarding_led(),
  public.onboarding_plan(uuid, text, integer, text, date, time, text, uuid, text), public.onboarding_remove(uuid),
  public.onboarding_record(uuid, text, numeric, boolean, date, text) to authenticated;

commit;
