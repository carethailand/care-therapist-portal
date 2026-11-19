-- (keep) Portal 046 – Leave: therapists ask to cancel approved leave
--
-- Run AFTER 045.
--   * A PENDING request: the therapist can still cancel it straight away (as before).
--   * An APPROVED leave that hasn't ended yet: the therapist taps "Ask to cancel"
--     (with a short reason). It goes back to Admin / HR as a cancel request; the
--     leave stays approved until they decide:
--       - Approve the cancel → the leave is cancelled (days come back to the balance)
--       - Keep the leave     → it stays approved; the therapist sees the note
--   * Slack: the admin-leave channel gets "Cancel request" (if Slack is set up).
-- Who decides: the same people who approve leave (Admin, HR).

begin;

alter table public.leave_requests
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancel_reason text check (char_length(cancel_reason) <= 300),
  add column if not exists cancel_note   text check (char_length(cancel_note) <= 500);

-- The therapist asks.
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
     and r.end_date >= (now() at time zone 'Asia/Bangkok')::date;
  if not found then raise exception 'This leave can''t be cancelled from here (it may have ended already, or a request is already waiting).'; end if;
end $$;

-- The therapist changes their mind (before Admin / HR decide).
create or replace function public.leave_request_cancel_withdraw(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.leave_requests r
     set cancel_requested_at = null, cancel_reason = null
   where r.id = p_id and r.therapist_id = private.current_therapist_id()
     and r.status = 'approved' and r.cancel_requested_at is not null;
  if not found then raise exception 'There is no cancel request to withdraw.'; end if;
end $$;

-- Admin / HR decide.
create or replace function public.leave_cancel_decide(p_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_leave_team() then raise exception 'Only Admin or HR can decide this.'; end if;
  if p_approve then
    update public.leave_requests
       set status = 'cancelled', cancel_note = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_id and status = 'approved' and cancel_requested_at is not null;
  else
    if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Please add a short note for the therapist.'; end if;
    update public.leave_requests
       set cancel_requested_at = null, cancel_note = left(btrim(p_note), 500)
     where id = p_id and status = 'approved' and cancel_requested_at is not null;
  end if;
  if not found then raise exception 'This cancel request isn''t waiting any more.'; end if;
end $$;

revoke execute on function public.leave_request_cancel(uuid, text), public.leave_request_cancel_withdraw(uuid),
                           public.leave_cancel_decide(uuid, boolean, text) from public, anon;
grant  execute on function public.leave_request_cancel(uuid, text), public.leave_request_cancel_withdraw(uuid),
                           public.leave_cancel_decide(uuid, boolean, text) to authenticated;

-- Slack: tell the admin-leave channel about a cancel request (as for new requests).
create or replace function private.slack_leave()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_when text := to_char(new.start_date, 'DD Mon') ||
                 case when new.end_date <> new.start_date then '–' || to_char(new.end_date, 'DD Mon') else '' end;
begin
  if tg_op = 'INSERT' then
    perform private.slack_post('admin-leave', '🏖️ *New leave request* · ' || private.slack_name(new.therapist_id)
      || ' · ' || new.type || ' · ' || regexp_replace(new.days::text, '\.0$', '') || ' day' || case when new.days = 1 then '' else 's' end
      || ' (' || v_when || ') · ' || private.slack_link('leave'));
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    perform private.slack_post('admin-leave', '↩️ *Leave cancelled* · ' || private.slack_name(new.therapist_id)
      || ' · ' || new.type || ' (' || v_when || ') · ' || private.slack_link('leave'));
  elsif new.cancel_requested_at is not null and old.cancel_requested_at is null then
    perform private.slack_post('admin-leave', '🙋 *Cancel request* · ' || private.slack_name(new.therapist_id)
      || ' asks to cancel ' || new.type || ' (' || v_when || ') · ' || private.slack_link('leave'));
  end if;
  return null;
end $$;
drop trigger if exists slack_leave on public.leave_requests;
create trigger slack_leave after insert or update of status, cancel_requested_at on public.leave_requests
  for each row execute function private.slack_leave();

commit;
