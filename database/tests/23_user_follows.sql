-- Follow relationships remain private, unique, non-self and block-aware.
select set_config('request.jwt.claim.role', 'service_role', false);
insert into auth.users (id, email, raw_user_meta_data) values
  ('fa110000-0000-4000-a000-000000000001', 'followone@pccoepune.org', '{}'::jsonb),
  ('fa110000-0000-4000-a000-000000000002', 'followtwo@pccoepune.org', '{}'::jsonb),
  ('fa110000-0000-4000-a000-000000000003', 'followthree@pccoepune.org', '{}'::jsonb)
on conflict (id) do nothing;
select set_config('request.jwt.claim.sub', 'fa110000-0000-4000-a000-000000000001', false);
select public.complete_profile('followone', 'Follow One', null, 'Computer Engineering', 'Third Year', 'A');
select set_config('request.jwt.claim.sub', 'fa110000-0000-4000-a000-000000000002', false);
select public.complete_profile('followtwo', 'Follow Two', null, 'Computer Engineering', 'Third Year', 'A');
select set_config('request.jwt.claim.sub', 'fa110000-0000-4000-a000-000000000003', false);
select public.complete_profile('followthree', 'Follow Three', null, 'Computer Engineering', 'Third Year', 'A');

insert into public.posts (id, author_id, kind, body, created_at)
select 'fb110000-0000-4000-a000-000000000001', id, 'post', 'Followed older', now() - interval '1 hour' from public.profiles where username = 'followtwo';
insert into public.posts (id, author_id, kind, body, created_at)
select 'fb110000-0000-4000-a000-000000000002', id, 'post', 'Followed newer', now() from public.profiles where username = 'followtwo';
insert into public.posts (id, author_id, kind, body, created_at)
select 'fb110000-0000-4000-a000-000000000003', id, 'post', 'Not followed', now() from public.profiles where username = 'followthree';
insert into public.posts (id, author_id, kind, body, status, created_at)
select 'fb110000-0000-4000-a000-000000000004', id, 'post', 'Hidden', 'hidden', now() from public.profiles where username = 'followtwo';

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'fa110000-0000-4000-a000-000000000001', false);
insert into public.user_follows (follower_id, followed_id)
select public.current_profile_id(), id from public.profiles where username = 'followtwo';
do $$
begin
  perform public.test_assert((select count(*) from public.user_follows) = 1, 'own follow is visible');
  perform public.test_assert((select count(*) from public.following_feed(10, 0)) = 2, 'feed includes followed author only');
  perform public.test_assert((select id from public.following_feed(1, 0)) = 'fb110000-0000-4000-a000-000000000002', 'feed is newest first');
  perform public.test_assert((select id from public.following_feed(1, 1)) = 'fb110000-0000-4000-a000-000000000001', 'feed pagination selects the next post');
  begin
    insert into public.user_follows (follower_id, followed_id) values (public.current_profile_id(), public.current_profile_id());
    raise exception 'self-follow unexpectedly succeeded';
  exception when check_violation then null; end;
  begin
    insert into public.user_follows (follower_id, followed_id)
    select public.current_profile_id(), id from public.profiles where username = 'followtwo';
    raise exception 'duplicate follow unexpectedly succeeded';
  exception when unique_violation then null; end;
  begin
    insert into public.user_follows (follower_id, followed_id)
    select id, public.current_profile_id() from public.profiles where username = 'followthree';
    raise exception 'forged follower unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;

insert into public.mutes (user_id, muted_user_id)
select public.current_profile_id(), id from public.profiles where username = 'followtwo';
select public.test_assert((select count(*) from public.following_feed(10, 0)) = 0, 'muted author is excluded');
delete from public.mutes where user_id = public.current_profile_id();

select set_config('request.jwt.claim.sub', 'fa110000-0000-4000-a000-000000000002', false);
select public.test_assert((select count(*) from public.user_follows) = 0, 'other users cannot read followers');
insert into public.blocks (blocker_id, blocked_id)
select public.current_profile_id(), id from public.profiles where username = 'followthree';
insert into public.blocks (blocker_id, blocked_id)
select public.current_profile_id(), id from public.profiles where username = 'followone';
select set_config('request.jwt.claim.sub', 'fa110000-0000-4000-a000-000000000001', false);
select public.test_assert((select count(*) from public.following_feed(10, 0)) = 0, 'blocked author is excluded');
select set_config('request.jwt.claim.sub', 'fa110000-0000-4000-a000-000000000003', false);
do $$
begin
  begin
    insert into public.user_follows (follower_id, followed_id)
    select public.current_profile_id(), id from public.profiles where username = 'followtwo';
    raise exception 'blocked follow unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', 'fa110000-0000-4000-a000-000000000001', false);
delete from public.user_follows where follower_id = public.current_profile_id();
select public.test_assert((select count(*) from public.user_follows) = 0, 'unfollow removes relationship');
select public.test_assert((select count(*) from public.following_feed(10, 0)) = 0, 'unfollow removes posts from feed');
reset role;
