-- (keep) Portal 018 – One "Learning Hub" tab instead of three
--
-- Run AFTER 017. Learning Hub, Resource Links and Journal Library were three
-- separate placeholder tabs (none built yet). They become ONE tab, Learning Hub,
-- which will hold study topics, resource links (Canva, Twinkl, timesheet tool…)
-- and the journal library as sections. Nothing else uses the two removed rows.

begin;

update public.app_modules
   set label = 'Learning Hub',
       description = 'Study topics, resource links (Canva, Twinkl, timesheet tool) and the journal library'
 where key = 'learning';

delete from public.app_modules where key in ('resources', 'journals');

commit;
