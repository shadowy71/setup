/** Disposable Postgres quota/authorization check; requires npm install --no-save embedded-postgres. Never targets production. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { startDatabase, applyMigrations } from './perf/lib.mjs';
import { SUPABASE_STUB_SQL, REALTIME_STUB_SQL } from './harness.mjs';
import { seedFixtures } from './perf/seed.mjs';
const {pg, admin, client} = await startDatabase({port:55435, database:'storage_profile_test'});
let a, b, c, d;
try {
 await client.query(SUPABASE_STUB_SQL); await client.query(REALTIME_STUB_SQL); await applyMigrations(client); const seed = await seedFixtures(client);
 const user = seed.me, other = seed.users.find(x => x.profileId !== user.profileId);
 const requiredTables = ['storage_accounts', 'storage_files', 'club_creation_requests'];
 for (const table of requiredTables) {
   const result = await client.query(`select capture, snapshot from public.backup_tracked_tables where schema_name='public' and table_name=$1`, [table]);
   assert.equal(result.rowCount, 1, `missing backup catalogue entry for ${table}`);
   assert.equal(result.rows[0].capture, true);
   assert.equal(result.rows[0].snapshot, true);
   const trigger = await client.query(`select 1 from pg_trigger where tgrelid = to_regclass($1) and tgname = 'backup_capture' and not tgisinternal`, [`public.${table}`]);
   assert.equal(trigger.rowCount, 1, `missing backup trigger for ${table}`);
 }

 const conn = { connectionString:'postgresql://postgres:postgres@127.0.0.1:55435/storage_profile_test' };
 a=new Client(conn); b=new Client(conn); c=new Client(conn); d=new Client(conn); await Promise.all([a.connect(),b.connect(),c.connect(),d.connect()]);
 await c.query('set role service_role'); await d.query('set role service_role');
 await c.query("select set_config('request.jwt.claim.role','service_role',false)");
 await d.query("select set_config('request.jwt.claim.role','service_role',false)");
 async function become(c, u) { await c.query('set role authenticated'); await c.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role','authenticated',false)", [u.authId]); }
 await become(a,user); await become(b,user);
 const limit = await c.query("select public.consume_rate_limit('profile_photo_upload',$1,20,3600) as result",[user.profileId]);
 assert.equal(limit.rows[0].result.allowed,true);
 const args=[randomUUID(),'photo.png','image/png',3145728,'a'.repeat(64)];
 const reserve = (connection, id) => connection.query('select public.storage_reserve_profile_picture($1,$2,$3,$4,$5,$6) as id',[user.profileId,id,...args.slice(1)]);
 await assert.rejects(reserve(c,args[0]),/Uploads are not enabled/);
 await assert.rejects(reserve(a,args[0]),/permission denied/);
 await assert.rejects(a.query('select public.admin_set_upload_enabled($1,true)',[user.profileId]),/Not authorized/);
 await assert.rejects(a.query('select * from public.storage_files'),/permission denied/);
 await assert.rejects(a.query('select public.admin_storage_summary()'),/Not authorized/);
 await assert.rejects(a.query('select * from public.storage_account_usage($1)',[other.profileId]),/Not authorized/);
 await client.query('select public.admin_set_upload_enabled($1,true)',[user.profileId]);
 await client.query('update public.storage_accounts set quota_bytes = 3145728 where profile_id=$1',[user.profileId]);
 const x=randomUUID(),y=randomUUID();
 const results=await Promise.allSettled([reserve(c,x),reserve(d,y)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
 await client.query("update public.storage_files set status='deleted',deleted_at=now() where id=$1",[results[1].value.rows[0].id]);
 const winner = results[0].status === 'fulfilled' ? x : y;
 const id=results.find(r=>r.status==='fulfilled').value.rows[0].id;
 assert.equal((await reserve(c,winner)).rows[0].id,id);
 const captured = await client.query(`select table_name, operation from public.backup_change_log where table_name in ('storage_accounts', 'storage_files')`);
 assert.ok(captured.rows.some(row => row.table_name === 'storage_accounts'));
 assert.ok(captured.rows.some(row => row.table_name === 'storage_files' && row.operation === 'insert'));
 assert.equal(Number((await a.query('select * from public.storage_account_usage($1)',[user.profileId])).rows[0].used_bytes),3145728);
 await become(b,seed.admin);
 const summary=(await b.query('select public.admin_storage_summary() as summary')).rows[0].summary;
 assert.equal(Number(summary.charged_bytes),3145728);
 assert.equal(Number(summary.reserved_count),1);
 assert.equal(summary.recent.length,2);
 assert.ok(summary.recent.some(row => row.id === id));
 assert.equal('provider_file_id' in summary.recent[0],false);
 assert.equal('checksum' in summary.recent[0],false);
 await b.query('select public.admin_set_upload_enabled($1,false)',[user.profileId]);
 await assert.rejects(reserve(c,args[0]),/Uploads are not enabled/);
 await assert.rejects(client.query('select public.storage_finalize_profile_picture($1,$2,$3,$4,$5,$6)',[user.profileId,id,'drive_id_0001','a'.repeat(64),3145728,'image/png']),/Upload no longer allowed/);
 await b.query('select public.admin_set_upload_enabled($1,true)',[user.profileId]);
 await assert.rejects(a.query('select public.storage_finalize_profile_picture($1,$2,$3,$4,$5,$6)',[user.profileId,id,'drive_id_0001','a'.repeat(64),3145728,'image/png']),/permission denied/);
 const finish = (file, provider, checksum='a'.repeat(64)) => client.query('select public.storage_finalize_profile_picture($1,$2,$3,$4,$5,$6)',[user.profileId,file,provider,checksum,3145728,'image/png']);
 await finish(id,'drive_id_0001');
 assert.equal((await reserve(c,winner)).rows[0].id,id);
 await client.query('update public.storage_accounts set quota_bytes=26214400 where profile_id=$1',[user.profileId]);
 const id2=(await reserve(c,randomUUID())).rows[0].id;
 await assert.rejects(finish(id2,'drive_id_0002','b'.repeat(64)),/Invalid operation/);
 assert.equal((await client.query('select status from public.storage_files where id=$1',[id])).rows[0].status,'ready');
 await finish(id2,'drive_id_0002');
 const states=(await client.query('select id,status from public.storage_files where id = any($1::uuid[])',[ [id,id2] ])).rows;
 assert.equal(states.find(r=>r.id===id).status,'delete_pending');
 assert.equal(states.find(r=>r.id===id2).status,'ready');
 assert.equal(Number((await a.query('select * from public.storage_account_usage($1)',[user.profileId])).rows[0].used_bytes),6291456);
 await client.query('select public.storage_complete_profile_delete($1,$2)',[user.profileId,id]);
 assert.equal(Number((await a.query('select * from public.storage_account_usage($1)',[user.profileId])).rows[0].used_bytes),3145728);
 await client.query('select public.storage_retire_profile_pictures($1,false)',[user.profileId]);
 await assert.rejects(finish(id2,'drive_id_0002'),/Operation no longer pending/);
 await client.query('select public.storage_complete_profile_delete($1,$2)',[user.profileId,id2]);
 assert.equal(Number((await a.query('select * from public.storage_account_usage($1)',[user.profileId])).rows[0].used_bytes),0);

 // V3 reservations share the same account lock as legacy files.
 await client.query('update public.storage_accounts set quota_bytes=3145728 where profile_id=$1',[user.profileId]);
 const v3reserve=(connection, requestId)=>connection.query('select public.storage_reserve_profile_picture_v3($1,$2,$3,$4,$5,$6) as id',[user.profileId,requestId,...args.slice(1)]);
 const v3requests=[randomUUID(),randomUUID()];
 await assert.rejects(v3reserve(a,v3requests[0]),/permission denied/);
 const v3results=await Promise.allSettled([v3reserve(c,v3requests[0]),v3reserve(d,v3requests[1])]);
 assert.equal(v3results.filter(r=>r.status==='fulfilled').length,2);
 await client.query("update public.storage_files set status='deleted',deleted_at=now() where id=$1",[v3results[1].value.rows[0].id]);
 const v3index=v3results.findIndex(r=>r.status==='fulfilled');
 const v3id=v3results[v3index].value.rows[0].id;
 const v3row=(await client.query('select gateway_key,upload_expires_at from public.storage_files where id=$1',[v3id])).rows[0];
 assert.match(v3row.gateway_key, new RegExp(`^[0-9]{13}-${v3id}$`));
 assert.equal((await v3reserve(c,v3requests[v3index])).rows[0].id,v3id);
 await assert.rejects(client.query('update public.storage_files set gateway_key=$2 where id=$1',[v3id,`1000000000000-${v3id}`]),/Upload operation key is immutable/);
 await client.query('select public.storage_retire_profile_pictures($1,false)',[user.profileId]);
 await assert.rejects(v3reserve(c,v3requests[v3index]),/conflicts/);
 await assert.rejects(finish(v3id,'drive_id_0003'),/Operation no longer pending/);
 await client.query('select public.storage_complete_profile_delete($1,$2)',[user.profileId,v3id]);
 assert.equal(Number((await a.query('select * from public.storage_account_usage($1)',[user.profileId])).rows[0].used_bytes),0);
 // Seed enough valid per-file operations to exceed the old 25 MiB allocation,
 // then exercise all reservation paths, including draft-based marketplace uploads.
 for (let i=0;i<9;i++) await v3reserve(c,randomUUID());
 assert.ok(Number((await a.query('select * from public.storage_account_usage($1)',[user.profileId])).rows[0].used_bytes)>26214400);
 await reserve(c,randomUUID());
 const post=(await client.query("insert into public.posts(author_id,body,visibility) values($1,'quota check','campus') returning id",[user.profileId])).rows[0].id;
 await c.query('select public.storage_reserve_post_attachment($1,$2,$3,$4,$5,$6,$7)',[user.profileId,post,randomUUID(),'photo.png','image/png',3145728,'a'.repeat(64)]);
 const draft=randomUUID(); await c.query('select public.storage_create_post_draft($1,$2)',[user.profileId,draft]);
 await c.query('select public.storage_reserve_draft_attachment($1,$2,$3,$4,$5,$6,$7)',[user.profileId,draft,randomUUID(),'photo.png','image/png',3145728,'a'.repeat(64)]);
 await assert.rejects(c.query('select public.storage_reserve_profile_picture_v3($1,$2,$3,$4,$5,$6)',[user.profileId,randomUUID(),'photo.png','image/png',3145729,'a'.repeat(64)]),/Invalid file metadata/);
 assert.equal((await a.query('select * from public.storage_account_usage($1)',[user.profileId])).rows[0].quota_bytes,null);
 console.log('PASS: legacy, V3, post and draft reservations above 25 MiB; per-file limit retained');
 console.log('PASS: V3 service-role reservation, immutable key constraint, idempotency, concurrent reservations, and retire-before-finalize');

 console.log('PASS: disabled default, self-grant denied, metadata/cross-user denied, concurrent reservations serialized, idempotent reservation, backup capture, redacted admin summary, finalization, replacement and ledger cleanup');
} finally { await a?.end(); await b?.end(); await c?.end(); await d?.end(); await client.end(); await admin.end(); await pg.stop(); }
