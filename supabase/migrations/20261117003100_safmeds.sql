-- (keep) Portal 031 – Learning Hub: SAFMEDS practice
--
-- Run AFTER 030. SAFMEDS = Say All Fast, a Minute Every Day, Shuffled.
--   * SETS of flash CARDS (front: term, back: definition). The cards are added
--     by a private setup file, or by supervisors / QCD / admin on the page.
--   * A person does a 1-minute shuffled TIMING and marks each card got it /
--     missed. The page sends the counts; the database saves them and decides
--     the leaves:
--       - 1 leaf for the first timing of the day (any set)
--       - a set is MASTERED when its aim (default 30+ correct, 2 or fewer
--         missed) is met on 3 different days → +5 leaves, once per set
--   * Timings are private to the person and supervisors / QCD / admin.

begin;

-- 1. Sets and cards ----------------------------------------------------------------------------
create table if not exists public.safmeds_sets (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 80),
  aim_correct smallint not null default 30 check (aim_correct between 1 and 120),
  aim_missed  smallint not null default 2 check (aim_missed between 0 and 30),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.safmeds_cards (
  id         uuid primary key default gen_random_uuid(),
  set_id     uuid not null references public.safmeds_sets (id) on delete cascade,
  front      text not null check (char_length(front) between 1 and 200),
  back       text not null check (char_length(back) between 1 and 1000),
  sort_order integer not null default 0
);
create index if not exists safmeds_cards_set_idx on public.safmeds_cards (set_id, sort_order);

-- 2. Timings ----------------------------------------------------------------------------------------
create table if not exists public.safmeds_timings (
  id           uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  set_id       uuid not null references public.safmeds_sets (id) on delete cascade,
  correct      smallint not null check (correct between 0 and 120),
  missed       smallint not null check (missed between 0 and 120),
  done_on      date not null,
  leaves       smallint not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists safmeds_timings_person_idx on public.safmeds_timings (therapist_id, set_id, created_at);

-- Leaves can now also come from SAFMEDS.
alter table public.learning_leaves drop constraint if exists learning_leaves_source_check;
alter table public.learning_leaves add constraint learning_leaves_source_check
  check (source in ('reflection','review','material','bonus','import','safmeds'));

-- 3. Privileges + rules ---------------------------------------------------------------------------------
alter table public.safmeds_sets    enable row level security;
alter table public.safmeds_cards   enable row level security;
alter table public.safmeds_timings enable row level security;
revoke all on public.safmeds_sets, public.safmeds_cards, public.safmeds_timings from anon, authenticated;
grant select, insert, update, delete on public.safmeds_sets, public.safmeds_cards to authenticated;
grant select on public.safmeds_timings to authenticated;

drop policy if exists "safmeds sets: staff read"   on public.safmeds_sets;
drop policy if exists "safmeds sets: team write"   on public.safmeds_sets;
drop policy if exists "safmeds cards: staff read"  on public.safmeds_cards;
drop policy if exists "safmeds cards: team write"  on public.safmeds_cards;
drop policy if exists "safmeds timings: own or team read" on public.safmeds_timings;
create policy "safmeds sets: staff read" on public.safmeds_sets
  for select to authenticated using ((select private.is_care_staff()));
create policy "safmeds sets: team write" on public.safmeds_sets
  for all to authenticated using ((select private.is_assessor())) with check ((select private.is_assessor()));
create policy "safmeds cards: staff read" on public.safmeds_cards
  for select to authenticated using ((select private.is_care_staff()));
create policy "safmeds cards: team write" on public.safmeds_cards
  for all to authenticated using ((select private.is_assessor())) with check ((select private.is_assessor()));
create policy "safmeds timings: own or team read" on public.safmeds_timings
  for select to authenticated using (therapist_id = (select private.current_therapist_id()) or (select private.is_assessor()));

-- 4. Save a timing (and decide the leaves) ------------------------------------------------------------------
create or replace function public.safmeds_record(p_set uuid, p_correct integer, p_missed integer)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me    uuid := private.current_therapist_id();
  v_today date := private.learning_today();
  v_set   public.safmeds_sets;
  v_leaf  integer := 0;
  v_days  integer;
  v_mastered boolean := false;
  v_new_master boolean := false;
  v_id uuid;
begin
  if v_me is null or not private.is_care_staff() then raise exception 'Only CARE staff can use the Learning Hub.'; end if;
  select * into v_set from public.safmeds_sets where id = p_set and active;
  if not found then raise exception 'Set not found.'; end if;
  if p_correct is null or p_missed is null or p_correct < 0 or p_missed < 0 or p_correct > 120 or p_missed > 120 then
    raise exception 'Those numbers don''t look right.';
  end if;
  if p_correct + p_missed = 0 then raise exception 'No cards were marked.'; end if;

  -- 1 leaf for the first timing of the day
  if not exists (select 1 from public.safmeds_timings where therapist_id = v_me and done_on = v_today and leaves > 0) then
    v_leaf := 1;
  end if;
  insert into public.safmeds_timings (therapist_id, set_id, correct, missed, done_on, leaves)
  values (v_me, p_set, p_correct, p_missed, v_today, v_leaf)
  returning id into v_id;
  if v_leaf > 0 then
    insert into public.learning_leaves (therapist_id, amount, source, reason, ref_id)
    values (v_me, 1, 'safmeds', 'SAFMEDS daily timing', v_id);
  end if;

  -- mastered: aim met on 3 different days
  select count(distinct done_on) into v_days from public.safmeds_timings
   where therapist_id = v_me and set_id = p_set and correct >= v_set.aim_correct and missed <= v_set.aim_missed;
  v_mastered := v_days >= 3;
  if v_mastered and not exists (select 1 from public.learning_leaves
                                where therapist_id = v_me and source = 'safmeds' and ref_id = p_set) then
    insert into public.learning_leaves (therapist_id, amount, source, reason, ref_id)
    values (v_me, 5, 'safmeds', 'SAFMEDS set mastered: ' || v_set.title, p_set);
    v_new_master := true;
  end if;

  return jsonb_build_object('leaves', v_leaf + (case when v_new_master then 5 else 0 end),
                            'aim_days', least(v_days, 3), 'mastered', v_mastered, 'new_master', v_new_master,
                            'aim_met', p_correct >= v_set.aim_correct and p_missed <= v_set.aim_missed);
end $$;

revoke execute on function public.safmeds_record(uuid, integer, integer) from public, anon;
grant  execute on function public.safmeds_record(uuid, integer, integer) to authenticated;

commit;
