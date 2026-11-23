-- (keep) Portal 064 – Learning Hub for supervisors: 9 supervisor skills
--
-- Run AFTER 063. Supervisors get their own self-reflection skill wheel with the 9 areas of
-- the supervisor evaluation (they keep a tree, the same stages, and still study the
-- therapist topics):
--   Professionalism & Ethics · Assessment & Treatment Planning · Behavior Assessment &
--   Intervention · Program Implementation · Therapist Coaching · Caregiver Collaboration ·
--   Data & Documentation · Case Management & Leadership · Administration & Compliance
-- Supervisors who already placed points on the old 7 skills get them BACK to place again
-- ("points to place again"). Their total, their tree and their leaves stay the same, and
-- placing those points again costs no leaves.
-- Someone who becomes a supervisor later is moved over the same way, automatically.
-- Safe to run again.

begin;

-- 1. The supervisor skills are allowed -----------------------------------------------------------------
alter table public.learning_skills drop constraint if exists learning_skills_skill_check;
alter table public.learning_skills add constraint learning_skills_skill_check check (skill in (
  'measurement','skill_acq','behavior_red','ethics','modern_aba','school_shadow','safe_behavior',
  'adm_schedule','adm_family','adm_records','adm_finance','adm_team','adm_tools','adm_profession',
  'sup_prof','sup_assess','sup_behavior','sup_impl','sup_coach','sup_caregiver','sup_data','sup_lead','sup_admin'));
alter table public.learning_profiles drop constraint if exists learning_profiles_hub_check;
alter table public.learning_profiles add constraint learning_profiles_hub_check check (hub in ('clinical','admin','supervisor'));
alter table public.learning_profiles add column if not exists unplaced integer not null default 0 check (unplaced >= 0);

create or replace function private.learning_skill_keys(p_hub text)
returns text[]
language sql immutable
set search_path = ''
as $$
  select case p_hub
    when 'admin' then array['adm_schedule','adm_family','adm_records','adm_finance','adm_team','adm_tools','adm_profession']
    when 'supervisor' then array['sup_prof','sup_assess','sup_behavior','sup_impl','sup_coach','sup_caregiver','sup_data','sup_lead','sup_admin']
    else array['measurement','skill_acq','behavior_red','ethics','modern_aba','school_shadow','safe_behavior'] end
$$;

