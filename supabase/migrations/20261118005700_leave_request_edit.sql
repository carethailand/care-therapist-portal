-- (keep) Portal 057 – Leave: change a request while it's still pending
--
-- Run AFTER 056. While a request is PENDING (HR hasn't decided yet) the therapist
-- can change it: type, dates, half day, number of days, reason and the sessions
-- they'll miss. Once approved, they use "Ask to cancel" (Portal 046) as before.
-- Admin / HR see "Changed <date>" on the request; the admin-leave Slack channel
-- gets a note (if Slack is set up). Case codes only (3 letters), never names.

begin;

alter table public.leave_requests add column if not exists edited_at timestamptz;

create or replace function public.leave_request_edit(
  p_id uuid, p_type text, p_kind text, p_reason text, p_start date, p_end date,
  p_half text, p_days numeric, p_sessions jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.leave_requests; s jsonb;
begin
  select * into r from public.leave_requests where id = p_id for update;
  if r.id is null or r.therapist_id is distinct from private.current_therapist_id() then
    raise exception 'This isn''t your leave request.';
  end if;
  if r.status <> 'pending' then
    raise exception 'HR has already decided this request. If it''s approved, use "Ask to cancel" instead.';
  end if;
  if jsonb_typeof(coalesce(p_sessions, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_sessions, '[]'::jsonb)) > 60 then
    raise exception 'The sessions list looks wrong.';
  end if;

  update public.leave_requests
     set type = p_type, kind = p_kind, reason = nullif(btrim(coalesce(p_reason, '')), ''),
         start_date = p_start, end_date = p_end, half_day = nullif(p_half, ''), days = p_days,
         edited_at = now()
   where id = p_id;

  delete from public.leave_sessions where request_id = p_id;
  for s in select * from jsonb_array_elements(coalesce(p_sessions, '[]'::jsonb)) loop
    if coalesce(s ->> 'case_code', '') !~ '^[A-Z]{3}$' then
      raise exception 'Each session needs a 3-letter case code (e.g. ABC).';
    end if;
    insert into public.leave_sessions (request_id, case_code, session_date, session_time)
    values (p_id, s ->> 'case_code', (s ->> 'session_date')::date, nullif(left(s ->> 'session_time', 20), ''));
  end loop;

  begin
    perform private.slack_post('admin-leave', '✏️ *Leave request changed* · ' || private.slack_name(r.therapist_id)
      || ' · ' || p_type || ' · ' || regexp_replace(p_days::text, '\.0$', '') || ' day' || case when p_days = 1 then '' else 's' end
      || ' (' || to_char(p_start, 'DD Mon') || case when p_end <> p_start then '–' || to_char(p_end, 'DD Mon') else '' end
      || ') · ' || private.slack_link('leave'));
  exception when others then null;   -- Slack is optional; never block the change
  end;
end $$;

revoke execute on function public.leave_request_edit(uuid, text, text, text, date, date, text, numeric, jsonb) from public, anon;
grant  execute on function public.leave_request_edit(uuid, text, text, text, date, date, text, numeric, jsonb) to authenticated;

commit;
