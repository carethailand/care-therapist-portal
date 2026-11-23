-- (keep) Portal 063 – Supervisor evaluation, part 2: due dates
--
-- Run AFTER 062. Works out each supervisor's NEXT evaluation and when it's due:
--   First year as a supervisor ... 6-month, then 12-month (from "supervisor since").
--   After that ................... a mid-year check-in 6 months after the last 12-month /
--                                  annual, then the annual 12 months after it. (If the
--                                  check-in was skipped and 10 months have passed, the
--                                  annual is next.)
-- Counted as done: evaluations finished in the Portal, plus "past evaluations" typed in
-- for dates before the Portal (date and type only, no scores).
-- Status: overdue (date passed) · due soon (within 30 days) · on track.
-- Who: the evaluator and Admin (the exact Admin role) see and set the dates.
-- Safe to run again.

begin;

create table if not exists public.sv_sup_schedule (
  therapist_id uuid primary key references public.therapists (id) on delete cascade,
  since        date,                                   -- started as a supervisor
  updated_by   uuid references public.therapists (id) on delete set null,
  updated_at   timestamptz not null default now()
);
create table if not exists public.sv_sup_past (
  id           uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.therapists (id) on delete cascade,
  kind         text not null check (kind in ('6_month','12_month','annual','check_in','extra')),
  eval_on      date not null,
  created_by   uuid references public.therapists (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (therapist_id, kind, eval_on)
);
alter table public.sv_sup_schedule enable row level security;
alter table public.sv_sup_past enable row level security;
revoke all on public.sv_sup_schedule, public.sv_sup_past from public, anon, authenticated;

create or replace function private.sv_sup_planner()
returns boolean language sql stable security definer set search_path = ''
as $$ select private.sv_sup_is_evaluator() or private.has_exact_role(array['admin']::public.app_role[]) $$;
revoke execute on function private.sv_sup_planner() from public, anon;
grant  execute on function private.sv_sup_planner() to authenticated;

-- The next evaluation for one supervisor: {kind, due_on, status} (null if nothing is known yet).
create or replace function private.sv_sup_due(p_who uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_since date; v_6 date; v_last date; v_ci date;
  v_kind text; v_on date;
begin
  select since into v_since from public.sv_sup_schedule where therapist_id = p_who;
  with ev as (
    select kind, eval_on from public.sv_sup_evals where therapist_id = p_who and ready_at is not null
    union all
    select kind, eval_on from public.sv_sup_past where therapist_id = p_who
  )
  select max(eval_on) filter (where kind = '6_month'), max(eval_on) filter (where kind in ('12_month','annual'))
    into v_6, v_last from ev;

  if v_last is null then
    if v_6 is null then
      if v_since is null then return null; end if;
      v_kind := '6_month'; v_on := (v_since + interval '6 months')::date;
    else
      v_kind := '12_month'; v_on := coalesce((v_since + interval '12 months')::date, (v_6 + interval '6 months')::date);
    end if;
  else
    select max(eval_on) into v_ci from (
      select kind, eval_on from public.sv_sup_evals where therapist_id = p_who and ready_at is not null
      union all
      select kind, eval_on from public.sv_sup_past where therapist_id = p_who) x
     where x.kind = 'check_in' and x.eval_on > v_last;
    if v_ci is null and current_date < (v_last + interval '10 months')::date then
      v_kind := 'check_in'; v_on := (v_last + interval '6 months')::date;
    else
      v_kind := 'annual'; v_on := (v_last + interval '12 months')::date;
    end if;
  end if;
  return jsonb_build_object('kind', v_kind, 'due_on', v_on,
    'status', case when v_on < current_date then 'overdue' when v_on <= current_date + 30 then 'soon' else 'ok' end);
end $$;
revoke execute on function private.sv_sup_due(uuid) from public, anon, authenticated;

-- Evaluator / Admin: every supervisor's start date, past evaluations and next one due.
create or replace function public.sv_sup_schedule_list()
returns table (id uuid, since date, past jsonb, due jsonb)
language sql stable security definer set search_path = ''
as $$
  select t.id, s.since,
         coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'eval_on', p.eval_on) order by p.eval_on desc)
                     from public.sv_sup_past p where p.therapist_id = t.id), '[]'::jsonb),
         private.sv_sup_due(t.id)
  from public.therapists t
  left join public.sv_sup_schedule s on s.therapist_id = t.id
  where private.sv_sup_planner()
    and t.status <> 'exited'
    and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role = 'supervisor')
$$;

create or replace function public.sv_sup_set_since(p_who uuid, p_since date)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.sv_sup_planner() then raise exception 'Only the evaluator or Admin can do this.'; end if;
  if p_since is not null and (p_since > current_date + 366 or p_since < date '2000-01-01') then raise exception 'Check the date.'; end if;
  insert into public.sv_sup_schedule (therapist_id, since, updated_by) values (p_who, p_since, private.current_therapist_id())
  on conflict (therapist_id) do update set since = excluded.since, updated_by = excluded.updated_by, updated_at = now();
end $$;

create or replace function public.sv_sup_past_add(p_who uuid, p_kind text, p_on date)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.sv_sup_planner() then raise exception 'Only the evaluator or Admin can do this.'; end if;
  if p_kind is null or p_kind not in ('6_month','12_month','annual','check_in','extra') then raise exception 'Choose the type.'; end if;
  if p_on is null or p_on > current_date or p_on < date '2000-01-01' then raise exception 'Check the date (it must be in the past).'; end if;
  if not exists (select 1 from public.staff_roles where therapist_id = p_who and role = 'supervisor') then raise exception 'This person isn’t a supervisor.'; end if;
  insert into public.sv_sup_past (therapist_id, kind, eval_on, created_by) values (p_who, p_kind, p_on, private.current_therapist_id())
  on conflict do nothing;
end $$;

create or replace function public.sv_sup_past_delete(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.sv_sup_planner() then raise exception 'Only the evaluator or Admin can do this.'; end if;
  delete from public.sv_sup_past where id = p_id;
end $$;

revoke execute on function public.sv_sup_schedule_list(), public.sv_sup_set_since(uuid, date),
  public.sv_sup_past_add(uuid, text, date), public.sv_sup_past_delete(uuid) from public, anon;
grant execute on function public.sv_sup_schedule_list(), public.sv_sup_set_since(uuid, date),
  public.sv_sup_past_add(uuid, text, date), public.sv_sup_past_delete(uuid) to authenticated;

commit;
