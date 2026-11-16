-- (keep) Portal 017 – Our Team page
--
-- Run AFTER 016. Adds:
--   * a short "about me" (up to 280 characters) and a photo for each person,
--     which they set themselves on the Our Team page
--   * a private photo store ("team-photos"): only signed-in CARE staff can
--     see the photos; each person can only add/replace their own (admins can
--     tidy any)
--   * team_directory(): the list the page shows. It returns names, ranks,
--     about, photo and milestone results only (years at CARE as a number, not
--     the start date; no email, phone or other HR details)
--   * the "Our Team" tab, hidden until you switch it on
-- Who is listed and who can see it: current CARE staff (not applicants or ABAT
-- learners, not people who have left).

begin;

-- 1. Profile fields --------------------------------------------------------------------
alter table public.therapists
  add column if not exists about      text check (char_length(about) <= 280),
  add column if not exists photo_path text check (photo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');

-- 2. Who counts as current CARE staff ----------------------------------------------------
create or replace function private.is_care_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.therapists t
    where t.id = private.current_therapist_id()
      and t.status <> 'exited' and t.track = 'care_hire'
      and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant'))
$$;
revoke execute on function private.is_care_staff() from public, anon;
grant  execute on function private.is_care_staff() to authenticated;

-- 3. Photo store ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-photos', 'team-photos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "team-photos: staff read"      on storage.objects;
drop policy if exists "team-photos: own add"         on storage.objects;
drop policy if exists "team-photos: own replace"     on storage.objects;
drop policy if exists "team-photos: own remove"      on storage.objects;

create policy "team-photos: staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'team-photos' and (select private.is_care_staff()));

-- Files live in a folder named after the person's id: <therapist id>/photo-….jpg
create policy "team-photos: own add" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'team-photos' and (select private.is_care_staff())
              and (storage.foldername(name))[1] = (select private.current_therapist_id())::text);

create policy "team-photos: own replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'team-photos'
         and ((storage.foldername(name))[1] = (select private.current_therapist_id())::text
              or (select private.has_any_role(array['admin']::public.app_role[]))))
  with check (bucket_id = 'team-photos'
         and ((storage.foldername(name))[1] = (select private.current_therapist_id())::text
              or (select private.has_any_role(array['admin']::public.app_role[]))));

create policy "team-photos: own remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'team-photos'
         and ((storage.foldername(name))[1] = (select private.current_therapist_id())::text
              or (select private.has_any_role(array['admin']::public.app_role[]))));

-- 4. Set my card (about + photo) -------------------------------------------------------------
create or replace function public.team_set_profile(p_about text, p_photo_path text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
begin
  if v_me is null or not private.is_care_staff() then raise exception 'Only CARE staff can edit a team card.'; end if;
  if p_photo_path is not null and split_part(p_photo_path, '/', 1) <> v_me::text then
    raise exception 'That photo isn''t yours.';
  end if;
  if char_length(coalesce(p_about, '')) > 280 then raise exception 'Please keep "about me" to 280 characters.'; end if;
  update public.therapists
     set about = nullif(btrim(coalesce(p_about, '')), ''),
         photo_path = p_photo_path
   where id = v_me;
end $$;

-- 5. The team list -----------------------------------------------------------------------------
create or replace function public.team_directory()
returns table (id uuid, full_name text, nickname text, roles text[], about text, photo_path text,
               years integer, probation_passed boolean, longest boolean)
language sql stable security definer
set search_path = ''
as $$
  with staff as (
    select t.*
    from public.therapists t
    where t.status <> 'exited' and t.track = 'care_hire'
      and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')
  ),
  oldest as (select id from public.milestone_longest() as l(id))
  select s.id, s.full_name, s.nickname,
         array(select r.role::text from public.staff_roles r where r.therapist_id = s.id order by r.role::text),
         s.about, s.photo_path,
         case when s.start_date is null then null
              else extract(year from age((now() at time zone 'Asia/Bangkok')::date, s.start_date))::integer end,
         s.stage = 'active',
         s.id in (select id from oldest)
  from staff s
  where private.is_care_staff()
  order by coalesce(s.nickname, s.full_name)
$$;

revoke execute on function public.team_set_profile(text, text), public.team_directory() from public, anon;
grant  execute on function public.team_set_profile(text, text), public.team_directory() to authenticated;

-- 6. The tab (hidden until you switch it on). Applicants don't get it. ---------------------------
insert into public.app_modules (key, label, description, sort_order, enabled, roles, phase)
values ('team', 'Our Team', 'Everyone at CARE, with photos, badges and a line about them', 15, false,
        array['admin','hr','supervisor','qcd','senior','therapist']::public.app_role[], 3)
on conflict (key) do nothing;

commit;
