-- (keep) Portal 010 – repair garbled characters
--
-- Earlier files were copied to the clipboard without Unicode, so characters
-- like • – — " " · and emoji arrived garbled (e.g. "‚Ä¢" instead of "•").
-- This file:
--   1. turns the garbled text back into the right characters in the ABAT
--      course content and in timeline entries, and
--   2. re-creates the three functions whose messages contain emoji.
-- Safe to run more than once.

begin;

create function pg_temp.unmangle(t text) returns text
language plpgsql immutable as $fix$
declare
  r record;
begin
  if t is null then return t; end if;
  for r in select * from (values
    ('üéâ', '🎉'),
    ('üéì', '🎓'),
    ('‚Äú', '“'),
    ('‚Äî', '—'),
    ('‚Üí', '→'),
    ('‚Ä¢', '•'),
    ('‚öô', '⚙'),
    ('‚Äì', '–'),
    ('‚Äô', '’'),
    ('Ô∏è', '️'),
    ('‚Äù', '”'),
    ('‚Ä¶', '…'),
    ('¬∑', '·'),
    ('¬ß', '§')
  ) as v(bad, good) order by length(bad) desc loop
    t := replace(t, r.bad, r.good);
  end loop;
  return t;
end $fix$;

update public.training_programs
   set title = pg_temp.unmangle(title), summary = pg_temp.unmangle(summary),
       certificate_title = pg_temp.unmangle(certificate_title), provider_name = pg_temp.unmangle(provider_name),
       certificate_note = pg_temp.unmangle(certificate_note);
update public.training_steps
   set title = pg_temp.unmangle(title), details = pg_temp.unmangle(details);
update public.training_items
   set title = pg_temp.unmangle(title), note = pg_temp.unmangle(note), body = pg_temp.unmangle(body);
update public.journey_events
   set title = pg_temp.unmangle(title)
 where title is distinct from pg_temp.unmangle(title);
update public.certificates
   set title = pg_temp.unmangle(title), full_name = pg_temp.unmangle(full_name)
 where title is distinct from pg_temp.unmangle(title) or full_name is distinct from pg_temp.unmangle(full_name);

comment on table public.therapists is 'One record per therapist — the identity every module hangs off. Staff data only, no child PHI.';

create or replace function private.promote_to_therapist()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if new.track = 'care_hire'
     and new.stage in ('probation', 'active')
     and old.stage not in ('probation', 'active')
     and exists (select 1 from public.staff_roles
                 where therapist_id = new.id and role = 'applicant') then

    insert into public.staff_roles (therapist_id, role, granted_by)
    values (new.id, 'therapist', private.current_therapist_id())
    on conflict do nothing;

    delete from public.staff_roles
     where therapist_id = new.id and role = 'applicant';

    insert into public.journey_events (therapist_id, stage, event_type, title, recorded_by)
    values (new.id, new.stage, 'became_therapist',
            'Became a CARE therapist 🎉', private.current_therapist_id());
  end if;
  return new;
end $$;

create or replace function private.issue_certificate(p_enrollment uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_e    public.training_enrollments;
  v_t    public.therapists;
  v_p    public.training_programs;
  v_id   uuid;
begin
  select id into v_id from public.certificates where enrollment_id = p_enrollment;
  if found then return v_id; end if;

  select * into v_e from public.training_enrollments where id = p_enrollment;
  select * into v_t from public.therapists           where id = v_e.therapist_id;
  select * into v_p from public.training_programs    where key = v_e.program_key;

  insert into public.certificates (code, therapist_id, program_key, enrollment_id, full_name, title)
  values ('CARE-' || upper(v_p.key) || '-'
            || to_char(now() at time zone 'Asia/Bangkok', 'YYYY') || '-'
            || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
          v_t.id, v_p.key, p_enrollment, v_t.full_name,
          coalesce(v_p.certificate_title, v_p.title))
  returning id into v_id;

  insert into public.journey_events (therapist_id, stage, event_type, title, recorded_by)
  values (v_t.id, v_t.stage, 'certificate', 'Certificate: ' || coalesce(v_p.certificate_title, v_p.title) || ' 🎓', null);
  return v_id;
end $$;

create or replace function private.exam_grade(p_attempt uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_att    public.exam_attempts;
  v_enr    public.training_enrollments;
  v_step   public.training_steps;
  v_prog   public.training_programs;
  v_t      public.therapists;
  v_score  numeric;
  v_total  numeric;
  v_mark   numeric;
  v_passed boolean;
begin
  select * into v_att from public.exam_attempts where id = p_attempt for update;
  if not found then raise exception 'Exam not found.'; end if;
  if v_att.status = 'submitted' then
    return jsonb_build_object('passed', v_att.passed, 'already', true);
  end if;

  select * into v_enr  from public.training_enrollments where id = v_att.enrollment_id;
  select * into v_step from public.training_steps       where id = v_att.step_id;
  select * into v_prog from public.training_programs    where key = v_enr.program_key;
  select * into v_t    from public.therapists           where id = v_enr.therapist_id;

  select coalesce(sum(q.points), 0),
         coalesce(sum(q.points) filter (where private.exam_is_correct(q.answer, d.answers -> (q.id::text))), 0)
    into v_total, v_score
  from private.exam_attempt_data d
  cross join lateral jsonb_array_elements(d.paper) as p(e)
  join private.exam_questions q on q.id = (p.e ->> 'q')::uuid
  where d.attempt_id = p_attempt;

  v_mark   := coalesce((v_step.config ->> 'pass_mark')::numeric, ceil(v_total * 0.85));
  v_passed := v_score >= v_mark;

  update public.exam_attempts
     set status = 'submitted',
         submitted_at = now(),
         score = v_score,
         total = v_total,
         passed = v_passed,
         time_used_min = greatest(1, ceil(extract(epoch from (least(now(), deadline) - started_at)) / 60))::int
   where id = p_attempt;

  insert into public.journey_events (therapist_id, stage, event_type, title, details, recorded_by)
  values (v_t.id, v_t.stage,
          case when v_passed then 'exam_passed' else 'exam_not_passed' end,
          v_step.title || case when v_passed then ': passed 🎉' else ': not passed' end,
          jsonb_build_object('attempt_id', p_attempt),
          null);

  if v_passed and coalesce((v_step.config ->> 'completes_program')::boolean, false) then
    update public.training_enrollments
       set status = 'passed', finished_on = (now() at time zone 'Asia/Bangkok')::date
     where id = v_enr.id;
    if v_prog.certificate then
      perform private.issue_certificate(v_enr.id);
    end if;
    -- ABAT learners have finished their journey.
    if v_prog.key = 'abat' and v_t.track = 'abat' and v_t.stage = 'online_course' then
      update public.therapists set stage = 'certified' where id = v_t.id;
    end if;
  end if;

  return jsonb_build_object('passed', v_passed);
end $$;

revoke execute on all functions in schema private from public;
grant  execute on function private.current_therapist_id()          to authenticated;
grant  execute on function private.has_any_role(public.app_role[]) to authenticated;
grant  execute on function private.is_training_team()              to authenticated;

-- Check: should show "•" and "–" correctly now.
select title, left(body, 120) as start_of_text from public.training_items
 where body is not null order by title limit 3;

commit;
