-- (keep) Portal 033 – Slack notifications
--
-- Run AFTER 032b. When something happens, the database posts a short message
-- (with a link to the Portal) to a Slack channel. Each channel has its own
-- "incoming webhook" address, kept in a locked table (never on GitHub; add them
-- with the private file "Slack webhooks (setup).sql").
--
--   admin-leave     new leave request · leave cancelled
--   tx-to-admin     CARE Connect to the Admin team · passed on to Admin ·
--                   training place waiting for approval
--   tx-to-sup       CARE Connect to Supervisors & QCD · reflection / assignment to review
--   tx-to-senior    CARE Connect to the Senior team
--   kudos-approval  kudos waiting for approval
--
-- Privacy: messages say only WHAT is waiting and from whom (never for anonymous
-- messages): no message text, reasons, reflections, scores or child details.
-- A Slack problem never stops anything in the Portal.

begin;

create extension if not exists pg_net with schema extensions;

-- 1. Webhook addresses (locked: only the database itself reads them) ------------------------------
create table if not exists private.slack_hooks (
  channel text primary key check (channel in ('admin-leave','tx-to-admin','tx-to-sup','tx-to-senior','kudos-approval')),
  url     text not null check (url ~ '^https://hooks\.slack\.com/'),
  active  boolean not null default true
);
revoke all on private.slack_hooks from public, anon, authenticated;
alter table private.slack_hooks enable row level security;   -- no policies: only the database's own functions read it

-- 2. Post to a channel (quietly does nothing if the channel isn't set up) ------------------------------
create or replace function private.slack_post(p_channel text, p_text text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  select url into v_url from private.slack_hooks where channel = p_channel and active;
  if v_url is null then return; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('text', p_text),
    headers := '{"Content-Type": "application/json"}'::jsonb);
exception when others then
  null;   -- never let Slack break the Portal
end $$;
revoke execute on function private.slack_post(text, text) from public, anon, authenticated;

create or replace function private.slack_link(p_page text, p_label text default 'Open in Portal')
returns text
language sql immutable
set search_path = ''
as $$ select '<https://carethailand.github.io/care-therapist-portal/#/' || p_page || '|' || p_label || ' →>' $$;

create or replace function private.slack_name(p_id uuid)
returns text
language sql stable security definer
set search_path = ''
as $$ select coalesce((select coalesce(nickname, full_name) from public.therapists where id = p_id), 'Someone') $$;

-- 3. Leave ---------------------------------------------------------------------------------------------------
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
  end if;
  return null;
end $$;
drop trigger if exists slack_leave on public.leave_requests;
create trigger slack_leave after insert or update of status on public.leave_requests
  for each row execute function private.slack_leave();

-- 4. CARE Connect ---------------------------------------------------------------------------------------------------
create or replace function private.slack_connect()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_from text := case when new.anonymous or new.sender_id is null then 'anonymous' else 'from ' || private.slack_name(new.sender_id) end;
  v_what text := '*New ' || case new.kind when 'idea' then 'idea' when 'concern' then 'concern' when 'problem' then 'problem'
                   when 'question' then 'question' else 'thank-you' end || '* ' || v_from;
begin
  if tg_op = 'INSERT' then
    if new.send_to in ('admin','both') then
      perform private.slack_post('tx-to-admin', '💬 ' || v_what || ' to the Admin team · ' || private.slack_link('connect'));
    end if;
    if new.send_to in ('sup','both') then
      perform private.slack_post('tx-to-sup', '💬 ' || v_what || ' to Supervisors & QCD · ' || private.slack_link('connect'));
    end if;
    if new.send_to = 'senior' then
      perform private.slack_post('tx-to-senior', '💬 ' || v_what || ' to the Senior team · ' || private.slack_link('connect'));
    end if;
    if new.kudos_status = 'requested' then
      perform private.slack_post('kudos-approval', '🌟 *Kudos waiting for approval* ' || v_from || ' · ' || private.slack_link('connect'));
    end if;
  else
    if new.forwarded_at is not null and old.forwarded_at is null then
      perform private.slack_post('tx-to-admin', '📨 *A message was passed on to the Admin team* · ' || private.slack_link('connect'));
    end if;
    if new.kudos_status = 'requested' and old.kudos_status is distinct from 'requested' then
      perform private.slack_post('kudos-approval', '🌟 *Kudos waiting for approval* ' || v_from || ' · ' || private.slack_link('connect'));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists slack_connect on public.connect_messages;
create trigger slack_connect after insert or update of forwarded_at, kudos_status on public.connect_messages
  for each row execute function private.slack_connect();

-- 5. Training + Learning Hub (waiting for someone) ------------------------------------------------------------------
create or replace function private.slack_training_place()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'recommended' and (tg_op = 'INSERT' or old.status is distinct from 'recommended') then
    perform private.slack_post('tx-to-admin', '🎓 *Training place waiting for approval* · '
      || private.slack_name(new.therapist_id) || ' · '
      || coalesce((select title from public.training_programs where key = new.program_key), new.program_key)
      || case when new.recommended_by is not null then ' (recommended by ' || private.slack_name(new.recommended_by) || ')' else '' end
      || ' · ' || private.slack_link('training'));
  end if;
  return null;
end $$;
drop trigger if exists slack_training_place on public.training_enrollments;
create trigger slack_training_place after insert or update of status on public.training_enrollments
  for each row execute function private.slack_training_place();

create or replace function private.slack_assignment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.submitted_at is distinct from new.submitted_at) then
    perform private.slack_post('tx-to-sup', '📎 *Assignment to review* · '
      || private.slack_name((select therapist_id from public.training_enrollments where id = new.enrollment_id))
      || ' · chapter ' || new.chapter || ' · ' || private.slack_link('training'));
  end if;
  return null;
end $$;
drop trigger if exists slack_assignment on public.training_submissions;
create trigger slack_assignment after insert or update of submitted_at on public.training_submissions
  for each row execute function private.slack_assignment();

create or replace function private.slack_reflection()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.slack_post('tx-to-sup', '📖 *Study reflection to review* · ' || private.slack_name(new.therapist_id)
    || coalesce(' · ' || (select title from public.learning_topics where code = new.topic_code), '')
    || ' · ' || private.slack_link('learning'));
  return null;
end $$;
drop trigger if exists slack_reflection on public.learning_reflections;
create trigger slack_reflection after insert on public.learning_reflections
  for each row execute function private.slack_reflection();

revoke execute on function private.slack_link(text, text), private.slack_name(uuid), private.slack_leave(),
  private.slack_connect(), private.slack_training_place(), private.slack_assignment(), private.slack_reflection()
  from public, anon, authenticated;

commit;
