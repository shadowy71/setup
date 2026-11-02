-- =============================================================================
-- Campus+ database tests — 20 "Busiest right now" trending score
-- =============================================================================
-- Real rows through the real `public.trending_posts` RPC. Runs as the migration
-- owner (RLS bypassed) so this file can concentrate on the score arithmetic;
-- the RLS/visibility boundary is exercised by suites 02/07/19 and by the
-- `security invoker` declaration itself. No counters are invented: every score
-- below comes from reaction/comment rows, with one row per student per post.
-- =============================================================================

reset role;
select set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false);

-- 32 synthetic students. Profiles only: they are the parents of reactions and
-- comments, and no claim is needed here.
insert into public.profiles (id, username, display_name)
select
  ('a4000000-0000-4000-a000-' || lpad(i::text, 12, '0'))::uuid,
  'trend_user_' || lpad(i::text, 2, '0'),
  'Trend ' || i
from generate_series(1, 32) as i
on conflict (id) do nothing;

-- Six discussions. The lifetime counters on E represent old popularity that
-- the trending score must NOT inherit. C and G share a timestamp to prove the
-- id tie-break; H is deleted and must never be returned.
insert into public.posts (id, author_id, kind, title, body, created_at)
values
  ('b4000000-0000-4000-b000-000000000001', 'a4000000-0000-4000-a000-000000000001', 'post', 'Trend A — two likes', 'A quiet discussion.', now() - interval '1 hour'),
  ('b4000000-0000-4000-b000-000000000002', 'a4000000-0000-4000-a000-000000000001', 'post', 'Trend B — one like', 'An even quieter discussion.', now() - interval '1 hour'),
  ('b4000000-0000-4000-b000-000000000003', 'a4000000-0000-4000-a000-000000000001', 'post', 'Trend C — no likes', 'Nobody has reacted yet.', now() - interval '1 hour'),
  ('b4000000-0000-4000-b000-000000000004', 'a4000000-0000-4000-a000-000000000001', 'post', 'Trend D — twenty five', 'The busy discussion.', now() - interval '1 hour'),
  ('b4000000-0000-4000-b000-000000000005', 'a4000000-0000-4000-a000-000000000001', 'post', 'Trend E — historical', 'Popular a month ago.', now() - interval '30 days'),
  ('b4000000-0000-4000-b000-000000000006', 'a4000000-0000-4000-a000-000000000001', 'post', 'Trend F — recent', 'Active right now.', now() - interval '1 hour'),
  ('b4000000-0000-4000-b000-000000000007', 'a4000000-0000-4000-a000-000000000001', 'post', 'Trend G — tie', 'Another empty discussion.', now() - interval '1 hour'),
  ('b4000000-0000-4000-b000-000000000008', 'a4000000-0000-4000-a000-000000000001', 'post', 'Trend H — deleted', 'Must never appear.', now() - interval '1 hour'),
  ('b4000000-0000-4000-b000-000000000009', 'a4000000-0000-4000-a000-000000000001', 'post', 'Trend I — comments', 'A commented discussion.', now() - interval '1 hour');

-- Recent likes: exactly one row per (student, post).
insert into public.reactions (user_id, target_type, target_id, kind, created_at)
select ('a4000000-0000-4000-a000-' || lpad(i::text, 12, '0'))::uuid,
       'post', 'b4000000-0000-4000-b000-000000000001'::uuid, 'like', now() - interval '2 minutes'
from generate_series(1, 2) as i;

insert into public.reactions (user_id, target_type, target_id, kind, created_at)
values ('a4000000-0000-4000-a000-000000000001', 'post', 'b4000000-0000-4000-b000-000000000002', 'like', now() - interval '2 minutes');

insert into public.reactions (user_id, target_type, target_id, kind, created_at)
select ('a4000000-0000-4000-a000-' || lpad(i::text, 12, '0'))::uuid,
       'post', 'b4000000-0000-4000-b000-000000000004'::uuid, 'like', now() - interval '2 minutes'
from generate_series(1, 25) as i;

-- E: 31 old likes plus one fresh one, and a lifetime counter of 100.
insert into public.reactions (user_id, target_type, target_id, kind, created_at)
select ('a4000000-0000-4000-a000-' || lpad(i::text, 12, '0'))::uuid,
       'post', 'b4000000-0000-4000-b000-000000000005'::uuid, 'like', now() - interval '30 days'
