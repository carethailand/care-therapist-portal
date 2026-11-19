-- (keep) Portal 053 – Yearly review, step 4: release to the person + signing
--
-- Run AFTER 052. The person's scores stay hidden until someone shows them at the
-- review meeting (1 lead supervisor + 1 admin + the person, twice a year):
--   * Mid-year:  "Show mid-year" → the person sees the admin evaluation for half 1.
--   * Year-end:  "Show year-end" → the person sees the clinical checklist (final),
--     the admin evaluation for both halves, and the FINAL score
--     (= average of Clinical and HR performance; HR performance = average of the
--     halves). They can then tap "I agree, sign" (with an optional comment).
-- Who shows / hides: admin / Portal manager, or the person's lead supervisor.
-- Showing can be undone (Hide) until the person has signed.

begin;

alter table public.sv_yearly
  add column if not exists release_mid_at timestamptz,
  add column if not exists release_end_at timestamptz,
  add column if not exists released_by    uuid references public.therapists (id) on delete set null,
  add column if not exists signed_at      timestamptz,
  add column if not exists sign_comment   text check (char_length(sign_comment) <= 1500);

-- 1. Show / hide (admin, Portal manager, or the lead)
create or replace function public.sv_yearly_release(p_who uuid, p_year integer, p_which text, p_show boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_me uuid := private.current_therapist_id(); y public.sv_yearly;
begin
  select * into y from public.sv_yearly where therapist_id = p_who and year = p_year;
  if not (private.has_any_role(array['admin']::public.app_role[]) or y.lead_id = v_me) then
    raise exception 'Only an admin or the lead supervisor can show the review.';
  end if;
  if p_which not in ('mid','end') then raise exception 'Choose mid-year or year-end.'; end if;
  if y.signed_at is not null and not coalesce(p_show, false) then raise exception 'Already signed: it can''t be hidden now.'; end if;
  insert into public.sv_yearly (therapist_id, year, assigned_by, updated_at) values (p_who, p_year, v_me, now())
  on conflict (therapist_id, year) do nothing;
  update public.sv_yearly
     set release_mid_at = case when p_which = 'mid' then (case when p_show then now() end) else release_mid_at end,
         release_end_at = case when p_which = 'end' then (case when p_show then now() end) else release_end_at end,
         released_by = v_me, updated_at = now()
   where therapist_id = p_who and year = p_year;
end $$;

-- 2. My review (the person): only what has been shown
create or replace function public.sv_my_review(p_year integer)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := private.current_therapist_id(); y public.sv_yearly; f public.sv_clinical;
  v_admin jsonb := '[]'::jsonb;
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
  return jsonb_build_object(
    'lead', private.onb_name(y.lead_id), 'mid_review_at', y.mid_review_at, 'end_review_at', y.end_review_at,
    'release_mid_at', y.release_mid_at, 'release_end_at', y.release_end_at, 'signed_at', y.signed_at, 'sign_comment', y.sign_comment,
    'admin', v_admin,
    'clinical', case when f.therapist_id is not null then jsonb_build_object('form_version', f.form_version, 'level', f.level,
                  'scores', f.scores, 'sections', f.sections, 'total', f.total, 'notes', f.notes) end);
end $$;

-- 3. Sign (the person, after the year-end review is shown)
create or replace function public.sv_yearly_sign(p_year integer, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_me uuid := private.current_therapist_id();
begin
  update public.sv_yearly
     set signed_at = now(), sign_comment = nullif(btrim(coalesce(p_comment, '')), ''), updated_at = now()
   where therapist_id = v_me and year = p_year and release_end_at is not null and signed_at is null;
  if not found then raise exception 'There''s nothing to sign yet (or it''s already signed).'; end if;
end $$;

-- 4. Team list: + shown / signed
drop function if exists public.sv_yearly_people(integer);
create function public.sv_yearly_people(p_year integer)
returns table (id uuid, full_name text, nickname text, rank text, reflection text, submitted_at timestamptz,
               no_yearly boolean, admin_h1 integer, admin_h2 integer,
               lead_id uuid, second_id uuid, lead text, second text, lead_done boolean, second_done boolean,
               final_total numeric, ioa numeric, mid_review_at timestamptz, end_review_at timestamptz,
               release_mid_at timestamptz, release_end_at timestamptz, signed_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.full_name, t.nickname,
         case when exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role = 'supervisor') then 'supervisor'
              when exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role = 'qcd') then 'qcd'
              when exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role = 'senior') then 'senior'
              when exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role = 'therapist') then 'therapist'
              else 'office' end,
         coalesce((select case when x.status = 'submitted' then 'submitted' else 'started' end
                   from public.sv_reflections x where x.therapist_id = t.id and x.year = p_year), 'none'),
         (select x.submitted_at from public.sv_reflections x where x.therapist_id = t.id and x.year = p_year),
         t.no_yearly,
         (select count(*)::integer from public.sv_admin_evals e where e.therapist_id = t.id and e.year = p_year and e.half = 1),
         (select count(*)::integer from public.sv_admin_evals e where e.therapist_id = t.id and e.year = p_year and e.half = 2),
         y.lead_id, y.second_id, private.onb_name(y.lead_id), private.onb_name(y.second_id),
         exists (select 1 from public.sv_clinical c where c.therapist_id = t.id and c.year = p_year and c.role = 'lead' and c.submitted_at is not null),
         exists (select 1 from public.sv_clinical c where c.therapist_id = t.id and c.year = p_year and c.role = 'second' and c.submitted_at is not null),
         (select c.total from public.sv_clinical c where c.therapist_id = t.id and c.year = p_year and c.role = 'final'),
         (select c.ioa from public.sv_clinical c where c.therapist_id = t.id and c.year = p_year and c.role = 'final'),
         y.mid_review_at, y.end_review_at, y.release_mid_at, y.release_end_at, y.signed_at
  from public.therapists t
  left join public.sv_yearly y on y.therapist_id = t.id and y.year = p_year
  where private.sv_yearly_team() and t.status <> 'exited' and t.track = 'care_hire'
    and exists (select 1 from public.staff_roles r where r.therapist_id = t.id and r.role <> 'applicant')
  order by lower(coalesce(t.nickname, t.full_name))
$$;


revoke execute on function public.sv_yearly_release(uuid, integer, text, boolean), public.sv_my_review(integer),
                           public.sv_yearly_sign(integer, text), public.sv_yearly_people(integer) from public, anon;
grant  execute on function public.sv_yearly_release(uuid, integer, text, boolean), public.sv_my_review(integer),
                           public.sv_yearly_sign(integer, text), public.sv_yearly_people(integer) to authenticated;

commit;
