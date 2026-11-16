-- (keep) Portal 019 – ABAT Coursework: new name, wording, accreditation line
--
-- Run AFTER 018. For the new Training page design:
--   * the course is called "ABAT Coursework" (the certificate keeps its formal
--     title: "Applied Behavior Analysis Technician (ABAT) Preparation Course")
--   * "modules" become "lessons" in the wording
--   * a new, empty "accreditation line" for each course (e.g. "Qualified by
--     QABA"), shown under the course name. Admins fill it in later from
--     ⚙️ Admin → Training content → Course settings.

begin;

alter table public.training_programs
  add column if not exists accreditation text check (char_length(accreditation) <= 120);

update public.training_programs
   set title = 'ABAT Coursework',
       summary = 'Applied Behavior Analysis Technician preparation: nine lessons across Domains A–G, then the ABAT Readiness Examination.'
 where key = 'abat';

update public.training_steps
   set title = 'Coursework',
       details = 'Work through the reading list and the nine lessons at your own pace. Tick each one when you finish it; finishing them all opens the exam.'
 where program_key = 'abat' and kind = 'learn';

commit;
