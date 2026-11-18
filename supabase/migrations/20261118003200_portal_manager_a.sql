-- (keep) Portal 032a – New office role: Portal manager (part 1 of 2)
--
-- Run this ON ITS OWN first, then 032b. (Postgres needs a new role name to be
-- saved before other code can use it.)

alter type public.app_role add value if not exists 'manager';
