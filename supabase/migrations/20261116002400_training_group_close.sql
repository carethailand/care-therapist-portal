-- (keep) Portal 024 – Close a training group (after exporting)
--
-- Run AFTER 023. When everyone in a group has finished, an admin taps
-- "Close group": the Portal first downloads one .zip (summary spreadsheet,
-- each person's record, all assignment files) for CARE's Google Drive, then
-- deletes the uploaded files and calls this function, which marks the files
-- as cleared and the group as closed. Scores, hours, checklist marks and
-- results stay (they are small text); only the uploaded files go.

begin;

create or replace function public.training_group_close(p_group uuid)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not private.has_any_role(array['admin']::public.app_role[]) then raise exception 'Only an admin can close a group.'; end if;
  if not exists (select 1 from public.training_groups where id = p_group) then raise exception 'Group not found.'; end if;
  if exists (select 1 from public.training_group_members m join public.training_enrollments e on e.id = m.enrollment_id
             where m.group_id = p_group and e.status in ('active','recommended')) then
    raise exception 'Someone in this group is still training. Close the group when everyone has finished.';
  end if;

  update public.training_submissions s
     set file_path = null, cleared_at = now()
   where s.file_path is not null
     and s.enrollment_id in (select enrollment_id from public.training_group_members where group_id = p_group);
  get diagnostics v_n = row_count;

  update public.training_groups
     set closed_at = now(), closed_by = private.current_therapist_id()
   where id = p_group;
  return v_n;
end $$;

revoke execute on function public.training_group_close(uuid) from public, anon;
grant  execute on function public.training_group_close(uuid) to authenticated;

commit;
