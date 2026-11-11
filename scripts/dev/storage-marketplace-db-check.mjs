/** Disposable PostgreSQL marketplace image lifecycle checks. Never targets production. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { startDatabase, applyMigrations } from './perf/lib.mjs';
import { SUPABASE_STUB_SQL, REALTIME_STUB_SQL } from './harness.mjs';
import { seedFixtures } from './perf/seed.mjs';
const {pg,admin,client}=await startDatabase({port:55438,database:'marketplace_storage_test'});
let owner,other,service;
try {
  await client.query(SUPABASE_STUB_SQL);await client.query(REALTIME_STUB_SQL);await applyMigrations(client);
  const seed=await seedFixtures(client);const user=seed.me;const peer=seed.users.find((u)=>u.profileId!==user.profileId && !u.username.startsWith('perf_'));
  await client.query('select public.admin_set_upload_enabled($1,true)',[user.profileId]);await client.query('select public.admin_set_upload_enabled($1,true)',[peer.profileId]);
  const conn={connectionString:'postgresql://postgres:postgres@127.0.0.1:55438/marketplace_storage_test'};
  owner=new Client(conn);other=new Client(conn);service=new Client(conn);await Promise.all([owner.connect(),other.connect(),service.connect()]);
  for(const [c,u] of [[owner,user],[other,peer]]) {await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[u.authId]);}
  await service.query('set role service_role');await service.query("select set_config('request.jwt.claim.role','service_role',false)");
  const cat=(await client.query("select id from public.marketplace_categories where scope='marketplace' and is_active limit 1")).rows[0].id;
  const payload={category_id:cat,title:'Example camera',description:'A tested camera',price:50,is_free:false,is_negotiable:false,condition:'good',location:'Campus',contact_note:null,status:'active'};
  async function newDraft(mime='image/png',name='camera.png') {
    const draft=randomUUID();await service.query('select public.storage_create_post_draft($1,$2)',[user.profileId,draft]);
    const file=(await service.query('select public.storage_reserve_draft_attachment($1,$2,$3,$4,$5,100,$6) id',[user.profileId,draft,randomUUID(),name,mime,'a'.repeat(64)])).rows[0].id;
    await service.query('select public.storage_finalize_draft_attachment($1,$2,$3,$4,100,$5)',[user.profileId,file,`drive_${file.replaceAll('-','')}`,'a'.repeat(64),mime]);return {draft,file};
  }
  const first=await newDraft(), listing=randomUUID();
  const publish=(id=listing)=>owner.query('select public.publish_listing_with_draft($1,$2,$3,$4::uuid[]) id',[first.draft,id,payload,[first.file]]);
  await assert.rejects(publish(),/Images disabled/);
  assert.equal((await client.query('select 1 from public.marketplace_listings where id=$1',[listing])).rowCount,0);
  await client.query("update public.feature_flags set enabled=true where key='marketplace_images'");
  await assert.rejects(other.query('select public.publish_listing_with_draft($1,$2,$3,$4::uuid[])',[first.draft,randomUUID(),payload,[first.file]]),/Draft unavailable/);
  assert.equal((await publish()).rows[0].id,listing);
  assert.equal((await publish(randomUUID())).rows[0].id,listing);
  await assert.rejects(owner.query('select * from public.marketplace_attachment_links'),/permission denied/);
  await assert.rejects(other.query('select public.marketplace_retire_image($1,$2)',[listing,first.file]),/Not allowed/);
  const second=await newDraft(); await owner.query('select public.marketplace_claim_draft($1,$2,$3::uuid[])',[second.draft,listing,[second.file]]);
  await owner.query('select public.marketplace_reorder_images($1,$2::uuid[])',[listing,[second.file,first.file]]);
  let links=(await client.query('select file_id,position from public.marketplace_attachment_links where listing_id=$1 order by position',[listing])).rows;
  assert.deepEqual(links.map((l)=>l.file_id),[second.file,first.file]);
  const replacement=await newDraft();await owner.query('select public.marketplace_claim_replacement($1,$2,$3,$4)',[listing,replacement.draft,second.file,replacement.file]);
  await owner.query('select public.marketplace_claim_replacement($1,$2,$3,$4)',[listing,replacement.draft,second.file,replacement.file]);
  links=(await client.query('select file_id,position from public.marketplace_attachment_links where listing_id=$1 order by position',[listing])).rows;
  assert.deepEqual(links.map((l)=>l.file_id),[replacement.file,first.file]);
  assert.equal((await client.query('select status from public.storage_files where id=$1',[second.file])).rows[0].status,'delete_pending');
  const extra=[]; for(let i=0;i<6;i++) {const image=await newDraft();extra.push(image);await owner.query('select public.marketplace_claim_draft($1,$2,$3::uuid[])',[image.draft,listing,[image.file]]);}
  const eighthReplacement=await newDraft();
  await owner.query('select public.marketplace_claim_replacement($1,$2,$3,$4)',[listing,eighthReplacement.draft,extra[5].file,eighthReplacement.file]);
  assert.equal((await client.query('select count(*)::int n from public.marketplace_attachment_links where listing_id=$1',[listing])).rows[0].n,8);
  await owner.query('select public.marketplace_retire_image($1,$2)',[listing,eighthReplacement.file]);
  const pdf=await newDraft('application/pdf','doc.pdf');await assert.rejects(owner.query('select public.marketplace_claim_draft($1,$2,$3::uuid[])',[pdf.draft,listing,[pdf.file]]),/Invalid gallery/);
  assert.equal((await client.query('select status from public.storage_files where id=$1',[pdf.file])).rows[0].status,'ready');
  await owner.query('select public.marketplace_retire_image($1,$2)',[listing,first.file]);
  assert.equal((await client.query('select status from public.storage_files where id=$1',[first.file])).rows[0].status,'delete_pending');
  await owner.query('delete from public.marketplace_listings where id=$1',[listing]);
  assert.equal((await client.query('select status from public.storage_files where id=$1',[replacement.file])).rows[0].status,'delete_pending');
  await service.query('select public.storage_complete_marketplace_image_delete($1)',[replacement.file]);
  assert.equal((await client.query('select status from public.storage_files where id=$1',[replacement.file])).rows[0].status,'deleted');
  console.log('PASS: disabled default, atomic listing rollback and retry, ownership, order, cover replacement, PDF denial, delete retirement and confirmed cleanup');
} finally {await owner?.end();await other?.end();await service?.end();await client.end();await admin.end();await pg.stop();}
