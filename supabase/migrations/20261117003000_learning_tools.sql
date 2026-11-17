-- (keep) Portal 030 – Learning Hub: CARE tools (quick links)
--
-- Run AFTER 029. A small row of everyday tools at the top of the Learning Hub
-- (timesheet, ABA Binder, handouts, Twinkl, Canva…). Each has a link and/or a
-- short note (e.g. "Ask admin for the login"). All CARE staff see them;
-- supervisors / QCD / admin edit them under Manage topics.
-- The tools themselves are added by a private setup file (or on the page).

begin;

create table if not exists public.learning_tools (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 1 and 60),
  url        text check (url ~ '^https?://' and char_length(url) <= 500),
  note       text check (char_length(note) <= 200),
  icon       text not null default 'link' check (icon ~ '^[a-z0-9-]{1,30}$'),
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.learning_tools enable row level security;
revoke all on public.learning_tools from anon, authenticated;
grant select, insert, update, delete on public.learning_tools to authenticated;

drop policy if exists "learning tools: staff read"  on public.learning_tools;
drop policy if exists "learning tools: team write"  on public.learning_tools;
create policy "learning tools: staff read" on public.learning_tools
  for select to authenticated using ((select private.is_care_staff()));
create policy "learning tools: team write" on public.learning_tools
  for all to authenticated
  using ((select private.is_assessor()))
  with check ((select private.is_assessor()));

commit;
