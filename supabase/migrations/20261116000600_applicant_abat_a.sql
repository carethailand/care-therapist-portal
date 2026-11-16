-- (keep) Portal 006a – applicant role + ABAT certified step
--
-- Run this ON ITS OWN first, then run 006b.
-- (Postgres needs new names saved before other SQL can use them.)
--
-- applicant = someone who is not a CARE therapist (yet):
--   - a CARE new hire, from interview until they pass field overlap
--     session 8 (supervisor evaluation) and sign their contract;
--   - an ABAT course learner (not CARE staff): online course + exam only.
-- certified = the last step for an ABAT learner (passed the course exam).

alter type public.app_role      add value if not exists 'applicant' after 'therapist';
alter type public.journey_stage add value if not exists 'certified' before 'exited';
