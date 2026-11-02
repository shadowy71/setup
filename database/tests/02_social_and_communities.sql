-- =============================================================================
-- Campus+ database tests — 02 posts, comments, reactions, polls, communities
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Fixtures (trusted context, like a maintenance script)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('b0000000-0000-4000-a000-000000000001', 'bhavya@pccoepune.org'),
  ('b0000000-0000-4000-a000-000000000002', 'chaitanya@pccoepune.org'),
  ('b0000000-0000-4000-a000-000000000003', 'dhruv@pccoepune.org')
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-a000-000000000001', false);
select public.complete_profile('bhavya', 'Bhavya Kulkarni', null, 'Computer Engineering', 'Third Year');
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-a000-000000000002', false);
select public.complete_profile('chaitanya', 'Chaitanya Deshmukh');
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-a000-000000000003', false);
select public.complete_profile('dhruv', 'Dhruv Nair');
select set_config('request.jwt.claim.sub', '', false);

-- A post that already exists, authored by Bhavya, used by later assertions.
insert into public.posts (author_id, body)
select id, 'Placement prep session in the seminar hall on Saturday.' from public.profiles where username = 'bhavya';

-- ---------------------------------------------------------------------------
-- 1. A student can post; other students can read it.
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_body text;
begin
  insert into public.posts (author_id, body) values (public.current_profile_id(), 'Anyone selling a scientific calculator?')
  returning body into v_body;
  perform public.test_assert(v_body like 'Anyone selling%', 'a student with create_posts must be able to publish a post');
end;
$$;

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-a000-000000000002', false);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.posts where body like 'Placement prep%';
  perform public.test_assert(v_count = 1, 'a student must be able to read another student''s public post');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A suspended author's content disappears for everyone else.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
update public.profile_private set account_status = 'suspended', suspended_until = now() + interval '3 days'
 where profile_id = (select id from public.profiles where username = 'chaitanya');
reset role;

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-a000-000000000001', false);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.posts where author_id = (select id from public.profiles where username = 'chaitanya');
  perform public.test_assert(v_count = 0, 'content from a suspended account must not be readable by others');
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
update public.profile_private set account_status = 'active', suspended_until = null
 where profile_id = (select id from public.profiles where username = 'chaitanya');
reset role;

-- ---------------------------------------------------------------------------
-- 3. Blocking hides content in both directions.
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-a000-000000000003', false);

insert into public.blocks (blocker_id, blocked_id)
select a.id, b.id
from public.profiles a, public.profiles b
where a.username = 'dhruv' and b.username = 'bhavya';

do $$
declare
  v_visible integer;
begin
  select count(*) into v_visible
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  where pr.username = 'bhavya';
  perform public.test_assert(v_visible = 0, 'a blocking student must not see the blocked student''s posts');

  select count(*) into v_visible
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  where pr.username = 'dhruv';
  perform public.test_assert(v_visible = 0, 'a blocked student must not see the blocking student''s posts either');
end;
$$;

-- The block is one-directional in storage.
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-a000-000000000001', false);
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.blocks where blocker_id = public.current_profile_id();
  perform public.test_assert(v_count = 0, 'the blocked student must not be able to read or alter the blocker''s block list');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Ownership: another student cannot edit or delete your post.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-a000-000000000002', false);

update public.posts set body = 'Rewritten by someone else' where body like 'Placement prep%';
do $$
declare
  v_body text;
begin
  select body into v_body from public.posts where body like 'Placement prep%';
  perform public.test_assert(v_body like 'Placement prep%', 'another student must not be able to edit your post');
end;
$$;

delete from public.posts where body like 'Placement prep%';
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.posts where body like 'Placement prep%';
  perform public.test_assert(v_count = 1, 'another student must not be able to delete your post');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Privileged columns are not student-editable.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-a000-000000000001', false);

-- Privileged post columns are not writable by clients at all (column privileges),
-- and the counters are recomputed from their source rows by the database.
select public.test_assert_denied(
  $sql$update public.posts set is_official = true where author_id = public.current_profile_id()$sql$,
  'a student must not be able to mark their own post as official'
);
select public.test_assert_denied(
  $sql$update public.posts set pinned = true where author_id = public.current_profile_id()$sql$,
  'a student must not be able to pin their own post'
);
select public.test_assert_denied(
  $sql$update public.posts set status = 'hidden' where author_id = public.current_profile_id()$sql$,
  'a student must not be able to write post moderation state'
);
select public.test_assert_denied(
  $sql$update public.posts set reaction_count = 9999 where author_id = public.current_profile_id()$sql$,
  'a student must not be able to inflate reaction counters'
);
select public.test_assert_denied(
  $sql$update public.profiles set reputation_score = 5 where id = public.current_profile_id()$sql$,
  'a student must not be able to write their own reputation'
);

-- Legitimate edits still work.
update public.posts set body = 'Placement prep session in the seminar hall on Saturday. Bring your resume.'
 where author_id = public.current_profile_id() and body like 'Placement prep%';

do $$
declare
  v_body text;
begin
  select body into v_body from public.posts
   where author_id = public.current_profile_id() and body like 'Placement prep%';
  perform public.test_assert(v_body like '%Bring your resume%', 'a student must be able to edit their own post');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Comments, reactions and their counters.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-a000-000000000002', false);

do $$
declare
  v_post uuid;
  v_comment uuid;
