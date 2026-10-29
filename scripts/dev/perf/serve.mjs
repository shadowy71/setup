#!/usr/bin/env node
/**
 * Boots the whole measurement backend (development tool):
 *
 *   embedded PostgreSQL → migrations → deterministic fixtures → Supabase stub
 *
 * Leave it running in one terminal, point the app at the printed URL, and run
 * `scripts/dev/perf/measure.mjs` against a production build.
 *
 *   node scripts/dev/perf/serve.mjs [--port 3111] [--rtt 25]
 */

import { parseArgs } from 'node:util';
import { startDatabase, applyMigrations, DATABASE_URL, PG_PORT, RTT_MS, banner } from './lib.mjs';
import { SUPABASE_STUB_SQL, REALTIME_STUB_SQL } from '../harness.mjs';
import { createStub } from './stub.mjs';
import { seedFixtures } from './seed.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const { values } = parseArgs({
  options: { port: { type: 'string' }, rtt: { type: 'string' } },
  allowPositionals: true,
});
const port = Number(values.port || process.env.PERF_STUB_PORT || 3111);
const rtt = Number(values.rtt || RTT_MS);

banner(`Starting disposable PostgreSQL on ${PG_PORT}…`);
const { pg, admin, client, fresh } = await startDatabase();
if (fresh) {
  banner('Creating the performance database…');
}
await client.query(SUPABASE_STUB_SQL);
await client.query(REALTIME_STUB_SQL);

banner('Applying migrations…');
const files = await applyMigrations(client);
console.log(`  ${files.length} migration files applied`);

banner('Seeding deterministic fixtures…');
const seed = await seedFixtures(client);
console.log(
  `  ${seed.users.length} accounts · ${seed.communities.length} communities · ` +
    `${await count(client, 'posts')} posts · ${await count(client, 'messages')} messages · ${await count(client, 'notifications')} notifications`,
);
await mkdir(path.join(process.cwd(), 'node_modules/.cache/perf'), { recursive: true });

banner(`Starting the Supabase stub on http://127.0.0.1:${port} (${rtt}ms RTT per request)…`);
const stub = createStub({ connectionString: DATABASE_URL, latencyMs: rtt });
await stub.listen(port);

// Stable representative ids let the extended route audit exercise detail and
// management surfaces with exactly the same fixtures on every run.
const conversationId = (await client.query(`select id from public.conversations order by last_message_at desc limit 1`)).rows[0]?.id;
const postId = (await client.query(`select id from public.posts order by created_at desc limit 1`)).rows[0]?.id;
const gigId = (await client.query(`select id from public.gigs where status = 'published' order by created_at desc limit 1`)).rows[0]?.id;
const clubId = (await client.query(`select id from public.communities where kind = 'club' and status = 'published' and admin_assigned order by created_at desc limit 1`)).rows[0]?.id;
const communitySlug = (await client.query(`select slug from public.communities where kind = 'community' and status = 'published' order by created_at desc limit 1`)).rows[0]?.slug;
const listingId = (await client.query(`select id from public.marketplace_listings where status = 'active' order by created_at desc limit 1`)).rows[0]?.id;
const eventId = (await client.query(`select id from public.events where status = 'published' order by created_at desc limit 1`)).rows[0]?.id;

// Handy for the measurement script and for shell use.
await writeFile(
  path.join(process.cwd(), 'node_modules/.cache/perf/harness.json'),
  JSON.stringify(
    {
      stubUrl: `http://127.0.0.1:${port}`,
      databaseUrl: DATABASE_URL,
      rtt,
      student: { email: seed.me.email, username: seed.me.username, profileId: seed.me.profileId },
      admin: { email: seed.admin.email, username: seed.admin.username, profileId: seed.admin.profileId },
      moderator: { email: seed.moderator.email, username: seed.moderator.username },
      conversationId,
      postId,
      gigId,
      clubId,
      communitySlug,
      listingId,
      eventId,
    },
    null,
    2,
  ),
);

console.log(`\n\x1b[1mPERF READY\x1b[0m http://127.0.0.1:${port}`);
console.log(`  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${port}`);
console.log('  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_perf_harness_key');
console.log('  SUPABASE_SECRET_KEY=sb_secret_perf_harness_key\n');

async function shutdown() {
  await stub.close();
  await client.end().catch(() => {});
  await admin.end().catch(() => {});
  await pg.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function count(dbClient, table) {
  const { rows } = await dbClient.query(`select count(*)::int as n from public.${table}`);
  return rows[0].n;
}
