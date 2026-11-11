/** Disposable PostgreSQL post attachment lifecycle checks; never targets production. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { startDatabase, applyMigrations } from './perf/lib.mjs';
import { SUPABASE_STUB_SQL, REALTIME_STUB_SQL } from './harness.mjs';
import { seedFixtures } from './perf/seed.mjs';
const { pg, admin, client } = await startDatabase({ port: 55436, database: 'storage_post_test' });
let a, b;
try {
  await client.query(SUPABASE_STUB_SQL); await client.query(REALTIME_STUB_SQL); await applyMigrations(client);
  const seed = await seedFixtures(client); const owner = seed.me.profileId; const other = seed.users.find((x) => x.profileId !== owner).profileId;
  const post = (await client.query("insert into public.posts(author_id,body,visibility) values($1,'attachment post','campus') returning id", [owner])).rows[0].id;
  await client.query('select public.admin_set_upload_enabled($1,true)', [owner]);
  await client.query('select public.admin_set_upload_enabled($1,true)', [other]);
  await client.query('update public.storage_accounts set quota_bytes=3145728 where profile_id=$1', [owner]);
  const conn = { connectionString: 'postgresql://postgres:postgres@127.0.0.1:55436/storage_post_test' };
  a = new Client(conn); b = new Client(conn); await Promise.all([a.connect(), b.connect()]);
  for (const db of [a,b]) { await db.query('set role service_role'); await db.query("select set_config('request.jwt.claim.role','service_role',false)"); }
  const reserve = (db, author, request, mime = 'image/png') => db.query('select public.storage_reserve_post_attachment($1,$2,$3,$4,$5,$6,$7) id', [author, post, request, mime === 'application/pdf' ? 'test.pdf' : 'test.png', mime, 3145728, 'a'.repeat(64)]);
  await assert.rejects(reserve(a,other,randomUUID()),/Post unavailable/);
  const requests = [randomUUID(), randomUUID()];
  const results = await Promise.allSettled([reserve(a,owner,requests[0]), reserve(b,owner,requests[1])]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length,1);
  const index = results.findIndex((r) => r.status === 'fulfilled'); const file = results[index].value.rows[0].id;
  assert.equal((await reserve(a,owner,requests[index])).rows[0].id,file);
  const row = (await client.query('select resource_type,resource_id,gateway_key,status from public.storage_files where id=$1', [file])).rows[0];
  assert.equal(row.resource_type,'post_attachment'); assert.equal(row.resource_id,post); assert.match(row.gateway_key, new RegExp(`^[0-9]{13}-${file}$`));
  await client.query("select public.storage_finalize_post_attachment($1,$2,'drive_12345678',$3,3145728,'image/png')",[owner,file,'a'.repeat(64)]);
  await client.query('update public.storage_accounts set quota_bytes=6291456 where profile_id=$1',[owner]);
  const pdf=(await reserve(a,owner,randomUUID(),'application/pdf')).rows[0].id;
  await client.query("select public.storage_finalize_post_attachment($1,$2,'drive_12345679',$3,3145728,'application/pdf')",[owner,pdf,'a'.repeat(64)]);
  const order = (actor, ids) => a.query('select public.storage_reorder_post_attachments($1,$2,$3)',[actor,post,ids]);
  await assert.rejects(order(other,[pdf,file]),/Post unavailable/);
  await assert.rejects(order(owner,[file,file]),/Attachments changed/);
  await order(owner,[pdf,file]);
  assert.deepEqual((await client.query('select file_id from public.post_attachment_links where post_id=$1 order by position',[post])).rows.map((r)=>r.file_id),[pdf,file]);
  await client.query("update public.posts set status='deleted',deleted_at=now() where id=$1", [post]);
  assert.equal((await client.query('select status from public.storage_files where id=$1',[file])).rows[0].status,'delete_pending');
  await assert.rejects(reserve(a,owner,randomUUID()),/Post unavailable/);
  assert.equal((await client.query('select status from public.storage_files where id=$1',[pdf])).rows[0].status,'delete_pending');
  await client.query('select public.storage_complete_post_attachment_delete($1)',[pdf]);
  await client.query('select public.storage_complete_post_attachment_delete($1)',[file]);
  assert.equal((await client.query('select status from public.storage_files where id=$1',[file])).rows[0].status,'deleted');
  const backup = await client.query("select 1 from public.backup_tracked_tables where table_name='post_attachment_links' and capture and snapshot"); assert.equal(backup.rowCount,1);
  console.log('PASS: post ownership, shared concurrent quota, retry idempotency, soft deletion and backup capture');
} finally { await a?.end(); await b?.end(); await client.end(); await admin.end(); await pg.stop(); }
