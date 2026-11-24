-- (keep) Portal 065 – Leave: quarter days + "Emergency / natural disaster"
--
-- Run AFTER 064.
--   * Leave can be taken in quarter days (0.25, about 2 hours), e.g. a doctor visit in
--     the afternoon. Days now go in steps of 0.25 (1, 0.5, 0.25, 1.75 …).
--   * New Other-leave kind: Emergency / natural disaster (e.g. flooding), up to 7 days
--     a year (Admin can change the limit in Supabase if needed).
-- Safe to run again.

begin;

alter table public.leave_requests alter column days type numeric;
alter table public.leave_requests drop constraint if exists leave_requests_days_quarter;
alter table public.leave_requests add constraint leave_requests_days_quarter
  check (days * 4 = trunc(days * 4) and days <= 999);

insert into public.leave_kinds (code, label, max_days, sort_order)
values ('emergency', 'Emergency / natural disaster', 7, 80)
on conflict (code) do nothing;

commit;
