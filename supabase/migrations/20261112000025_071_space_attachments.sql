-- Private attachment links for space posts; uploads use existing V3 drafts.
insert into public.feature_flags(key,label,description,group_name,enabled)
values ('space_attachments','Space attachments','Allow entitled users to add attachments to space posts.','campus',false)
on conflict (key) do nothing;
alter table public.storage_files drop constraint storage_resource_type_check;
alter table public.storage_files add constraint storage_resource_type_check check (resource_type in ('profile_picture','post_attachment','marketplace_image','lost_found_image','housing_attachment','ride_attachment','team_attachment','project_attachment','gig_attachment','achievement_attachment','notice_attachment','event_attachment','space_attachment'));
create table public.space_attachment_links (
  file_id uuid primary key references public.storage_files(id) on delete restrict,
  post_id uuid not null references public.communities(id) on delete cascade,
  position integer not null check (position between 0 and 7)
);
create index space_attachment_links_post on public.space_attachment_links(post_id,position);
alter table public.space_attachment_links enable row level security;
revoke all on public.space_attachment_links from public,anon,authenticated;
create policy space_attachment_links_deny on public.space_attachment_links for all to authenticated using(false) with check(false);
grant select,insert,update,delete on public.space_attachment_links to service_role;
create table public.space_attachment_receipts (
  draft_id uuid primary key references public.post_upload_drafts(id) on delete restrict,
  post_id uuid not null references public.communities(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete restrict
);
alter table public.space_attachment_receipts enable row level security;
revoke all on public.space_attachment_receipts from public,anon,authenticated;
create policy space_attachment_receipts_deny on public.space_attachment_receipts for all to authenticated using(false) with check(false);
grant select,insert,delete on public.space_attachment_receipts to service_role;
create function public.space_draft_post(p_draft uuid) returns uuid language sql stable security definer set search_path=public,pg_temp as $$
  select post_id from public.space_attachment_receipts where draft_id=p_draft and owner_id=public.current_profile_id() and public.is_active_user();
$$;
revoke all on function public.space_draft_post(uuid) from public,anon;
grant execute on function public.space_draft_post(uuid) to authenticated;
create function public.can_manage_space(p_space uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_active_user() and exists(select 1 from public.communities c where c.id=p_space and
    case when c.kind='club' then public.can_manage_club(c.id) else public.is_community_moderator(c.id) or public.has_permission('moderate_communities') or public.has_permission('moderate_all') end);
$$;
revoke all on function public.can_manage_space(uuid) from public,anon;
grant execute on function public.can_manage_space(uuid) to authenticated;
create function public.space_claim_draft(p_draft uuid,p_post uuid,p_files uuid[]) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.current_profile_id(); d public.post_upload_drafts%rowtype; r public.communities%rowtype; n integer; existing integer;
begin
  if not public.feature_enabled('space_attachments') or actor is null or not public.is_active_user() or p_files is null or cardinality(p_files) not between 1 and 8 then raise exception 'Not permitted' using errcode='42501'; end if;
  perform 1 from public.storage_accounts where profile_id=actor and upload_enabled for update;
  if not found then raise exception 'Uploads disabled' using errcode='42501'; end if;
  if exists(select 1 from public.space_attachment_receipts where draft_id=p_draft and owner_id=actor and post_id=p_post) then return; end if;
  select * into d from public.post_upload_drafts where id=p_draft and owner_id=actor for update;
  if not found or d.state<>'open' or d.expires_at<=now() then raise exception 'Draft unavailable' using errcode='42501'; end if;
  select * into r from public.communities where id=p_post for update;
  if not found or not public.can_manage_space(p_post) then raise exception 'Post unavailable' using errcode='42501'; end if;
  select count(*) into existing from public.space_attachment_links l join public.storage_files f on f.id=l.file_id where l.post_id=p_post and f.status in ('ready','reserved');
  select count(*) into n from public.storage_files f join public.post_upload_draft_files l on l.file_id=f.id where l.draft_id=p_draft and f.owner_id=actor and f.resource_type='post_attachment' and f.resource_id=p_draft and f.status in ('ready','reserved');
  if existing+n>8 or n<>cardinality(p_files) or (select count(distinct x) from unnest(p_files) x)<>n or exists(select 1 from unnest(p_files) x where not exists(select 1 from public.storage_files f join public.post_upload_draft_files l on l.file_id=f.id where f.id=x and l.draft_id=p_draft and f.owner_id=actor and f.resource_type='post_attachment' and f.resource_id=p_draft and f.status='ready' and (f.mime_type in ('image/jpeg','image/png','image/webp') or (r.kind='club' and f.mime_type='application/pdf')))) then raise exception 'Invalid attachments' using errcode='23505'; end if;
  update public.storage_files set resource_type='space_attachment',resource_id=p_post where id=any(p_files);
  insert into public.space_attachment_links(file_id,post_id,position) select x,p_post,existing+ordinality-1 from unnest(p_files) with ordinality files(x,ordinality);
  insert into public.space_attachment_receipts(draft_id,post_id,owner_id) values(p_draft,p_post,actor);
  update public.post_upload_drafts set state='abandoned' where id=p_draft;
end $$;
revoke all on function public.space_claim_draft(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.space_claim_draft(uuid,uuid,uuid[]) to authenticated;
-- Allow client-provided UUIDs for idempotent invoker-RLS publication.
grant insert (id) on public.communities to authenticated;
create function public.publish_space_with_draft(p_draft uuid,p_id uuid,p_post jsonb,p_files uuid[]) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid:=public.current_profile_id(); previous uuid;
begin
  if actor is null or not public.is_active_user() then raise exception 'Not permitted' using errcode='42501'; end if;
  previous:=public.space_draft_post(p_draft);
  if previous is not null then return (select jsonb_build_object('id',id,'slug',slug) from public.communities where id=previous); end if;
  if p_post->>'kind' not in ('community','study_group') then raise exception 'Not permitted' using errcode='42501'; end if;
  insert into public.communities(id,kind,name,slug,description,subject,branch,year,meeting_info,contact_info,external_url,visibility,join_policy,status,is_official,created_by)
  values(p_id,(p_post->>'kind')::public.community_kind,p_post->>'name',p_post->>'slug',p_post->>'description',nullif(p_post->>'subject',''),nullif(p_post->>'branch',''),nullif(p_post->>'year',''),nullif(p_post->>'meeting_info',''),nullif(p_post->>'contact_info',''),nullif(p_post->>'external_url',''),(p_post->>'visibility')::public.visibility_level,p_post->>'join_policy','published',false,actor);
  perform public.space_claim_draft(p_draft,p_id,p_files);
  return jsonb_build_object('id',p_id,'slug',p_post->>'slug');
end $$;
revoke all on function public.publish_space_with_draft(uuid,uuid,jsonb,uuid[]) from public,anon;
grant execute on function public.publish_space_with_draft(uuid,uuid,jsonb,uuid[]) to authenticated;
create function public.publish_club_with_draft(p_draft uuid,p_admin_username text,p_post jsonb,p_files uuid[]) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare previous uuid; result jsonb; club_id uuid;
begin
  if not public.is_active_user() or not public.has_permission('manage_clubs') then raise exception 'Not permitted' using errcode='42501'; end if;
  previous:=public.space_draft_post(p_draft);
  if previous is not null then return (select jsonb_build_object('id',id,'slug',slug) from public.communities where id=previous and kind='club'); end if;
  result:=public.create_club_with_admin(p_admin_username,p_post);
  club_id:=(result->>'id')::uuid;
  perform public.space_claim_draft(p_draft,club_id,p_files);
  return result;
end $$;
revoke all on function public.publish_club_with_draft(uuid,text,jsonb,uuid[]) from public,anon;
grant execute on function public.publish_club_with_draft(uuid,text,jsonb,uuid[]) to authenticated;
create function public.space_retire_attachment(p_post uuid,p_file uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_active_user() or not public.feature_enabled('space_attachments') then raise exception 'Not permitted' using errcode='42501'; end if;
  perform 1 from public.communities where id=p_post and public.can_manage_space(p_post) for update;
  if not found then raise exception 'Not permitted' using errcode='42501'; end if;
  update public.storage_files f set status='delete_pending' from public.space_attachment_links l where l.post_id=p_post and l.file_id=p_file and f.id=l.file_id and f.resource_type='space_attachment' and f.status='ready';
  if not found then raise exception 'Attachment unavailable' using errcode='42501'; end if;
end $$;
revoke all on function public.space_retire_attachment(uuid,uuid) from public,anon;
grant execute on function public.space_retire_attachment(uuid,uuid) to authenticated;
create function public.space_retire_deleted() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.storage_files f set status='delete_pending' from public.space_attachment_links l where l.post_id=old.id and l.file_id=f.id and f.resource_type='space_attachment' and f.status in ('reserved','ready');
  return old;
end $$;
revoke all on function public.space_retire_deleted() from public,anon,authenticated;
create trigger space_retire_deleted before delete on public.communities for each row execute function public.space_retire_deleted();
create function public.storage_complete_space_attachment_delete(p_file uuid) returns void language sql security definer set search_path=public,pg_temp as $$
  update public.storage_files set status='deleted',deleted_at=now() where id=p_file and resource_type='space_attachment' and status='delete_pending';
$$;
revoke all on function public.storage_complete_space_attachment_delete(uuid) from public,anon,authenticated;
grant execute on function public.storage_complete_space_attachment_delete(uuid) to service_role;
select public.backup_sync_triggers();
