-- (keep) Portal 054 – Year report + Close the year
--
-- Run AFTER 053.
--   * Year report: one page per person with the year's QCD sessions (charts),
--     the clinical checklist, the admin evaluation and the final score. Shown in
--     the review meeting and saved as PDF.
--       - Admin + supervisors (+ Portal manager) can open anyone's report.
--       - The person can open their own once the year-end review is shown.
--       - QCD can't see it (they only see QCD sessions).
--   * Close the year (Admin or Portal manager): keeps ONE small summary line per
--     person (QCD average, clinical, HR performance, final score, lead/second,
--     signed date) and deletes that year's details: QCD sessions, clinical and
--     admin scores, reflections, assignments, and old drafts. It can't be undone,
--     so save the reports as PDF first. You have to type "CLOSE 2026" to do it.

begin;

-- 1. The summary kept after a year is closed (one row per person per year)
create table if not exists public.sv_year_summaries (
  therapist_id  uuid not null references public.therapists (id) on delete cascade,
  year          integer not null check (year between 2024 and 2100),
  name          text not null,
  level         text,
  qcd_sessions  integer not null default 0,
  qcd_avg       numeric(4,2),
  qcd_last      numeric(4,2),
  clinical      numeric(4,2),
  ioa           numeric(5,1),
  hr_h1         numeric(4,2),
  hr_h2         numeric(4,2),
  hr_perf       numeric(4,2),
  final         numeric(4,2),
  lead          text,
  second        text,
  reflection_at timestamptz,
  signed_at     timestamptz,
  sign_comment  text,
  closed_at     timestamptz not null default now(),
  closed_by     uuid references public.therapists (id) on delete set null,
  primary key (therapist_id, year)
);
alter table public.sv_year_summaries enable row level security;
revoke all on public.sv_year_summaries from public, anon, authenticated;

-- 2. One person's year report (everything on one page)
create or replace function public.sv_year_report(p_who uuid, p_year integer)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id();
  y public.sv_yearly; t public.therapists; f public.sv_clinical; s public.sv_year_summaries;
begin
  select * into t from public.therapists where id = p_who;
  if t.id is null then return null; end if;
  select * into y from public.sv_yearly where therapist_id = p_who and year = p_year;
  if not (private.sv_yearly_team() or (p_who = v_me and y.release_end_at is not null)) then
    select * into s from public.sv_year_summaries where therapist_id = p_who and year = p_year;
    if p_who = v_me and s.therapist_id is not null then
      return jsonb_build_object('closed', true, 'summary', to_jsonb(s) - 'closed_by');
    end if;
    raise exception 'This report isn''t available to you.';
  end if;
  select * into s from public.sv_year_summaries where therapist_id = p_who and year = p_year;
  select * into f from public.sv_clinical where therapist_id = p_who and year = p_year and role = 'final';
  return jsonb_build_object(
    'id', t.id, 'name', coalesce(t.nickname, t.full_name), 'full_name', t.full_name,
    'level', coalesce(f.level, private.sv_level(t.id)),
    'lead', private.onb_name(y.lead_id), 'second', private.onb_name(y.second_id),
    'mid_review_at', y.mid_review_at, 'end_review_at', y.end_review_at,
    'release_mid_at', y.release_mid_at, 'release_end_at', y.release_end_at,
    'signed_at', y.signed_at, 'sign_comment', y.sign_comment,
    'closed', s.therapist_id is not null,
    'summary', case when s.therapist_id is not null then to_jsonb(s) - 'closed_by' end,
    'clinical', case when f.therapist_id is not null then jsonb_build_object('form_version', f.form_version, 'level', f.level,
                  'scores', f.scores, 'sections', f.sections, 'total', f.total, 'notes', f.notes, 'ioa', f.ioa) end,
    'admin', coalesce((select jsonb_agg(jsonb_build_object('half', e.half, 'section', e.section, 'form_version', e.form_version,
                  'scores', e.scores, 'average', e.average, 'note', e.note, 'scorer', private.onb_name(e.scored_by))
                  order by e.half, e.section)
                from public.sv_admin_evals e where e.therapist_id = p_who and e.year = p_year), '[]'::jsonb),
    'qcd', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', r.id, 'form_version', r.form_version, 'level', r.level, 'held_on', r.held_on, 'case_code', r.case_code,
                  'scores', r.scores, 'sections', r.sections, 'total', r.total, 'notes', r.notes, 'tallies', r.tallies,
                  'recorder', private.onb_name(r.recorded_by))
                  order by r.held_on desc, r.recorded_at desc)
                from public.sv_records r where r.therapist_id = p_who and r.form_key = 'qcd'
                  and extract(year from r.held_on) = p_year), '[]'::jsonb));
end $$;

-- 3. The kept summaries for a year (team: everyone; anyone else: their own line)
create or replace function public.sv_year_summary_list(p_year integer)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(s) - 'closed_by' || jsonb_build_object('closed_by_name', private.onb_name(s.closed_by))
                            order by lower(s.name)), '[]'::jsonb)
  from public.sv_year_summaries s
  where s.year = p_year and (private.sv_yearly_team() or s.therapist_id = private.current_therapist_id())
$$;

-- 4. Close the year (Admin or Portal manager). Returns how much was cleared.
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
      (select round(avg(r.total), 2) from public.sv_records r where r.therapist_id = w.therapist_id and r.form_key = 'qcd' and extract(year from r.held_on) = p_year) as qavg,
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
  select therapist_id, p_year, coalesce(nickname, full_name), coalesce(clevel, qlevel), qn, qavg, qlast, clin, ioa,
         round(h1, 2), round(h2, 2), round(hrp, 2),
         round(case when clin is null and hrp is null then null else (coalesce(clin, hrp) + coalesce(hrp, clin)) / 2 end, 2),
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

revoke execute on function public.sv_year_report(uuid, integer), public.sv_year_summary_list(integer), public.sv_close_year(integer, text) from public, anon;
grant  execute on function public.sv_year_report(uuid, integer), public.sv_year_summary_list(integer), public.sv_close_year(integer, text) to authenticated;

commit;
