-- (keep) Portal 032b – Portal manager access + supervisors approve kudos (part 2 of 2)
--
-- Run AFTER 032a. A "Portal manager" (GM) runs the Portal like an admin:
-- People, logins and sign-in links, tabs, training content and approvals,
-- promotions, Learning Hub management, kudos. They do NOT see private office
-- work, which stays with Admin (and HR):
--   * Leave: everyone's requests, reasons, sessions, allowances, decisions,
--     families notified, arranging sessions
--   * CARE Connect: the Admin team inbox (incl. messages passed on to Admin)
-- Also: Supervisors can now approve kudos too.

begin;

-- 1. A manager counts as admin wherever the Portal checks for "admin"…
create or replace function private.has_any_role(roles public.app_role[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_roles sr
    join public.therapists t on t.id = sr.therapist_id
    where t.auth_user_id = (select auth.uid())
      and t.status <> 'exited'
      and (sr.role = any (roles) or (sr.role = 'manager' and 'admin' = any (roles)))
  )
$$;

-- 2. …except here: the exact roles only (Admin / HR office work).
create or replace function private.has_exact_role(roles public.app_role[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_roles sr
    join public.therapists t on t.id = sr.therapist_id
    where t.auth_user_id = (select auth.uid())
      and t.status <> 'exited'
      and sr.role = any (roles)
  )
$$;
revoke execute on function private.has_exact_role(public.app_role[]) from public, anon;
grant  execute on function private.has_exact_role(public.app_role[]) to authenticated;

-- Leave: Admin + HR only
create or replace function private.is_leave_team()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.has_exact_role(array['admin','hr']::public.app_role[])
$$;

create or replace function public.leave_decide(p_id uuid, p_approve boolean, p_note text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_exact_role(array['hr','admin']::public.app_role[]) then
    raise exception 'Only HR can approve or decline leave.';
  end if;
  update public.leave_requests
     set status = case when p_approve then 'approved' else 'declined' end,
         decided_by = private.current_therapist_id(), decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id and status = 'pending';
  if not found then raise exception 'This request is no longer waiting for a decision.'; end if;
end $$;

create or replace function public.leave_mark_notified(p_id uuid, p_date date)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_exact_role(array['admin']::public.app_role[]) then
    raise exception 'Only an admin can record that families were notified.';
  end if;
  update public.leave_requests
     set families_notified_on = coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date),
         notified_by = private.current_therapist_id()
   where id = p_id and status = 'approved';
  if not found then raise exception 'Only approved leave can be marked as notified.'; end if;
end $$;

create or replace function public.leave_session_arrange(
  p_session uuid, p_kind text, p_cover uuid, p_makeup_date date, p_makeup_time text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_exact_role(array['admin']::public.app_role[]) then
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

-- CARE Connect: the Admin team inbox is Admin + HR only
create or replace function private.connect_visible(p_send_to text, p_recipient uuid, p_forwarded timestamptz)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (p_send_to in ('admin','both') and private.has_exact_role(array['admin','hr']::public.app_role[]))
      or (p_send_to in ('sup','both')   and private.has_any_role(array['supervisor','qcd']::public.app_role[]))
      or (p_send_to = 'senior'          and private.has_any_role(array['senior']::public.app_role[]))
      or (p_send_to = 'person' and p_recipient = private.current_therapist_id())
      or (p_send_to = 'person' and p_forwarded is not null and private.has_exact_role(array['admin','hr']::public.app_role[]))
$$;

-- 3. Kudos: Admin, Portal manager and Supervisors approve
create or replace function public.connect_kudos_decide(p_message uuid, p_post boolean, p_text text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.has_any_role(array['admin','supervisor']::public.app_role[]) then
    raise exception 'Only an admin or a supervisor can post kudos.';
  end if;
  update public.connect_messages
     set kudos_status = case when p_post then 'posted' else 'declined' end,
         kudos_text = case when p_post then nullif(btrim(coalesce(p_text, '')), '') end,
         kudos_posted_at = case when p_post then now() end,
         kudos_by = private.current_therapist_id()
   where id = p_message and kudos_request;
  if not found then raise exception 'This isn''t a kudos request.'; end if;
end $$;

create or replace function public.connect_kudos_requests()
returns table (id uuid, body text, sender text, recipient text, send_to text, created_at timestamptz, sticker text)
language sql stable security definer
set search_path = ''
as $$
  select m.id, m.body,
         case when m.anonymous then null else coalesce(s.nickname, s.full_name) end,
         coalesce(r.nickname, r.full_name), m.send_to, m.created_at, m.sticker
  from public.connect_messages m
  left join public.therapists s on s.id = m.sender_id
  left join public.therapists r on r.id = m.recipient_id
  where m.kudos_status = 'requested' and private.has_any_role(array['admin','supervisor']::public.app_role[])
  order by m.created_at
$$;

commit;
