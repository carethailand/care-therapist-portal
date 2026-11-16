-- (keep) Portal 022 – Training groups, schedule and attendance
--
-- Run AFTER 021. Senior (and later QCD) training runs in groups:
--   * an admin creates a GROUP (e.g. "Senior 2027 – Group 1") and adds people
--   * an admin plans SESSIONS ahead: date, start time, hours, chapters, place,
--     supervisor, or an exam date (written / oral)
--   * after a training session, a supervisor / QCD / admin confirms who
--     ATTENDED; their hours and chapters are logged automatically
-- Trainees see their group's schedule (and whether they attended).

begin;

-- 1. Groups -----------------------------------------------------------------------------------
create table if not exists public.training_groups (
  id          uuid primary key default gen_random_uuid(),
  program_key text not null references public.training_programs (key) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  notes       text check (char_length(notes) <= 500),
  created_by  uuid references public.therapists (id) on delete set null,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,
  closed_by   uuid references public.therapists (id) on delete set null
);

create table if not exists public.training_group_members (
  group_id      uuid not null references public.training_groups (id) on delete cascade,
  enrollment_id uuid not null unique references public.training_enrollments (id) on delete cascade,  -- one group per place
  added_at      timestamptz not null default now(),
  primary key (group_id, enrollment_id)
);

-- 2. Sessions (planned ahead) -------------------------------------------------------------------
create table if not exists public.training_sessions (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.training_groups (id) on delete cascade,
  step_id     uuid references public.training_steps (id) on delete set null,
  kind        text not null default 'session' check (kind in ('session','exam','other')),
  title       text check (char_length(title) <= 120),
  held_on     date not null,
  start_time  time,
  hours       numeric(4,1) check (hours > 0 and hours <= 12),
  chapters    smallint[] not null default '{}',
  place       text check (char_length(place) <= 120),
  trainer_id  uuid references public.therapists (id) on delete set null,
  status      text not null default 'planned' check (status in ('planned','done','cancelled')),
  attended_at timestamptz,
  attended_by uuid references public.therapists (id) on delete set null,
  created_by  uuid references public.therapists (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists training_sessions_group_idx on public.training_sessions (group_id, held_on);

-- Hours that came from a session (so attendance can be corrected).
alter table public.training_hours
  add column if not exists session_id uuid references public.training_sessions (id) on delete set null;

-- Is the signed-in person in this group?
create or replace function private.in_training_group(p_group uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.training_group_members m
                 join public.training_enrollments e on e.id = m.enrollment_id
                 where m.group_id = p_group and e.therapist_id = private.current_therapist_id())
$$;
revoke execute on function private.in_training_group(uuid) from public, anon;
grant  execute on function private.in_training_group(uuid) to authenticated;

-- 3. Privileges + rules ---------------------------------------------------------------------------
alter table public.training_groups        enable row level security;
alter table public.training_group_members enable row level security;
alter table public.training_sessions      enable row level security;
revoke all on public.training_groups, public.training_group_members, public.training_sessions from anon, authenticated;
grant select, insert, update, delete on public.training_groups, public.training_group_members, public.training_sessions to authenticated;

drop policy if exists "groups: team or member read" on public.training_groups;
drop policy if exists "groups: admin write"        on public.training_groups;
create policy "groups: team or member read" on public.training_groups
  for select to authenticated using ((select private.is_training_team()) or private.in_training_group(id));
create policy "groups: admin write" on public.training_groups
  for all to authenticated
  using ((select private.has_any_role(array['admin']::public.app_role[])))
  with check ((select private.has_any_role(array['admin']::public.app_role[])));

drop policy if exists "group members: team or member read" on public.training_group_members;
drop policy if exists "group members: admin write"        on public.training_group_members;
create policy "group members: team or member read" on public.training_group_members
  for select to authenticated using ((select private.is_training_team()) or private.in_training_group(group_id));
create policy "group members: admin write" on public.training_group_members
  for all to authenticated
  using ((select private.has_any_role(array['admin']::public.app_role[])))
  with check ((select private.has_any_role(array['admin']::public.app_role[])));

drop policy if exists "sessions: team or member read" on public.training_sessions;
drop policy if exists "sessions: admin write"        on public.training_sessions;
create policy "sessions: team or member read" on public.training_sessions
  for select to authenticated using ((select private.is_training_team()) or private.in_training_group(group_id));
create policy "sessions: admin write" on public.training_sessions
  for all to authenticated
  using ((select private.has_any_role(array['admin']::public.app_role[])))
  with check ((select private.has_any_role(array['admin']::public.app_role[])));

-- 4. Trainer names for the trainee's schedule (names only) ------------------------------------------
create or replace function public.training_my_sessions()
returns table (id uuid, group_id uuid, group_name text, step_id uuid, kind text, title text, held_on date,
               start_time time, hours numeric, chapters smallint[], place text, trainer text, status text, attended boolean)
language sql stable security definer
set search_path = ''
as $$
  select s.id, s.group_id, g.name, s.step_id, s.kind, s.title, s.held_on, s.start_time, s.hours, s.chapters, s.place,
         coalesce(t.nickname, t.full_name), s.status,
         exists (select 1 from public.training_hours h where h.session_id = s.id and h.enrollment_id = m.enrollment_id)
  from public.training_sessions s
  join public.training_groups g on g.id = s.group_id
  join public.training_group_members m on m.group_id = s.group_id
  join public.training_enrollments e on e.id = m.enrollment_id and e.therapist_id = private.current_therapist_id()
  left join public.therapists t on t.id = s.trainer_id
  where s.status <> 'cancelled'
  order by s.held_on, s.start_time
$$;

-- 5. Attendance (supervisor / QCD / admin): logs hours + chapters for each person who came ----------
create or replace function public.training_session_attend(p_session uuid, p_enrollments uuid[])
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me  uuid := private.current_therapist_id();
  v_s   public.training_sessions;
  v_step uuid;
  v_n   integer := 0;
begin
  if not private.is_assessor() then raise exception 'Only a supervisor, QCD or admin can take attendance.'; end if;
  select * into v_s from public.training_sessions where id = p_session;
  if not found then raise exception 'Session not found.'; end if;
  if v_s.kind <> 'session' then raise exception 'Attendance is for training sessions.'; end if;
  if v_s.hours is null then raise exception 'Add the session''s hours first.'; end if;
  -- the in-person training step of this programme
  select coalesce(v_s.step_id, (select st.id from public.training_steps st
                                join public.training_groups g on g.program_key = st.program_key
                                where g.id = v_s.group_id and st.kind = 'session' order by st.sort_order limit 1))
    into v_step;
  if v_step is null then raise exception 'This programme has no in-person training step.'; end if;

  delete from public.training_hours where session_id = p_session;   -- re-taking attendance replaces it
  insert into public.training_hours (enrollment_id, step_id, held_on, hours, topic, chapters, recorded_by, session_id)
  select e.id, v_step, v_s.held_on, v_s.hours, v_s.title, v_s.chapters, v_me, p_session
  from public.training_enrollments e
  join public.training_group_members m on m.enrollment_id = e.id and m.group_id = v_s.group_id
  where e.id = any (coalesce(p_enrollments, '{}')) and e.status = 'active';
  get diagnostics v_n = row_count;

  update public.training_sessions
     set status = 'done', attended_at = now(), attended_by = v_me
   where id = p_session;
  return v_n;
end $$;

revoke execute on function public.training_my_sessions(), public.training_session_attend(uuid, uuid[]) from public, anon;
grant  execute on function public.training_my_sessions(), public.training_session_attend(uuid, uuid[]) to authenticated;

commit;
