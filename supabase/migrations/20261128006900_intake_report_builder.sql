-- (keep) Portal 069 – Reports & Forms: intake report builder
--
-- Run AFTER 068. Adds the INTAKE REPORT BUILDER to Reports & Forms.
-- PRIVACY: the report itself is NEVER saved here. The supervisor fills it in the browser and
--   downloads Word / PDF (and, if they want, a draft file on their own computer). The Portal
--   keeps only the TEMPLATE: standard wording (English + Thai) and the lesson library.
--   No child names, dates of birth or clinical notes ever reach the database.
-- Who:
--   write a report ....... Supervisors (rank Supervisor)
--   edit the template .... Supervisors + Admin
--   signature picture .... each supervisor uploads their OWN. Only that person can see it
--                          (no one else, not even admins; admins may only remove one).
-- The template content (wording + 230 lessons) is NOT in this file (the repo is public):
-- Songg runs the private import file from the "Portal people" folder after this one.
-- Everything goes through the functions below (RLS on, no direct table access).
-- Safe to run again.

begin;

-- 1. Tables ----------------------------------------------------------------------------------------------
create table if not exists public.intake_wording (
  key        text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  lang       text not null check (lang in ('en', 'th')),
  body       text not null default '' check (length(body) <= 6000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.therapists (id),
  primary key (key, lang)
);
alter table public.intake_wording enable row level security;   -- no policies: functions only

create table if not exists public.intake_lessons (
  id         uuid primary key default gen_random_uuid(),
  area       text not null check (area in ('social','language','ef','cognition','motor','adaptive','academic','play')),
  name_en    text not null check (length(btrim(name_en)) between 1 and 120),
  name_th    text check (length(name_th) <= 160),
  expl_en    text check (length(expl_en) <= 2000),
  expl_th    text check (length(expl_th) <= 2000),
  sort       int  not null default 0,
  active     boolean not null default true,              -- never deleted, only hidden
  updated_at timestamptz not null default now(),
  updated_by uuid references public.therapists (id)
);
create unique index if not exists intake_lessons_name on public.intake_lessons (area, lower(btrim(name_en)));
alter table public.intake_lessons enable row level security;   -- no policies: functions only

create table if not exists public.intake_signers (
  therapist_id uuid primary key references public.therapists (id),
  sign_name    text check (length(sign_name) <= 120),
  title        text check (length(title) <= 120),
  credentials  text check (length(credentials) <= 120),
  sig_path     text check (length(sig_path) <= 300),
  updated_at   timestamptz not null default now()
);
alter table public.intake_signers enable row level security;   -- no policies: functions only

-- 2. Who -------------------------------------------------------------------------------------------------
create or replace function private.intake_writer()
returns boolean language sql stable security definer set search_path = ''
as $$ select private.has_exact_role(array['supervisor']::public.app_role[]) $$;
revoke execute on function private.intake_writer() from public, anon;
grant  execute on function private.intake_writer() to authenticated;

create or replace function private.intake_editor()
returns boolean language sql stable security definer set search_path = ''
as $$ select private.intake_writer() or private.has_any_role(array['admin']::public.app_role[]) $$;
revoke execute on function private.intake_editor() from public, anon;
grant  execute on function private.intake_editor() to authenticated;

create or replace function public.intake_role()
returns jsonb language sql stable security definer set search_path = ''
as $$ select jsonb_build_object('write', private.intake_writer(), 'edit', private.intake_editor()) $$;

-- 3. Read the template -----------------------------------------------------------------------------------
create or replace function public.intake_template()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_edit boolean := private.intake_editor();
begin
  if not v_edit then raise exception 'Only supervisors and admins can use the intake report builder.'; end if;
  return jsonb_build_object(
    'wording', coalesce((select jsonb_agg(jsonb_build_object('key', w.key, 'lang', w.lang, 'body', w.body) order by w.key, w.lang)
                         from public.intake_wording w), '[]'::jsonb),
    'lessons', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'area', l.area, 'name_en', l.name_en, 'name_th', l.name_th,
                                  'expl_en', l.expl_en, 'expl_th', l.expl_th, 'sort', l.sort, 'active', l.active)
                                order by l.area, l.sort, l.name_en)
                         from public.intake_lessons l), '[]'::jsonb));
end $$;

