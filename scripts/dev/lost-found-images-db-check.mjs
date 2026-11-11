/** Disposable PostgreSQL only; no Drive calls. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { startDatabase, applyMigrations } from './perf/lib.mjs';
import { SUPABASE_STUB_SQL, REALTIME_STUB_SQL } from './harness.mjs';
import { seedFixtures } from './perf/seed.mjs';
const {pg,admin,client}=await startDatabase({port:55438,database:'lost_found_images_test'});
let owner,other,service;
try {
  await client.query(SUPABASE_STUB_SQL); await client.query(REALTIME_STUB_SQL); await applyMigrations(client);
  const seed=await seedFixtures(client); const me=seed.me; const peer=seed.users.find(u=>u.profileId!==me.profileId);
  await client.query('select public.admin_set_upload_enabled($1,true)',[me.profileId]);
  const conn={connectionString:'postgresql://postgres:postgres@127.0.0.1:55438/lost_found_images_test'};
  owner=new Client(conn);other=new Client(conn);service=new Client(conn);await Promise.all([owner.connect(),other.connect(),service.connect()]);
  for(const [c,u] of [[owner,me],[other,peer]]) {await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[u.authId]);}
  await service.query('set role service_role');await service.query("select set_config('request.jwt.claim.role','service_role',false)");
  const draft=randomUUID(),request=randomUUID(),report=randomUUID();
  await service.query('select public.storage_create_post_draft($1,$2)',[me.profileId,draft]);
  const file=(await service.query("select public.storage_reserve_draft_attachment($1,$2,$3,'item.png','image/png',100,$4) id",[me.profileId,draft,request,'a'.repeat(64)])).rows[0].id;
  const publish=(connection,id)=>connection.query('select public.publish_lost_found_with_draft($1,$2,$3,$4::uuid[]) id',[draft,id,{kind:'lost',title:'Lost camera',description:'A black camera lost nearby'},[file]]);
  await assert.rejects(publish(owner,report),/Not permitted/);
  assert.equal((await client.query('select 1 from public.lost_found where id=$1',[report])).rowCount,0);
  await client.query("update public.feature_flags set enabled=true where key='lost_found_images'");
  await assert.rejects(publish(owner,report),/Invalid images/);
  assert.equal((await client.query('select 1 from public.lost_found where id=$1',[report])).rowCount,0);
  await service.query("select public.storage_finalize_draft_attachment($1,$2,'drive_12345678',$3,100,'image/png')",[me.profileId,file,'a'.repeat(64)]);
  await assert.rejects(publish(other,randomUUID()),/Uploads disabled|Draft unavailable/);
  assert.equal((await publish(owner,report)).rows[0].id,report);
  assert.equal((await publish(owner,randomUUID())).rows[0].id,report);
  const row=(await client.query('select f.resource_type,f.resource_id,f.status,l.report_id from public.storage_files f join public.lost_found_attachment_links l on l.file_id=f.id where f.id=$1',[file])).rows[0];
  assert.deepEqual(row,{resource_type:'lost_found_image',resource_id:report,status:'ready',report_id:report});
  await assert.rejects(owner.query('select * from public.lost_found_attachment_links'),/permission denied/);
  await assert.rejects(other.query('select public.lost_found_retire_image($1,$2)',[report,file]),/Not permitted/);
  await owner.query('delete from public.lost_found where id=$1',[report]);
  assert.equal((await client.query('select status from public.storage_files where id=$1',[file])).rows[0].status,'delete_pending');
  await service.query('select public.storage_complete_lost_found_image_delete($1)',[file]);
  assert.equal((await client.query('select status from public.storage_files where id=$1',[file])).rows[0].status,'deleted');
  console.log('PASS: lost-and-found flag, atomic publication, ownership, retry, privacy and deletion retirement');
} finally {await owner?.end();await other?.end();await service?.end();await client.end();await admin.end();await pg.stop();}
