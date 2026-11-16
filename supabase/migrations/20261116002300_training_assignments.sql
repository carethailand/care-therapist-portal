-- (keep) Portal 023 – Chapter assignments (upload + review)
--
-- Run AFTER 022. Each chapter of the in-person training has an assignment.
--   * The trainee uploads it in the Portal (PDF, Word or a photo, max 10 MB)
--     instead of emailing it. They can replace it until it's reviewed.
--   * A supervisor / QCD / admin opens it and marks it Reviewed or
--     "Please redo", with a comment the trainee sees.
--   * Files live in a PRIVATE store ("training-work"): only the trainee and the
--     training team can open them, through short-lived links.
--   * Later, "Close group" exports everything and clears these files.

begin;

-- 1. Submissions ---------------------------------------------------------------------------------
create table if not exists public.training_submissions (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.training_enrollments (id) on delete cascade,
  step_id       uuid not null references public.training_steps (id) on delete cascade,
  chapter       smallint not null check (chapter between 1 and 50),
  file_path     text check (file_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),   -- null once cleared
  file_name     text check (char_length(file_name) <= 200),
  file_type     text check (char_length(file_type) <= 120),
  file_size     integer check (file_size between 1 and 10485760),
  submitted_at  timestamptz not null default now(),
  status        text not null default 'submitted' check (status in ('submitted','reviewed','redo')),
  feedback      text check (char_length(feedback) <= 2000),
  reviewed_by   uuid references public.therapists (id) on delete set null,
  reviewed_at   timestamptz,
  cleared_at    timestamptz,
  unique (enrollment_id, step_id, chapter)
);
alter table public.training_submissions enable row level security;
revoke all on public.training_submissions from anon, authenticated;
grant select on public.training_submissions to authenticated;
drop policy if exists "submissions: own or team read" on public.training_submissions;
create policy "submissions: own or team read" on public.training_submissions
  for select to authenticated using (
    (select private.is_training_team())
    or exists (select 1 from public.training_enrollments e
               where e.id = enrollment_id and e.therapist_id = (select private.current_therapist_id())));

-- Does the signed-in person own this training place? (folder name = enrolment id)
create or replace function private.owns_enrollment(p_id text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.training_enrollments e
                 where e.id::text = p_id and e.therapist_id = private.current_therapist_id() and e.status = 'active')
$$;
revoke execute on function private.owns_enrollment(text) from public, anon;
grant  execute on function private.owns_enrollment(text) to authenticated;

-- 2. File store ------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('training-work', 'training-work', false, 10485760,
        array['application/pdf','application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760,
      allowed_mime_types = array['application/pdf','application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'image/jpeg','image/png','image/webp'];

drop policy if exists "training-work: owner or team read" on storage.objects;
drop policy if exists "training-work: owner add"          on storage.objects;
drop policy if exists "training-work: owner or admin remove" on storage.objects;
create policy "training-work: owner or team read" on storage.objects
  for select to authenticated
  using (bucket_id = 'training-work'
         and ((select private.is_training_team())
              or exists (select 1 from public.training_enrollments e
                         where e.id::text = (storage.foldername(name))[1]
                           and e.therapist_id = (select private.current_therapist_id()))));
create policy "training-work: owner add" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'training-work' and private.owns_enrollment((storage.foldername(name))[1]));
create policy "training-work: owner or admin remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'training-work'
         and (private.owns_enrollment((storage.foldername(name))[1])
              or (select private.has_any_role(array['admin']::public.app_role[]))));

-- 3. Submit (trainee) ---------------------------------------------------------------------------------
create or replace function public.training_submit(p_enrollment uuid, p_step uuid, p_chapter smallint,
                                                  p_path text, p_name text, p_type text, p_size integer)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old public.training_submissions;
begin
  if not private.owns_enrollment(p_enrollment::text) then raise exception 'This isn''t your active training place.'; end if;
  if split_part(p_path, '/', 1) <> p_enrollment::text then raise exception 'That file isn''t in your folder.'; end if;
  if not exists (select 1 from public.training_steps s join public.training_enrollments e on e.program_key = s.program_key
                 where s.id = p_step and e.id = p_enrollment and s.kind = 'session') then
    raise exception 'Assignments belong to the in-person training step.';
  end if;
  select * into v_old from public.training_submissions where enrollment_id = p_enrollment and step_id = p_step and chapter = p_chapter;
  if found and v_old.status = 'reviewed' then raise exception 'This assignment has already been reviewed.'; end if;

  insert into public.training_submissions (enrollment_id, step_id, chapter, file_path, file_name, file_type, file_size, submitted_at, status)
  values (p_enrollment, p_step, p_chapter, p_path, left(p_name, 200), left(p_type, 120), p_size, now(), 'submitted')
  on conflict (enrollment_id, step_id, chapter) do update
    set file_path = excluded.file_path, file_name = excluded.file_name, file_type = excluded.file_type,
        file_size = excluded.file_size, submitted_at = now(), status = 'submitted', cleared_at = null;
  -- the old file (if replaced) is removed by the app
  return jsonb_build_object('replaced', case when found then v_old.file_path end);
end $$;

-- 4. Review (supervisor / QCD / admin) ----------------------------------------------------------------
create or replace function public.training_review(p_submission uuid, p_status text, p_feedback text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.is_assessor() then raise exception 'Only a supervisor, QCD or admin can review assignments.'; end if;
  if p_status not in ('reviewed','redo') then raise exception 'Choose Reviewed or Please redo.'; end if;
  update public.training_submissions
     set status = p_status, feedback = nullif(btrim(coalesce(p_feedback, '')), ''),
         reviewed_by = private.current_therapist_id(), reviewed_at = now()
   where id = p_submission;
  if not found then raise exception 'Assignment not found.'; end if;
end $$;

revoke execute on function public.training_submit(uuid, uuid, smallint, text, text, text, integer),
                           public.training_review(uuid, text, text) from public, anon;
grant  execute on function public.training_submit(uuid, uuid, smallint, text, text, text, integer),
                           public.training_review(uuid, text, text) to authenticated;

commit;