begin
  select id into v_post from public.posts where body like 'Placement prep%';
  insert into public.comments (post_id, author_id, body)
  values (v_post, public.current_profile_id(), 'Count me in.')
  returning id into v_comment;

  perform public.test_assert(
    (select comment_count from public.posts where id = v_post) = 1,
    'comment_count must be maintained by the database'
  );

  insert into public.reactions (user_id, target_type, target_id, kind)
  values (public.current_profile_id(), 'post', v_post, 'like');

  perform public.test_assert(
    (select reaction_count from public.posts where id = v_post) = 1,
    'reaction_count must be maintained by the database'
  );
end;
$$;

-- Duplicate reactions are impossible.
select public.test_assert_denied(
  $sql$insert into public.reactions (user_id, target_type, target_id, kind)
       select public.current_profile_id(), 'post', id, 'like' from public.posts where body like 'Placement prep%'$sql$,
  'a student must not be able to react twice to the same post'
);

-- Bhavya cannot delete Chaitanya's comment.
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-a000-000000000001', false);
delete from public.comments where body = 'Count me in.';
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.comments where body = 'Count me in.';
  perform public.test_assert(v_count = 1, 'a student must not be able to delete another student''s comment');
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Polls: one vote per student; the poll author may vote like any other student.
-- ---------------------------------------------------------------------------
do $$
declare
  v_poll uuid;
begin
  insert into public.posts (author_id, kind, title, body)
  values (public.current_profile_id(), 'poll', 'Best library timing?', 'When do you study in the library?')
  returning id into v_poll;

  insert into public.poll_options (post_id, label, position) values
    (v_poll, 'Morning', 1),
    (v_poll, 'Evening', 2);
end;
$$;

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-a000-000000000002', false);

do $$
declare
  v_option uuid;
begin
  select o.id into v_option
  from public.poll_options o
  join public.posts p on p.id = o.post_id
  where p.title = 'Best library timing?' and o.label = 'Evening';

  insert into public.poll_votes (post_id, option_id, user_id)
  select o.post_id, o.id, public.current_profile_id() from public.poll_options o where o.id = v_option;

  perform public.test_assert(
    (select vote_count from public.poll_options where id = v_option) = 1,
    'poll option counts must be maintained by the database'
  );
end;
$$;

select public.test_assert_denied(
  $sql$insert into public.poll_votes (post_id, option_id, user_id)
       select o.post_id, o.id, public.current_profile_id()
       from public.poll_options o join public.posts p on p.id = o.post_id
       where p.title = 'Best library timing?' and o.label = 'Morning'$sql$,
  'a student must not be able to vote twice in the same poll'
);

-- The author CAN vote on their own poll — the restriction was removed (migration 039).
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-a000-000000000001', false);
do $$
declare
  v_votes int;
begin
  insert into public.poll_votes (post_id, option_id, user_id)
  select o.post_id, o.id, public.current_profile_id()
  from public.poll_options o join public.posts p on p.id = o.post_id
  where p.title = 'Best library timing?' and o.label = 'Morning';

  select count(*) into v_votes from public.poll_votes
  where post_id = (select id from public.posts where title = 'Best library timing?');
  perform public.test_assert(v_votes = 2, 'the poll author must be able to vote in their own poll');
end;
$$;

-- A closed poll still rejects every vote, including the author's.
update public.posts set poll_closes_at = now() - interval '1 hour' where title = 'Best library timing?';
select public.test_assert_denied(
  $sql$insert into public.poll_votes (post_id, option_id, user_id)
       select o.post_id, o.id, public.current_profile_id()
       from public.poll_options o join public.posts p on p.id = o.post_id
       where p.title = 'Best library timing?' limit 1$sql$,
  'a closed poll must reject votes'
);
update public.posts set poll_closes_at = null where title = 'Best library timing?';

-- ---------------------------------------------------------------------------
-- 8. Communities: creator becomes owner, private content stays private.
-- ---------------------------------------------------------------------------
do $$
declare
  v_community uuid;
begin
  insert into public.communities (kind, name, slug, description, created_by, visibility, join_policy)
  values ('community', 'Robotics Club Circle', 'robotics-circle',
          'A space to plan robotics builds, share meeting notes and coordinate lab time.',
          public.current_profile_id(), 'public', 'open')
  returning id into v_community;

  perform public.test_assert(
    (select role from public.community_members
      where community_id = v_community and user_id = public.current_profile_id()) = 'owner',
    'the creator must automatically become the community owner'
  );
  perform public.test_assert(
    (select member_count from public.communities where id = v_community) = 1,
    'member_count must include the owner'
  );
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
insert into public.communities (kind, name, slug, description, created_by, visibility, join_policy)
select 'community', 'Private Study Circle', 'private-study-circle',
       'Invite-only space for a study group preparing for the semester examinations.',
       p.id, 'private', 'invite'
from public.profiles p where p.username = 'bhavya';
reset role;

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-a000-000000000002', false);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.communities where slug = 'private-study-circle';
  perform public.test_assert(v_count = 0, 'a private community must not be visible to non-members');

  select count(*) into v_count from public.communities where slug = 'robotics-circle';
  perform public.test_assert(v_count = 1, 'a public community must be discoverable');
end;
$$;

-- A community owner gains no platform authority.
do $$
begin
  perform public.test_assert(not public.is_staff(), 'a community owner must not become platform staff');
  perform public.test_assert(not public.has_permission('remove_posts'), 'a community owner gains no moderation permission');
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Mentions resolve server-side and skip blocked students.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_post uuid;
  v_mentions integer;
begin
  select id into v_post from public.posts where body like 'Placement prep%';

  perform public.record_mentions('post', v_post, array['chaitanya', 'dhruv', 'nobody_here']);

  select count(*) into v_mentions from public.mentions where source_id = v_post;
  perform public.test_assert(v_mentions = 1, 'only real, unblocked usernames may be recorded as mentions');
end;
$$;

reset role;
