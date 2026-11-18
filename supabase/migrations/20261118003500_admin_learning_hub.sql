-- (keep) Portal 035 – Learning Hub for the admin team: admin skills + flower field
--
-- Run AFTER 034. Office-only staff (Admin / HR / Portal manager with no therapist
-- rank) get their own Learning Hub:
--   * 7 ADMIN SKILLS (their own topics and links) instead of the clinical ones.
--   * A FLOWER FIELD instead of a tree. Same points and stages (10 / 20 / 30 / 40 /
--     60 / 100); the higher the stage, the more flowers, and the more kinds of
--     flower they can mix (2 → 6 of 10). One animal joins at 100 points.
--   * Leaves for HELPING therapists, automatically (+1 each, at most 3 a day):
--     replying to a CARE Connect message sent to Admin, answering a leave request.
--   * The PORTAL MANAGER reviews admin reflections, gives admin staff leaves (e.g.
--     for help outside the Portal) and manages the admin topics and links.
-- Therapists' hub is unchanged. Someone who already planted a tree keeps it.

begin;

-- 1. Who is office-only -------------------------------------------------------------------------------
create or replace function private.is_office_only(p_who uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff_roles where therapist_id = p_who and role in ('admin','hr','manager'))
     and not exists (select 1 from public.staff_roles where therapist_id = p_who
                      and role in ('applicant','therapist','senior','qcd','supervisor'))
$$;
revoke execute on function private.is_office_only(uuid) from public, anon;
grant  execute on function private.is_office_only(uuid) to authenticated;

create or replace function private.learning_skill_keys(p_hub text)
returns text[]
language sql immutable
set search_path = ''
as $$
  select case when p_hub = 'admin'
    then array['adm_schedule','adm_family','adm_records','adm_finance','adm_team','adm_tools','adm_profession']
    else array['measurement','skill_acq','behavior_red','ethics','modern_aba','school_shadow','safe_behavior'] end
$$;
revoke execute on function private.learning_skill_keys(text) from public, anon;
grant  execute on function private.learning_skill_keys(text) to authenticated;

-- 2. Admin skills are allowed on topics and skill rows ----------------------------------------------------
alter table public.learning_topics drop constraint if exists learning_topics_skill_check;
alter table public.learning_topics add constraint learning_topics_skill_check check (skill in (
  'measurement','skill_acq','behavior_red','ethics','modern_aba','school_shadow','safe_behavior',
  'adm_schedule','adm_family','adm_records','adm_finance','adm_team','adm_tools','adm_profession'));
alter table public.learning_skills drop constraint if exists learning_skills_skill_check;
alter table public.learning_skills add constraint learning_skills_skill_check check (skill in (
  'measurement','skill_acq','behavior_red','ethics','modern_aba','school_shadow','safe_behavior',
  'adm_schedule','adm_family','adm_records','adm_finance','adm_team','adm_tools','adm_profession'));

-- 3. Which hub a person is on + their flowers ------------------------------------------------------------
alter table public.learning_profiles
  add column if not exists hub text not null default 'clinical' check (hub in ('clinical','admin')),
  add column if not exists flowers smallint[] not null default '{0,2}'
    check (cardinality(flowers) between 1 and 6 and 0 <= all (flowers) and 9 >= all (flowers));

-- 4. "Helping" leaves -----------------------------------------------------------------------------------
alter table public.learning_leaves drop constraint if exists learning_leaves_source_check;
alter table public.learning_leaves add constraint learning_leaves_source_check
  check (source in ('reflection','review','material','bonus','import','safmeds','helping'));

