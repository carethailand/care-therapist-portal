-- (keep) Portal 005a – add QCD role
--
-- Run this ON ITS OWN first, then run 005b.
-- (Postgres needs a new role name saved before other SQL can use it.)
--
-- QCD = Quality Control Department. Runs the role-play training (stage 3),
-- does overlap forms (stage 4) and QCD evaluations.

alter type public.app_role add value if not exists 'qcd' after 'senior';
