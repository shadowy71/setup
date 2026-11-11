-- Private image links for lost-and-found reports; uploads use existing V3 drafts.
insert into public.feature_flags(key,label,description,group_name,enabled)
values ('lost_found_images','Lost and found images','Allow entitled users to add images to lost and found reports.','campus',false)
on conflict (key) do nothing;
alter table public.storage_files drop constraint storage_resource_type_check;
alter table public.storage_files add constraint storage_resource_type_check check (resource_type in ('profile_picture','post_attachment','marketplace_image','lost_found_image'));
create table public.lost_found_attachment_links (
  file_id uuid primary key references public.storage_files(id) on delete restrict,
  report_id uuid not null references public.lost_found(id) on delete cascade,
  position integer not null check (position between 0 and 7)
);
create index lost_found_attachment_links_report on public.lost_found_attachment_links(report_id,position);
alter table public.lost_found_attachment_links enable row level security;
revoke all on public.lost_found_attachment_links from public,anon,authenticated;
create policy lost_found_attachment_links_deny on public.lost_found_attachment_links for all to authenticated using(false) with check(false);
grant select,insert,update,delete on public.lost_found_attachment_links to service_role;
create table public.lost_found_attachment_receipts (
  draft_id uuid primary key references public.post_upload_drafts(id) on delete restrict,
  report_id uuid not null references public.lost_found(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete restrict
);
alter table public.lost_found_attachment_receipts enable row level security;
revoke all on public.lost_found_attachment_receipts from public,anon,authenticated;
create policy lost_found_attachment_receipts_deny on public.lost_found_attachment_receipts for all to authenticated using(false) with check(false);
grant select,insert,delete on public.lost_found_attachment_receipts to service_role;
create function public.lost_found_draft_report(p_draft uuid) returns uuid language sql stable security definer set search_path=public,pg_temp as $$
  select report_id from public.lost_found_attachment_receipts where draft_id=p_draft and owner_id=public.current_profile_id() and public.is_active_user();
$$;
revoke all on function public.lost_found_draft_report(uuid) from public,anon;
grant execute on function public.lost_found_draft_report(uuid) to authenticated;
create function public.lost_found_claim_draft(p_draft uuid,p_report uuid,p_files uuid[]) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.current_profile_id(); d public.post_upload_drafts%rowtype; r public.lost_found%rowtype; n integer; existing integer;
begin
  if not public.feature_enabled('lost_found_images') or actor is null or not public.is_active_user() or p_files is null or cardinality(p_files) not between 1 and 8 then raise exception 'Not permitted' using errcode='42501'; end if;
  perform 1 from public.storage_accounts where profile_id=actor and upload_enabled for update;
  if not found then raise exception 'Uploads disabled' using errcode='42501'; end if;
  if exists(select 1 from public.lost_found_attachment_receipts where draft_id=p_draft and owner_id=actor and report_id=p_report) then return; end if;
  select * into d from public.post_upload_drafts where id=p_draft and owner_id=actor for update;
  if not found or d.state<>'open' or d.expires_at<=now() then raise exception 'Draft unavailable' using errcode='42501'; end if;
  select * into r from public.lost_found where id=p_report for update;
  if not found or r.creator_id<>actor or r.status<>'published' then raise exception 'Report unavailable' using errcode='42501'; end if;
  select count(*) into existing from public.lost_found_attachment_links l join public.storage_files f on f.id=l.file_id where l.report_id=p_report and f.status in ('ready','reserved');
  select count(*) into n from public.storage_files f join public.post_upload_draft_files l on l.file_id=f.id where l.draft_id=p_draft and f.owner_id=actor and f.resource_type='post_attachment' and f.resource_id=p_draft and f.status in ('ready','reserved');
  if existing+n>8 or n<>cardinality(p_files) or (select count(distinct x) from unnest(p_files) x)<>n or exists(select 1 from unnest(p_files) x where not exists(select 1 from public.storage_files f join public.post_upload_draft_files l on l.file_id=f.id where f.id=x and l.draft_id=p_draft and f.owner_id=actor and f.resource_type='post_attachment' and f.resource_id=p_draft and f.status='ready' and f.mime_type in ('image/jpeg','image/png','image/webp'))) then raise exception 'Invalid images' using errcode='23505'; end if;
  update public.storage_files set resource_type='lost_found_image',resource_id=p_report where id=any(p_files);
  insert into public.lost_found_attachment_links(file_id,report_id,position) select x,p_report,existing+ordinality-1 from unnest(p_files) with ordinality files(x,ordinality);
  insert into public.lost_found_attachment_receipts(draft_id,report_id,owner_id) values(p_draft,p_report,actor);
  update public.post_upload_drafts set state='abandoned' where id=p_draft;
end $$;
revoke all on function public.lost_found_claim_draft(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.lost_found_claim_draft(uuid,uuid,uuid[]) to authenticated;
create function public.publish_lost_found_with_draft(p_draft uuid,p_id uuid,p_report jsonb,p_files uuid[]) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid:=public.current_profile_id(); previous uuid;
begin
  if actor is null or not public.is_active_user() then raise exception 'Not permitted' using errcode='42501'; end if;
  previous:=public.lost_found_draft_report(p_draft); if previous is not null then return previous; end if;
  insert into public.lost_found(id,creator_id,kind,title,description,location,occurred_on,status)
  values(p_id,actor,(p_report->>'kind')::public.lost_found_kind,p_report->>'title',p_report->>'description',nullif(p_report->>'location',''),nullif(p_report->>'occurred_on','')::date,'published');
  perform public.lost_found_claim_draft(p_draft,p_id,p_files);
  return p_id;
end $$;
revoke all on function public.publish_lost_found_with_draft(uuid,uuid,jsonb,uuid[]) from public,anon;
grant execute on function public.publish_lost_found_with_draft(uuid,uuid,jsonb,uuid[]) to authenticated;
create function public.lost_found_retire_image(p_report uuid,p_file uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_active_user() or not public.feature_enabled('lost_found_images') then raise exception 'Not permitted' using errcode='42501'; end if;
  perform 1 from public.lost_found where id=p_report and creator_id=public.current_profile_id() for update;
  if not found then raise exception 'Not permitted' using errcode='42501'; end if;
  update public.storage_files f set status='delete_pending' from public.lost_found_attachment_links l where l.report_id=p_report and l.file_id=p_file and f.id=l.file_id and f.resource_type='lost_found_image' and f.status='ready';
  if not found then raise exception 'Image unavailable' using errcode='42501'; end if;
end $$;
revoke all on function public.lost_found_retire_image(uuid,uuid) from public,anon;
grant execute on function public.lost_found_retire_image(uuid,uuid) to authenticated;
create function public.lost_found_retire_deleted() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.storage_files f set status='delete_pending' from public.lost_found_attachment_links l where l.report_id=old.id and l.file_id=f.id and f.resource_type='lost_found_image' and f.status in ('reserved','ready');
  return old;
end $$;
revoke all on function public.lost_found_retire_deleted() from public,anon,authenticated;
create trigger lost_found_retire_deleted before delete on public.lost_found for each row execute function public.lost_found_retire_deleted();
create function public.storage_complete_lost_found_image_delete(p_file uuid) returns void language sql security definer set search_path=public,pg_temp as $$
  update public.storage_files set status='deleted',deleted_at=now() where id=p_file and resource_type='lost_found_image' and status='delete_pending';
$$;
revoke all on function public.storage_complete_lost_found_image_delete(uuid) from public,anon,authenticated;
grant execute on function public.storage_complete_lost_found_image_delete(uuid) to service_role;
select public.backup_sync_triggers();