-- One leaf for helping, for office-only staff: once per message / request, at most 3 a day.
create or replace function private.learning_helping(p_who uuid, p_reason text, p_ref uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_who is null or not private.is_office_only(p_who) then return; end if;
  if exists (select 1 from public.learning_leaves where therapist_id = p_who and source = 'helping' and ref_id = p_ref) then return; end if;
  if (select count(*) from public.learning_leaves where therapist_id = p_who and source = 'helping'
        and (created_at at time zone 'Asia/Bangkok')::date = private.learning_today()) >= 3 then return; end if;
  insert into public.learning_leaves (therapist_id, amount, source, reason, ref_id) values (p_who, 1, 'helping', p_reason, p_ref);
exception when others then
  null;   -- a leaf must never stop the real work
end $$;
revoke execute on function private.learning_helping(uuid, text, uuid) from public, anon, authenticated;

create or replace function private.learning_helping_connect()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.author_kind = 'team' and not new.internal and new.author_id is not null
     and exists (select 1 from public.connect_messages m where m.id = new.message_id
                  and (m.send_to in ('admin','both') or m.forwarded_at is not null)) then
    perform private.learning_helping(new.author_id, 'Replied to a CARE Connect message', new.message_id);
  end if;
  return null;
end $$;
drop trigger if exists learning_helping on public.connect_replies;
create trigger learning_helping after insert on public.connect_replies
  for each row execute function private.learning_helping_connect();

create or replace function private.learning_helping_leave()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status in ('approved','declined') and new.decided_by is not null then
    perform private.learning_helping(new.decided_by, 'Answered a leave request', new.id);
  end if;
  return null;
end $$;
drop trigger if exists learning_helping on public.leave_requests;
create trigger learning_helping after update of status on public.leave_requests
  for each row execute function private.learning_helping_leave();
revoke execute on function private.learning_helping_connect(), private.learning_helping_leave() from public, anon, authenticated;

-- 5. Admin topics + links: only the Portal manager edits them ---------------------------------------------
create or replace function private.learning_topic_editable(p_code text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select skill not like 'adm\_%' from public.learning_topics where code = p_code), true)
      or private.has_exact_role(array['manager']::public.app_role[])
$$;
revoke execute on function private.learning_topic_editable(text) from public, anon;
grant  execute on function private.learning_topic_editable(text) to authenticated;

drop policy if exists "learning topics: team write" on public.learning_topics;
create policy "learning topics: team write" on public.learning_topics
  for all to authenticated
  using ((select private.is_assessor()) and (skill not like 'adm\_%' or (select private.has_exact_role(array['manager']::public.app_role[]))))
  with check ((select private.is_assessor()) and (skill not like 'adm\_%' or (select private.has_exact_role(array['manager']::public.app_role[]))));

drop policy if exists "learning resources: team write" on public.learning_resources;
create policy "learning resources: team write" on public.learning_resources
  for all to authenticated
  using ((select private.is_assessor()) and private.learning_topic_editable(topic_code))
  with check ((select private.is_assessor()) and private.learning_topic_editable(topic_code));

