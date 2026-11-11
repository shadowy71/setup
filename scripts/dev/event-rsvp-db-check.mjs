/** Event RSVP RLS regression checks on disposable Postgres. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { startDatabase, applyMigrations } from './perf/lib.mjs';
import { SUPABASE_STUB_SQL, REALTIME_STUB_SQL } from './harness.mjs';
import { seedFixtures } from './perf/seed.mjs';
const { pg, admin, client } = await startDatabase({ port: 55443, database: 'rsvp_test' });
let user, peer;
try {
  await client.query(SUPABASE_STUB_SQL); await client.query(REALTIME_STUB_SQL); await applyMigrations(client);
  const seed = await seedFixtures(client); const id = randomUUID();
  await client.query("insert into public.events(id,title,description,starts_on,location,status,created_by,show_attendees) values($1,'Event','Event description',current_date,'Campus','published',$2,false)",[id,seed.me.profileId]);
  user = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:55443/rsvp_test' }); await user.connect(); await user.query('set role authenticated');
  await user.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[seed.me.authId]);
  await user.query("insert into public.event_registrations(event_id,user_id,status) values($1,$2,'going')",[id,seed.me.profileId]);
  assert.equal((await user.query("update public.event_registrations set status='interested' where event_id=$1 returning id",[id])).rowCount,1);
  await client.query("update public.events set status='cancelled' where id=$1",[id]);
  assert.equal((await user.query("update public.event_registrations set status='going' where event_id=$1 returning id",[id])).rowCount,0);
  assert.equal((await user.query('delete from public.event_registrations where event_id=$1 returning id',[id])).rowCount,1);
  const peerUser = seed.users.find((u) => u.profileId !== seed.me.profileId && !u.username.startsWith('perf_'));
  peer = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:55443/rsvp_test' }); await peer.connect(); await peer.query('set role authenticated');
  await peer.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[peerUser.authId]);
  const limited = randomUUID();
  await client.query("insert into public.events(id,title,description,starts_on,location,status,created_by,show_attendees,capacity) values($1,'Limited','A limited event',current_date,'Campus','published',$2,false,1)",[limited,seed.me.profileId]);
  const outcome = await Promise.allSettled([[user,seed.me],[peer,peerUser]].map(([c,u]) => c.query("insert into public.event_registrations(event_id,user_id,status) values($1,$2,'going')",[limited,u.profileId])));
  assert.equal(outcome.filter((x) => x.status === 'fulfilled').length,1);
  assert.match(String(outcome.find((x) => x.status === 'rejected').reason.message), /capacity is full/);
  const winner = outcome[0].status === 'fulfilled' ? user : peer;
  const loser = winner === user ? peer : user; const loserUser = winner === user ? peerUser : seed.me;
  await winner.query("update public.event_registrations set status='interested' where event_id=$1",[limited]);
  await loser.query("insert into public.event_registrations(event_id,user_id,status) values($1,$2,'going')",[limited,loserUser.profileId]);
  await assert.rejects(user.query('select * from public.event_rsvp_capacity'), /permission denied/);
  assert.equal((await client.query('select going_count from public.event_rsvp_capacity where event_id=$1',[limited])).rows[0].going_count,1);
  await client.query('delete from public.events where id=$1',[limited]);
  assert.equal((await client.query('select * from public.event_rsvp_capacity where event_id=$1',[limited])).rowCount,0);
  console.log('PASS: RSVP status guard, concurrent capacity, released seat, private counter and event deletion');
} finally { await user?.end(); await peer?.end(); await client.end(); await admin.end(); await pg.stop(); }
