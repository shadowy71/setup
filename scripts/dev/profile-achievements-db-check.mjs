/** Disposable PostgreSQL checks for achievement privacy, ownership and audit. */
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { startDatabase, applyMigrations } from './perf/lib.mjs';
import { SUPABASE_STUB_SQL, REALTIME_STUB_SQL } from './harness.mjs';
import { seedFixtures } from './perf/seed.mjs';
const { pg, admin, client } = await startDatabase({ port: 55441, database: 'profile_achievements_test' });
const clients = [];
try {
  await client.query(SUPABASE_STUB_SQL); await client.query(REALTIME_STUB_SQL); await applyMigrations(client);
  const seed = await seedFixtures(client);
  const peer = seed.users.find((u) => u.profileId !== seed.me.profileId && !u.username.startsWith('perf_'));
  const staff = seed.users.find((u) => u.username === 'perf_admin');
  for (const user of [seed.me, peer, staff]) {
    const c = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:55441/profile_achievements_test' });
    await c.connect(); clients.push(c); await c.query('set role authenticated');
    await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)", [user.authId]);
  }
  const [owner, other, moderator] = clients;
  const id = (await owner.query("insert into public.profile_achievements(owner_id,title,description,category) values($1,'Award','A self reported award','competition') returning id",[seed.me.profileId])).rows[0].id;
  assert.equal((await other.query('select id from public.profile_achievements where id=$1',[id])).rowCount, 1);
  await assert.rejects(owner.query("update public.profile_achievements set status='hidden' where id=$1",[id]), /Only moderators/);
  assert.equal((await other.query("update public.profile_achievements set title='Unauthorized' where id=$1 returning id",[id])).rowCount, 0);
  await moderator.query("update public.profile_achievements set status='hidden' where id=$1",[id]);
  assert.equal((await other.query('select id from public.profile_achievements where id=$1',[id])).rowCount, 0);
  assert.equal((await owner.query('select id from public.profile_achievements where id=$1',[id])).rowCount, 1);
  assert.equal((await client.query("select id from public.audit_logs where target_type='profile_achievement' and target_id=$1",[id])).rowCount, 1);
  assert.equal((await client.query("select id from public.moderation_actions where target_type='profile_achievement' and target_id=$1",[id])).rowCount, 1);
  await moderator.query("update public.profile_achievements set status='published' where id=$1",[id]);
  await client.query('insert into public.blocks(blocker_id,blocked_id) values($1,$2)',[seed.me.profileId,peer.profileId]);
  assert.equal((await other.query('select id from public.profile_achievements where id=$1',[id])).rowCount, 0);
  await client.query("update public.feature_flags set enabled=false where key='achievements'");
  assert.equal((await owner.query('select id from public.profile_achievements where id=$1',[id])).rowCount, 0);
  await assert.rejects(owner.query("insert into public.profile_achievements(owner_id,title,description,category) values($1,'Award','Another award','other')",[seed.me.profileId]), /row-level security/);
  await client.query('set role anon'); await assert.rejects(client.query('select * from public.profile_achievements'), /permission denied/); await client.query('reset role');
  console.log('PASS: achievement feature flag, owner and block privacy, anonymous denial, moderator status and audit');
} finally { for (const c of clients) await c.end(); await client.end(); await admin.end(); await pg.stop(); }
