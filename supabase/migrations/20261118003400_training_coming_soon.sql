-- (keep) Portal 034 – QCD and Supervisor Training: "Coming soon" outlines
--
-- Run AFTER 033. Shows two training paths on the Training tab for everyone at
-- CARE, as "Coming soon" cards with their steps and requirements (no content
-- yet, nobody can be assigned). Content is added later.
--   * QCD Training (Therapist Liaison): from the QCD Training Path chart
--   * Supervisor Training (Case Manager / Supervisor): steps from the chart,
--     details to follow
-- People who already hold the rank see "Completed before the Portal" as before
-- (QCD: QCD staff, and supervisors an admin ticked).

begin;

alter table public.training_programs
  add column if not exists coming_soon boolean not null default false;

-- QCD Training (the programme already exists, switched off) ----------------------------------------
update public.training_programs
   set title = 'QCD Training (Therapist Liaison)',
       summary = 'Builds on your clinical expertise and prepares you for leadership and case management responsibilities. For Senior therapists who have completed Therapist and Senior Therapist training.',
       enabled = true, coming_soon = true, promotes_to = 'qcd', sort_order = 30
 where key = 'qcd';

insert into public.training_steps (program_key, sort_order, kind, title, details, config)
select 'qcd', v.o, v.kind, v.title, v.details, v.config::jsonb
from (values
  (10, 'result', 'Qualifying exam', '4 hours covering QCD and Senior content (minimum 80%).', '{"mode":"paper","duration_min":240}'),
  (20, 'session', 'QCD training course', '6 hours led by Clinical Supervisors, focusing on quality case development and team coordination.', '{"target_hours":6}'),
  (30, 'result', 'Written exam', '3 hours (minimum 80%) to demonstrate applied clinical and supervisory knowledge.', '{"mode":"paper","duration_min":180}'),
  (40, 'practicum', 'Practicum period', '2 months: 7 overlap sessions (14 hours in total) with case practice and feedback every session.', '{}'),
  (50, 'result', 'Oral exam', '1.5 hours (30 min review, 15 min prep, 45 min oral) with a passing score of 80%.', '{"mode":"oral","duration_min":90,"completes_program":true}'),
  (60, 'certificate', 'QCD (Therapist Liaison)', 'Promotion to the Quality Control Department.', '{}')
) as v(o, kind, title, details, config)
where not exists (select 1 from public.training_steps s where s.program_key = 'qcd');

-- Supervisor Training ------------------------------------------------------------------------------------
insert into public.training_programs (key, title, summary, sort_order, enabled, certificate, certificate_title, promotes_to, coming_soon)
values ('supervisor', 'Supervisor Training (Case Manager / Supervisor)',
        'Advancement to the Case Manager / Supervisor position. For Senior therapists. Talk to the Admin team for details.',
        40, true, false, null, 'supervisor', true)
on conflict (key) do update set coming_soon = true, enabled = true, promotes_to = 'supervisor';

insert into public.training_steps (program_key, sort_order, kind, title, details, config)
select 'supervisor', v.o, v.kind, v.title, v.details, v.config::jsonb
from (values
  (10, 'result', 'Qualifying exam', 'Talk to the Admin team for details.', '{"mode":"paper"}'),
  (20, 'learn', 'Video training', 'Talk to the Admin team for details.', '{}'),
  (30, 'session', 'In-person training', 'Talk to the Admin team for details.', '{}'),
  (40, 'result', 'Written exam', 'Talk to the Admin team for details.', '{"mode":"paper"}'),
  (50, 'practicum', 'Co-supervision practicum', 'Talk to the Admin team for details.', '{}'),
  (60, 'result', 'Oral exam', 'Talk to the Admin team for details.', '{"mode":"oral","completes_program":true}'),
  (70, 'certificate', 'Supervisor', 'Promotion to Case Manager / Supervisor.', '{}')
) as v(o, kind, title, details, config)
where not exists (select 1 from public.training_steps s where s.program_key = 'supervisor');

commit;
