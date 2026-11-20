-- (keep) Portal 059 – Yearly review: QCD now counts in the final score
--
-- Run AFTER 054 (it doesn't need 058).
--   * Final score = average of Clinical, HR performance and the QCD average for
--     the year (equal thirds). If one part is missing, it's the average of the
--     parts there are. Before this it was Clinical and HR performance only.
--   * The person's review (sv_my_review) now also sends their QCD average and
--     number of sessions, so it can show "QCD so far" at the check-in meeting
--     (the mid-year meeting) and the QCD part of the final score at year-end.
--   * Close the year saves the new final score in the summary.
-- Nothing is deleted or changed in the data; only the two functions are replaced.

begin;

create or replace function public.sv_my_review(p_year integer)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id(); y public.sv_yearly; f public.sv_clinical;
  v_admin jsonb := '[]'::jsonb; v_qn integer; v_qavg numeric;
begin
  if v_me is null then return null; end if;
  select * into y from public.sv_yearly where therapist_id = v_me and year = p_year;
  if y.release_end_at is not null then
    select * into f from public.sv_clinical where therapist_id = v_me and year = p_year and role = 'final';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('half', e.half, 'section', e.section, 'form_version', e.form_version,
           'scores', e.scores, 'average', e.average, 'note', e.note) order by e.half, e.section), '[]'::jsonb)
    into v_admin
  from public.sv_admin_evals e
  where e.therapist_id = v_me and e.year = p_year
    and ((e.half = 1 and (y.release_mid_at is not null or y.release_end_at is not null)) or (e.half = 2 and y.release_end_at is not null));
  -- the person's own QCD sessions this year (they already see each session in My supervision)
  select count(*)::integer, avg(r.total) into v_qn, v_qavg
  from public.sv_records r where r.therapist_id = v_me and r.form_key = 'qcd' and extract(year from r.held_on) = p_year;
  return jsonb_build_object(
    'qcd_sessions', v_qn, 'qcd_avg', v_qavg,
    'lead', private.onb_name(y.lead_id), 'mid_review_at', y.mid_review_at, 'end_review_at', y.end_review_at,
    'release_mid_at', y.release_mid_at, 'release_end_at', y.release_end_at, 'signed_at', y.signed_at, 'sign_comment', y.sign_comment,
    'admin', v_admin,
    'clinical', case when f.therapist_id is not null then jsonb_build_object('form_version', f.form_version, 'level', f.level,
                  'scores', f.scores, 'sections', f.sections, 'total', f.total, 'notes', f.notes) end);
end $$;

