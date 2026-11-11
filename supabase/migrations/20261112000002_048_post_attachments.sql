-- The existing storage ledger remains the single quota and operation ledger.
-- Post attachments use the same V3 fencing and never expose provider IDs.
alter table public.storage_files drop constraint storage_files_resource_id_fkey;
alter table public.storage_files drop constraint storage_files_resource_type_check;
alter table public.storage_files drop constraint storage_files_mime_type_check;
-- The original multi-column check ties resource_id to the profile owner.
alter table public.storage_files drop constraint storage_files_check;
alter table public.storage_files add constraint storage_resource_type_check check (resource_type in ('profile_picture','post_attachment'));
alter table public.storage_files add constraint storage_mime_type_check check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf'));
alter table public.storage_files add constraint storage_profile_resource_check check (resource_type <> 'profile_picture' or (resource_id = owner_id and mime_type <> 'application/pdf'));

create table public.post_attachment_links (
  file_id uuid primary key references public.storage_files(id) on delete restrict,
  post_id uuid not null references public.posts(id) on delete restrict,
  position integer not null check (position between 0 and 7)
);
create index post_attachment_links_post_idx on public.post_attachment_links(post_id,position);
alter table public.post_attachment_links enable row level security;
revoke all on public.post_attachment_links from public,anon,authenticated;
-- Deliberately no student access: metadata is filtered through the API.
create policy post_attachment_links_deny_clients on public.post_attachment_links for all to authenticated using (false) with check (false);
grant select,insert,update on public.post_attachment_links to service_role;

create function public.storage_reserve_post_attachment(p_owner uuid,p_post uuid,p_request_id uuid,p_original_name text,p_mime_type text,p_byte_size bigint,p_checksum text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.storage_accounts%rowtype; f public.storage_files%rowtype; v_id uuid; v_pos integer; v_used bigint; v_ms bigint;
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
  select coalesce(sum(byte_size),0) into v_used from public.storage_files where owner_id=p_owner and status in ('reserved','ready','delete_pending');
  if v_used+p_byte_size>a.quota_bytes then raise exception 'Quota exceeded' using errcode='22023'; end if;
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
revoke all on function public.storage_reserve_post_attachment(uuid,uuid,uuid,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.storage_reserve_post_attachment(uuid,uuid,uuid,text,text,bigint,text) to service_role;

create function public.storage_finalize_post_attachment(p_owner uuid,p_file uuid,p_provider_id text,p_checksum text,p_size bigint,p_mime text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.storage_files%rowtype; allowed boolean;
begin
  select upload_enabled into allowed from public.storage_accounts where profile_id=p_owner for update;
  if not found or not allowed or not public.is_active_profile(p_owner) then raise exception 'Upload no longer allowed'; end if;
  select * into f from public.storage_files where id=p_file and owner_id=p_owner and resource_type='post_attachment' for update;
  if not found or p_provider_id is null or p_provider_id !~ '^[A-Za-z0-9_-]{10,200}$' or f.checksum is distinct from p_checksum or f.byte_size is distinct from p_size or f.mime_type is distinct from p_mime then raise exception 'Invalid operation'; end if;
  if f.status='ready' and f.provider_file_id=p_provider_id then return; end if;
  if f.status<>'reserved' then raise exception 'Operation no longer pending'; end if;
  perform 1 from public.posts where id=f.resource_id and author_id=p_owner and status='published' and deleted_at is null for update;
  if not found then raise exception 'Post unavailable'; end if;
  update public.storage_files set status='ready',provider_file_id=p_provider_id where id=p_file;
end $$;
revoke all on function public.storage_finalize_post_attachment(uuid,uuid,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.storage_finalize_post_attachment(uuid,uuid,text,text,bigint,text) to service_role;

create function public.storage_retire_post_attachment(p_owner uuid,p_file uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from public.storage_accounts where profile_id=p_owner for update;
  update public.storage_files set status='delete_pending' where id=p_file and owner_id=p_owner and resource_type='post_attachment' and status in ('ready','reserved');
end $$;
revoke all on function public.storage_retire_post_attachment(uuid,uuid) from public,anon,authenticated;
grant execute on function public.storage_retire_post_attachment(uuid,uuid) to service_role;

create function public.storage_complete_post_attachment_delete(p_file uuid) returns void
language sql security definer set search_path=public,pg_temp as $$
  update public.storage_files set status='deleted',deleted_at=now() where id=p_file and resource_type='post_attachment' and status='delete_pending';
$$;
revoke all on function public.storage_complete_post_attachment_delete(uuid) from public,anon,authenticated;
grant execute on function public.storage_complete_post_attachment_delete(uuid) to service_role;

-- Soft deletion retires attachments in the same transaction. Restore does not
-- revive deleted uploads; reconciliation releases quota only after Drive cleanup.
create function public.storage_retire_deleted_post() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='deleted' and old.status <> 'deleted' then
    update public.storage_files set status='delete_pending' where resource_type='post_attachment' and resource_id=new.id and status in ('reserved','ready');
  end if;
  return new;
end $$;
revoke all on function public.storage_retire_deleted_post() from public,anon,authenticated;
create trigger storage_retire_deleted_post after update of status on public.posts for each row execute function public.storage_retire_deleted_post();

-- Include the new associations in the independent backup catalogue.
select public.backup_sync_triggers();

-- Do not let author/staff SELECT policies bypass normal attachment visibility.
-- Invoker RLS and the explicit predicates both apply to every request.
create function public.can_view_post_attachment(p_post uuid) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
  select exists(select 1 from public.posts p where p.id=p_post and p.status='published' and p.deleted_at is null
    and public.is_active_profile(p.author_id) and not public.is_blocked_with_current(p.author_id)
    and not public.is_muted_by_current(p.author_id)
    and ((p.community_id is null and p.visibility in ('public','campus'))
      or (p.community_id is not null and public.can_view_community(p.community_id))));
$$;
revoke all on function public.can_view_post_attachment(uuid) from public,anon;
grant execute on function public.can_view_post_attachment(uuid) to authenticated;
