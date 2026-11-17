-- (keep) Portal 028 – Learning Hub: supervisors, QCD and admin manage topics
--
-- Run AFTER 027. One simple rule: supervisors, QCD and admin can add, rename,
-- move (between the 7 areas), reorder, describe and hide topics, as they
-- already can with links. Adds a short description to each topic. Codes stay
-- in the database (hidden on screen); new topics get one automatically.

begin;

alter table public.learning_topics
  add column if not exists description text check (char_length(description) <= 300);

-- allow longer automatic codes (e.g. D-101)
alter table public.learning_topics drop constraint if exists learning_topics_code_check;
alter table public.learning_topics add constraint learning_topics_code_check check (code ~ '^[A-Z]{1,3}-[0-9]{2,4}$');

drop policy if exists "learning topics: admin write" on public.learning_topics;
drop policy if exists "learning topics: team write"  on public.learning_topics;
create policy "learning topics: team write" on public.learning_topics
  for all to authenticated
  using ((select private.is_assessor()))
  with check ((select private.is_assessor()));

commit;
