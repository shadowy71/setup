-- V3 keys are immutable and separate from legacy V2 keys. Existing rows stay V2.
alter table public.storage_files add column upload_expires_at timestamptz;
alter table public.storage_files add column gateway_key text unique;
alter table public.storage_files add constraint storage_v3_key_check check (
  (gateway_key is null and upload_expires_at is null) or
  (gateway_key is not null and upload_expires_at is not null and
   gateway_key = floor(extract(epoch from upload_expires_at) * 1000)::bigint::text || '-' || id::text)
);


-- Even trusted callers cannot extend a reservation after its key was issued.
create function public.storage_preserve_gateway_key() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.gateway_key is distinct from old.gateway_key or new.upload_expires_at is distinct from old.upload_expires_at then
    raise exception 'Upload operation key is immutable' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function public.storage_preserve_gateway_key() from public, anon, authenticated;
create trigger storage_gateway_key_immutable before update on public.storage_files
for each row execute function public.storage_preserve_gateway_key();

create function public.storage_reserve_profile_picture_v3(
  p_owner uuid, p_request_id uuid, p_original_name text, p_mime_type text, p_byte_size bigint, p_checksum text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := p_owner; v_account public.storage_accounts%rowtype;
  v_existing public.storage_files%rowtype; v_used bigint; v_id uuid;
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
  select coalesce(sum(byte_size),0) into v_used from public.storage_files
    where owner_id=v_user and status in ('reserved','ready','delete_pending');
  if v_used + p_byte_size > v_account.quota_bytes then raise exception 'Storage quota exceeded' using errcode='22023'; end if;
  v_id := gen_random_uuid();
  -- The deadline is assigned once and embedded in the immutable gateway key.
  insert into public.storage_files(id,owner_id,request_id,original_name,mime_type,byte_size,checksum,resource_id,upload_expires_at,gateway_key)
    select v_id,v_user,p_request_id,p_original_name,p_mime_type,p_byte_size,p_checksum,v_user,
      to_timestamp(deadline_ms / 1000.0), deadline_ms::text || '-' || v_id::text
    from (select floor(extract(epoch from clock_timestamp() + interval '10 minutes') * 1000)::bigint as deadline_ms) as deadline;
  return v_id;
end $$;
revoke all on function public.storage_reserve_profile_picture_v3(uuid,uuid,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.storage_reserve_profile_picture_v3(uuid,uuid,text,text,bigint,text) to service_role;
