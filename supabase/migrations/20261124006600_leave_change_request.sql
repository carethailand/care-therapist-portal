-- (keep) Portal 066 – Leave: ask to change APPROVED leave
--
-- Run AFTER 065. An approved leave that hasn't ended yet can be changed with
-- "Ask to change" (type, dates, part of the day, days, reason, sessions):
--   * The change waits for Admin / HR. Until they decide, the leave stays approved
--     exactly as it was.
--   * Approve the change → the leave is updated. Sessions that are still on the list
--     keep their cover / make-up; new sessions need arranging. If the dates or sessions
--     changed, "families notified" is cleared so the families are told again.
--   * Keep as it was → nothing changes; the person sees Admin / HR's note.
--   * The person can withdraw the change while it's waiting.
-- Only one request at a time: a change OR a cancel request.
-- Slack: the admin-leave channel gets "Change request" (if Slack is set up).
-- Who decides: the same people who approve leave (Admin, HR). Case codes only.
-- Safe to run again.

begin;

alter table public.leave_requests
  add column if not exists change_requested_at timestamptz,
  add column if not exists change     jsonb,                 -- the new type, dates, days, reason, sessions
  add column if not exists change_note text check (char_length(change_note) <= 500),
  add column if not exists change_ok   boolean;              -- last decision: true approved, false kept as it was

