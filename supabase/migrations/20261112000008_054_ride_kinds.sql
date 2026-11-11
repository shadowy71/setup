-- Existing posts remain unclassified rather than being guessed as offers.
alter table public.ride_posts add column ride_kind text check (ride_kind in ('offer', 'request'));
grant update (ride_kind) on public.ride_posts to authenticated;
create index ride_posts_kind_date_idx on public.ride_posts (ride_kind, ride_date) where status = 'published';
