-- Private attachment links for notice posts; uploads use existing V3 drafts.
insert into public.feature_flags(key,label,description,group_name,enabled)
values ('notice_attachments','Notice attachments','Allow entitled users to add attachments to notice posts.','campus',false)
on conflict (key) do nothing;
alter table public.storage_files drop constraint storage_resource_type_check;
alter table public.storage_files add constraint storage_resource_type_check check (resource_type in ('profile_picture','post_attachment','marketplace_image','lost_found_image','housing_attachment','ride_attachment','team_attachment','project_attachment','gig_attachment','achievement_attachment','notice_attachment'));
create table public.notice_attachment_links (
  file_id uuid primary key references public.storage_files(id) on delete restrict,
  post_id uuid not null references public.notices(id) on delete cascade,
  position integer not null check (position between 0 and 7)
);
create index notice_attachment_links_post on public.notice_attachment_links(post_id,position);
alter table public.notice_attachment_links enable row level security;
revoke all on public.notice_attachment_links from public,anon,authenticated;
create policy notice_attachment_links_deny on public.notice_attachment_links for all to authenticated using(false) with check(false);
grant select,insert,update,delete on public.notice_attachment_links to service_role;
create table public.notice_attachment_receipts (
  draft_id uuid primary key references public.post_upload_drafts(id) on delete restrict,
  post_id uuid not null references public.notices(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete restrict
);
alter table public.notice_attachment_receipts enable row level security;
revoke all on public.notice_attachment_receipts from public,anon,authenticated;
create policy notice_attachment_receipts_deny on public.notice_attachment_receipts for all to authenticated using(false) with check(false);
grant select,insert,delete on public.notice_attachment_receipts to service_role;
create function public.notice_draft_post(p_draft uuid) returns uuid language sql stable security definer set search_path=public,pg_temp as $$
  select post_id from public.notice_attachment_receipts where draft_id=p_draft and owner_id=public.current_profile_id() and public.is_active_user();
$$;
revoke all on function public.notice_draft_post(uuid) from public,anon;
grant execute on function public.notice_draft_post(uuid) to authenticated;
create function public.notice_claim_draft(p_draft uuid,p_post uuid,p_files uuid[]) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.current_profile_id(); d public.post_upload_drafts%rowtype; r public.notices%rowtype; n integer; existing integer;
begin
  if not public.feature_enabled('notice_attachments') or actor is null or not public.is_active_user() or p_files is null or cardinality(p_files) not between 1 and 8 then raise exception 'Not permitted' using errcode='42501'; end if;
  perform 1 from public.storage_accounts where profile_id=actor and upload_enabled for update;
  if not found then raise exception 'Uploads disabled' using errcode='42501'; end if;
  if exists(select 1 from public.notice_attachment_receipts where draft_id=p_draft and owner_id=actor and post_id=p_post) then return; end if;
  select * into d from public.post_upload_drafts where id=p_draft and owner_id=actor for update;
  if not found or d.state<>'open' or d.expires_at<=now() then raise exception 'Draft unavailable' using errcode='42501'; end if;
  select * into r from public.notices where id=p_post for update;
  if not found or not public.has_permission('manage_notices') then raise exception 'Post unavailable' using errcode='42501'; end if;
  select count(*) into existing from public.notice_attachment_links l join public.storage_files f on f.id=l.file_id where l.post_id=p_post and f.status in ('ready','reserved');
  select count(*) into n from public.storage_files f join public.post_upload_draft_files l on l.file_id=f.id where l.draft_id=p_draft and f.owner_id=actor and f.resource_type='post_attachment' and f.resource_id=p_draft and f.status in ('ready','reserved');
  if existing+n>8 or n<>cardinality(p_files) or (select count(distinct x) from unnest(p_files) x)<>n or exists(select 1 from unnest(p_files) x where not exists(select 1 from public.storage_files f join public.post_upload_draft_files l on l.file_id=f.id where f.id=x and l.draft_id=p_draft and f.owner_id=actor and f.resource_type='post_attachment' and f.resource_id=p_draft and f.status='ready' and f.mime_type in ('image/jpeg','image/png','image/webp','application/pdf'))) then raise exception 'Invalid attachments' using errcode='23505'; end if;
  update public.storage_files set resource_type='notice_attachment',resource_id=p_post where id=any(p_files);
  insert into public.notice_attachment_links(file_id,post_id,position) select x,p_post,existing+ordinality-1 from unnest(p_files) with ordinality files(x,ordinality);
  insert into public.notice_attachment_receipts(draft_id,post_id,owner_id) values(p_draft,p_post,actor);
  update public.post_upload_drafts set state='abandoned' where id=p_draft;
end $$;
revoke all on function public.notice_claim_draft(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.notice_claim_draft(uuid,uuid,uuid[]) to authenticated;
-- Allow client-provided UUIDs for idempotent invoker-RLS publication.
grant insert (id) on public.notices to authenticated;
create function public.publish_notice_with_draft(p_draft uuid,p_id uuid,p_post jsonb,p_files uuid[]) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid:=public.current_profile_id(); previous uuid;
begin
  if actor is null or not public.is_active_user() then raise exception 'Not permitted' using errcode='42501'; end if;
  previous:=public.notice_draft_post(p_draft); if previous is not null then return previous; end if;
  insert into public.notices(id,created_by,updated_by,title,body,category,importance,pinned,expires_at,status,published_at)
  values(p_id,actor,actor,p_post->>'title',p_post->>'body',(p_post->>'category')::public.notice_category,p_post->>'importance',coalesce((p_post->>'pinned')::boolean,false),nullif(p_post->>'expires_at','')::timestamptz,(p_post->>'status')::public.content_status,nullif(p_post->>'published_at','')::timestamptz);
  perform public.notice_claim_draft(p_draft,p_id,p_files);
  return p_id;
end $$;
revoke all on function public.publish_notice_with_draft(uuid,uuid,jsonb,uuid[]) from public,anon;
grant execute on function public.publish_notice_with_draft(uuid,uuid,jsonb,uuid[]) to authenticated;
create function public.notice_retire_attachment(p_post uuid,p_file uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_active_user() or not public.feature_enabled('notice_attachments') then raise exception 'Not permitted' using errcode='42501'; end if;
  perform 1 from public.notices where id=p_post and public.has_permission('manage_notices') for update;
  if not found then raise exception 'Not permitted' using errcode='42501'; end if;
  update public.storage_files f set status='delete_pending' from public.notice_attachment_links l where l.post_id=p_post and l.file_id=p_file and f.id=l.file_id and f.resource_type='notice_attachment' and f.status='ready';
  if not found then raise exception 'Attachment unavailable' using errcode='42501'; end if;
end $$;
revoke all on function public.notice_retire_attachment(uuid,uuid) from public,anon;
grant execute on function public.notice_retire_attachment(uuid,uuid) to authenticated;
create function public.notice_retire_deleted() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.storage_files f set status='delete_pending' from public.notice_attachment_links l where l.post_id=old.id and l.file_id=f.id and f.resource_type='notice_attachment' and f.status in ('reserved','ready');
  return old;
end $$;
revoke all on function public.notice_retire_deleted() from public,anon,authenticated;
create trigger notice_retire_deleted before delete on public.notices for each row execute function public.notice_retire_deleted();
create function public.storage_complete_notice_attachment_delete(p_file uuid) returns void language sql security definer set search_path=public,pg_temp as $$
  update public.storage_files set status='deleted',deleted_at=now() where id=p_file and resource_type='notice_attachment' and status='delete_pending';
$$;
revoke all on function public.storage_complete_notice_attachment_delete(uuid) from public,anon,authenticated;
grant execute on function public.storage_complete_notice_attachment_delete(uuid) to service_role;
select public.backup_sync_triggers();
