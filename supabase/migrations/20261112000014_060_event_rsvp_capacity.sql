-- Keep capacity accounting private even when attendee visibility is disabled.
-- This separate counter is serialized by its row lock and never exposed through
-- event public projections. Existing RSVPs are retained, even if over capacity.
create table public.event_rsvp_capacity (
  event_id uuid primary key references public.events(id) on delete cascade,
  going_count integer not null default 0 check (going_count >= 0)
);
alter table public.event_rsvp_capacity enable row level security;
revoke all on public.event_rsvp_capacity from public,anon,authenticated;
grant all on public.event_rsvp_capacity to service_role;
insert into public.event_rsvp_capacity(event_id,going_count)
select e.id, count(r.id)::integer from public.events e left join public.event_registrations r on r.event_id=e.id and r.status='going' group by e.id;

create function public.sync_event_rsvp_capacity() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare old_going boolean := false; new_going boolean := false; target uuid; max_places integer;
begin
  if tg_op <> 'INSERT' then old_going := old.status='going'; end if;
  if tg_op <> 'DELETE' then new_going := new.status='going'; end if;
  target := case when tg_op='DELETE' then old.event_id else new.event_id end;
  if old_going = new_going then return coalesce(new,old); end if;
  if new_going then
    -- Lock the event against concurrent capacity edits; the counter row performs
    -- the atomic bounded increment even when multiple RSVP transactions race.
    select capacity into max_places from public.events where id=target for share;
    if not found then raise exception 'Event unavailable' using errcode='23503'; end if;
    insert into public.event_rsvp_capacity(event_id) values(target) on conflict do nothing;
    update public.event_rsvp_capacity set going_count=going_count+1 where event_id=target and (max_places is null or going_count < max_places);
    if not found then raise exception 'Event capacity is full' using errcode='23514'; end if;
  else
    update public.event_rsvp_capacity set going_count=greatest(going_count-1,0) where event_id=target;
  end if;
  return coalesce(new,old);
end $$;
revoke all on function public.sync_event_rsvp_capacity() from public,anon,authenticated;
create trigger event_rsvp_capacity_sync after insert or update of status or delete on public.event_registrations
for each row execute function public.sync_event_rsvp_capacity();
select public.backup_sync_triggers();
