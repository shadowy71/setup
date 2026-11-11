/** Disposable PostgreSQL only. No provider calls. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { startDatabase, applyMigrations } from './perf/lib.mjs';
import { SUPABASE_STUB_SQL, REALTIME_STUB_SQL } from './harness.mjs';
import { seedFixtures } from './perf/seed.mjs';
const {pg,admin,client}=await startDatabase({port:55444,database:'space_attachments_test'});
let owner,other,staff,service;
try {
  await client.query(SUPABASE_STUB_SQL); await client.query(REALTIME_STUB_SQL); await applyMigrations(client);
  const seed=await seedFixtures(client); const me=seed.me; const peer=seed.users.find(u=>u.profileId!==me.profileId && !u.username.startsWith('perf_')); const administrator=seed.admin;
  for(const u of [me,peer,administrator]) await client.query('select public.admin_set_upload_enabled($1,true)',[u.profileId]);
  const conn={connectionString:'postgresql://postgres:postgres@127.0.0.1:55444/space_attachments_test'};
  owner=new Client(conn);other=new Client(conn);staff=new Client(conn);service=new Client(conn);await Promise.all([owner.connect(),other.connect(),staff.connect(),service.connect()]);
  for(const [c,u] of [[owner,me],[other,peer],[staff,administrator]]) {await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[u.authId]);}
  await service.query('set role service_role');await service.query("select set_config('request.jwt.claim.role','service_role',false)");
  async function draftFile(user,mime) {
    const draft=randomUUID(),request=randomUUID(),checksum=randomUUID().replaceAll('-','').repeat(2);
    await service.query('select public.storage_create_post_draft($1,$2)',[user.profileId,draft]);
    const file=(await service.query('select public.storage_reserve_draft_attachment($1,$2,$3,$4,$5,100,$6) id',[user.profileId,draft,request,mime==='application/pdf'?'doc.pdf':'photo.png',mime,checksum])).rows[0].id;
    await service.query('select public.storage_finalize_draft_attachment($1,$2,$3,$4,100,$5)',[user.profileId,file,`drive_${request.replaceAll('-','')}`,checksum,mime]);
    return {draft,file};
  }
  const first=await draftFile(me,'image/png'), id=randomUUID();
  const payload={kind:'community',name:'Private Space',slug:'private-test-space',description:'A private place for students',visibility:'private',join_policy:'request'};
  const create=(c,p=payload)=>c.query('select public.publish_space_with_draft($1,$2,$3,$4::uuid[]) result',[first.draft,id,p,[first.file]]);
  await assert.rejects(create(owner),/Not permitted/);
  assert.equal((await client.query('select 1 from public.communities where id=$1',[id])).rowCount,0);
  await client.query("update public.feature_flags set enabled=true where key='space_attachments'");
  const created=(await create(owner)).rows[0].result; assert.equal(created.id,id);
  assert.equal((await create(owner)).rows[0].result.id,id);
  assert.equal((await other.query('select id from public.communities where id=$1',[id])).rowCount,0);
  assert.equal((await owner.query('select id from public.communities where id=$1',[id])).rowCount,1);
  await assert.rejects(other.query('select public.space_retire_attachment($1,$2)',[id,first.file]),/Not permitted/);
  await assert.rejects(owner.query('select * from public.space_attachment_links'),/permission denied/);
  await client.query("insert into public.community_members(community_id,user_id,role,status) values($1,$2,'moderator','active')",[id,peer.profileId]);
  const second=await draftFile(peer,'image/png');
  await other.query('select public.space_claim_draft($1,$2,$3::uuid[])',[second.draft,id,[second.file]]);
  await other.query('select public.space_retire_attachment($1,$2)',[id,first.file]);
  assert.equal((await client.query('select status from public.storage_files where id=$1',[first.file])).rows[0].status,'delete_pending');
  const bad=await draftFile(me,'application/pdf');
  await assert.rejects(owner.query('select public.space_claim_draft($1,$2,$3::uuid[])',[bad.draft,id,[bad.file]]),/Invalid attachments/);
  const clubfile=await draftFile(administrator,'application/pdf');
  const clubPayload={name:'Test Robotics Club',slug:'test-robotics-club',description:'A real test club for robotics',club_category:'Technical',organization_type:'technical_club',visibility:'campus',join_policy:'request'};
  const createClub=()=>staff.query('select public.publish_club_with_draft($1,$2,$3,$4::uuid[]) result',[clubfile.draft,me.username,clubPayload,[clubfile.file]]);
  await client.query("update public.feature_flags set enabled=false where key='space_attachments'");
  await assert.rejects(createClub(),/Not permitted/);
  assert.equal((await client.query('select 1 from public.communities where slug=$1',[clubPayload.slug])).rowCount,0);
  await client.query("update public.feature_flags set enabled=true where key='space_attachments'");
  const club=(await createClub()).rows[0].result;
  assert.equal((await createClub()).rows[0].result.id,club.id);
  assert.equal((await client.query("select 1 from public.community_members where community_id=$1 and user_id=$2 and role='owner' and status='active'",[club.id,me.profileId])).rowCount,1);
  await owner.query('select public.space_retire_attachment($1,$2)',[club.id,clubfile.file]);
  await owner.query('delete from public.communities where id=$1',[id]);
  assert.equal((await client.query('select status from public.storage_files where id=$1',[second.file])).rows[0].status,'delete_pending');
  console.log('PASS: spaces flags, atomic club/community creation, membership, private RLS, manager authorization, file types, retry and deletion');
} finally {await owner?.end();await other?.end();await staff?.end();await service?.end();await client.end();await admin.end();await pg.stop();}