create or replace function public.sv_close_year(p_year integer, p_confirm text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  v_now date := (now() at time zone 'Asia/Bangkok')::date;
  n_people integer; n_qcd integer; n_clin integer; n_adm integer; n_refl integer; n_year integer; n_drafts integer;
begin
  if not private.has_any_role(array['admin']::public.app_role[]) then raise exception 'Only Admin or the Portal manager can close the year.'; end if;
  if coalesce(p_confirm, '') <> 'CLOSE ' || p_year then raise exception 'Type CLOSE % to confirm.', p_year; end if;
  if p_year > extract(year from v_now) or (p_year = extract(year from v_now) and extract(month from v_now) < 12) then
    raise exception 'A year can be closed from 1 December of that year.';
  end if;

  -- everyone with anything this year
  with who as (
    select therapist_id from public.sv_records where form_key = 'qcd' and extract(year from held_on) = p_year
    union select therapist_id from public.sv_clinical where year = p_year
    union select therapist_id from public.sv_admin_evals where year = p_year
    union select therapist_id from public.sv_reflections where year = p_year and status = 'submitted'
    union select therapist_id from public.sv_yearly where year = p_year
  ), calc as (
    select w.therapist_id, t.nickname, t.full_name,
      (select count(*)::integer from public.sv_records r where r.therapist_id = w.therapist_id and r.form_key = 'qcd' and extract(year from r.held_on) = p_year) as qn,
      (select avg(r.total) from public.sv_records r where r.therapist_id = w.therapist_id and r.form_key = 'qcd' and extract(year from r.held_on) = p_year) as qavg,
      (select r.total from public.sv_records r where r.therapist_id = w.therapist_id and r.form_key = 'qcd' and extract(year from r.held_on) = p_year
        order by r.held_on desc, r.recorded_at desc limit 1) as qlast,
      (select r.level from public.sv_records r where r.therapist_id = w.therapist_id and r.form_key = 'qcd' and extract(year from r.held_on) = p_year
        order by r.held_on desc, r.recorded_at desc limit 1) as qlevel,
      c.total as clin, c.ioa, c.level as clevel,
      (select avg(e.average) from public.sv_admin_evals e where e.therapist_id = w.therapist_id and e.year = p_year and e.half = 1 and e.average is not null) as h1,
      (select avg(e.average) from public.sv_admin_evals e where e.therapist_id = w.therapist_id and e.year = p_year and e.half = 2 and e.average is not null) as h2,
      private.onb_name(y.lead_id) as lead, private.onb_name(y.second_id) as second, y.signed_at, y.sign_comment,
      (select x.submitted_at from public.sv_reflections x where x.therapist_id = w.therapist_id and x.year = p_year and x.status = 'submitted') as refl
    from who w
    join public.therapists t on t.id = w.therapist_id
    left join public.sv_clinical c on c.therapist_id = w.therapist_id and c.year = p_year and c.role = 'final'
    left join public.sv_yearly y on y.therapist_id = w.therapist_id and y.year = p_year
  ), hr as (
    select calc.*, case when h1 is null and h2 is null then null else (coalesce(h1, h2) + coalesce(h2, h1)) / 2 end as hrp from calc
  )
  insert into public.sv_year_summaries (therapist_id, year, name, level, qcd_sessions, qcd_avg, qcd_last, clinical, ioa,
                                        hr_h1, hr_h2, hr_perf, final, lead, second, reflection_at, signed_at, sign_comment, closed_at, closed_by)
  select therapist_id, p_year, coalesce(nickname, full_name), coalesce(clevel, qlevel), qn, round(qavg, 2), qlast, clin, ioa,
         round(h1, 2), round(h2, 2), round(hrp, 2),
         -- final = average of Clinical, HR performance and QCD average (whichever there are)
         round((coalesce(clin, 0) + coalesce(hrp, 0) + coalesce(qavg, 0))
               / nullif((clin is not null)::int + (hrp is not null)::int + (qavg is not null)::int, 0), 2),
         lead, second, refl, signed_at, sign_comment, now(), v_me
  from hr
  on conflict (therapist_id, year) do nothing;
  get diagnostics n_people = row_count;

  delete from public.sv_records where form_key = 'qcd' and extract(year from held_on) = p_year; get diagnostics n_qcd = row_count;
  delete from public.sv_clinical where year = p_year;        get diagnostics n_clin = row_count;
  delete from public.sv_admin_evals where year = p_year;     get diagnostics n_adm = row_count;
  delete from public.sv_reflections where year = p_year;     get diagnostics n_refl = row_count;
  delete from public.sv_yearly where year = p_year;          get diagnostics n_year = row_count;
  delete from public.sv_drafts where updated_at < make_date(p_year + 1, 1, 1); get diagnostics n_drafts = row_count;

  return jsonb_build_object('summaries', n_people, 'qcd_sessions', n_qcd, 'clinical', n_clin, 'admin', n_adm,
                            'reflections', n_refl, 'assignments', n_year, 'drafts', n_drafts);
end $$;

revoke execute on function public.sv_my_review(integer), public.sv_close_year(integer, text) from public, anon;
grant  execute on function public.sv_my_review(integer), public.sv_close_year(integer, text) to authenticated;

commit;
