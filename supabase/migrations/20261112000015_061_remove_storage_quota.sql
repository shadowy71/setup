-- Remove aggregate per-user storage limits while retaining operation reservations,
-- upload entitlement, per-file limits, idempotency and cleanup.

create or replace function public.storage_reserve_profile_picture(
  p_owner uuid, p_request_id uuid, p_original_name text, p_mime_type text, p_byte_size bigint, p_checksum text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := p_owner; v_account public.storage_accounts%rowtype;
  v_existing public.storage_files%rowtype; v_id uuid;
begin
  if v_user is null or not public.is_active_profile(v_user) then raise exception 'Active account required' using errcode='42501'; end if;
  if p_request_id is null or p_original_name is null or length(p_original_name) not between 1 and 180
     or p_mime_type is null or p_mime_type not in ('image/jpeg','image/png','image/webp')
     or p_byte_size is null or p_byte_size not between 1 and 3145728
     or p_checksum is null or p_checksum !~ '^[0-9a-f]{64}$' then raise exception 'Invalid file metadata' using errcode='22023'; end if;
  insert into public.storage_accounts(profile_id) values(v_user) on conflict do nothing;
  select * into v_account from public.storage_accounts where profile_id=v_user for update;
  if not v_account.upload_enabled then raise exception 'Uploads are not enabled' using errcode='42501'; end if;
  select * into v_existing from public.storage_files where owner_id=v_user and request_id=p_request_id;
  if found then
    if v_existing.original_name <> p_original_name or v_existing.mime_type <> p_mime_type
       or v_existing.byte_size <> p_byte_size or v_existing.checksum <> p_checksum
       or v_existing.status not in ('reserved','ready') then
      raise exception 'Upload request conflicts with an existing operation' using errcode='23505';
    end if;
    return v_existing.id;
  end if;
  insert into public.storage_files(owner_id,request_id,original_name,mime_type,byte_size,checksum,resource_id)
    values(v_user,p_request_id,p_original_name,p_mime_type,p_byte_size,p_checksum,v_user) returning id into v_id;
  return v_id;
end $$;

create or replace function public.storage_reserve_profile_picture_v3(
  p_owner uuid, p_request_id uuid, p_original_name text, p_mime_type text, p_byte_size bigint, p_checksum text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := p_owner; v_account public.storage_accounts%rowtype;
  v_existing public.storage_files%rowtype; v_id uuid;
begin
  if v_user is null or not public.is_active_profile(v_user) then raise exception 'Active account required' using errcode='42501'; end if;
  if p_request_id is null or p_original_name is null or length(p_original_name) not between 1 and 180
     or p_mime_type is null or p_mime_type not in ('image/jpeg','image/png','image/webp')
     or p_byte_size is null or p_byte_size not between 1 and 3145728
     or p_checksum is null or p_checksum !~ '^[0-9a-f]{64}$' then raise exception 'Invalid file metadata' using errcode='22023'; end if;
  insert into public.storage_accounts(profile_id) values(v_user) on conflict do nothing;
  select * into v_account from public.storage_accounts where profile_id=v_user for update;
  if not v_account.upload_enabled then raise exception 'Uploads are not enabled' using errcode='42501'; end if;
  select * into v_existing from public.storage_files where owner_id=v_user and request_id=p_request_id;
  if found then
    if v_existing.original_name <> p_original_name or v_existing.mime_type <> p_mime_type
       or v_existing.byte_size <> p_byte_size or v_existing.checksum <> p_checksum
       or v_existing.status not in ('reserved','ready') or v_existing.gateway_key is null
       or (v_existing.status = 'reserved' and v_existing.upload_expires_at <= clock_timestamp()) then
      raise exception 'Upload request conflicts with an existing operation' using errcode='23505';
    end if;
    return v_existing.id;
  end if;
  v_id := gen_random_uuid();
  -- The deadline is assigned once and embedded in the immutable gateway key.
  insert into public.storage_files(id,owner_id,request_id,original_name,mime_type,byte_size,checksum,resource_id,upload_expires_at,gateway_key)
    select v_id,v_user,p_request_id,p_original_name,p_mime_type,p_byte_size,p_checksum,v_user,
      to_timestamp(deadline_ms / 1000.0), deadline_ms::text || '-' || v_id::text
    from (select floor(extract(epoch from clock_timestamp() + interval '10 minutes') * 1000)::bigint as deadline_ms) as deadline;
  return v_id;
end $$;

create or replace function public.storage_reserve_post_attachment(p_owner uuid,p_post uuid,p_request_id uuid,p_original_name text,p_mime_type text,p_byte_size bigint,p_checksum text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.storage_accounts%rowtype; f public.storage_files%rowtype; v_id uuid; v_pos integer; v_ms bigint;
begin
  if p_owner is null or not public.is_active_profile(p_owner) then raise exception 'Active account required' using errcode='42501'; end if;
  if p_request_id is null or p_original_name is null or length(p_original_name) not between 1 and 180
    or p_mime_type not in ('image/jpeg','image/png','image/webp','application/pdf') or p_byte_size not between 1 and 3145728
    or p_checksum !~ '^[0-9a-f]{64}$' then raise exception 'Invalid metadata' using errcode='22023'; end if;
  insert into public.storage_accounts(profile_id) values(p_owner) on conflict do nothing;
  select * into a from public.storage_accounts where profile_id=p_owner for update;
  if not a.upload_enabled then raise exception 'Uploads disabled' using errcode='42501'; end if;
  -- Post lock serializes reservation and deletion/visibility changes.
  perform 1 from public.posts where id=p_post and author_id=p_owner and status='published' and deleted_at is null for update;
  if not found then raise exception 'Post unavailable' using errcode='42501'; end if;
  select * into f from public.storage_files where owner_id=p_owner and request_id=p_request_id;
  if found then
    if f.resource_type <> 'post_attachment' or f.resource_id <> p_post or f.original_name <> p_original_name or f.mime_type <> p_mime_type
      or f.byte_size <> p_byte_size or f.checksum <> p_checksum or f.status not in ('reserved','ready')
      or (f.status='reserved' and f.upload_expires_at <= clock_timestamp()) then raise exception 'Conflicting operation' using errcode='23505'; end if;
    return f.id;
  end if;
  select n into v_pos from generate_series(0,7) n where not exists (
    select 1 from public.post_attachment_links l join public.storage_files s on s.id=l.file_id
    where l.post_id=p_post and l.position=n and s.status in ('reserved','ready')) order by n limit 1;
  if v_pos is null then raise exception 'Attachment limit reached' using errcode='22023'; end if;
  v_id:=gen_random_uuid(); v_ms:=floor(extract(epoch from clock_timestamp()+interval '10 minutes')*1000)::bigint;
  insert into public.storage_files(id,owner_id,request_id,original_name,mime_type,byte_size,checksum,resource_type,resource_id,upload_expires_at,gateway_key)
    values(v_id,p_owner,p_request_id,p_original_name,p_mime_type,p_byte_size,p_checksum,'post_attachment',p_post,to_timestamp(v_ms/1000.0),v_ms::text||'-'||v_id::text);
  insert into public.post_attachment_links(file_id,post_id,position) values(v_id,p_post,v_pos);
  return v_id;
end $$;

create or replace function public.storage_reserve_draft_attachment(p_owner uuid,p_draft uuid,p_request_id uuid,p_name text,p_mime text,p_size bigint,p_checksum text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare account public.storage_accounts%rowtype; f public.storage_files%rowtype; v_id uuid; v_pos integer; v_ms bigint;
begin
  if p_owner is null or not public.is_active_profile(p_owner) then raise exception 'Not allowed' using errcode='42501'; end if;
  if p_request_id is null or p_name is null or length(p_name) not between 1 and 180 or p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp','application/pdf') or p_size is null or p_size not between 1 and 3145728 or p_checksum is null or p_checksum !~ '^[0-9a-f]{64}$' then raise exception 'Invalid file' using errcode='22023'; end if;
  select * into account from public.storage_accounts where profile_id=p_owner for update;
  if not found or not account.upload_enabled then raise exception 'Uploads disabled' using errcode='42501'; end if;
  perform 1 from public.post_upload_drafts where id=p_draft and owner_id=p_owner and state='open' and expires_at>now() for update;
  if not found then raise exception 'Draft unavailable' using errcode='42501'; end if;
  select * into f from public.storage_files where owner_id=p_owner and request_id=p_request_id;
  if found then
    if f.resource_type<>'post_attachment' or f.resource_id<>p_draft or f.original_name<>p_name or f.mime_type<>p_mime or f.byte_size<>p_size or f.checksum<>p_checksum or f.status not in ('reserved','ready') or (f.status='reserved' and f.upload_expires_at<=clock_timestamp()) then raise exception 'Conflicting operation' using errcode='23505'; end if;
    return f.id;
  end if;
  select n into v_pos from generate_series(0,7) n where not exists (select 1 from public.post_upload_draft_files l join public.storage_files sf on sf.id=l.file_id where l.draft_id=p_draft and l.position=n and sf.status in ('reserved','ready')) order by n limit 1;
  if v_pos is null then raise exception 'Attachment limit' using errcode='22023'; end if;
  v_id:=gen_random_uuid(); v_ms:=floor(extract(epoch from clock_timestamp()+interval '10 minutes')*1000)::bigint;
  insert into public.storage_files(id,owner_id,request_id,original_name,mime_type,byte_size,checksum,resource_type,resource_id,upload_expires_at,gateway_key)
    values(v_id,p_owner,p_request_id,p_name,p_mime,p_size,p_checksum,'post_attachment',p_draft,to_timestamp(v_ms/1000.0),v_ms::text||'-'||v_id::text);
  insert into public.post_upload_draft_files(file_id,draft_id,position) values(v_id,p_draft,v_pos);
  return v_id;
end $$;

-- Keep the historical response shape for deployed clients, but no longer expose
-- an allocation. Usage remains a ledger statistic, not an enforcement check.
create or replace function public.storage_account_usage(p_user uuid)
returns table(upload_enabled boolean, quota_bytes bigint, used_bytes bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_actor uuid := public.current_profile_id();
begin
  if v_actor is null or not public.is_active_profile(v_actor) or
     (p_user <> v_actor and not (public.has_permission('manage_users') and
       (public.has_role('admin') or public.has_role('super_admin')))) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query select coalesce(a.upload_enabled, false), null::bigint,
    (select coalesce(sum(f.byte_size), 0)::bigint from public.storage_files f where f.owner_id = p_user and f.status in ('reserved', 'ready', 'delete_pending'))
    from (select p_user as profile_id) target left join public.storage_accounts a on a.profile_id = target.profile_id;
end $$;
-- Retain the unused column for compatibility with deployed older code and backups;
-- it no longer controls any upload path.
