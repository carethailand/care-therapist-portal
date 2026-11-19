-- (keep) Portal 048 – QCD live observation: raw tallies + counted / rated items
--
-- Run AFTER 047.
--   * sv_records.tallies: the raw data from a live QCD: { item: { c: correct, n: chances } }
--     (about 1 KB a session). The 0-3 score of each item is still saved too; at year end
--     the tallies can be added up across sessions for a score based on all the data.
--   * The QCD checklist gets a new version: Professionalism items are RATED 0-3, the
--     rest are COUNTED with tick / cross. Score rule (from the master, as percentages):
--     Junior 70% = 3, 50% = 2, 30% = 1; Senior / QCD 90% / 70% / 50%; at least 3 chances.
--     Supervisors can change any of this in the checklist editor. Recorded sessions keep
--     the version they were scored with.

begin;

alter table public.sv_records add column if not exists tallies jsonb not null default '{}'::jsonb;

drop function if exists public.sv_record_save(uuid, uuid, date, text, text, jsonb, jsonb);
create function public.sv_record_save(p_id uuid, p_who uuid, p_held_on date, p_case text,
                                       p_level text, p_scores jsonb, p_notes jsonb, p_tallies jsonb default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_ver integer; v_body jsonb; v_calc jsonb; v_id uuid;
  v_case text := nullif(upper(btrim(coalesce(p_case, ''))), '');
  v_old public.sv_records;
  k text; v jsonb; v_max integer; v_keys text[];
begin
  if not private.has_exact_role(array['qcd','supervisor']::public.app_role[]) then
    raise exception 'Only QCD and supervisors can record a QCD session.';
  end if;
  if p_who = v_me then raise exception 'Ask another QCD or supervisor to score your own session.'; end if;
  if p_level not in ('junior','senior','supervisor') then raise exception 'Choose the level.'; end if;
  if p_held_on is null or p_held_on > (now() at time zone 'Asia/Bangkok')::date then raise exception 'Choose the session date (not in the future).'; end if;
  if v_case is not null and v_case !~ '^[A-Z]{3}$' then raise exception 'Case code: 3 letters (e.g. ABC), never a name.'; end if;
  if not exists (select 1 from public.therapists t where t.id = p_who and t.status <> 'exited' and t.track = 'care_hire') then
    raise exception 'Person not found.';
  end if;

  if p_id is not null then
    select * into v_old from public.sv_records where id = p_id;
    if not found then raise exception 'Session not found.'; end if;
    if v_old.recorded_by <> v_me and not private.has_exact_role(array['supervisor']::public.app_role[]) then
      raise exception 'Only the person who recorded it (or a supervisor) can change it.';
    end if;
    v_ver := v_old.form_version;           -- keep the checklist it was scored with
  else
    select version into v_ver from public.sv_forms where key = 'qcd';
  end if;
  select body into v_body from public.sv_form_versions where form_key = 'qcd' and version = v_ver;

  -- every score must be an item for this level, 0..max or "na"
  v_max := coalesce((v_body #>> '{scale,max}')::integer, 3);
  select array_agg(i ->> 'key') into v_keys
  from jsonb_array_elements(v_body -> 'sections') s, jsonb_array_elements(s -> 'items') i
  where (i -> 'levels') ? p_level;
  if v_keys is null then raise exception 'This checklist has no items for this level yet.'; end if;
  for k, v in select * from jsonb_each(coalesce(p_scores, '{}'::jsonb)) loop
    if not (k = any (v_keys)) then raise exception 'A score doesn''t match the checklist. Refresh and try again.'; end if;
    if not ((jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric in (0,1,2,3,4) and (v #>> '{}')::numeric <= v_max)
            or (jsonb_typeof(v) = 'string' and v #>> '{}' = 'na')) then
      raise exception 'Scores are 0 to % or N/A.', v_max;
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(coalesce(p_scores, '{}'::jsonb))) = 0 then raise exception 'Score at least one item.'; end if;
  -- raw tallies: { item: { c: correct, n: chances } }, 0..200, c <= n
  for k, v in select * from jsonb_each(coalesce(p_tallies, '{}'::jsonb)) loop
    if not (k = any (v_keys)) then raise exception 'A tally doesn''t match the checklist. Refresh and try again.'; end if;
    if jsonb_typeof(v) <> 'object' or coalesce(jsonb_typeof(v -> 'c'), '') <> 'number' or coalesce(jsonb_typeof(v -> 'n'), '') <> 'number'
       or (v ->> 'c')::numeric < 0 or (v ->> 'n')::numeric > 200 or (v ->> 'c')::numeric > (v ->> 'n')::numeric
       or (v ->> 'c')::numeric <> floor((v ->> 'c')::numeric) or (v ->> 'n')::numeric <> floor((v ->> 'n')::numeric) then
      raise exception 'Tallies look wrong. Refresh and try again.';
    end if;
  end loop;

  v_calc := private.sv_score(v_body, p_level, p_scores);
  if p_id is null then
    insert into public.sv_records (form_key, form_version, therapist_id, level, held_on, case_code, scores, tallies, sections, total, notes, recorded_by)
    values ('qcd', v_ver, p_who, p_level, p_held_on, v_case, p_scores, coalesce(p_tallies, '{}'::jsonb), v_calc -> 'sections', (v_calc ->> 'total')::numeric,
            coalesce(p_notes, '{}'::jsonb), v_me)
    returning id into v_id;
  else
    update public.sv_records
       set level = p_level, held_on = p_held_on, case_code = v_case, scores = p_scores, tallies = coalesce(p_tallies, '{}'::jsonb),
           sections = v_calc -> 'sections', total = (v_calc ->> 'total')::numeric,
           notes = coalesce(p_notes, '{}'::jsonb), updated_at = now()
     where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end $$;


create or replace function public.sv_records(p_who uuid, p_year integer)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'form_key', r.form_key, 'form_version', r.form_version, 'level', r.level,
           'held_on', r.held_on, 'case_code', r.case_code, 'scores', r.scores, 'sections', r.sections,
           'total', r.total, 'notes', r.notes, 'tallies', r.tallies, 'recorded_by', r.recorded_by,
           'recorder', private.onb_name(r.recorded_by), 'recorded_at', r.recorded_at)
         order by r.held_on desc, r.recorded_at desc), '[]'::jsonb)
  from public.sv_records r
  where r.therapist_id = p_who and r.form_key = 'qcd'
    and extract(year from r.held_on) = p_year
    and (p_who = private.current_therapist_id() or private.sv_team())
$$;


revoke execute on function public.sv_record_save(uuid, uuid, date, text, text, jsonb, jsonb, jsonb) from public, anon;
grant  execute on function public.sv_record_save(uuid, uuid, date, text, text, jsonb, jsonb, jsonb) to authenticated;

-- New checklist version: mode per item (rate / count) + the score rule.
do $$
declare v_ver integer; v_body jsonb; v_new jsonb;
begin
  select version into v_ver from public.sv_forms where key = 'qcd';
  select body into v_body from public.sv_form_versions where form_key = 'qcd' and version = v_ver;
  if v_body ? 'rule' then return; end if;   -- already done
  select jsonb_set(v_body, '{sections}', coalesce(jsonb_agg(
           jsonb_set(sec, '{items}', coalesce((select jsonb_agg(it || jsonb_build_object('mode',
                                         case when sec ->> 'key' = 'prof' then 'rate' else 'count' end))
                                       from jsonb_array_elements(sec -> 'items') it), '[]'::jsonb))
           order by ord), '[]'::jsonb))
    into v_new
  from jsonb_array_elements(v_body -> 'sections') with ordinality as s(sec, ord);
  v_new := v_new || jsonb_build_object('rule', jsonb_build_object(
             'min', 3, 'junior', jsonb_build_array(30, 50, 70), 'senior', jsonb_build_array(50, 70, 90)));
  update public.sv_forms set version = v_ver + 1, updated_at = now() where key = 'qcd';
  insert into public.sv_form_versions (form_key, version, body) values ('qcd', v_ver + 1, v_new);
end $$;

commit;
