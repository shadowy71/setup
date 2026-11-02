#!/usr/bin/env node
/**
 * Preview-only fixture shaping for the "Busiest right now" rebuild (dev tool).
 *
 * `npm run perf:serve` seeds a realistic but uniformly-engaged campus: every
 * recent post has the same six comments and one like, so every activity bar
 * looks alike. That is a good performance fixture and a poor demonstration of
 * an engagement scale. This script keeps the real schema, real RLS, real
 * triggers and real rows, and only gives three existing discussions different
 * amounts of *recent* engagement:
 *
 *   discussion 1    2 fresh likes + 100 old, accumulated likes → small bar
 *   discussion 2   10 fresh likes                             → middle bar
 *   discussion 3   30 fresh likes                             → full bar
 *
 * Nothing here ships to production and no application data is replaced: the
 * running Home page still reads `public.trending_posts` through `/api/home/feed`.
 * Re-running this script is safe.
 *
 *   node scripts/dev/preview-trending-fixtures.mjs
 */

import pg from 'pg';
import { DATABASE_URL } from './perf/lib.mjs';

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  await client.query('begin');

  // Idempotency: drop only the reactions belonging to this preview's students.
  await client.query(`
    delete from public.reactions r
    using public.profile_private pp, auth.users u
    where r.user_id = pp.profile_id
      and pp.auth_user_id = u.id
      and u.email like 'perf.preview%@pccoepune.org'
  `);

  // Extra students: reactions are unique per (student, post), so a like has to
  // come from a distinct real profile. These are ordinary auth users created by
  // the same handle_new_user() trigger as every other account.
  await client.query(`
    insert into auth.users (email, encrypted_password, raw_user_meta_data, created_at, last_sign_in_at)
    select 'perf.preview' || lpad(i::text, 3, '0') || '@pccoepune.org',
           'perf-password',
           jsonb_build_object('display_name', 'Preview Student ' || i),
           now() - interval '60 days', now() - interval '2 hours'
    from generate_series(1, 105) as i
    on conflict (email) do nothing
  `);

  // Move the seed's uniform engagement outside the 48 h window. The lifetime
  // counters on posts are computed by triggers and deliberately stay intact:
  // the rail can now show a large ♥ count beside a small, honest bar.
  await client.query(`
    update public.reactions set created_at = now() - interval '30 days'
    where target_type = 'post'
  `);
  await client.query(`
    update public.comments set created_at = now() - interval '30 days'
  `);

  // Three real, published, campus-level discussions from the newest feed rows.
  await client.query(`
    create temporary table preview_posts on commit drop as
    select id, row_number() over (order by created_at desc, id asc) as rn
    from public.posts
    where status = 'published'
      and deleted_at is null
      and community_id is null
      and created_at > now() - interval '2 hours'
    order by created_at desc, id asc
    limit 3
  `);

  // Distinct students per (post), so no duplicate-like inflation is possible.
  await client.query(`
    with u as (
      select pp.profile_id,
             row_number() over (order by au.email)::int as n
      from auth.users au
      join public.profile_private pp on pp.auth_user_id = au.id
      where au.email like 'perf.preview%@pccoepune.org'
    )
    insert into public.reactions (user_id, target_type, target_id, kind, created_at)
    select u.profile_id, 'post', p.id, 'like'::public.reaction_kind, now() - interval '2 minutes'
      from u join preview_posts p on p.rn = 3 where u.n <= 30
    union all
    select u.profile_id, 'post', p.id, 'like'::public.reaction_kind, now() - interval '2 minutes'
      from u join preview_posts p on p.rn = 2 where u.n <= 10
    union all
    select u.profile_id, 'post', p.id, 'like'::public.reaction_kind, now() - interval '2 minutes'
      from u join preview_posts p on p.rn = 1 where u.n between 101 and 102
    union all
    -- Old popularity: 100 accumulated likes that must NOT fill the bar.
    select u.profile_id, 'post', p.id, 'like'::public.reaction_kind, now() - interval '30 days'
      from u join preview_posts p on p.rn = 1 where u.n <= 100
    on conflict (user_id, target_type, target_id) do nothing
  `);

  await client.query('commit');
} catch (error) {
  await client.query('rollback');
  throw error;
}

// Report exactly what the running app will see, with the same RLS identity the
// signed-in preview proxy uses.
const me = await client.query(`
  select pp.profile_id
  from auth.users au join public.profile_private pp on pp.auth_user_id = au.id
  where au.email = 'perf.student1@pccoepune.org'
`);
await client.query('set role authenticated');
await client.query('select set_config($1, $2, false)', ['request.jwt.claim.sub', me.rows[0].profile_id]);
await client.query('select set_config($1, $2, false)', ['request.jwt.claim.role', 'authenticated']);
const { rows } = await client.query('select title, reaction_count, comment_count, score from public.trending_posts(3, 48)');
await client.query('reset role');

const benchmark = 25;
console.log('\nBusiest right now — real trending_posts(3, 48) rows:\n');
for (const [index, row] of rows.entries()) {
  const score = Number(row.score);
  const raw = (100 * Math.log1p(score)) / Math.log1p(benchmark);
  const bar = score >= benchmark ? 100 : Math.min(99, Math.round(Math.min(100, Math.max(0, raw))));
  const title = (row.title || '').slice(0, 34).padEnd(36);
  console.log(
    `  ${index + 1}. ${title} score=${score.toFixed(3).padStart(8)}  ` +
    `${String(row.reaction_count).padStart(3)} ♥  ${String(row.comment_count).padStart(2)} ↺  bar=${String(bar).padStart(3)}%`,
  );
}
console.log('');

await client.end();
