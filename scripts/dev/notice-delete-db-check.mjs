/** Checks notice deletion authorization and atomic audit on disposable Postgres. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { startDatabase, applyMigrations } from './perf/lib.mjs';
import { SUPABASE_STUB_SQL, REALTIME_STUB_SQL } from './harness.mjs';
import { seedFixtures } from './perf/seed.mjs';
const { pg, admin, client } = await startDatabase({ port: 55442, database: 'notice_delete_test' });
const clients = [];
try {
  await client.query(SUPABASE_STUB_SQL); await client.query(REALTIME_STUB_SQL); await applyMigrations(client);
  const seed = await seedFixtures(client); const staff = seed.users.find((u) => u.username === 'perf_admin');
  for (const user of [seed.me, staff]) {
    const c = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:55442/notice_delete_test' });
    await c.connect(); clients.push(c); await c.query('set role authenticated');
    await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[user.authId]);
  }
  const [student, manager] = clients; const id = randomUUID();
  await client.query("insert into public.notices(id,title,body,created_by,status) values($1,'Notice','A test notice',$2,'published')",[id,staff.profileId]);
  await assert.rejects(student.query('select public.delete_official_notice($1)',[id]),/Not allowed/);
  assert.equal((await client.query('select id from public.notices where id=$1',[id])).rowCount,1);
  assert.equal((await manager.query('select public.delete_official_notice($1) ok',[id])).rows[0].ok,true);
  assert.equal((await client.query("select id from public.audit_logs where action='notice.delete' and target_id=$1",[id])).rowCount,1);
  assert.equal((await manager.query('select public.delete_official_notice($1) ok',[id])).rows[0].ok,false);
  console.log('PASS: notice deletion permission, audit and repeat behavior');
} finally { for (const c of clients) await c.end(); await client.end(); await admin.end(); await pg.stop(); }
