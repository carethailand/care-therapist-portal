-- (keep) Portal 038 – Learning Hub: leaves for years at CARE
--
-- Run AFTER 037. Every full year at CARE (from the start date in People) is worth
-- 5 skill points = 50 leaves, for everyone at CARE (therapists and the admin team),
-- on top of the rank bundle from 036. All past years count, so e.g. a Supervisor
-- with 10 years starts in Grove and one with 12+ years at Forest Guardian.
-- Each work anniversary adds 50 more: they arrive the next time the person opens
-- the Learning Hub. Never taken back. People who already planted get theirs now.

begin;

-- 1. A new kind of leaf, and room for many years in one go ----------------------------------------------
alter table public.learning_leaves drop constraint if exists learning_leaves_source_check;
alter table public.learning_leaves add constraint learning_leaves_source_check
  check (source in ('reflection','review','material','bonus','import','safmeds','helping','experience','years'));
alter table public.learning_leaves drop constraint if exists learning_leaves_amount_check;
alter table public.learning_leaves add constraint learning_leaves_amount_check check (amount between 1 and 2000);

-- 2. Give (or top up) the years leaves. Only for people who have started their Learning Hub. -------------
create or replace function private.learning_give_years(p_who uuid)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_years integer;
  v_have integer;
  v_add integer;
begin
  if not exists (select 1 from public.learning_profiles where therapist_id = p_who) then return 0; end if;
  select coalesce(extract(year from age(private.learning_today(), t.start_date))::integer, 0) into v_years
    from public.therapists t where t.id = p_who and t.status <> 'exited';
  select coalesce(sum(amount), 0) into v_have from public.learning_leaves where therapist_id = p_who and source = 'years';
  v_add := greatest(coalesce(v_years, 0), 0) * 50 - v_have;
  if v_add <= 0 then return 0; end if;
  insert into public.learning_leaves (therapist_id, amount, source, reason)
  values (p_who, v_add, 'years',
          case when v_have = 0 then v_years || ' year' || case when v_years = 1 then '' else 's' end || ' at CARE'
               else 'Work anniversary: ' || v_years || ' years at CARE' end);
  return v_add;
end $$;
revoke execute on function private.learning_give_years(uuid) from public, anon, authenticated;

-- The rank bundle (036) now also brings the years with it: right after planting,
-- and on a promotion.
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
  if v_target > v_have then
    v_rank := case when v_target = 300 then 'Supervisor' when v_target = 200 then 'QCD' else 'Senior therapist' end;
    insert into public.learning_leaves (therapist_id, amount, source, reason)
    values (p_who, v_target - v_have, 'experience', 'Experience as ' || v_rank);
  end if;
  perform private.learning_give_years(p_who);
end $$;
revoke execute on function private.learning_give_experience(uuid) from public, anon, authenticated;

-- 3. Opening the Learning Hub picks up a new anniversary (or a corrected start date) ------------------------
create or replace function public.learning_refresh()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_add integer;
begin
  if v_me is null then return jsonb_build_object('added', 0); end if;
  v_add := private.learning_give_years(v_me);
  return jsonb_build_object('added', v_add,
    'reason', case when v_add > 0 then (select reason from public.learning_leaves where therapist_id = v_me and source = 'years'
                                        order by created_at desc limit 1) end);
end $$;
revoke execute on function public.learning_refresh() from public, anon;
grant  execute on function public.learning_refresh() to authenticated;

-- 4. Everyone who has already planted gets theirs now -------------------------------------------------------
select private.learning_give_years(therapist_id) from public.learning_profiles;

commit;
