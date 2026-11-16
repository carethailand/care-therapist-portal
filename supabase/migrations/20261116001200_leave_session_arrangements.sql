-- (keep) Portal 012 – leave: admin arranges missed sessions
--
-- Run AFTER 011. Changes who decides what happens to each missed session:
--   * the therapist only lists the sessions they'll miss (case code, date, time);
--   * an ADMIN then decides for each one: cancelled, covered by a colleague,
--     or a make-up session (date + time).
-- Sessions with no decision yet show as "waiting for admin".

begin;

-- 1. Let a session wait for the admin's decision, and allow "cancelled".
do $fix$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.leave_sessions'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%cover_kind%' or pg_get_constraintdef(oid) ilike '%makeup_date%')
  loop
    execute format('alter table public.leave_sessions drop constraint %I', c.conname);
  end loop;
end $fix$;

alter table public.leave_sessions alter column cover_kind drop not null;
alter table public.leave_sessions
  add column arranged_by uuid references public.therapists (id) on delete set null,
  add column arranged_at timestamptz,
  add constraint leave_sessions_cover_kind_check check (cover_kind in ('cover','makeup','cancelled')),
  add constraint leave_sessions_cover_needs_person check (cover_kind is distinct from 'cover' or covering_therapist_id is not null),
  add constraint leave_sessions_makeup_needs_date check (cover_kind is distinct from 'makeup' or makeup_date is not null);

-- 2. Therapists add sessions WITHOUT a decision (only the admin decides).
alter policy "leave_sessions: add own while pending" on public.leave_sessions
  with check (
    cover_kind is null and covering_therapist_id is null and makeup_date is null and makeup_time is null
    and arranged_by is null and arranged_at is null
    and exists (select 1 from public.leave_requests r
                where r.id = request_id and r.status = 'pending'
                  and r.therapist_id = (select private.current_therapist_id()))
  );

-- 3. The admin's decision for one session.
--    p_kind: 'cancelled' | 'cover' | 'makeup' | null (undo the decision)
create or replace function public.leave_session_arrange(
  p_session uuid, p_kind text, p_cover uuid, p_makeup_date date, p_makeup_time text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_any_role(array['admin']::public.app_role[]) then
    raise exception 'Only an admin can arrange missed sessions.';
  end if;
  if p_kind is not null and p_kind not in ('cancelled','cover','makeup') then
    raise exception 'Choose cancelled, covered or make-up.';
  end if;
  if p_kind = 'cover' and p_cover is null then raise exception 'Choose who covers the session.'; end if;
  if p_kind = 'makeup' and p_makeup_date is null then raise exception 'Give the make-up date.'; end if;

  update public.leave_sessions s
     set cover_kind = p_kind,
         covering_therapist_id = case when p_kind = 'cover' then p_cover end,
         makeup_date = case when p_kind = 'makeup' then p_makeup_date end,
         makeup_time = case when p_kind = 'makeup' then nullif(btrim(coalesce(p_makeup_time, '')), '') end,
         arranged_by = case when p_kind is null then null else private.current_therapist_id() end,
         arranged_at = case when p_kind is null then null else now() end
   where s.id = p_session
     and exists (select 1 from public.leave_requests r
                 where r.id = s.request_id and r.status in ('pending','approved'));
  if not found then raise exception 'This session can''t be changed (the leave was declined or cancelled).'; end if;
end $$;

revoke execute on function public.leave_session_arrange(uuid, text, uuid, date, text) from public, anon;
grant  execute on function public.leave_session_arrange(uuid, text, uuid, date, text) to authenticated;

commit;
