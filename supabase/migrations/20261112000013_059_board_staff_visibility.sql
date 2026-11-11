-- Moderators can inspect hidden board reports without granting student access.
create policy housing_select_staff on public.housing_posts for select to authenticated using (public.has_permission('moderate_all'));
create policy rides_select_staff on public.ride_posts for select to authenticated using (public.has_permission('moderate_all'));