from generate_series(1, 31) as i;
insert into public.reactions (user_id, target_type, target_id, kind, created_at)
values ('a4000000-0000-4000-a000-000000000032', 'post', 'b4000000-0000-4000-b000-000000000005', 'like', now() - interval '2 minutes');
update public.posts set reaction_count = 100 where id = 'b4000000-0000-4000-b000-000000000005';

insert into public.reactions (user_id, target_type, target_id, kind, created_at)
select ('a4000000-0000-4000-a000-' || lpad(i::text, 12, '0'))::uuid,
       'post', 'b4000000-0000-4000-b000-000000000006'::uuid, 'like', now() - interval '2 minutes'
from generate_series(1, 12) as i;

-- A deleted post with engagement must not be a candidate.
insert into public.reactions (user_id, target_type, target_id, kind, created_at)
select ('a4000000-0000-4000-a000-' || lpad(i::text, 12, '0'))::uuid,
       'post', 'b4000000-0000-4000-b000-000000000008'::uuid, 'like', now() - interval '2 minutes'
from generate_series(1, 10) as i;
update public.posts set status = 'deleted', deleted_at = now() where id = 'b4000000-0000-4000-b000-000000000008';

-- Three recent comments from two distinct students.
insert into public.comments (post_id, author_id, body, status, created_at)
values
  ('b4000000-0000-4000-b000-000000000009', 'a4000000-0000-4000-a000-000000000001', 'First voice.', 'published', now() - interval '3 minutes'),
  ('b4000000-0000-4000-b000-000000000009', 'a4000000-0000-4000-a000-000000000001', 'Same voice again.', 'published', now() - interval '3 minutes'),
  ('b4000000-0000-4000-b000-000000000009', 'a4000000-0000-4000-a000-000000000002', 'Second voice.', 'published', now() - interval '3 minutes');

-- ---------------------------------------------------------------------------
-- 1. Scenario A — 2 / 1 / 0 likes: honest, small scores and small bars.
-- ---------------------------------------------------------------------------
do $$
declare
  v_a real; v_b real; v_c real;
  v_bar_a numeric;
begin
  select score into v_a from public.trending_posts(50, 48) where id = 'b4000000-0000-4000-b000-000000000001';
  select score into v_b from public.trending_posts(50, 48) where id = 'b4000000-0000-4000-b000-000000000002';
  select score into v_c from public.trending_posts(50, 48) where id = 'b4000000-0000-4000-b000-000000000003';

  perform public.test_assert(v_a > v_b and v_b > v_c, '20.1 two likes must outrank one, one must outrank zero');
  perform public.test_assert(v_c = 0, '20.2 zero engagement must score exactly zero');
  perform public.test_assert(v_a < 2.1, '20.3 two likes must not be inflated into a large score');
  perform public.test_assert(
    (select reaction_count from public.posts where id = 'b4000000-0000-4000-b000-000000000005') = 100,
    '20.4 the historical post really does have 100 lifetime likes'
  );

  select round(100 * ln((1 + v_a)::numeric) / ln(26::numeric)) into v_bar_a;
  perform public.test_assert(v_bar_a < 40 and v_bar_a > 20, '20.5 two likes produce a small logarithmic bar, not a full one');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Scenario C / D — high engagement and historical popularity.
-- ---------------------------------------------------------------------------
do $$
declare
  v_d real; v_e real; v_f real; v_i real;
  v_participants integer;
begin
  select score into v_d from public.trending_posts(50, 48) where id = 'b4000000-0000-4000-b000-000000000004';
  select score into v_e from public.trending_posts(50, 48) where id = 'b4000000-0000-4000-b000-000000000005';
  select score into v_f from public.trending_posts(50, 48) where id = 'b4000000-0000-4000-b000-000000000006';
  select score, participant_count into v_i, v_participants from public.trending_posts(50, 48) where id = 'b4000000-0000-4000-b000-000000000009';

  perform public.test_assert(v_d > 20, '20.6 twenty-five recent likes approach the full-scale benchmark');
  perform public.test_assert(v_e < 1, '20.7 a month of accumulated likes contributes almost nothing without recent activity');
  perform public.test_assert(v_f > v_e, '20.8 twelve recent likes outrank a hundred historical likes');
  perform public.test_assert(v_participants = 2, '20.9 participant_count counts distinct recent commenters');
  perform public.test_assert(v_i > 5, '20.10 recent comments are worth two like-equivalent points each');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Ranking, tie-breaks and visibility.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ord_a bigint; v_ord_b bigint; v_ord_c bigint; v_ord_g bigint;
  v_deleted integer;
  v_first text; v_second text;