-- 6. Start, invest, flowers -------------------------------------------------------------------------------
create or replace function public.learning_start(p_points jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_hub text;
  v_keys text[];
  v_sum integer := 0;
  v_k text; v_v integer;
begin
  if v_me is null or not private.is_care_staff() then raise exception 'Only CARE staff can use the Learning Hub.'; end if;
  if exists (select 1 from public.learning_profiles where therapist_id = v_me) then raise exception 'You have already started.'; end if;
  v_hub := case when private.is_office_only(v_me) then 'admin' else 'clinical' end;
  v_keys := private.learning_skill_keys(v_hub);
  for v_k, v_v in select key, value::integer from jsonb_each_text(coalesce(p_points, '{}')) loop
    if not (v_k = any (v_keys)) then raise exception 'Unknown skill.'; end if;
    if v_v < 0 or v_v > 4 then raise exception 'Put 0 to 4 points in each skill.'; end if;
    v_sum := v_sum + v_v;
  end loop;
  if v_sum <> 10 then raise exception 'Place exactly 10 points.'; end if;
  insert into public.learning_profiles (therapist_id, hub) values (v_me, v_hub);
  insert into public.learning_skills (therapist_id, skill, points)
  select v_me, s, coalesce((p_points ->> s)::integer, 0) from unnest(v_keys) as s;
end $$;

create or replace function public.learning_invest(p_skill text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_hub text;
begin
  select hub into v_hub from public.learning_profiles where therapist_id = v_me for update;
  if v_me is null or v_hub is null then raise exception 'Start your Learning Hub first.'; end if;
  if not (p_skill = any (private.learning_skill_keys(v_hub))) then raise exception 'Unknown skill.'; end if;
  if (private.learning_totals(v_me) ->> 'balance')::integer < 10 then raise exception 'You need 10 leaves for a skill point.'; end if;
  update public.learning_profiles set invested = invested + 1 where therapist_id = v_me;
  update public.learning_skills set points = least(99, points + 1) where therapist_id = v_me and skill = p_skill;
end $$;

-- Flower field look: background, the kinds of flower to mix (more kinds as it grows), animal at 100.
create or replace function public.learning_set_garden(p_bg integer, p_flowers integer[], p_animal integer)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_pts integer;
  v_kinds integer;
  v_n integer := coalesce(cardinality(p_flowers), 0);
begin
  if v_me is null or not exists (select 1 from public.learning_profiles where therapist_id = v_me and hub = 'admin') then
    raise exception 'Start your flower field first.';
  end if;
  v_pts := (private.learning_totals(v_me) ->> 'points')::integer;
  v_kinds := case when v_pts >= 60 then 6 when v_pts >= 40 then 5 when v_pts >= 30 then 4 when v_pts >= 20 then 3 else 2 end;
  if p_bg is null or p_bg < 0 or p_bg > 3 then raise exception 'Choose a background.'; end if;
  if v_n < 1 then raise exception 'Choose at least one flower.'; end if;
  if v_n > v_kinds then raise exception 'You can mix up to % kinds of flower now.', v_kinds; end if;
  if exists (select 1 from unnest(p_flowers) f where f is null or f < 0 or f > 9) then raise exception 'Unknown flower.'; end if;
  if (select count(distinct f) from unnest(p_flowers) f) <> v_n then raise exception 'Choose each flower once.'; end if;
  if p_animal is not null then
    if p_animal < 0 or p_animal > 8 then raise exception 'Unknown animal.'; end if;
    if v_pts < 100 then raise exception 'Animals join at Flower Field Keeper (100 skill points).'; end if;
  end if;
  update public.learning_profiles set bg = p_bg, flowers = p_flowers::smallint[], animal = p_animal where therapist_id = v_me;
end $$;

-- 7. Reviews and gifts: the Portal manager looks after the admin team ---------------------------------------
create or replace function public.learning_review(p_reflection uuid, p_note text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_r public.learning_reflections;
begin
  select * into v_r from public.learning_reflections where id = p_reflection;
  if not found then raise exception 'Reflection not found.'; end if;
  if private.is_office_only(v_r.therapist_id) then
    if not private.has_exact_role(array['manager']::public.app_role[]) then raise exception 'The Portal manager reviews the admin team''s reflections.'; end if;
  elsif not private.is_assessor() then raise exception 'Only a supervisor, QCD or admin can review reflections.';
  end if;
  if v_r.therapist_id = v_me then raise exception 'Ask someone else to review your own reflection.'; end if;
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
  if private.is_office_only(p_therapist) then
    if not private.has_exact_role(array['manager']::public.app_role[]) then raise exception 'The Portal manager gives leaves to the admin team.'; end if;
  elsif not private.is_assessor() then raise exception 'Only a supervisor, QCD or admin can give leaves.';
  end if;
  if p_therapist = v_me then raise exception 'You can''t give leaves to yourself.'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 20 then raise exception 'Give 1 to 20 leaves.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say what the leaves are for (e.g. helping at an event).'; end if;
  if not exists (select 1 from public.therapists t where t.id = p_therapist and t.status <> 'exited' and t.track = 'care_hire') then
    raise exception 'Person not found.';
  end if;
  insert into public.learning_leaves (therapist_id, amount, source, reason, given_by)
  values (p_therapist, p_amount, 'bonus', left(btrim(p_reason), 200), v_me);
end $$;

-- 8. Reads now say which hub (and the flowers) ---------------------------------------------------------------
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
    'hub', coalesce(v_p.hub, case when private.is_office_only(v_who) then 'admin' else 'clinical' end),
    'bg', v_p.bg, 'looks', to_jsonb(v_p.looks), 'animal', v_p.animal, 'flowers', to_jsonb(v_p.flowers),
    'skills', coalesce((select jsonb_object_agg(skill, points) from public.learning_skills where therapist_id = v_who), '{}'::jsonb),
    'logs_today', (select count(*) from public.learning_reflections where therapist_id = v_who
                    and (created_at at time zone 'Asia/Bangkok')::date = private.learning_today() and leaves > 0),
    'done_today', (select count(*) from public.learning_resource_done where therapist_id = v_who
                    and (done_at at time zone 'Asia/Bangkok')::date = private.learning_today() and leaves > 0),
    'helping_today', (select count(*) from public.learning_leaves where therapist_id = v_who and source = 'helping'
                    and (created_at at time zone 'Asia/Bangkok')::date = private.learning_today()));
end $$;

-- Team list: the admin team is listed only for the Portal manager.
drop function if exists public.learning_team();
create function public.learning_team()
returns table (id uuid, full_name text, nickname text, points integer, balance integer, started boolean,
               logs integer, to_review integer, last_study date, hub text)
language sql stable security definer
set search_path = ''
as $$
  select t.id, t.full_name, t.nickname,
         ((private.learning_totals(t.id)) ->> 'points')::integer,
         ((private.learning_totals(t.id)) ->> 'balance')::integer,
         exists (select 1 from public.learning_profiles p where p.therapist_id = t.id),
         (select count(*)::integer from public.learning_reflections r where r.therapist_id = t.id),
         (select count(*)::integer from public.learning_reflections r where r.therapist_id = t.id and r.status = 'submitted'),
         (select max(studied_on) from public.learning_reflections r where r.therapist_id = t.id),
         case when private.is_office_only(t.id) then 'admin' else 'clinical' end
  from public.therapists t
  where private.is_assessor()
    and t.status <> 'exited' and t.track = 'care_hire'
    and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')
    and (not private.is_office_only(t.id) or private.has_exact_role(array['manager']::public.app_role[]))
  order by coalesce(t.nickname, t.full_name)
$$;

drop function if exists public.learning_trees();
create function public.learning_trees()
returns table (id uuid, points integer, bg smallint, looks smallint[], animal smallint, hub text, flowers smallint[])
language sql stable security definer
set search_path = ''
as $$
  select p.therapist_id, coalesce((select sum(s.points)::integer from public.learning_skills s where s.therapist_id = p.therapist_id), 0),
         p.bg, p.looks, p.animal, p.hub, p.flowers
  from public.learning_profiles p
  join public.therapists t on t.id = p.therapist_id and t.status <> 'exited'
  where private.is_care_staff()
$$;

revoke execute on function public.learning_start(jsonb), public.learning_invest(text),
                           public.learning_set_garden(integer, integer[], integer),
                           public.learning_review(uuid, text), public.learning_give(uuid, integer, text),
                           public.learning_summary(uuid), public.learning_team(), public.learning_trees() from public, anon;
grant  execute on function public.learning_start(jsonb), public.learning_invest(text),
                           public.learning_set_garden(integer, integer[], integer),
                           public.learning_review(uuid, text), public.learning_give(uuid, integer, text),
                           public.learning_summary(uuid), public.learning_team(), public.learning_trees() to authenticated;

-- 9. Starter admin topics (the Portal manager can rename, move, add or hide them) ---------------------------------
insert into public.learning_topics (code, title, skill, sort_order, description) values
  ('AS-01', 'Session scheduling & changes',            'adm_schedule',   10, 'Booking sessions, moving them and keeping everyone told.'),
  ('AS-02', 'Cover & cancellations',                   'adm_schedule',   20, 'Finding cover, cancelling kindly and on time.'),
  ('AS-03', 'Calendars & reminders',                   'adm_schedule',   30, 'Shared calendars and reminders that keep the week running.'),
  ('AF-01', 'First contact & intake calls',            'adm_family',     10, 'The first call or message with a new family.'),
  ('AF-02', 'Difficult conversations & complaints',    'adm_family',     20, 'Staying calm, listening and following up.'),
  ('AF-03', 'Writing clear messages (Thai / English)', 'adm_family',     30, 'Short, warm, clear messages to families.'),
  ('AR-01', 'Thailand PDPA basics',                    'adm_records',    10, 'What personal data law asks of us day to day.'),
  ('AR-02', 'Filing & document control',               'adm_records',    20, 'Where things live, naming, versions.'),
  ('AR-03', 'Sharing safely (case codes only)',        'adm_records',    30, 'Never a child''s name outside their file; use case codes.'),
  ('AB-01', 'Invoices & receipts',                     'adm_finance',    10, 'Making and checking invoices and receipts.'),
  ('AB-02', 'Following up payments',                   'adm_finance',    20, 'Friendly, firm reminders.'),
  ('AB-03', 'Petty cash & expenses',                   'adm_finance',    30, 'Recording small spending properly.'),
  ('AH-01', 'Onboarding new staff',                    'adm_team',       10, 'Welcoming new people and getting them set up.'),
  ('AH-02', 'Leave & attendance',                      'adm_team',       20, 'Leave requests, allowances and records.'),
  ('AH-03', 'Supporting therapists'' requests',        'adm_team',       30, 'Answering CARE Connect messages and everyday asks.'),
  ('AT-01', 'Portal admin tasks',                      'adm_tools',      10, 'People, sign-in links, exports and approvals in the Portal.'),
  ('AT-02', 'Google Workspace (Sheets, Calendar, Drive)', 'adm_tools',   20, 'Everyday Google tools.'),
  ('AT-03', 'Slack',                                   'adm_tools',      30, 'Channels, threads and notifications.'),
  ('AP-01', 'Confidentiality at the front desk',       'adm_profession', 10, 'What can be said where, and to whom.'),
  ('AP-02', 'Customer service mindset',                'adm_profession', 20, 'Helpful, kind and consistent service.'),
  ('AP-03', 'Time & task management',                  'adm_profession', 30, 'Planning the day and keeping track of tasks.')
on conflict (code) do nothing;

insert into public.learning_resources (topic_code, kind, title, url, sort_order)
select v.code, 'book', v.title, v.url, v.o
from (values
  ('AS-03', 'Google Calendar training and help', 'https://support.google.com/a/users/answer/9247501', 10),
  ('AR-01', 'PDPC Thailand (Personal Data Protection Committee)', 'https://www.pdpc.or.th', 10),
  ('AT-02', 'Google Sheets training and help', 'https://support.google.com/a/users/answer/9282959', 10),
  ('AT-02', 'Google Sheets cheat sheet', 'https://support.google.com/a/users/answer/9300022', 20),
  ('AT-02', 'Google Drive training and help', 'https://support.google.com/a/users/answer/9282958', 30),
  ('AT-02', 'Gmail training and help', 'https://support.google.com/a/users/answer/9259748', 40),
  ('AT-03', 'How to use Slack: quick start guide', 'https://slack.com/help/articles/360059928654', 10)
) as v(code, title, url, o)
where not exists (select 1 from public.learning_resources r where r.topic_code = v.code and r.url = v.url);

commit;
