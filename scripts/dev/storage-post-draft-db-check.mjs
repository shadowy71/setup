/** Disposable PostgreSQL draft, authorization and atomic post publication checks. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { startDatabase, applyMigrations } from './perf/lib.mjs';
import { SUPABASE_STUB_SQL, REALTIME_STUB_SQL } from './harness.mjs';
import { seedFixtures } from './perf/seed.mjs';
const {pg,admin,client} = await startDatabase({port:55437,database:'storage_draft_test'});
let session, other, service;
try {
 await client.query(SUPABASE_STUB_SQL); await client.query(REALTIME_STUB_SQL); await applyMigrations(client);
 const seed=await seedFixtures(client); const owner=seed.me; const peer=seed.users.find((u)=>u.profileId!==owner.profileId);
 await client.query('select public.admin_set_upload_enabled($1,true)',[owner.profileId]);
 const conn={connectionString:'postgresql://postgres:postgres@127.0.0.1:55437/storage_draft_test'};
 session=new Client(conn); other=new Client(conn); service=new Client(conn); await Promise.all([session.connect(),other.connect(),service.connect()]);
 for (const [c,u] of [[session,owner],[other,peer]]) { await c.query('set role authenticated'); await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[u.authId]); }
 await service.query('set role service_role'); await service.query("select set_config('request.jwt.claim.role','service_role',false)");
 const draft=randomUUID(), request=randomUUID();
 await service.query('select public.storage_create_post_draft($1,$2)',[owner.profileId,draft]);
 await assert.rejects(service.query('select public.storage_create_post_draft($1,$2)',[peer.profileId,draft]),/Uploads disabled|Draft unavailable/);
 await assert.rejects(session.query('select * from public.post_upload_drafts'),/permission denied/);
 const file=(await service.query("select public.storage_reserve_draft_attachment($1,$2,$3,'a.png','image/png',100,$4) id",[owner.profileId,draft,request,'a'.repeat(64)])).rows[0].id;
 const publish=(c,post) => c.query("select public.publish_post_with_draft($1,$2,'post',null,'atomic post',null,null,null,array[]::text[],array[$3]::uuid[]) id",[draft,post,file]);
 const rejectedPost=randomUUID(); await assert.rejects(publish(session,rejectedPost),/Draft uploads incomplete/);
 assert.equal((await client.query('select 1 from public.posts where id=$1',[rejectedPost])).rowCount,0);
 await service.query("select public.storage_finalize_draft_attachment($1,$2,'drive_12345678',$3,100,'image/png')",[owner.profileId,file,'a'.repeat(64)]);
 await assert.rejects(publish(other,randomUUID()),/Uploads disabled|Draft unavailable/);
 const post=randomUUID(); assert.equal((await publish(session,post)).rows[0].id,post);
 assert.equal((await publish(session,randomUUID())).rows[0].id,post);
 const joined=(await client.query('select f.resource_id,f.status,l.position from public.storage_files f join public.post_attachment_links l on l.file_id=f.id where f.id=$1',[file])).rows[0];
 assert.equal(joined.resource_id,post); assert.equal(joined.status,'ready'); assert.equal(joined.position,0);
 const draft2=randomUUID(); await service.query('select public.storage_create_post_draft($1,$2)',[owner.profileId,draft2]);
 const orphan=(await service.query("select public.storage_reserve_draft_attachment($1,$2,$3,'a.pdf','application/pdf',10,$4) id",[owner.profileId,draft2,randomUUID(),'b'.repeat(64)])).rows[0].id;
 await service.query('select public.storage_abandon_post_draft($1,$2)',[owner.profileId,draft2]);
 assert.equal((await client.query('select status from public.storage_files where id=$1',[orphan])).rows[0].status,'delete_pending');
 await assert.rejects(service.query("select public.storage_finalize_draft_attachment($1,$2,'drive_12345679',$3,10,'application/pdf')",[owner.profileId,orphan,'b'.repeat(64)]),/Draft unavailable/);
 const pollDraft=randomUUID(); await service.query('select public.storage_create_post_draft($1,$2)',[owner.profileId,pollDraft]);
 const pollFile=(await service.query("select public.storage_reserve_draft_attachment($1,$2,$3,'b.png','image/png',10,$4) id",[owner.profileId,pollDraft,randomUUID(),'c'.repeat(64)])).rows[0].id;
 await service.query("select public.storage_finalize_draft_attachment($1,$2,'drive_12345680',$3,10,'image/png')",[owner.profileId,pollFile,'c'.repeat(64)]);
 const poll=randomUUID(); await session.query("select public.publish_post_with_draft($1,$2,'poll','Which slot?','Which slot?',null,null,null,array['Monday','Tuesday'],array[$3]::uuid[])",[pollDraft,poll,pollFile]);
 assert.equal((await client.query('select count(*)::int n from public.poll_options where post_id=$1',[poll])).rows[0].n,2);
 console.log('PASS: owner isolation, atomic publication rollback, retry idempotency, draft association and abandoned upload retirement');
} finally { await session?.end(); await other?.end(); await service?.end(); await client.end(); await admin.end(); await pg.stop(); }
