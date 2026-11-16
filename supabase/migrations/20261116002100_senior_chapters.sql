-- (keep) Portal 021 – Senior in-person training: the 14 chapters
--
-- Run AFTER 020 and the Senior course setup. The in-person training step gets
-- its 14 chapters (topics). When a supervisor logs a session they tick which
-- chapters it covered; the trainee sees each chapter ticked once covered.

begin;

alter table public.training_hours
  add column if not exists chapters smallint[] not null default '{}';

update public.training_steps
   set config = config || jsonb_build_object('topics', jsonb_build_array(
         'Advancement for Clinical Positions',
         'New Client Start-up Process',
         'The Activity Logbook',
         'Managing Therapists Through Activity',
         'Performance Evaluation',
         'Direction of the Field of ABA',
         'Research and Evidence-Based Practice',
         'Verbal Behavior',
         'The CARD Curriculum',
         'Discrete Trial Training (DTT)',
         'Advanced Behavior Support',
         'Toilet Training',
         'Desensitization Program',
         'Tolerating "No" Program'))
 where program_key = 'senior' and kind = 'session';

commit;
