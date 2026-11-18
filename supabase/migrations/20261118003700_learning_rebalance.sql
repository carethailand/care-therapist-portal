-- (keep) Portal 037 – Learning Hub: move points between skills on your own wheel
--
-- Run AFTER 036. The self-reflection skill wheel is a person's own view, so they
-- can re-balance it whenever their view changes: take points from one skill and
-- put them in another. The total stays the same (the tree / flower field never
-- shrinks). Only the person themselves can do this; no history is kept.

begin;

create or replace function public.learning_rebalance(p_points jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_hub text;
  v_keys text[];
  v_now integer;
  v_new integer := 0;
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
  if v_new <> v_now then raise exception 'Moving points keeps the same total (% points).', v_now; end if;
  update public.learning_skills s
     set points = coalesce((p_points ->> s.skill)::integer, 0)
   where s.therapist_id = v_me and s.skill = any (v_keys);
end $$;

revoke execute on function public.learning_rebalance(jsonb) from public, anon;
grant  execute on function public.learning_rebalance(jsonb) to authenticated;

commit;
