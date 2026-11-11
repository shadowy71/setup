-- Private, expiring upload drafts. Nothing is visible as a post until the
-- invoker-RLS publication function commits the post and links in one transaction.
create table public.post_upload_drafts (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  state text not null default 'open' check (state in ('open','published','abandoned')),
  post_id uuid references public.posts(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  check ((state = 'published') = (post_id is not null))
);
create index post_upload_drafts_expiry on public.post_upload_drafts(expires_at) where state='open';
alter table public.post_upload_drafts enable row level security;
revoke all on public.post_upload_drafts from public,anon,authenticated;
create policy post_upload_drafts_deny on public.post_upload_drafts for all to authenticated using(false) with check(false);
grant select,insert,update on public.post_upload_drafts to service_role;

create table public.post_upload_draft_files (
  file_id uuid primary key references public.storage_files(id) on delete restrict,
  draft_id uuid not null references public.post_upload_drafts(id) on delete restrict,
  position integer not null check(position between 0 and 7)
);
create index post_upload_draft_files_draft on public.post_upload_draft_files(draft_id,position);
alter table public.post_upload_draft_files enable row level security;
revoke all on public.post_upload_draft_files from public,anon,authenticated;
create policy post_upload_draft_files_deny on public.post_upload_draft_files for all to authenticated using(false) with check(false);
grant select,insert,update on public.post_upload_draft_files to service_role;

create function public.storage_create_post_draft(p_owner uuid,p_draft uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare existing public.post_upload_drafts%rowtype; enabled boolean;
begin
  if p_owner is null or p_draft is null or not public.is_active_profile(p_owner) then raise exception 'Not allowed' using errcode='42501'; end if;
  insert into public.storage_accounts(profile_id) values(p_owner) on conflict do nothing;
  select upload_enabled into enabled from public.storage_accounts where profile_id=p_owner for update;
  if not enabled then raise exception 'Uploads disabled' using errcode='42501'; end if;
  select * into existing from public.post_upload_drafts where id=p_draft for update;
  if found then
    if existing.owner_id<>p_owner or existing.state<>'open' or existing.expires_at<=now() then raise exception 'Draft unavailable' using errcode='42501'; end if;
    return p_draft;
  end if;
  if (select count(*) from public.post_upload_drafts where owner_id=p_owner and state='open' and expires_at>now())>=5 then raise exception 'Too many drafts' using errcode='22023'; end if;
  insert into public.post_upload_drafts(id,owner_id) values(p_draft,p_owner);
  return p_draft;
end $$;
revoke all on function public.storage_create_post_draft(uuid,uuid) from public,anon,authenticated;
grant execute on function public.storage_create_post_draft(uuid,uuid) to service_role;

create function public.storage_reserve_draft_attachment(p_owner uuid,p_draft uuid,p_request_id uuid,p_name text,p_mime text,p_size bigint,p_checksum text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare account public.storage_accounts%rowtype; f public.storage_files%rowtype; v_id uuid; v_pos integer; v_used bigint; v_ms bigint;
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
  select coalesce(sum(byte_size),0) into v_used from public.storage_files where owner_id=p_owner and status in ('reserved','ready','delete_pending');
  if v_used+p_size>account.quota_bytes then raise exception 'Quota exceeded' using errcode='22023'; end if;
  select n into v_pos from generate_series(0,7) n where not exists (select 1 from public.post_upload_draft_files l join public.storage_files sf on sf.id=l.file_id where l.draft_id=p_draft and l.position=n and sf.status in ('reserved','ready')) order by n limit 1;
  if v_pos is null then raise exception 'Attachment limit' using errcode='22023'; end if;
  v_id:=gen_random_uuid(); v_ms:=floor(extract(epoch from clock_timestamp()+interval '10 minutes')*1000)::bigint;
  insert into public.storage_files(id,owner_id,request_id,original_name,mime_type,byte_size,checksum,resource_type,resource_id,upload_expires_at,gateway_key)
    values(v_id,p_owner,p_request_id,p_name,p_mime,p_size,p_checksum,'post_attachment',p_draft,to_timestamp(v_ms/1000.0),v_ms::text||'-'||v_id::text);
  insert into public.post_upload_draft_files(file_id,draft_id,position) values(v_id,p_draft,v_pos);
  return v_id;
end $$;
revoke all on function public.storage_reserve_draft_attachment(uuid,uuid,uuid,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.storage_reserve_draft_attachment(uuid,uuid,uuid,text,text,bigint,text) to service_role;

create function public.storage_finalize_draft_attachment(p_owner uuid,p_file uuid,p_provider text,p_checksum text,p_size bigint,p_mime text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.storage_files%rowtype; enabled boolean;
begin
  select upload_enabled into enabled from public.storage_accounts where profile_id=p_owner for update;
  if not found or not enabled or not public.is_active_profile(p_owner) then raise exception 'Uploads disabled' using errcode='42501'; end if;
  select * into f from public.storage_files where id=p_file and owner_id=p_owner and resource_type='post_attachment' for update;
  if not found or p_provider is null or p_provider !~ '^[A-Za-z0-9_-]{10,200}$' or f.checksum is distinct from p_checksum or f.byte_size is distinct from p_size or f.mime_type is distinct from p_mime then raise exception 'Invalid operation'; end if;
  perform 1 from public.post_upload_drafts where id=f.resource_id and owner_id=p_owner and state='open' and expires_at>now() for update;
  if not found then raise exception 'Draft unavailable'; end if;
  if f.status='ready' and f.provider_file_id=p_provider then return; end if;
  if f.status<>'reserved' then raise exception 'Operation no longer pending'; end if;
  update public.storage_files set status='ready',provider_file_id=p_provider where id=p_file;
end $$;
revoke all on function public.storage_finalize_draft_attachment(uuid,uuid,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.storage_finalize_draft_attachment(uuid,uuid,text,text,bigint,text) to service_role;

create function public.storage_abandon_post_draft(p_owner uuid,p_draft uuid) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare current_state text;
begin
  perform 1 from public.storage_accounts where profile_id=p_owner for update;
  select state into current_state from public.post_upload_drafts where id=p_draft and owner_id=p_owner for update;
  if not found then return 'absent'; end if;
  if current_state='published' then return 'published'; end if;
  if current_state='open' then
    update public.post_upload_drafts set state='abandoned' where id=p_draft;
    update public.storage_files f set status='delete_pending' from public.post_upload_draft_files l where l.file_id=f.id and l.draft_id=p_draft and f.resource_type='post_attachment' and f.resource_id=p_draft and f.owner_id=p_owner and f.status in ('reserved','ready');
  end if;
  return 'abandoned';
end $$;
revoke all on function public.storage_abandon_post_draft(uuid,uuid) from public,anon,authenticated;
grant execute on function public.storage_abandon_post_draft(uuid,uuid) to service_role;

-- A draft UUID can equal a post UUID. Retire by association, not by the
-- polymorphic resource_id alone, so deleting a post cannot retire draft files.
create or replace function public.storage_retire_deleted_post() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='deleted' and old.status <> 'deleted' then
    update public.storage_files f set status='delete_pending' from public.post_attachment_links l
      where l.file_id=f.id and l.post_id=new.id and f.resource_type='post_attachment' and f.resource_id=new.id and f.status in ('reserved','ready');
  end if;
  return new;
end $$;

-- Only the draft owner can claim its files onto their own newly created post.
create function public.storage_commit_post_draft(p_draft uuid,p_post uuid,p_files uuid[]) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.current_profile_id(); draft public.post_upload_drafts%rowtype; n integer;
begin
  if actor is null or not public.is_active_user() or p_files is null or cardinality(p_files) not between 1 and 8 then raise exception 'Not allowed' using errcode='42501'; end if;
  perform 1 from public.storage_accounts where profile_id=actor and upload_enabled for update;
  if not found then raise exception 'Uploads disabled' using errcode='42501'; end if;
  select * into draft from public.post_upload_drafts where id=p_draft and owner_id=actor for update;
  if not found or draft.state<>'open' or draft.expires_at<=now() then raise exception 'Draft unavailable' using errcode='42501'; end if;
  perform 1 from public.posts where id=p_post and author_id=actor and status in ('published','pending') and deleted_at is null and created_at > now() - interval '5 minutes' for update;
  if not found then raise exception 'Post unavailable' using errcode='42501'; end if;
  if exists(select 1 from public.post_attachment_links l join public.storage_files f on f.id=l.file_id where l.post_id=p_post and f.status in ('ready','reserved')) then raise exception 'Post already has attachments' using errcode='23505'; end if;
  select count(*) into n from public.storage_files f join public.post_upload_draft_files l on l.file_id=f.id where l.draft_id=p_draft and f.owner_id=actor and f.resource_type='post_attachment' and f.resource_id=p_draft and f.status in ('ready','reserved');
  if n<>cardinality(p_files) or (select count(distinct x) from unnest(p_files) x)<>n or exists(select 1 from unnest(p_files) x where not exists(select 1 from public.storage_files f join public.post_upload_draft_files l on l.file_id=f.id where f.id=x and f.owner_id=actor and f.resource_id=p_draft and f.status='ready' and l.draft_id=p_draft)) then raise exception 'Draft uploads incomplete' using errcode='23505'; end if;
  update public.storage_files set resource_id=p_post where id=any(p_files);
  insert into public.post_attachment_links(file_id,post_id,position) select x,p_post,ordinality-1 from unnest(p_files) with ordinality as files(x,ordinality);
  update public.post_upload_drafts set state='published',post_id=p_post where id=p_draft;
end $$;
revoke all on function public.storage_commit_post_draft(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.storage_commit_post_draft(uuid,uuid,uuid[]) to authenticated;

-- A lost response can be retried without creating a second post.
create function public.storage_published_draft_post(p_draft uuid) returns uuid language sql stable security definer set search_path=public,pg_temp as $$
  select post_id from public.post_upload_drafts where id=p_draft and owner_id=public.current_profile_id() and public.is_active_user() and state='published';
$$;
revoke all on function public.storage_published_draft_post(uuid) from public,anon;
grant execute on function public.storage_published_draft_post(uuid) to authenticated;

-- RLS still controls INSERT; post and file association commit atomically.
create function public.publish_post_with_draft(p_draft uuid,p_post uuid,p_kind public.post_kind,p_title text,p_body text,p_gif jsonb,p_community uuid,p_closes timestamptz,p_options text[],p_files uuid[]) returns uuid
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid:=public.current_profile_id(); option_text text; pos integer:=0; existing uuid;
begin
  if actor is null or not public.is_active_user() then raise exception 'Not allowed' using errcode='42501'; end if;
  existing:=public.storage_published_draft_post(p_draft);
  if existing is not null then return existing; end if;
  insert into public.posts(id,author_id,kind,title,body,gif,visibility,community_id,status,poll_closes_at)
    values(p_post,actor,p_kind,p_title,p_body,p_gif,case when p_community is null then 'campus'::public.visibility_level else 'community'::public.visibility_level end,p_community,'published',p_closes);
  if p_kind='poll' then
    if cardinality(p_options) not between 2 and 6 then raise exception 'Invalid poll'; end if;
    foreach option_text in array p_options loop
      insert into public.poll_options(post_id,label,position) values(p_post,option_text,pos); pos:=pos+1;
    end loop;
  elsif coalesce(cardinality(p_options),0)<>0 then raise exception 'Unexpected options'; end if;
  perform public.storage_commit_post_draft(p_draft,p_post,p_files);
  return p_post;
end $$;
revoke all on function public.publish_post_with_draft(uuid,uuid,public.post_kind,text,text,jsonb,uuid,timestamptz,text[],uuid[]) from public,anon;
grant execute on function public.publish_post_with_draft(uuid,uuid,public.post_kind,text,text,jsonb,uuid,timestamptz,text[],uuid[]) to authenticated;

select public.backup_sync_triggers();
