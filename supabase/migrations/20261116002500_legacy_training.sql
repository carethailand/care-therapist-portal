-- (keep) Portal 025 – Training completed before the Portal (admin-verified)
--
-- Run AFTER 024. Current staff who finished a programme before the Portal
-- existed get the completed card and badge without going through it again:
--   * Senior Therapist Training: automatic for Senior therapists and above.
--   * QCD Training: automatic for QCD; for Supervisors only when an admin ticks
--     "Completed QCD Training before the Portal" on the People screen
--     (not every supervisor did QCD training).
-- This column holds those admin ticks.

begin;

alter table public.therapists
  add column if not exists legacy_training text[] not null default '{}'
    check (legacy_training <@ array['senior','qcd','supervisor']::text[]);

comment on column public.therapists.legacy_training is
  'Programmes completed before the Portal, verified by an admin (e.g. {qcd}). Shown as completed + badge.';

commit;
