-- (keep) Portal 049 – QCD drafts kept in the Portal (private to the scorer)
--
-- Run AFTER 048. While a QCD / supervisor scores a live session, the draft is
-- saved in the Portal as well as on the device, so they can start on one device
-- and finish on another, and a cleared browser doesn't lose it.
-- A draft is visible ONLY to the person scoring (nobody else, not even admins in
-- the app) until they tap Save QCD; then it's deleted. One draft per scorer per
-- therapist. Drafts older than 30 days are cleared automatically. Small (~2 KB).

begin;

create table if not exists public.sv_drafts (
  scorer_id    uuid not null references public.therapists (id) on delete cascade,
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  form_key     text not null default 'qcd',
  form_version integer not null,
  state        jsonb not null,
  updated_at   timestamptz not null default now(),
  primary key (scorer_id, therapist_id, form_key)
);
alter table public.sv_drafts enable row level security;
revoke all on public.sv_drafts from public, anon, authenticated;

create or replace function public.sv_draft_get(p_who uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('version', d.form_version, 'state', d.state, 'updated_at', d.updated_at)
  from public.sv_drafts d
  where d.scorer_id = private.current_therapist_id() and d.therapist_id = p_who and d.form_key = 'qcd'
    and d.updated_at > now() - interval '30 days'
$$;

create or replace function public.sv_draft_put(p_who uuid, p_version integer, p_state jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_me uuid := private.current_therapist_id();
begin
  if not private.has_exact_role(array['qcd','supervisor']::public.app_role[]) then
    raise exception 'Only QCD and supervisors can score a QCD session.';
  end if;
  if p_who = v_me then raise exception 'You can''t score yourself.'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or pg_column_size(p_state) > 60000 then
    raise exception 'This draft looks wrong.';
  end if;
  insert into public.sv_drafts (scorer_id, therapist_id, form_key, form_version, state, updated_at)
  values (v_me, p_who, 'qcd', p_version, p_state, now())
  on conflict (scorer_id, therapist_id, form_key)
  do update set form_version = excluded.form_version, state = excluded.state, updated_at = now();
  delete from public.sv_drafts where scorer_id = v_me and updated_at < now() - interval '30 days';
end $$;

create or replace function public.sv_draft_delete(p_who uuid)
returns void language sql security definer set search_path = ''
as $$
  delete from public.sv_drafts
  where scorer_id = private.current_therapist_id() and therapist_id = p_who and form_key = 'qcd'
$$;

revoke execute on function public.sv_draft_get(uuid), public.sv_draft_put(uuid, integer, jsonb), public.sv_draft_delete(uuid) from public, anon;
grant  execute on function public.sv_draft_get(uuid), public.sv_draft_put(uuid, integer, jsonb), public.sv_draft_delete(uuid) to authenticated;

commit;