-- 4. Edit the template (Supervisors + Admin) -------------------------------------------------------------
create or replace function public.intake_wording_save(p_key text, p_lang text, p_body text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.intake_editor() then raise exception 'Only supervisors and admins can change the intake template.'; end if;
  insert into public.intake_wording (key, lang, body, updated_at, updated_by)
  values (p_key, p_lang, coalesce(p_body, ''), now(), private.current_therapist_id())
  on conflict (key, lang) do update set body = excluded.body, updated_at = now(), updated_by = excluded.updated_by;
end $$;

create or replace function public.intake_lesson_save(p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if not private.intake_editor() then raise exception 'Only supervisors and admins can change the lesson library.'; end if;
  if coalesce(btrim(p->>'name_en'), '') = '' then raise exception 'Give the lesson an English name.'; end if;
  if v_id is null then
    insert into public.intake_lessons (area, name_en, name_th, expl_en, expl_th, sort, updated_by)
    values (p->>'area', btrim(p->>'name_en'), nullif(btrim(p->>'name_th'), ''), nullif(btrim(p->>'expl_en'), ''),
            nullif(btrim(p->>'expl_th'), ''), coalesce((p->>'sort')::int, 999), private.current_therapist_id())
    returning id into v_id;
  else
    update public.intake_lessons
       set area = p->>'area', name_en = btrim(p->>'name_en'), name_th = nullif(btrim(p->>'name_th'), ''),
           expl_en = nullif(btrim(p->>'expl_en'), ''), expl_th = nullif(btrim(p->>'expl_th'), ''),
           updated_at = now(), updated_by = private.current_therapist_id()
     where id = v_id;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'That lesson is already in this area.';
end $$;

create or replace function public.intake_lesson_set_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.intake_editor() then raise exception 'Only supervisors and admins can change the lesson library.'; end if;
  update public.intake_lessons set active = coalesce(p_active, true), updated_at = now(), updated_by = private.current_therapist_id()
   where id = p_id;
end $$;

-- 5. My signature block ----------------------------------------------------------------------------------
create or replace function public.intake_signer_me()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'sign_name',   coalesce(s.sign_name, t.full_name),
    'title',       coalesce(s.title, 'CARE Clinical Supervisor'),
    'credentials', s.credentials,
    'sig_path',    s.sig_path)
  from public.therapists t
  left join public.intake_signers s on s.therapist_id = t.id
  where t.id = private.current_therapist_id() and private.intake_writer()
$$;

create or replace function public.intake_signer_save(p_name text, p_title text, p_credentials text, p_sig_path text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_me uuid := private.current_therapist_id();
begin
  if not private.intake_writer() then raise exception 'Only supervisors sign intake reports.'; end if;
  if p_sig_path is not null and split_part(p_sig_path, '/', 1) <> v_me::text then
    raise exception 'That isn''t your signature file.';
  end if;
  insert into public.intake_signers (therapist_id, sign_name, title, credentials, sig_path, updated_at)
  values (v_me, nullif(btrim(p_name), ''), nullif(btrim(p_title), ''), nullif(btrim(p_credentials), ''), p_sig_path, now())
  on conflict (therapist_id) do update
    set sign_name = excluded.sign_name, title = excluded.title, credentials = excluded.credentials,
        sig_path = excluded.sig_path, updated_at = now();
end $$;

revoke execute on function public.intake_role() from public, anon;
revoke execute on function public.intake_template() from public, anon;
revoke execute on function public.intake_wording_save(text, text, text) from public, anon;
revoke execute on function public.intake_lesson_save(jsonb) from public, anon;
revoke execute on function public.intake_lesson_set_active(uuid, boolean) from public, anon;
revoke execute on function public.intake_signer_me() from public, anon;
revoke execute on function public.intake_signer_save(text, text, text, text) from public, anon;
grant execute on function public.intake_role() to authenticated;
grant execute on function public.intake_template() to authenticated;
grant execute on function public.intake_wording_save(text, text, text) to authenticated;
grant execute on function public.intake_lesson_save(jsonb) to authenticated;
grant execute on function public.intake_lesson_set_active(uuid, boolean) to authenticated;
grant execute on function public.intake_signer_me() to authenticated;
grant execute on function public.intake_signer_save(text, text, text, text) to authenticated;

-- 6. Signature store: private, each supervisor sees ONLY their own ---------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signatures', 'signatures', false, 1048576, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/png','image/jpeg','image/webp'];

drop policy if exists "signatures: own read"    on storage.objects;
drop policy if exists "signatures: own add"     on storage.objects;
drop policy if exists "signatures: own replace" on storage.objects;
drop policy if exists "signatures: own remove"  on storage.objects;

-- Files live in a folder named after the person's id: <therapist id>/sig-….png
create policy "signatures: own read" on storage.objects
  for select to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = (select private.current_therapist_id())::text);

create policy "signatures: own add" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'signatures' and (select private.intake_writer())
              and (storage.foldername(name))[1] = (select private.current_therapist_id())::text);

create policy "signatures: own replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = (select private.current_therapist_id())::text)
  with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = (select private.current_therapist_id())::text);

create policy "signatures: own remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'signatures'
         and ((storage.foldername(name))[1] = (select private.current_therapist_id())::text
              or (select private.has_any_role(array['admin']::public.app_role[]))));

-- 7. Tab description -------------------------------------------------------------------------------------
update public.app_modules set description = 'Incident reports, intake reports and other forms' where key = 'documents';

commit;
