-- (keep) Portal setup – add a staff member
--
-- Use this to add yourself as the first admin, and anyone else in Phase 0
-- (before the in-app staff screen exists).
--
-- 1. Fill in the three lines marked  <-- below.
-- 2. Run it. It is safe to run twice: it updates the name and adds any
--    missing roles, and never removes anything.
-- 3. Then create their login (Authentication → Users → Add user) with the
--    SAME email. The login and the record link themselves automatically,
--    whichever you do first.
--
-- Do NOT save a filled-in copy of this file to GitHub — the repo is public.

do $$
declare
  v_email text              := 'REPLACE-WITH-EMAIL';            -- <--
  v_name  text              := 'REPLACE-WITH-FULL-NAME';        -- <--
  v_roles public.app_role[] := array['therapist']::public.app_role[];
                               -- <-- e.g. array['admin','supervisor','therapist']
  v_stage public.journey_stage := 'active';  -- 'interview' for a brand-new hire
  v_id    uuid;
begin
  if v_email like 'REPLACE%' or v_name like 'REPLACE%' then
    raise exception 'Please fill in the email and name at the top first.';
  end if;

  insert into public.therapists (email, full_name, stage, status, accepted_on)
  values (trim(v_email), trim(v_name), v_stage, 'active',
          (now() at time zone 'Asia/Bangkok')::date)
  on conflict ((lower(email))) do update set full_name = excluded.full_name
  returning id into v_id;

  insert into public.staff_roles (therapist_id, role)
  select v_id, r from unnest(v_roles) as r
  on conflict do nothing;

  raise notice 'Done: % (%) now has roles %', v_name, v_email, v_roles;
end $$;
