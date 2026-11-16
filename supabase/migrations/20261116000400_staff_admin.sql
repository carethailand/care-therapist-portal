-- (keep) Portal 004 – staff page rules
--
-- For the Admin → Staff page:
--   1. HR may give or remove the plain 'therapist' role (so HR can onboard
--      new hires). Every other role (senior, supervisor, hr, admin) stays admin-only.
--   2. Safety guard: the Portal can never be left without an active admin.
--      Removing the last admin role, or marking the last admin as exited,
--      is refused with a clear message.

begin;

-- 0. The staff-admin Edge Function (server side, secret key) needs to read
--    these two tables. "Automatically expose new tables" is off, so say so.
grant select on public.therapists, public.staff_roles to service_role;

-- 1. HR can manage the 'therapist' role --------------------------------------
drop policy "staff_roles: admin grant"  on public.staff_roles;
drop policy "staff_roles: admin remove" on public.staff_roles;

create policy "staff_roles: admin grant any, hr grant therapist"
  on public.staff_roles for insert to authenticated
  with check (
    (select private.has_any_role(array['admin']::public.app_role[]))
    or (role = 'therapist' and (select private.has_any_role(array['hr']::public.app_role[])))
  );

create policy "staff_roles: admin remove any, hr remove therapist"
  on public.staff_roles for delete to authenticated
  using (
    (select private.has_any_role(array['admin']::public.app_role[]))
    or (role = 'therapist' and (select private.has_any_role(array['hr']::public.app_role[])))
  );

-- 2. Never leave the Portal without an admin ---------------------------------
create or replace function private.active_admin_count(excluding_therapist uuid)
returns integer
language sql stable security definer
set search_path = ''
as $$
  select count(*)::int
  from public.staff_roles sr
  join public.therapists t on t.id = sr.therapist_id
  where sr.role = 'admin'
    and t.status <> 'exited'
    and t.id <> excluding_therapist
$$;
revoke execute on function private.active_admin_count(uuid) from public;

create or replace function private.guard_last_admin_role()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and private.active_admin_count(old.therapist_id) = 0 then
    raise exception 'This is the last admin. Make someone else an admin first.';
  end if;
  return old;
end $$;

create trigger staff_roles_guard_last_admin
  before delete on public.staff_roles
  for each row execute function private.guard_last_admin_role();

create or replace function private.guard_last_admin_exit()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'exited' and old.status <> 'exited'
     and exists (select 1 from public.staff_roles
                 where therapist_id = new.id and role = 'admin')
     and private.active_admin_count(new.id) = 0 then
    raise exception 'This is the last admin. Make someone else an admin first.';
  end if;
  return new;
end $$;

create trigger therapists_guard_last_admin
  before update of status on public.therapists
  for each row execute function private.guard_last_admin_exit();

commit;
