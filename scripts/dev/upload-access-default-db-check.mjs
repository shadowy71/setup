/** Disposable PostgreSQL only: default entitlement and revocation, no Drive calls. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { startDatabase } from './perf/lib.mjs';
import { migrationsDir, SUPABASE_STUB_SQL, REALTIME_STUB_SQL } from './harness.mjs';
import { seedFixtures } from './perf/seed.mjs';
const {pg,admin,client}=await startDatabase({port:55446,database:'upload_default_test'});
let session,service;
try {
  await client.query(SUPABASE_STUB_SQL); await client.query(REALTIME_STUB_SQL);
  const files=(await readdir(migrationsDir)).filter(f=>f.endsWith('.sql')).sort();
  const migration=files.find(f=>f.endsWith('_074_upload_access_default.sql'));
  assert.ok(migration);
  for(const f of files.filter(f=>f!==migration)) await client.query(await readFile(path.join(migrationsDir,f),'utf8'));
  const seed=await seedFixtures(client); const prior=seed.me; const inactive=seed.users.find(u=>u.profileId!==prior.profileId);
  await client.query('select public.admin_set_upload_enabled($1,false)',[prior.profileId]);
  await client.query("update public.profile_private set account_status='suspended' where profile_id=$1",[inactive.profileId]);
  await client.query(await readFile(path.join(migrationsDir,migration),'utf8'));
  assert.equal((await client.query('select upload_enabled from public.storage_accounts where profile_id=$1',[prior.profileId])).rows[0].upload_enabled,true);
  assert.equal((await client.query('select 1 from public.storage_accounts where profile_id=$1',[inactive.profileId])).rowCount,0);
  // A later profile starts without a ledger row; the usage endpoint must still
  // advertise the same default the service-side draft creation will use.
  const auth=(await client.query("insert into auth.users(email,raw_user_meta_data) values($1,$2) returning id",[`future-${randomUUID()}@pccoepune.org`,JSON.stringify({display_name:'Future user'})])).rows[0].id;
  const profile=(await client.query('select profile_id from public.profile_private where auth_user_id=$1',[auth])).rows[0].profile_id;
  const conn={connectionString:'postgresql://postgres:postgres@127.0.0.1:55446/upload_default_test'};
  session=new Client(conn); service=new Client(conn);await Promise.all([session.connect(),service.connect()]);
  await session.query('set role authenticated');await session.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[auth]);
  await service.query('set role service_role');await service.query("select set_config('request.jwt.claim.role','service_role',false)");
  assert.equal((await client.query('select 1 from public.storage_accounts where profile_id=$1',[profile])).rowCount,0);
  assert.equal((await session.query('select * from public.storage_account_usage($1)',[profile])).rows[0].upload_enabled,true);
  await assert.rejects(session.query('select * from public.storage_account_usage($1)',[prior.profileId]),/Not authorized/);
  const draft=randomUUID();await service.query('select public.storage_create_post_draft($1,$2)',[profile,draft]);
  assert.equal((await client.query('select upload_enabled from public.storage_accounts where profile_id=$1',[profile])).rows[0].upload_enabled,true);
  await client.query('select public.admin_set_upload_enabled($1,false)',[profile]);
  assert.equal((await session.query('select * from public.storage_account_usage($1)',[profile])).rows[0].upload_enabled,false);
  await assert.rejects(service.query('select public.storage_create_post_draft($1,$2)',[profile,randomUUID()]),/Uploads disabled/);
  await client.query("update public.profile_private set account_status='suspended' where profile_id=$1",[profile]);
  await assert.rejects(session.query('select * from public.storage_account_usage($1)',[profile]),/Not authorized/);
  await assert.rejects(service.query('select public.storage_create_post_draft($1,$2)',[profile,randomUUID()]),/Not allowed/);
  console.log('PASS: backfill, future default, lazy account creation, individual revocation, suspension and cross-user authorization');
} finally {await session?.end();await service?.end();await client.end();await admin.end();await pg.stop();}