-- Which hub a person belongs on.
create or replace function private.learning_hub_for(p_who uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select case when private.is_office_only(p_who) then 'admin'
              when exists (select 1 from public.staff_roles where therapist_id = p_who and role = 'supervisor') then 'supervisor'
              else 'clinical' end
$$;
revoke execute on function private.learning_hub_for(uuid) from public, anon;
grant  execute on function private.learning_hub_for(uuid) to authenticated;

-- 2. Points: placed skills + points waiting to be placed again --------------------------------------------
create or replace function private.learning_totals(p_who uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'points',  coalesce((select sum(points) from public.learning_skills where therapist_id = p_who), 0)
             + coalesce((select unplaced from public.learning_profiles where therapist_id = p_who), 0),
    'unplaced', coalesce((select unplaced from public.learning_profiles where therapist_id = p_who), 0),
    'earned',  coalesce((select sum(amount) from public.learning_leaves where therapist_id = p_who), 0),
    'spent',   coalesce((select invested * 10 from public.learning_profiles where therapist_id = p_who), 0),
    'balance', coalesce((select sum(amount) from public.learning_leaves where therapist_id = p_who), 0)
               - coalesce((select invested * 10 from public.learning_profiles where therapist_id = p_who), 0))
$$;

-- 3. Move one person onto the supervisor wheel (their placed points come back to place again) -----------
create or replace function private.learning_to_supervisor(p_who uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_hub text;
begin
  select hub into v_hub from public.learning_profiles where therapist_id = p_who for update;
  if v_hub is null or v_hub = 'supervisor' or private.learning_hub_for(p_who) <> 'supervisor' then return; end if;
  update public.learning_profiles
     set unplaced = unplaced + coalesce((select sum(points) from public.learning_skills where therapist_id = p_who), 0),
         hub = 'supervisor'
   where therapist_id = p_who;
  delete from public.learning_skills where therapist_id = p_who;
  insert into public.learning_skills (therapist_id, skill, points)
  select p_who, s, 0 from unnest(private.learning_skill_keys('supervisor')) as s
  on conflict do nothing;
end $$;
revoke execute on function private.learning_to_supervisor(uuid) from public, anon, authenticated;

create or replace function private.learning_role_added()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.role = 'supervisor' then perform private.learning_to_supervisor(new.therapist_id); end if;
  return null;
end $$;
revoke execute on function private.learning_role_added() from public, anon, authenticated;
drop trigger if exists learning_role_added on public.staff_roles;
create trigger learning_role_added after insert on public.staff_roles
  for each row execute function private.learning_role_added();

-- Everyone who is a supervisor today.
select private.learning_to_supervisor(p.therapist_id) from public.learning_profiles p
where p.hub <> 'supervisor';

-- 4. Start: supervisors start on their own wheel --------------------------------------------------------
create or replace function public.learning_start(p_points jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_hub text;
  v_keys text[];
begin
  if v_me is null or not private.is_care_staff() then raise exception 'Only CARE staff can use the Learning Hub.'; end if;
  if exists (select 1 from public.learning_profiles where therapist_id = v_me) then raise exception 'You have already started.'; end if;
  v_hub := private.learning_hub_for(v_me);
  v_keys := private.learning_skill_keys(v_hub);
  insert into public.learning_profiles (therapist_id, hub) values (v_me, v_hub);
  insert into public.learning_skills (therapist_id, skill, points) select v_me, s, 0 from unnest(v_keys) as s;
  insert into public.learning_leaves (therapist_id, amount, source, reason)
  values (v_me, 100, 'bonus', 'Welcome: 10 starter skill points');
  perform private.learning_give_experience(v_me);   -- promotion + years leaves
end $$;

-- 5. Save the whole wheel: points to place again are used first (free), then new points (10 leaves each).
create or replace function public.learning_set_wheel(p_points jsonb)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_hub text;
  v_unpl integer;
  v_keys text[];
  v_now integer;
  v_new integer := 0;
  v_can integer;
  v_from integer;
  v_paid integer;
  v_k text; v_v integer;
begin
  select hub, unplaced into v_hub, v_unpl from public.learning_profiles where therapist_id = v_me for update;
  if v_me is null or v_hub is null then raise exception 'Start your Learning Hub first.'; end if;
  v_keys := private.learning_skill_keys(v_hub);
  for v_k, v_v in select key, value::integer from jsonb_each_text(coalesce(p_points, '{}')) loop
    if not (v_k = any (v_keys)) then raise exception 'Unknown skill.'; end if;
    if v_v < 0 or v_v > 99 then raise exception 'Each skill can have 0 to 99 points.'; end if;
    v_new := v_new + v_v;
  end loop;
  select coalesce(sum(points), 0) into v_now from public.learning_skills where therapist_id = v_me;
  v_can := floor((private.learning_totals(v_me) ->> 'balance')::numeric / 10)::integer;
  if v_new < v_now then raise exception 'Place all your points (at least % in total). Your tree never shrinks.', v_now; end if;
  v_from := least(v_unpl, v_new - v_now);
  v_paid := (v_new - v_now) - v_from;
  if v_paid > v_can then raise exception 'You have % skill point(s) left to use.', v_can + v_unpl; end if;
  update public.learning_profiles set invested = invested + v_paid, unplaced = unplaced - v_from where therapist_id = v_me;
  update public.learning_skills s
     set points = coalesce((p_points ->> s.skill)::integer, 0)
   where s.therapist_id = v_me and s.skill = any (v_keys);
  return v_paid;   -- new points bought with leaves
end $$;

commit;
