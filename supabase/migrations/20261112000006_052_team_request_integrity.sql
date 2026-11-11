-- Team requests are private to the applicant and the team-post owner. Prevent
-- direct API clients from submitting an already accepted request or forging a
-- decision timestamp. Column grants and existing owner-only RLS still apply.
create or replace function public.guard_team_post_request()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not public.feature_enabled('team_finder') then
    raise exception 'Team finder disabled' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.decided_at is not null then
      raise exception 'New requests must be pending' using errcode = '42501';
    end if;
  else
    if old.status <> 'pending' or new.status not in ('accepted', 'declined') then
      raise exception 'Only pending requests may be accepted or declined' using errcode = '42501';
    end if;
    new.decided_at := now();
  end if;
  return new;
end $$;
revoke all on function public.guard_team_post_request() from public, anon, authenticated;
create trigger guard_team_post_request before insert or update on public.team_post_requests
for each row execute function public.guard_team_post_request();