-- 1. The person asks ------------------------------------------------------------------------------------
create or replace function public.leave_request_change(
  p_id uuid, p_type text, p_kind text, p_reason text, p_start date, p_end date,
  p_half text, p_days numeric, p_sessions jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.leave_requests; s jsonb; v_sessions jsonb := coalesce(p_sessions, '[]'::jsonb);
begin
  select * into r from public.leave_requests where id = p_id for update;
  if r.id is null or r.therapist_id is distinct from private.current_therapist_id() then
    raise exception 'This isn''t your leave.';
  end if;
  if r.status <> 'approved' or r.end_date < (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'Only approved leave that hasn''t ended can be changed from here.';
  end if;
  if r.cancel_requested_at is not null or r.change_requested_at is not null then
    raise exception 'A request for this leave is already waiting for Admin / HR.';
  end if;
  if not exists (select 1 from public.leave_types where code = p_type and active) then raise exception 'Choose a type of leave.'; end if;
  if (p_type = 'OL') <> (p_kind is not null) or (p_kind is not null and not exists (select 1 from public.leave_kinds where code = p_kind)) then
    raise exception 'Other leave needs a specific kind.';
  end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'Please check the dates.'; end if;
  if nullif(p_half, '') is not null and (p_half not in ('am','pm') or p_end <> p_start) then raise exception 'Part of a day needs the same first and last day.'; end if;
  if p_days is null or p_days <= 0 or p_days * 4 <> trunc(p_days * 4) or p_days > (p_end - p_start + 1) then
    raise exception 'Please check the number of days.';
  end if;
  if jsonb_typeof(v_sessions) <> 'array' or jsonb_array_length(v_sessions) > 60 then raise exception 'The sessions list looks wrong.'; end if;
  for s in select * from jsonb_array_elements(v_sessions) loop
    if coalesce(s ->> 'case_code', '') !~ '^[A-Z]{3}$' then raise exception 'Each session needs a 3-letter case code (e.g. ABC).'; end if;
    if coalesce(s ->> 'session_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Each session needs a date.'; end if;
  end loop;

  update public.leave_requests
     set change_requested_at = now(), change_note = null, change_ok = null,
         change = jsonb_build_object('type', p_type, 'kind', p_kind, 'reason', nullif(btrim(coalesce(p_reason, '')), ''),
                                     'start_date', p_start, 'end_date', p_end, 'half_day', nullif(p_half, ''),
                                     'days', p_days, 'sessions', v_sessions)
   where id = p_id;

  begin
    perform private.slack_post('admin-leave', '✏️ *Change request* · ' || private.slack_name(r.therapist_id)
      || ' asks to change ' || r.type || ' (' || to_char(r.start_date, 'DD Mon')
      || case when r.end_date <> r.start_date then '–' || to_char(r.end_date, 'DD Mon') else '' end
      || ') → ' || p_type || ' · ' || regexp_replace(p_days::text, '\.0$', '') || ' day' || case when p_days = 1 then '' else 's' end
      || ' (' || to_char(p_start, 'DD Mon') || case when p_end <> p_start then '–' || to_char(p_end, 'DD Mon') else '' end
      || ') · ' || private.slack_link('leave'));
  exception when others then null;   -- Slack is optional; never block the request
  end;
end $$;

-- The person withdraws it (before Admin / HR decide).
create or replace function public.leave_request_change_withdraw(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.leave_requests r
     set change_requested_at = null, change = null
   where r.id = p_id and r.therapist_id = private.current_therapist_id()
     and r.status = 'approved' and r.change_requested_at is not null;
  if not found then raise exception 'There is no change request to withdraw.'; end if;
end $$;

-- 2. Admin / HR decide ------------------------------------------------------------------------------------
create or replace function public.leave_change_decide(p_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.leave_requests; c jsonb; v_moved boolean;
begin
  if not private.is_leave_team() then raise exception 'Only Admin or HR can decide this.'; end if;
  select * into r from public.leave_requests where id = p_id for update;
  if r.id is null or r.status <> 'approved' or r.change_requested_at is null then raise exception 'This change request isn''t waiting any more.'; end if;
  c := r.change;

  if not coalesce(p_approve, false) then
    if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Please add a short note for the therapist.'; end if;
    update public.leave_requests
       set change_requested_at = null, change = null, change_note = left(btrim(p_note), 500), change_ok = false
     where id = p_id;
    return;
  end if;

  -- sessions no longer on the list go; new ones are added (to arrange); the rest keep their cover / make-up
  delete from public.leave_sessions s
   where s.request_id = p_id
     and not exists (select 1 from jsonb_array_elements(coalesce(c -> 'sessions', '[]'::jsonb)) x
                      where x ->> 'case_code' = s.case_code and (x ->> 'session_date')::date = s.session_date);
  insert into public.leave_sessions (request_id, case_code, session_date, session_time)
  select p_id, x ->> 'case_code', (x ->> 'session_date')::date, nullif(left(x ->> 'session_time', 20), '')
    from jsonb_array_elements(coalesce(c -> 'sessions', '[]'::jsonb)) x
   where not exists (select 1 from public.leave_sessions s
                      where s.request_id = p_id and s.case_code = x ->> 'case_code' and s.session_date = (x ->> 'session_date')::date);
  v_moved := found or (c ->> 'start_date')::date <> r.start_date or (c ->> 'end_date')::date <> r.end_date;

  update public.leave_requests
     set type = c ->> 'type', kind = nullif(c ->> 'kind', ''), reason = nullif(c ->> 'reason', ''),
         start_date = (c ->> 'start_date')::date, end_date = (c ->> 'end_date')::date,
         half_day = nullif(c ->> 'half_day', ''), days = (c ->> 'days')::numeric,
         edited_at = now(), change_requested_at = null, change = null,
         change_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), change_ok = true,
         families_notified_on = case when v_moved then null else families_notified_on end,
         notified_by = case when v_moved then null else notified_by end
   where id = p_id;
end $$;

-- 3. A cancel request can't be sent while a change is waiting ----------------------------------------------
create or replace function public.leave_request_cancel(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please say why you want to cancel (a few words).'; end if;
  update public.leave_requests r
     set cancel_requested_at = now(), cancel_reason = left(btrim(p_reason), 300), cancel_note = null
   where r.id = p_id
     and r.therapist_id = private.current_therapist_id()
     and r.status = 'approved'
     and r.cancel_requested_at is null
     and r.change_requested_at is null
     and r.end_date >= (now() at time zone 'Asia/Bangkok')::date;
  if not found then raise exception 'This leave can''t be cancelled from here (it may have ended already, or a request is already waiting).'; end if;
end $$;

revoke execute on function public.leave_request_change(uuid, text, text, text, date, date, text, numeric, jsonb),
  public.leave_request_change_withdraw(uuid), public.leave_change_decide(uuid, boolean, text) from public, anon;
grant execute on function public.leave_request_change(uuid, text, text, text, date, date, text, numeric, jsonb),
  public.leave_request_change_withdraw(uuid), public.leave_change_decide(uuid, boolean, text) to authenticated;

commit;
