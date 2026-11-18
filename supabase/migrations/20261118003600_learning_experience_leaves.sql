-- (keep) Portal 036 – Learning Hub: experience leaves by rank
--
-- Run AFTER 035. People who have already learned a lot in their role start
-- further along. After the 10-point self-check, each person gets a one-time
-- bundle of "experience" leaves for their clinical rank, to put into the skills
-- they choose (so the self-reflection wheel stays their own picture):
--   Therapist 0 · Senior 100 · QCD 200 · Supervisor 300   (10 leaves = 1 skill point)
-- People who already planted get theirs when this is run. A promotion later tops
-- it up to the new rank automatically (e.g. Senior → QCD: +100). Never taken back.
-- The admin team (no clinical rank) gets none for now. Decided only in the database.

begin;

-- 1. A new kind of leaf, and room for a bundle bigger than 50 -------------------------------------------
alter table public.learning_leaves drop constraint if exists learning_leaves_source_check;
alter table public.learning_leaves add constraint learning_leaves_source_check
  check (source in ('reflection','review','material','bonus','import','safmeds','helping','experience'));
alter table public.learning_leaves drop constraint if exists learning_leaves_amount_check;
alter table public.learning_leaves add constraint learning_leaves_amount_check check (amount between 1 and 500);

-- 2. How many experience leaves a person's rank is worth -----------------------------------------------
create or replace function private.learning_rank_leaves(p_who uuid)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select coalesce(max(case r.role when 'supervisor' then 300 when 'qcd' then 200 when 'senior' then 100 else 0 end), 0)
  from public.staff_roles r where r.therapist_id = p_who
$$;

-- Give (or top up) the bundle. Only for people who have started their Learning Hub.
create or replace function private.learning_give_experience(p_who uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_target integer := private.learning_rank_leaves(p_who);
  v_have integer;
  v_rank text;
begin
  if not exists (select 1 from public.learning_profiles where therapist_id = p_who) then return; end if;
  select coalesce(sum(amount), 0) into v_have from public.learning_leaves where therapist_id = p_who and source = 'experience';
  if v_target <= v_have then return; end if;
  v_rank := case when v_target = 300 then 'Supervisor' when v_target = 200 then 'QCD' else 'Senior therapist' end;
  insert into public.learning_leaves (therapist_id, amount, source, reason)
  values (p_who, v_target - v_have, 'experience', 'Experience as ' || v_rank);
end $$;
revoke execute on function private.learning_rank_leaves(uuid), private.learning_give_experience(uuid) from public, anon, authenticated;

-- 3. After the self-check (same as 035, plus the bundle) --------------------------------------------------
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
  perform private.learning_give_experience(v_me);
end $$;

-- 4. Promotions top it up ------------------------------------------------------------------------------------
create or replace function private.learning_experience_on_role()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.learning_give_experience(new.therapist_id);
  return null;
exception when others then
  return null;   -- a leaf must never stop a role change
end $$;
revoke execute on function private.learning_experience_on_role() from public, anon, authenticated;
drop trigger if exists learning_experience on public.staff_roles;
create trigger learning_experience after insert or update on public.staff_roles
  for each row execute function private.learning_experience_on_role();

-- 5. Everyone who has already planted gets theirs now ----------------------------------------------------------
select private.learning_give_experience(therapist_id) from public.learning_profiles;

commit;
