-- (keep) Portal 026 – Learning Hub: study log, reflections, leaves, skills and your tree
--
-- Run AFTER 025. Replaces the old Learning Hub page (Google Sheet + Formspree).
--   * TOPICS (26, each in one of 7 skills) and RESOURCE LINKS per topic.
--     The links themselves are added by a private setup file (some are Drive
--     links), or by an admin / supervisor / QCD on the page.
--   * STUDY LOG: a therapist logs a study session with a short reflection.
--   * LEAVES are earned automatically, here in the database (never by the page):
--       - each reflection box written properly (at least 15 characters) = 1 leaf
--         (max 5 per reflection; only the first 2 reflections a day earn leaves)
--       - a resource marked "done" with a one-line note = 1 leaf (max 3 a day)
--       - a supervisor / QCD / admin reviews the reflection = +5 leaves
--       - a supervisor / QCD / admin can give leaves for role-play, training…
--   * 10 leaves = 1 SKILL POINT, which the person puts into one of the 7 skills.
--     Everyone starts by placing 10 points themselves (a self-check).
--   * The SKILL WHEEL is private: only the person and supervisors / QCD / admin.
--   * The TREE (stage from total skill points, chosen look, background and,
--     at Forest Guardian, one animal) is seen by all CARE staff.
-- Stages: Seedling 10 · Sprout 20 · Sapling 30 · Tree 40 · Grove 60 · Forest Guardian 100.

begin;

-- 1. Topics and resource links -------------------------------------------------------------------
create table if not exists public.learning_topics (
  code       text primary key check (code ~ '^[A-Z]{1,3}-[0-9]{2}$'),
  title      text not null check (char_length(title) between 1 and 120),
  skill      text not null check (skill in ('measurement','skill_acq','behavior_red','ethics','modern_aba','school_shadow','safe_behavior')),
  sort_order integer not null default 0,
  active     boolean not null default true
);

insert into public.learning_topics (code, title, skill, sort_order) values
  ('A-01', 'Measurement: continuous methods', 'measurement', 10),
  ('A-02', 'Measurement: discontinuous methods', 'measurement', 20),
  ('A-05', 'Data display & graphs', 'measurement', 30),
  ('B-01', 'Observing & describing behavior', 'skill_acq', 40),
  ('C-01', 'Preparing & organizing materials', 'skill_acq', 50),
  ('D-01', 'DTT: discrete trial teaching', 'skill_acq', 60),
  ('D-02', 'NET: naturalistic environment', 'skill_acq', 70),
  ('D-03', 'Task analysis & chaining', 'skill_acq', 80),
  ('D-05', 'Prompting & prompt fading', 'skill_acq', 90),
  ('D-07', 'Shaping behavior', 'skill_acq', 100),
  ('D-08', 'Building rapport', 'skill_acq', 110),
  ('E-01', 'Reinforcement strategies', 'behavior_red', 120),
  ('E-02', 'Extinction procedures', 'behavior_red', 130),
  ('E-04', 'DRO / DRI / DRA', 'behavior_red', 140),
  ('F-01', 'BIP basics', 'behavior_red', 150),
  ('G-01', 'BT ethics & professional conduct', 'ethics', 160),
  ('H-01', 'Communication with supervisor', 'ethics', 170),
  ('M-01', 'Trauma-informed care in ABA', 'modern_aba', 180),
  ('M-02', 'Assent & client dignity', 'modern_aba', 190),
  ('M-03', 'Self-care & therapist wellbeing', 'modern_aba', 200),
  ('M-04', 'Co-regulation', 'modern_aba', 210),
  ('SS-01', 'Role of a school shadow', 'school_shadow', 220),
  ('SS-03', 'Collaboration with teachers & school staff', 'school_shadow', 230),
  ('SB-02', 'De-escalation strategies', 'safe_behavior', 240),
  ('SB-03', 'Safe physical management principles', 'safe_behavior', 250),
  ('SB-04', 'After incident protocol', 'safe_behavior', 260)
on conflict (code) do nothing;

