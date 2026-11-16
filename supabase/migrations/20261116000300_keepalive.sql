-- (keep) Portal 003 – keep-alive ping
--
-- Free Supabase projects pause after 7 days without activity.
-- The daily GitHub Action (.github/workflows/keepalive.yml) calls this function.
-- It reads no table and returns only the current time, so it is safe to
-- leave callable with the public key.

create or replace function public.keepalive()
returns timestamptz
language sql stable
set search_path = ''
as $$
  select now()
$$;

revoke execute on function public.keepalive() from public;
grant  execute on function public.keepalive() to anon, authenticated;
