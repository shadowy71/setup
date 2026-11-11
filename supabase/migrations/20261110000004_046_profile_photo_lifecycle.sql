-- Profile photos use the existing ledger as the association. There is at most
-- one ready photo; old files remain charged until Drive confirms deletion.
alter table public.storage_files add column cleanup_attempted_at timestamptz;

create unique index storage_one_ready_profile_photo on public.storage_files(owner_id)
  where resource_type = 'profile_picture' and status = 'ready';

-- Reservations must only come from the bounded upload API. Direct browser
-- access could fill Script Properties with fake 1-byte cleanup tombstones.
-- The API supplies the owner from its verified session, never from a client.
drop function public.storage_reserve_profile_picture(uuid,text,text,bigint,text);
create function public.storage_reserve_profile_picture(
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
       or v_existing.status not in ('reserved','ready') then
      raise exception 'Upload request conflicts with an existing operation' using errcode='23505';
    end if;
    return v_existing.id;
  end if;
  select coalesce(sum(byte_size),0) into v_used from public.storage_files
    where owner_id=v_user and status in ('reserved','ready','delete_pending');
  if v_used + p_byte_size > v_account.quota_bytes then raise exception 'Storage quota exceeded' using errcode='22023'; end if;
  insert into public.storage_files(owner_id,request_id,original_name,mime_type,byte_size,checksum,resource_id)
    values(v_user,p_request_id,p_original_name,p_mime_type,p_byte_size,p_checksum,v_user) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.storage_reserve_profile_picture(uuid,uuid,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.storage_reserve_profile_picture(uuid,uuid,text,text,bigint,text) to service_role;

-- Called only by the trusted server after the gateway verified stored bytes.
-- The account lock serializes competing uploads/removals; association and
-- previous-image retirement occur atomically in the same transaction.
create function public.storage_finalize_profile_picture(p_owner uuid, p_file uuid, p_provider_id text, p_checksum text, p_size bigint, p_mime text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare f public.storage_files%rowtype; allowed boolean;
begin
  select upload_enabled into allowed from public.storage_accounts where profile_id=p_owner for update;
  if not found or not allowed or not public.is_active_profile(p_owner) then raise exception 'Upload no longer allowed' using errcode='42501'; end if;
  select * into f from public.storage_files where id=p_file and owner_id=p_owner and resource_type='profile_picture' for update;
  if not found or p_provider_id is null or p_provider_id !~ '^[A-Za-z0-9_-]{10,200}$'
    or f.checksum is distinct from p_checksum or f.byte_size is distinct from p_size or f.mime_type is distinct from p_mime then
    raise exception 'Invalid operation'; end if;
  if f.status='ready' and f.provider_file_id=p_provider_id then return; end if;
  if f.status<>'reserved' then raise exception 'Operation no longer pending'; end if;
  update public.storage_files set status='delete_pending' where owner_id=p_owner and resource_type='profile_picture' and status='ready';
  update public.storage_files set status='ready',provider_file_id=p_provider_id where id=p_file;
end $$;
revoke all on function public.storage_finalize_profile_picture(uuid,uuid,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.storage_finalize_profile_picture(uuid,uuid,text,text,bigint,text) to service_role;

-- Cancelling first marks operations as deletion-pending, before touching Drive.
-- The gateway's durable key tombstone prevents delayed uploads from reviving.
create function public.storage_retire_profile_pictures(p_owner uuid, p_stale_only boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.storage_accounts where profile_id=p_owner for update;
  if not found then return; end if;
  update public.storage_files set status='delete_pending'
    where owner_id=p_owner and resource_type='profile_picture'
      and ((not p_stale_only and status in ('reserved','ready'))
        or (p_stale_only and status='reserved' and created_at < now() - interval '1 hour'));
end $$;
revoke all on function public.storage_retire_profile_pictures(uuid,boolean) from public,anon,authenticated;
grant execute on function public.storage_retire_profile_pictures(uuid,boolean) to service_role;

create function public.storage_complete_profile_delete(p_owner uuid,p_file uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.storage_files set status='deleted',deleted_at=now()
    where id=p_file and owner_id=p_owner and resource_type='profile_picture' and status='delete_pending';
end $$;
revoke all on function public.storage_complete_profile_delete(uuid,uuid) from public,anon,authenticated;
grant execute on function public.storage_complete_profile_delete(uuid,uuid) to service_role;