create table if not exists public.learning_resources (
  id         uuid primary key default gen_random_uuid(),
  topic_code text not null references public.learning_topics (code) on update cascade on delete cascade,
  kind       text not null check (kind in ('book','podcast','video','bacb','quiz')),
  title      text not null check (char_length(title) between 1 and 160),
  url        text not null check (url ~ '^https://' and char_length(url) <= 500),
  sort_order integer not null default 0,
  created_by uuid references public.therapists (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists learning_resources_topic_idx on public.learning_resources (topic_code, sort_order);

-- 2. Study log (reflections) --------------------------------------------------------------------
create table if not exists public.learning_reflections (
  id           uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  topic_code   text references public.learning_topics (code) on update cascade on delete set null,
  studied_on   date not null,
  minutes      smallint not null check (minutes between 5 and 480),
  resources    text check (char_length(resources) <= 1000),
  studied      text check (char_length(studied) <= 2000),
  clicked      text check (char_length(clicked) <= 2000),
  question     text check (char_length(question) <= 2000),
  feeling      smallint check (feeling between 1 and 5),
  try_next     text check (char_length(try_next) <= 2000),
  leaves       smallint not null default 0,
  status       text not null default 'submitted' check (status in ('submitted','reviewed')),
  review_note  text check (char_length(review_note) <= 2000),
  reviewed_by  uuid references public.therapists (id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists learning_reflections_person_idx on public.learning_reflections (therapist_id, created_at desc);
create index if not exists learning_reflections_status_idx on public.learning_reflections (status, created_at);

-- Resources a person has finished (with their one-line note)
create table if not exists public.learning_resource_done (
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  resource_id  uuid not null references public.learning_resources (id) on delete cascade,
  note         text check (char_length(note) <= 500),
  leaves       smallint not null default 0,
  done_at      timestamptz not null default now(),
  primary key (therapist_id, resource_id)
);

-- 3. Leaves, skills and the tree ------------------------------------------------------------------
create table if not exists public.learning_leaves (
  id           uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  amount       smallint not null check (amount between 1 and 50),
  source       text not null check (source in ('reflection','review','material','bonus','import')),
  reason       text check (char_length(reason) <= 200),
  ref_id       uuid,
  given_by     uuid references public.therapists (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists learning_leaves_person_idx on public.learning_leaves (therapist_id, created_at desc);

create table if not exists public.learning_profiles (
  therapist_id uuid primary key references public.therapists (id) on delete cascade,
  started_at   timestamptz not null default now(),
  invested     integer not null default 0 check (invested >= 0),   -- skill points bought with leaves
  bg           smallint not null default 0 check (bg between 0 and 3),
  looks        smallint[] not null default '{0,0,0,0,0,0}' check (array_length(looks, 1) = 6),
  animal       smallint check (animal between 0 and 8)
);

create table if not exists public.learning_skills (
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  skill        text not null check (skill in ('measurement','skill_acq','behavior_red','ethics','modern_aba','school_shadow','safe_behavior')),
  points       smallint not null default 0 check (points between 0 and 99),
  primary key (therapist_id, skill)
);

-- 4. Privileges + rules ---------------------------------------------------------------------------------
alter table public.learning_topics        enable row level security;
alter table public.learning_resources     enable row level security;
alter table public.learning_reflections   enable row level security;
alter table public.learning_resource_done enable row level security;
alter table public.learning_leaves        enable row level security;
alter table public.learning_profiles      enable row level security;
alter table public.learning_skills        enable row level security;
revoke all on public.learning_topics, public.learning_resources, public.learning_reflections, public.learning_resource_done,
              public.learning_leaves, public.learning_profiles, public.learning_skills from anon, authenticated;
grant select on public.learning_topics, public.learning_resources, public.learning_reflections, public.learning_resource_done,
                public.learning_leaves, public.learning_profiles, public.learning_skills to authenticated;
grant insert, update, delete on public.learning_topics, public.learning_resources to authenticated;

-- Topics + links: all CARE staff read; admin edits topics; admin / supervisor / QCD edit links.
drop policy if exists "learning topics: staff read"  on public.learning_topics;
drop policy if exists "learning topics: admin write" on public.learning_topics;
create policy "learning topics: staff read" on public.learning_topics
  for select to authenticated using ((select private.is_care_staff()));
create policy "learning topics: admin write" on public.learning_topics
  for all to authenticated
  using ((select private.has_any_role(array['admin']::public.app_role[])))
  with check ((select private.has_any_role(array['admin']::public.app_role[])));

drop policy if exists "learning resources: staff read"  on public.learning_resources;
drop policy if exists "learning resources: team write"  on public.learning_resources;
create policy "learning resources: staff read" on public.learning_resources
  for select to authenticated using ((select private.is_care_staff()));
create policy "learning resources: team write" on public.learning_resources
  for all to authenticated
  using ((select private.is_assessor()))
  with check ((select private.is_assessor()));

-- Personal rows: the person themselves, or a supervisor / QCD / admin.
drop policy if exists "learning reflections: own or team read" on public.learning_reflections;
create policy "learning reflections: own or team read" on public.learning_reflections
  for select to authenticated using (therapist_id = (select private.current_therapist_id()) or (select private.is_assessor()));
drop policy if exists "learning done: own or team read" on public.learning_resource_done;
create policy "learning done: own or team read" on public.learning_resource_done
  for select to authenticated using (therapist_id = (select private.current_therapist_id()) or (select private.is_assessor()));
drop policy if exists "learning leaves: own or team read" on public.learning_leaves;
create policy "learning leaves: own or team read" on public.learning_leaves
  for select to authenticated using (therapist_id = (select private.current_therapist_id()) or (select private.is_assessor()));
drop policy if exists "learning skills: own or team read" on public.learning_skills;
create policy "learning skills: own or team read" on public.learning_skills
  for select to authenticated using (therapist_id = (select private.current_therapist_id()) or (select private.is_assessor()));
drop policy if exists "learning profiles: own or team read" on public.learning_profiles;
create policy "learning profiles: own or team read" on public.learning_profiles
  for select to authenticated using (therapist_id = (select private.current_therapist_id()) or (select private.is_assessor()));

-- 5. Helpers ---------------------------------------------------------------------------------------------
-- A box "counts" when it has at least 15 characters and isn't one letter repeated.
create or replace function private.learning_box_ok(p text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select char_length(btrim(coalesce(p, ''))) >= 15
     and (select count(distinct c) from regexp_split_to_table(lower(btrim(p)), '') as c) >= 5
$$;

create or replace function private.learning_today()
returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Bangkok')::date $$;

-- Totals for one person: skill points, leaves earned / spent / left.
create or replace function private.learning_totals(p_who uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'points',  coalesce((select sum(points) from public.learning_skills where therapist_id = p_who), 0),
    'earned',  coalesce((select sum(amount) from public.learning_leaves where therapist_id = p_who), 0),
    'spent',   coalesce((select invested * 10 from public.learning_profiles where therapist_id = p_who), 0),
    'balance', coalesce((select sum(amount) from public.learning_leaves where therapist_id = p_who), 0)
               - coalesce((select invested * 10 from public.learning_profiles where therapist_id = p_who), 0))
$$;

revoke execute on function private.learning_box_ok(text), private.learning_today(), private.learning_totals(uuid) from public, anon;
grant  execute on function private.learning_box_ok(text), private.learning_today(), private.learning_totals(uuid) to authenticated;

-- 6. Start: place your first 10 skill points (self-check) -------------------------------------------------
create or replace function public.learning_start(p_points jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_sum integer := 0;
  v_k text; v_v integer;
begin
  if v_me is null or not private.is_care_staff() then raise exception 'Only CARE staff can use the Learning Hub.'; end if;
  if exists (select 1 from public.learning_profiles where therapist_id = v_me) then raise exception 'Your tree is already planted.'; end if;
  for v_k, v_v in select key, value::integer from jsonb_each_text(coalesce(p_points, '{}')) loop
    if v_k not in ('measurement','skill_acq','behavior_red','ethics','modern_aba','school_shadow','safe_behavior') then raise exception 'Unknown skill.'; end if;
    if v_v < 0 or v_v > 4 then raise exception 'Put 0 to 4 points in each skill.'; end if;
    v_sum := v_sum + v_v;
  end loop;
  if v_sum <> 10 then raise exception 'Place exactly 10 points.'; end if;
  insert into public.learning_profiles (therapist_id) values (v_me);
  insert into public.learning_skills (therapist_id, skill, points)
  select v_me, s, coalesce((p_points ->> s)::integer, 0)
  from unnest(array['measurement','skill_acq','behavior_red','ethics','modern_aba','school_shadow','safe_behavior']) as s;
end $$;

-- 7. Log a study session ----------------------------------------------------------------------------------
create or replace function public.learning_log(p_topic text, p_studied_on date, p_minutes integer, p_resources text,
                                               p_studied text, p_clicked text, p_question text, p_feeling integer, p_try_next text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_today date := private.learning_today();
  v_n integer;
  v_leaves integer := 0;
  v_id uuid;
begin
  if v_me is null or not private.is_care_staff() then raise exception 'Only CARE staff can use the Learning Hub.'; end if;
  if p_studied_on is null or p_studied_on > v_today or p_studied_on < v_today - 14 then
    raise exception 'Choose the study date (today or within the last 2 weeks).';
  end if;
  if p_topic is not null and not exists (select 1 from public.learning_topics where code = p_topic) then raise exception 'Unknown topic.'; end if;
  if not private.learning_box_ok(p_studied) then raise exception 'Please write a little about what you studied.'; end if;

  -- leaves: 1 per box written properly, only for the first 2 logs of the day
  select count(*) into v_n from public.learning_reflections
   where therapist_id = v_me and (created_at at time zone 'Asia/Bangkok')::date = v_today and leaves > 0;
  if v_n < 2 then
    v_leaves := (case when private.learning_box_ok(p_resources) then 1 else 0 end)
              + (case when private.learning_box_ok(p_studied)   then 1 else 0 end)
              + (case when private.learning_box_ok(p_clicked)   then 1 else 0 end)
              + (case when private.learning_box_ok(p_question)  then 1 else 0 end)
              + (case when private.learning_box_ok(p_try_next)  then 1 else 0 end);
  end if;

  insert into public.learning_reflections (therapist_id, topic_code, studied_on, minutes, resources, studied, clicked, question, feeling, try_next, leaves)
  values (v_me, p_topic, p_studied_on, greatest(5, least(480, coalesce(p_minutes, 30))),
          nullif(btrim(coalesce(p_resources, '')), ''), btrim(p_studied), nullif(btrim(coalesce(p_clicked, '')), ''),
          nullif(btrim(coalesce(p_question, '')), ''), p_feeling, nullif(btrim(coalesce(p_try_next, '')), ''), v_leaves)
  returning id into v_id;
  if v_leaves > 0 then
    insert into public.learning_leaves (therapist_id, amount, source, reason, ref_id)
    values (v_me, v_leaves, 'reflection', 'Study reflection', v_id);
  end if;
  return jsonb_build_object('id', v_id, 'leaves', v_leaves, 'capped', v_n >= 2);
end $$;

-- 8. Mark a resource done (one-line note) ---------------------------------------------------------------------
create or replace function public.learning_done(p_resource uuid, p_note text)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_n integer;
  v_leaves integer := 0;
begin
  if v_me is null or not private.is_care_staff() then raise exception 'Only CARE staff can use the Learning Hub.'; end if;
  if not exists (select 1 from public.learning_resources where id = p_resource) then raise exception 'Resource not found.'; end if;
  if exists (select 1 from public.learning_resource_done where therapist_id = v_me and resource_id = p_resource) then
    raise exception 'You''ve already finished this one.';
  end if;
  if not private.learning_box_ok(p_note) then raise exception 'Write one line about what you learned (at least 15 characters).'; end if;
  select count(*) into v_n from public.learning_resource_done
   where therapist_id = v_me and (done_at at time zone 'Asia/Bangkok')::date = private.learning_today() and leaves > 0;
  if v_n < 3 then v_leaves := 1; end if;
  insert into public.learning_resource_done (therapist_id, resource_id, note, leaves) values (v_me, p_resource, btrim(p_note), v_leaves);
  if v_leaves > 0 then
    insert into public.learning_leaves (therapist_id, amount, source, reason, ref_id)
    values (v_me, 1, 'material', 'Finished a resource', p_resource);
  end if;
  return v_leaves;
end $$;

-- 9. Supervisor / QCD / admin: review a reflection (+5 leaves), give leaves ------------------------------------
create or replace function public.learning_review(p_reflection uuid, p_note text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_r public.learning_reflections;
begin
  if not private.is_assessor() then raise exception 'Only a supervisor, QCD or admin can review reflections.'; end if;
  select * into v_r from public.learning_reflections where id = p_reflection;
  if not found then raise exception 'Reflection not found.'; end if;
  if v_r.therapist_id = v_me then raise exception 'Ask another supervisor to review your own reflection.'; end if;
  if v_r.status = 'reviewed' then
    update public.learning_reflections set review_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_reflection;
    return;
  end if;
  update public.learning_reflections
     set status = 'reviewed', review_note = nullif(btrim(coalesce(p_note, '')), ''), reviewed_by = v_me, reviewed_at = now()
   where id = p_reflection;
  insert into public.learning_leaves (therapist_id, amount, source, reason, ref_id, given_by)
  values (v_r.therapist_id, 5, 'review', 'Reflection reviewed', p_reflection, v_me);
end $$;

create or replace function public.learning_give(p_therapist uuid, p_amount integer, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
begin
  if not private.is_assessor() then raise exception 'Only a supervisor, QCD or admin can give leaves.'; end if;
  if p_therapist = v_me then raise exception 'You can''t give leaves to yourself.'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 20 then raise exception 'Give 1 to 20 leaves.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say what the leaves are for (e.g. role-play session).'; end if;
  if not exists (select 1 from public.therapists t where t.id = p_therapist and t.status <> 'exited' and t.track = 'care_hire') then
    raise exception 'Person not found.';
  end if;
  insert into public.learning_leaves (therapist_id, amount, source, reason, given_by)
  values (p_therapist, p_amount, 'bonus', left(btrim(p_reason), 200), v_me);
end $$;

-- 10. Spend 10 leaves for 1 skill point ---------------------------------------------------------------------------
create or replace function public.learning_invest(p_skill text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
begin
  if v_me is null or not exists (select 1 from public.learning_profiles where therapist_id = v_me) then raise exception 'Plant your tree first.'; end if;
  if p_skill not in ('measurement','skill_acq','behavior_red','ethics','modern_aba','school_shadow','safe_behavior') then raise exception 'Unknown skill.'; end if;
  perform 1 from public.learning_profiles where therapist_id = v_me for update;
  if (private.learning_totals(v_me) ->> 'balance')::integer < 10 then raise exception 'You need 10 leaves for a skill point.'; end if;
  update public.learning_profiles set invested = invested + 1 where therapist_id = v_me;
  update public.learning_skills set points = least(99, points + 1) where therapist_id = v_me and skill = p_skill;
end $$;

-- 11. Choose how your tree looks ----------------------------------------------------------------------------------
create or replace function public.learning_set_look(p_bg integer, p_looks integer[], p_animal integer)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_max integer[] := array[2,2,3,3,3,3];   -- looks per stage
  i integer;
begin
  if v_me is null or not exists (select 1 from public.learning_profiles where therapist_id = v_me) then raise exception 'Plant your tree first.'; end if;
  if p_bg is null or p_bg < 0 or p_bg > 3 then raise exception 'Choose a background.'; end if;
  if array_length(p_looks, 1) is distinct from 6 then raise exception 'Choose a look for each stage.'; end if;
  for i in 1..6 loop
    if p_looks[i] is null or p_looks[i] < 0 or p_looks[i] >= v_max[i] then raise exception 'Unknown tree look.'; end if;
  end loop;
  if p_animal is not null then
    if p_animal < 0 or p_animal > 8 then raise exception 'Unknown animal.'; end if;
    if (private.learning_totals(v_me) ->> 'points')::integer < 100 then raise exception 'Animals join at Forest Guardian (100 skill points).'; end if;
  end if;
  update public.learning_profiles set bg = p_bg, looks = p_looks::smallint[], animal = p_animal where therapist_id = v_me;
end $$;

-- 12. Read: my hub, one person (team), the team overview, everyone's trees -----------------------------------------
create or replace function public.learning_summary(p_who uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_who uuid := coalesce(p_who, v_me);
  v_p public.learning_profiles;
begin
  if v_who <> v_me and not private.is_assessor() then raise exception 'Not allowed.'; end if;
  select * into v_p from public.learning_profiles where therapist_id = v_who;
  return private.learning_totals(v_who) || jsonb_build_object(
    'started', v_p.therapist_id is not null,
    'bg', v_p.bg, 'looks', to_jsonb(v_p.looks), 'animal', v_p.animal,
    'skills', coalesce((select jsonb_object_agg(skill, points) from public.learning_skills where therapist_id = v_who), '{}'::jsonb),
    'logs_today', (select count(*) from public.learning_reflections where therapist_id = v_who
                    and (created_at at time zone 'Asia/Bangkok')::date = private.learning_today() and leaves > 0),
    'done_today', (select count(*) from public.learning_resource_done where therapist_id = v_who
                    and (done_at at time zone 'Asia/Bangkok')::date = private.learning_today() and leaves > 0));
end $$;

create or replace function public.learning_team()
returns table (id uuid, full_name text, nickname text, points integer, balance integer, started boolean,
               logs integer, to_review integer, last_study date)
language sql stable security definer
set search_path = ''
as $$
  select t.id, t.full_name, t.nickname,
         ((private.learning_totals(t.id)) ->> 'points')::integer,
         ((private.learning_totals(t.id)) ->> 'balance')::integer,
         exists (select 1 from public.learning_profiles p where p.therapist_id = t.id),
         (select count(*)::integer from public.learning_reflections r where r.therapist_id = t.id),
         (select count(*)::integer from public.learning_reflections r where r.therapist_id = t.id and r.status = 'submitted'),
         (select max(studied_on) from public.learning_reflections r where r.therapist_id = t.id)
  from public.therapists t
  where private.is_assessor()
    and t.status <> 'exited' and t.track = 'care_hire'
    and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')
  order by coalesce(t.nickname, t.full_name)
$$;

-- Trees for Our Team: stage comes from total skill points (no skill detail).
create or replace function public.learning_trees()
returns table (id uuid, points integer, bg smallint, looks smallint[], animal smallint)
language sql stable security definer
set search_path = ''
as $$
  select p.therapist_id, coalesce((select sum(s.points)::integer from public.learning_skills s where s.therapist_id = p.therapist_id), 0),
         p.bg, p.looks, p.animal
  from public.learning_profiles p
  join public.therapists t on t.id = p.therapist_id and t.status <> 'exited'
  where private.is_care_staff()
$$;

revoke execute on function public.learning_start(jsonb),
                           public.learning_log(text, date, integer, text, text, text, text, integer, text),
                           public.learning_done(uuid, text), public.learning_review(uuid, text),
                           public.learning_give(uuid, integer, text), public.learning_invest(text),
                           public.learning_set_look(integer, integer[], integer), public.learning_summary(uuid),
                           public.learning_team(), public.learning_trees() from public, anon;
grant  execute on function public.learning_start(jsonb),
                           public.learning_log(text, date, integer, text, text, text, text, integer, text),
                           public.learning_done(uuid, text), public.learning_review(uuid, text),
                           public.learning_give(uuid, integer, text), public.learning_invest(text),
                           public.learning_set_look(integer, integer[], integer), public.learning_summary(uuid),
                           public.learning_team(), public.learning_trees() to authenticated;

-- 13. Switch the tab on for CARE staff ------------------------------------------------------------------------------
update public.app_modules
   set enabled = true,
       roles = array['admin','hr','supervisor','qcd','senior','therapist']::public.app_role[],
       description = 'Study topics, resources and your reflection log. Grow your tree as you learn.'
 where key = 'learning';

commit;
