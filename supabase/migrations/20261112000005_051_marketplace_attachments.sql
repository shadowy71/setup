insert into public.feature_flags(key,label,description,group_name,enabled) values ('marketplace_images','Marketplace images','Allow entitled users to attach images to marketplace listings.','marketplace',false) on conflict (key) do nothing;

-- Marketplace images share the existing account quota, draft reservations and V3 gateway.
alter table public.storage_files drop constraint storage_resource_type_check;
alter table public.storage_files add constraint storage_resource_type_check check (resource_type in ('profile_picture','post_attachment','marketplace_image'));
create table public.marketplace_attachment_links (
  file_id uuid primary key references public.storage_files(id) on delete restrict,
  listing_id uuid not null references public.marketplace_listings(id) on delete cascade,
  position integer not null check (position between 0 and 7)
);
create index marketplace_attachment_links_listing on public.marketplace_attachment_links(listing_id,position);
alter table public.marketplace_attachment_links enable row level security;
revoke all on public.marketplace_attachment_links from public,anon,authenticated;
create policy marketplace_attachment_links_deny on public.marketplace_attachment_links for all to authenticated using(false) with check(false);
grant select,insert,update,delete on public.marketplace_attachment_links to service_role;

-- An immutable receipt allows a lost publish response to be safely retried.
create table public.marketplace_attachment_draft_receipts (
  draft_id uuid primary key references public.post_upload_drafts(id) on delete restrict,
  listing_id uuid not null references public.marketplace_listings(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete restrict
);
alter table public.marketplace_attachment_draft_receipts enable row level security;
revoke all on public.marketplace_attachment_draft_receipts from public,anon,authenticated;
create policy marketplace_attachment_draft_receipts_deny on public.marketplace_attachment_draft_receipts for all to authenticated using(false) with check(false);
grant select,insert,delete on public.marketplace_attachment_draft_receipts to service_role;

create function public.marketplace_draft_listing(p_draft uuid) returns uuid language sql stable security definer set search_path=public,pg_temp as $$
  select listing_id from public.marketplace_attachment_draft_receipts where draft_id=p_draft and owner_id=public.current_profile_id() and public.is_active_user();
$$;
revoke all on function public.marketplace_draft_listing(uuid) from public,anon;
grant execute on function public.marketplace_draft_listing(uuid) to authenticated;

-- Called within the listing creation transaction or by an authorized editor.
create function public.marketplace_claim_draft(p_draft uuid,p_listing uuid,p_files uuid[]) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.current_profile_id(); d public.post_upload_drafts%rowtype; listing public.marketplace_listings%rowtype; n integer; existing integer;
begin
  if not coalesce((select enabled from public.feature_flags where key='marketplace_images'),false) then raise exception 'Images disabled' using errcode='42501'; end if;
  if actor is null or not public.is_active_user() or p_files is null or cardinality(p_files) not between 1 and 8 then raise exception 'Not permitted' using errcode='42501'; end if;
  perform 1 from public.storage_accounts where profile_id=actor and upload_enabled for update;
  if not found then raise exception 'Uploads disabled' using errcode='42501'; end if;
  if exists(select 1 from public.marketplace_attachment_draft_receipts where draft_id=p_draft and owner_id=actor and listing_id=p_listing) then return; end if;
  select * into d from public.post_upload_drafts where id=p_draft and owner_id=actor for update;
  if not found or d.state<>'open' or d.expires_at<=now() then raise exception 'Draft unavailable' using errcode='42501'; end if;
  select * into listing from public.marketplace_listings where id=p_listing for update;
  if not found or (listing.seller_id<>actor and not (public.has_permission('moderate_marketplace') or public.has_permission('moderate_all'))) or listing.status not in ('active','pending','reserved') then raise exception 'Listing unavailable' using errcode='42501'; end if;
  select count(*) into existing from public.marketplace_attachment_links l join public.storage_files f on f.id=l.file_id where l.listing_id=p_listing and f.status in ('ready','reserved');
  select count(*) into n from public.storage_files f join public.post_upload_draft_files l on l.file_id=f.id where l.draft_id=p_draft and f.owner_id=actor and f.resource_type='post_attachment' and f.resource_id=p_draft and f.status in ('ready','reserved');
  if existing+n>8 or n<>cardinality(p_files) or (select count(distinct x) from unnest(p_files) x)<>n or exists(select 1 from unnest(p_files) x where not exists(select 1 from public.storage_files f join public.post_upload_draft_files l on l.file_id=f.id where f.id=x and l.draft_id=p_draft and f.owner_id=actor and f.resource_type='post_attachment' and f.resource_id=p_draft and f.status='ready' and f.mime_type in ('image/jpeg','image/png','image/webp'))) then raise exception 'Invalid gallery' using errcode='23505'; end if;
  update public.storage_files set resource_type='marketplace_image',resource_id=p_listing where id=any(p_files);
  insert into public.marketplace_attachment_links(file_id,listing_id,position) select x,p_listing,existing+ordinality-1 from unnest(p_files) with ordinality files(x,ordinality);
  insert into public.marketplace_attachment_draft_receipts(draft_id,listing_id,owner_id) values(p_draft,p_listing,actor);
  update public.post_upload_drafts set state='abandoned' where id=p_draft;
end $$;
revoke all on function public.marketplace_claim_draft(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.marketplace_claim_draft(uuid,uuid,uuid[]) to authenticated;

create function public.publish_listing_with_draft(p_draft uuid,p_id uuid,p_listing jsonb,p_files uuid[]) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid:=public.current_profile_id(); previous uuid;
begin
  if actor is null or not public.is_active_user() then raise exception 'Not permitted' using errcode='42501'; end if;
  previous:=public.marketplace_draft_listing(p_draft); if previous is not null then return previous; end if;
  insert into public.marketplace_listings(id,seller_id,category_id,title,description,price,is_free,is_negotiable,condition,location,contact_note,status)
  values(p_id,actor,(p_listing->>'category_id')::uuid,p_listing->>'title',p_listing->>'description',nullif(p_listing->>'price','')::numeric,coalesce((p_listing->>'is_free')::boolean,false),coalesce((p_listing->>'is_negotiable')::boolean,false),(p_listing->>'condition')::public.item_condition,nullif(p_listing->>'location',''),nullif(p_listing->>'contact_note',''),(p_listing->>'status')::public.listing_status);
  perform public.marketplace_claim_draft(p_draft,p_id,p_files);
  return p_id;
end $$;
revoke all on function public.publish_listing_with_draft(uuid,uuid,jsonb,uuid[]) from public,anon;
grant execute on function public.publish_listing_with_draft(uuid,uuid,jsonb,uuid[]) to authenticated;

create function public.marketplace_reorder_images(p_listing uuid,p_files uuid[]) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.current_profile_id(); l public.marketplace_listings%rowtype; n integer;
begin
  if not coalesce((select enabled from public.feature_flags where key='marketplace_images'),false) then raise exception 'Images disabled' using errcode='42501'; end if;
  if actor is null or not public.is_active_user() or p_files is null then raise exception 'Not allowed' using errcode='42501'; end if;
  select * into l from public.marketplace_listings where id=p_listing for update;
  if not found or (l.seller_id<>actor and not (public.has_permission('moderate_marketplace') or public.has_permission('moderate_all'))) then raise exception 'Not allowed' using errcode='42501'; end if;
  select count(*) into n from public.marketplace_attachment_links ml join public.storage_files f on f.id=ml.file_id where ml.listing_id=p_listing and f.status='ready';
  if cardinality(p_files)<>n or (select count(distinct x) from unnest(p_files) x)<>n or exists(select 1 from unnest(p_files) x where not exists(select 1 from public.marketplace_attachment_links ml join public.storage_files f on f.id=ml.file_id where ml.listing_id=p_listing and f.id=x and f.status='ready')) then raise exception 'Gallery changed' using errcode='23505'; end if;
  update public.marketplace_attachment_links ml set position=x.ordinality-1 from unnest(p_files) with ordinality x(id,ordinality) where ml.file_id=x.id and ml.listing_id=p_listing;
end $$;
revoke all on function public.marketplace_reorder_images(uuid,uuid[]) from public,anon;
grant execute on function public.marketplace_reorder_images(uuid,uuid[]) to authenticated;

create function public.marketplace_retire_image(p_listing uuid,p_file uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.current_profile_id(); l public.marketplace_listings%rowtype;
begin
  if actor is null or not public.is_active_user() then raise exception 'Not allowed' using errcode='42501'; end if;
  select * into l from public.marketplace_listings where id=p_listing for update;
  if not found or (l.seller_id<>actor and not (public.has_permission('moderate_marketplace') or public.has_permission('moderate_all'))) then raise exception 'Not allowed' using errcode='42501'; end if;
  update public.storage_files f set status='delete_pending' from public.marketplace_attachment_links ml where ml.file_id=p_file and ml.listing_id=p_listing and f.id=ml.file_id and f.resource_type='marketplace_image' and f.status='ready';
  if not found then raise exception 'Image unavailable' using errcode='42501'; end if;
  delete from public.marketplace_attachment_links where listing_id=p_listing and file_id=p_file;
  with ordered as (select file_id,row_number() over(order by position,file_id)-1 as pos from public.marketplace_attachment_links where listing_id=p_listing) update public.marketplace_attachment_links ml set position=ordered.pos from ordered where ml.file_id=ordered.file_id;
end $$;
revoke all on function public.marketplace_retire_image(uuid,uuid) from public,anon;
grant execute on function public.marketplace_retire_image(uuid,uuid) to authenticated;

-- Atomically swap one ready draft image into the old position, including cover.
create function public.marketplace_claim_replacement(p_listing uuid,p_draft uuid,p_old uuid,p_new uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.current_profile_id(); d public.post_upload_drafts%rowtype; l public.marketplace_listings%rowtype; old_position integer; n integer;
begin
  if actor is null or not public.is_active_user() or not coalesce((select enabled from public.feature_flags where key='marketplace_images'),false) then raise exception 'Not allowed' using errcode='42501'; end if;
  perform 1 from public.storage_accounts where profile_id=actor and upload_enabled for update;
  if not found then raise exception 'Uploads disabled' using errcode='42501'; end if;
  if exists(select 1 from public.marketplace_attachment_draft_receipts where draft_id=p_draft and owner_id=actor and listing_id=p_listing) then return; end if;
  select * into d from public.post_upload_drafts where id=p_draft and owner_id=actor for update;
  if not found or d.state<>'open' or d.expires_at<=now() then raise exception 'Draft unavailable' using errcode='42501'; end if;
  select * into l from public.marketplace_listings where id=p_listing for update;
  if not found or (l.seller_id<>actor and not (public.has_permission('moderate_marketplace') or public.has_permission('moderate_all'))) or l.status not in ('active','pending','reserved') then raise exception 'Not allowed' using errcode='42501'; end if;
  select ml.position into old_position from public.marketplace_attachment_links ml join public.storage_files f on f.id=ml.file_id where ml.listing_id=p_listing and ml.file_id=p_old and f.status='ready';
  if not found then raise exception 'Image unavailable' using errcode='42501'; end if;
  select count(*) into n from public.post_upload_draft_files dl join public.storage_files f on f.id=dl.file_id where dl.draft_id=p_draft and f.owner_id=actor and f.resource_type='post_attachment' and f.resource_id=p_draft and f.status in ('ready','reserved');
  if n<>1 or not exists(select 1 from public.post_upload_draft_files dl join public.storage_files f on f.id=dl.file_id where dl.draft_id=p_draft and f.id=p_new and f.owner_id=actor and f.resource_type='post_attachment' and f.resource_id=p_draft and f.status='ready' and f.mime_type in ('image/jpeg','image/png','image/webp')) then raise exception 'Invalid replacement' using errcode='23505'; end if;
  update public.storage_files set status='delete_pending' where id=p_old and resource_type='marketplace_image' and status='ready';
  delete from public.marketplace_attachment_links where listing_id=p_listing and file_id=p_old;
  update public.storage_files set resource_type='marketplace_image',resource_id=p_listing where id=p_new;
  insert into public.marketplace_attachment_links(file_id,listing_id,position) values(p_new,p_listing,old_position);
  insert into public.marketplace_attachment_draft_receipts(draft_id,listing_id,owner_id) values(p_draft,p_listing,actor);
  update public.post_upload_drafts set state='abandoned' where id=p_draft;
end $$;
revoke all on function public.marketplace_claim_replacement(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.marketplace_claim_replacement(uuid,uuid,uuid,uuid) to authenticated;

create function public.marketplace_retire_deleted_listing() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.storage_files f set status='delete_pending' from public.marketplace_attachment_links l where l.listing_id=old.id and l.file_id=f.id and f.resource_type='marketplace_image' and f.status in ('reserved','ready');
  return old;
end $$;
revoke all on function public.marketplace_retire_deleted_listing() from public,anon,authenticated;
create trigger marketplace_retire_deleted_listing before delete on public.marketplace_listings for each row execute function public.marketplace_retire_deleted_listing();

create function public.storage_complete_marketplace_image_delete(p_file uuid) returns void language sql security definer set search_path=public,pg_temp as $$
  update public.storage_files set status='deleted',deleted_at=now() where id=p_file and resource_type='marketplace_image' and status='delete_pending';
$$;
revoke all on function public.storage_complete_marketplace_image_delete(uuid) from public,anon,authenticated;
grant execute on function public.storage_complete_marketplace_image_delete(uuid) to service_role;

create function public.can_view_marketplace_images(p_listing uuid) returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
  select exists(select 1 from public.marketplace_listings l where l.id=p_listing and public.is_active_profile(l.seller_id) and not public.is_blocked_with_current(l.seller_id) and (l.status in ('active','reserved','sold') or l.seller_id=public.current_profile_id() or public.has_permission('moderate_marketplace') or public.has_permission('moderate_all')));
$$;
revoke all on function public.can_view_marketplace_images(uuid) from public,anon;
grant execute on function public.can_view_marketplace_images(uuid) to authenticated;

select public.backup_sync_triggers();
