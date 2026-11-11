-- A previously saved RSVP cannot be changed after an event stops accepting
-- registrations. Existing rows remain untouched; users may still delete theirs.
alter policy event_registrations_update_own on public.event_registrations
  using (user_id = public.current_profile_id() and public.is_active_user() and public.has_permission('rsvp_events')
         and exists (select 1 from public.events e where e.id = event_id and e.status = 'published'))
  with check (user_id = public.current_profile_id() and public.is_active_user() and public.has_permission('rsvp_events')
              and exists (select 1 from public.events e where e.id = event_id and e.status = 'published'));
