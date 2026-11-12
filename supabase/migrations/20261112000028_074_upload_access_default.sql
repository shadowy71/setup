-- Give current active profiles upload access and enable it for new accounts.
-- Existing explicit administrator revocations remain effective after rollout.
alter table public.storage_accounts alter column upload_enabled set default true;

-- Account rows are created lazily by the reservation/draft RPCs. Until then,
-- availability must reflect the new default, while preserving explicit false.
create or replace function public.storage_account_usage(p_user uuid)
returns table(upload_enabled boolean, quota_bytes bigint, used_bytes bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_actor uuid := public.current_profile_id();
begin
  if v_actor is null or p_user is null or not public.is_active_profile(v_actor) or
     (p_user <> v_actor and not (public.has_permission('manage_users') and
       (public.has_role('admin') or public.has_role('super_admin')))) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query select coalesce(a.upload_enabled, true), null::bigint,
    (select coalesce(sum(f.byte_size), 0)::bigint from public.storage_files f where f.owner_id = p_user and f.status in ('reserved', 'ready', 'delete_pending'))
    from (select p_user as profile_id) target left join public.storage_accounts a on a.profile_id = target.profile_id;
end $$;

-- Use the existing audited administrative path. Active/pending profiles only;
-- suspension and other authorization checks are unchanged. Already enabled
-- rows are left untouched, so reruns do not emit redundant audit events.
do $$
declare p record;
begin
  for p in select profiles.id from public.profiles profiles
    left join public.storage_accounts a on a.profile_id = profiles.id
    where public.is_active_profile(profiles.id) and coalesce(a.upload_enabled, false) = false
  loop
    perform public.admin_set_upload_enabled(p.id, true);
  end loop;
end $$;
