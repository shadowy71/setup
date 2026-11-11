-- Storage ledger foundation only. No file endpoints are enabled by this migration.
-- Keep Drive identifiers and operation state inaccessible to browser clients.
create table public.storage_accounts (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  upload_enabled boolean not null default false,
  quota_bytes bigint not null default 26214400 check (quota_bytes between 0 and 1073741824),
  updated_at timestamptz not null default now()
);

create table public.storage_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null,
  provider text not null default 'google_apps_script' check (provider = 'google_apps_script'),
  provider_file_id text,
  original_name text not null check (length(original_name) between 1 and 180),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size between 1 and 3145728),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  resource_type text not null default 'profile_picture' check (resource_type = 'profile_picture'),
  resource_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'reserved' check (status in ('reserved', 'ready', 'delete_pending', 'deleted')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_id, request_id),
  check (resource_id = owner_id),
  check ((status = 'deleted') = (deleted_at is not null)),
  check (status <> 'ready' or provider_file_id is not null)
);
create index storage_files_owner_status_idx on public.storage_files(owner_id, status);
create unique index storage_files_provider_id_idx on public.storage_files(provider, provider_file_id) where provider_file_id is not null;

alter table public.storage_accounts enable row level security;
alter table public.storage_files enable row level security;
revoke all on public.storage_accounts, public.storage_files from public, anon, authenticated;
grant select, insert, update on public.storage_accounts, public.storage_files to service_role;

-- The only authenticated write to a ledger is a bounded reservation. It never
-- accepts a provider identifier, status, owner, or someone else's profile ID.
-- Pending and delete-pending files keep consuming quota until reconciled.
create function public.storage_reserve_profile_picture(
  p_request_id uuid, p_original_name text, p_mime_type text, p_byte_size bigint, p_checksum text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.current_profile_id();
  v_account public.storage_accounts%rowtype;
  v_existing public.storage_files%rowtype;
  v_used bigint;
  v_id uuid;
begin
  if v_user is null or not public.is_active_profile(v_user) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  if p_request_id is null or p_original_name is null or length(p_original_name) not between 1 and 180
     or p_mime_type is null or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
     or p_byte_size is null or p_byte_size not between 1 and 3145728
     or p_checksum is null or p_checksum !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid file metadata' using errcode = '22023';
  end if;
  insert into public.storage_accounts(profile_id) values (v_user) on conflict (profile_id) do nothing;
  select * into v_account from public.storage_accounts where profile_id = v_user for update;
  if not v_account.upload_enabled then raise exception 'Uploads are not enabled' using errcode = '42501'; end if;
  select * into v_existing from public.storage_files where owner_id = v_user and request_id = p_request_id;
  if found then
    if v_existing.original_name <> p_original_name or v_existing.mime_type <> p_mime_type
       or v_existing.byte_size <> p_byte_size or v_existing.checksum <> p_checksum
       or v_existing.status <> 'reserved' then
      raise exception 'Upload request conflicts with an existing operation' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;
  select coalesce(sum(byte_size), 0) into v_used from public.storage_files
    where owner_id = v_user and status in ('reserved', 'ready', 'delete_pending');
  if v_used + p_byte_size > v_account.quota_bytes then raise exception 'Storage quota exceeded' using errcode = '22023'; end if;
  insert into public.storage_files(owner_id, request_id, original_name, mime_type, byte_size, checksum, resource_id)
    values (v_user, p_request_id, p_original_name, p_mime_type, p_byte_size, p_checksum, v_user)
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.storage_reserve_profile_picture(uuid,text,text,bigint,text) from public, anon;
grant execute on function public.storage_reserve_profile_picture(uuid,text,text,bigint,text) to authenticated;

-- Rank and permission mirror existing user administration. Trusted database
-- maintenance may bootstrap the first administrator without embedding an ID.
create function public.admin_set_upload_enabled(p_user uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_actor uuid := public.current_profile_id();
begin
  if p_user is null or p_enabled is null then raise exception 'Invalid request' using errcode = '22023'; end if;
  if not public.is_trusted_writer() then
    if v_actor is null or not public.is_active_profile(v_actor) or not public.has_permission('manage_users')
       or not (public.has_role('admin') or public.has_role('super_admin')) then
      raise exception 'Not authorized' using errcode = '42501';
    end if;
    if p_user = v_actor or public.current_role_rank() <= public.role_rank(p_user) then
      raise exception 'Cannot change your own or a peer account' using errcode = '42501';
    end if;
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'User not found' using errcode = '22023'; end if;
  insert into public.storage_accounts(profile_id, upload_enabled) values(p_user, p_enabled)
    on conflict (profile_id) do update set upload_enabled = excluded.upload_enabled, updated_at = now();
  perform public.log_audit('admin.upload_permission_changed', 'user', p_user::text,
    jsonb_build_object('upload_enabled', p_enabled), true, null, 'staff');
end;
$$;
revoke all on function public.admin_set_upload_enabled(uuid,boolean) from public, anon;
grant execute on function public.admin_set_upload_enabled(uuid,boolean) to authenticated, service_role;

-- Safe counts for the owner or an administrator; no Drive IDs or checksums.
create function public.storage_account_usage(p_user uuid)
returns table(upload_enabled boolean, quota_bytes bigint, used_bytes bigint)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_actor uuid := public.current_profile_id();
begin
  if v_actor is null or not public.is_active_profile(v_actor) or
     (p_user <> v_actor and not (public.has_permission('manage_users') and
       (public.has_role('admin') or public.has_role('super_admin')))) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query select coalesce(a.upload_enabled, false), coalesce(a.quota_bytes, 26214400::bigint),
    (select coalesce(sum(f.byte_size), 0)::bigint from public.storage_files f where f.owner_id = p_user and f.status in ('reserved', 'ready', 'delete_pending'))
    from (select p_user as profile_id) target left join public.storage_accounts a on a.profile_id = target.profile_id;
end;
$$;
revoke all on function public.storage_account_usage(uuid) from public, anon;
grant execute on function public.storage_account_usage(uuid) to authenticated;