begin
  select rn into v_ord_a from (select id, row_number() over () as rn from public.trending_posts(50, 48)) r where id = 'b4000000-0000-4000-b000-000000000001';
  select rn into v_ord_b from (select id, row_number() over () as rn from public.trending_posts(50, 48)) r where id = 'b4000000-0000-4000-b000-000000000002';
  select rn into v_ord_c from (select id, row_number() over () as rn from public.trending_posts(50, 48)) r where id = 'b4000000-0000-4000-b000-000000000003';
  select rn into v_ord_g from (select id, row_number() over () as rn from public.trending_posts(50, 48)) r where id = 'b4000000-0000-4000-b000-000000000007';

  perform public.test_assert(v_ord_a < v_ord_b and v_ord_b < v_ord_c, '20.11 the RPC really orders by decreasing score');
  perform public.test_assert(v_ord_c < v_ord_g, '20.12 equal scores break ties by created_at desc then id asc');
  select string_agg(id::text, ',' order by rn) into v_first
    from (select id, row_number() over () as rn from public.trending_posts(50, 48)) r;
  select string_agg(id::text, ',' order by rn) into v_second
    from (select id, row_number() over () as rn from public.trending_posts(50, 48)) r;
  perform public.test_assert(v_first = v_second, '20.13 two reads return the same deterministic order');
  select count(*) into v_deleted from public.trending_posts(50, 48) where id = 'b4000000-0000-4000-b000-000000000008';
  perform public.test_assert(v_deleted = 0, '20.14 a deleted post with likes is never trending');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Scenario F — a like, then its removal, and duplicate-like protection.
-- ---------------------------------------------------------------------------
do $$
declare
  v_before real; v_after real; v_restored real;
begin
  select score into v_before from public.trending_posts(50, 48) where id = 'b4000000-0000-4000-b000-000000000001';

  delete from public.reactions
   where target_type = 'post' and target_id = 'b4000000-0000-4000-b000-000000000001'
     and user_id = 'a4000000-0000-4000-a000-000000000002';
  select score into v_after from public.trending_posts(50, 48) where id = 'b4000000-0000-4000-b000-000000000001';
  perform public.test_assert(v_after < v_before, '20.15 removing a like lowers the real score');
  perform public.test_assert(
    (select reaction_count from public.posts where id = 'b4000000-0000-4000-b000-000000000001') = 1,
    '20.16 the database counter follows the deleted reaction'
  );

  insert into public.reactions (user_id, target_type, target_id, kind, created_at)
  values ('a4000000-0000-4000-a000-000000000002', 'post', 'b4000000-0000-4000-b000-000000000001', 'like', now() - interval '2 minutes');
  select score into v_restored from public.trending_posts(50, 48) where id = 'b4000000-0000-4000-b000-000000000001';
  perform public.test_assert(abs(v_restored - v_before) < 0.01, '20.17 re-liking restores the score without duplication');
end;
$$;

select public.test_assert_denied(
  $sql$insert into public.reactions (user_id, target_type, target_id, kind)
       values ('a4000000-0000-4000-a000-000000000001', 'post', 'b4000000-0000-4000-b000-000000000002', 'like')$sql$,
  '20.18 one student cannot like the same post twice, so engagement cannot be inflated'
);

-- A short window still returns real rows, every score finite and non-negative,
-- and the zero-engagement discussions are present with score 0 (scenario E).
do $$
declare
  v_rows integer; v_bad integer; v_zero integer;
begin
  select count(*), count(*) filter (where score is null or score < 0 or score = 'Infinity'::real)
    into v_rows, v_bad
  from public.trending_posts(3, 1);
  perform public.test_assert(v_rows = 3, '20.19 a quiet/short window still shows real discussions');
  perform public.test_assert(v_bad = 0, '20.20 no null, negative or infinite scores are produced');
  select count(*) into v_zero from public.trending_posts(50, 48)
   where id in ('b4000000-0000-4000-b000-000000000003', 'b4000000-0000-4000-b000-000000000007') and score = 0;
  perform public.test_assert(v_zero = 2, '20.21 zero-engagement discussions appear honestly at score 0');
end;
$$;
