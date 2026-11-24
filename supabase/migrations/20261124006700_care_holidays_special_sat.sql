-- (keep) Portal 067 – CARE holidays + Special Sat
--
-- Run AFTER 066.
--   * CARE holidays: one row per day off for everyone. The leave form skips them when
--     it counts days. Everyone can see them; only Admin and the Portal manager change
--     them (Leave & HR → CARE holidays). 2027 is loaded from "Calendar 2027 REV 11-2026".
--   * Special Sat (leave type SS): when a CARE holiday falls on a SATURDAY, Senior / QCD /
--     Supervisor (5-day week) may take one day off of their choice IN THAT SAME MONTH,
--     free (it doesn't use any other leave). Requested in the leave form, approved by
--     Admin / HR like other leave. Unused = lost at the end of the month.
-- The database checks every Special Sat: right rank, one day, a month that has a
-- Saturday holiday, and no more Special Sats than that month's Saturday holidays.
-- Safe to run again.

begin;

-- 1. CARE holidays -----------------------------------------------------------------------------------------
create table if not exists public.care_holidays (
  day        date primary key,
  label      text not null check (char_length(btrim(label)) between 2 and 80),
  created_at timestamptz not null default now()
);
alter table public.care_holidays enable row level security;
grant select, insert, update, delete on public.care_holidays to authenticated;
revoke all on public.care_holidays from anon;

drop policy if exists "care_holidays: signed-in read" on public.care_holidays;
create policy "care_holidays: signed-in read" on public.care_holidays
  for select to authenticated using (true);
drop policy if exists "care_holidays: admin add" on public.care_holidays;
create policy "care_holidays: admin add" on public.care_holidays
  for insert to authenticated with check ((select private.has_exact_role(array['admin','manager']::public.app_role[])));
drop policy if exists "care_holidays: admin edit" on public.care_holidays;
create policy "care_holidays: admin edit" on public.care_holidays
  for update to authenticated using ((select private.has_exact_role(array['admin','manager']::public.app_role[])))
  with check ((select private.has_exact_role(array['admin','manager']::public.app_role[])));
drop policy if exists "care_holidays: admin delete" on public.care_holidays;
create policy "care_holidays: admin delete" on public.care_holidays
  for delete to authenticated using ((select private.has_exact_role(array['admin','manager']::public.app_role[])));

insert into public.care_holidays (day, label) values
  ('2027-01-01', 'New Year'),
  ('2027-01-02', 'New Year'),
  ('2027-02-22', 'Makha Bucha Day (substitution)'),
  ('2027-04-13', 'Songkran'),
  ('2027-04-14', 'Songkran'),
  ('2027-04-15', 'Songkran'),
  ('2027-05-01', 'Labour Day'),
  ('2027-05-20', 'Visakha Bucha Day'),
  ('2027-06-03', 'HM the Queen''s Birthday'),
  ('2027-07-19', 'Asanha Bucha Day (substitution)'),
  ('2027-07-28', 'King Vajiralongkorn''s Birthday'),
  ('2027-08-12', 'Queen Mother''s Birthday'),
  ('2027-10-13', 'King Bhumibol Memorial Day'),
  ('2027-10-23', 'Chulalongkorn Day'),
  ('2027-12-06', 'King Bhumibol''s Birthday (substitution)'),
  ('2027-12-29', 'End of year'),
  ('2027-12-30', 'End of year'),
  ('2027-12-31', 'End of year')
on conflict (day) do nothing;

-- 2. Special Sat -----------------------------------------------------------------------------------------
insert into public.leave_types (code, label, max_days, per_person, notice_days, needs_kind, sort_order)
values ('SS', 'Special Sat', null, false, 7, false, 15)
on conflict (code) do nothing;

create or replace function private.leave_special_sat_check()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_sats integer; v_used integer;
begin
  if new.type <> 'SS' or new.status not in ('pending','approved') then return new; end if;
  if not exists (select 1 from public.staff_roles where therapist_id = new.therapist_id and role in ('senior','qcd','supervisor')) then
    raise exception 'Special Sat is for Senior, QCD and Supervisor.';
  end if;
  if new.start_date <> new.end_date or new.days <> 1 or new.half_day is not null then
    raise exception 'A Special Sat is one full day.';
  end if;
  select count(*) into v_sats from public.care_holidays
   where date_trunc('month', day) = date_trunc('month', new.start_date) and extract(isodow from day) = 6;
  if v_sats = 0 then
    raise exception 'There is no Special Sat in %: no CARE holiday falls on a Saturday that month.', to_char(new.start_date, 'FMMonth YYYY');
  end if;
  select count(*) into v_used from public.leave_requests
   where therapist_id = new.therapist_id and type = 'SS' and status in ('pending','approved') and id <> new.id
     and date_trunc('month', start_date) = date_trunc('month', new.start_date);
  if v_used >= v_sats then
    raise exception 'Your Special Sat for % is already requested.', to_char(new.start_date, 'FMMonth YYYY');
  end if;
  return new;
end $$;
revoke execute on function private.leave_special_sat_check() from public, anon, authenticated;
drop trigger if exists leave_special_sat_check on public.leave_requests;
create trigger leave_special_sat_check before insert or update of type, start_date, end_date, days, half_day, status
  on public.leave_requests for each row execute function private.leave_special_sat_check();

commit;
