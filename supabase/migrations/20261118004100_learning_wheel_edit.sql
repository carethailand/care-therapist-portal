-- (keep) Portal 041 – Learning Hub: one-tap planting + edit the wheel with − / +
--
-- Run AFTER 040.
--   1. Planting is one tap. The tree / flower field starts at its first stage
--      (Seedling / Bud) with an empty wheel. The 10 starter skill points arrive as
--      100 welcome leaves ("10 skill points left to use"), on top of any promotion
--      and years leaves. The old 10-point self-check screen is gone.
--   2. learning_set_wheel: the person saves their whole wheel at once from the
--      "Edit my wheel" window (− / + one point at a time). They can move points
--      between skills and place new ones (10 leaves each). The total never goes
--      down, so the tree / flower field never shrinks.
-- Only the person themselves can do either. learning_invest / learning_rebalance stay
-- (unused by the new app) so nothing breaks while the app updates.

begin;

-- 1. One-tap start (p_points is ignored; kept so the old app still works) ------------------------
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
  v_hub := case when private.is_office_only(v_me) then 'admin' else 'clinical' end;
  v_keys := private.learning_skill_keys(v_hub);
  insert into public.learning_profiles (therapist_id, hub) values (v_me, v_hub);
  insert into public.learning_skills (therapist_id, skill, points) select v_me, s, 0 from unnest(v_keys) as s;
  insert into public.learning_leaves (therapist_id, amount, source, reason)
  values (v_me, 100, 'bonus', 'Welcome: 10 starter skill points');
  perform private.learning_give_experience(v_me);   -- promotion + years leaves
end $$;

-- 2. Save the whole wheel -----------------------------------------------------------------------------
create or replace function public.learning_set_wheel(p_points jsonb)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_hub text;
  v_keys text[];
  v_now integer;
  v_new integer := 0;
  v_can integer;
  v_k text; v_v integer;
begin
  select hub into v_hub from public.learning_profiles where therapist_id = v_me for update;
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
  if v_new - v_now > v_can then raise exception 'You have % skill point(s) left to use.', v_can; end if;
  update public.learning_profiles set invested = invested + (v_new - v_now) where therapist_id = v_me;
  update public.learning_skills s
     set points = coalesce((p_points ->> s.skill)::integer, 0)
   where s.therapist_id = v_me and s.skill = any (v_keys);
  return v_new - v_now;   -- new points placed
end $$;

revoke execute on function public.learning_set_wheel(jsonb) from public, anon;
grant  execute on function public.learning_set_wheel(jsonb) to authenticated;

commit;
