-- (keep) Portal check – every table locked
--
-- Safe to run any time: it only reads table settings, never data.
-- Expected result: NO ROWS. Any row listed is a table that is either open
-- (RLS off) or invisible to the app (RLS on but no policies) — fix before release.

select c.relname as table_name,
       case when not c.relrowsecurity then 'RLS is OFF — table is open'
            else 'RLS on but NO policies — app cannot see it' end as problem
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and ( not c.relrowsecurity
        or not exists (select 1 from pg_policies p
                       where p.schemaname = 'public' and p.tablename = c.relname) )
order by 1;
