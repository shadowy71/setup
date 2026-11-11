/** Isolated team-request RLS and transition checks; never connects to production. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { startDatabase, applyMigrations } from './perf/lib.mjs';
import { SUPABASE_STUB_SQL, REALTIME_STUB_SQL } from './harness.mjs';
import { seedFixtures } from './perf/seed.mjs';
const { pg, admin, client } = await startDatabase({ port: 55440, database: 'team_requests_test' });
const clients = [];
try {
  await client.query(SUPABASE_STUB_SQL); await client.query(REALTIME_STUB_SQL); await applyMigrations(client);
  const seed = await seedFixtures(client);
  const participants = [seed.me, ...seed.users.filter((u) => u.profileId !== seed.me.profileId && !u.username.startsWith('perf_')).slice(0, 2)];
  assert.equal(participants.length, 3);
  for (const user of participants) {
    const c = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:55440/team_requests_test' });
    await c.connect(); clients.push(c); await c.query('set role authenticated');
    await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)", [user.authId]);
  }
  const [owner, applicant, stranger] = clients;
  const team = randomUUID(); const request = randomUUID();
  await client.query("insert into public.team_posts(id,creator_id,project_name,description,required_skills) values($1,$2,'Project','Interesting project details','Design')", [team, participants[0].profileId]);
  const ownProject = randomUUID(), otherProject = randomUUID();
  await client.query("insert into public.projects(id,creator_id,title,description,technologies) values($1,$2,'Own project','A project description','JavaScript'),($3,$4,'Other project','Another project description','JavaScript')",[ownProject,participants[0].profileId,otherProject,participants[1].profileId]);
  await assert.rejects(owner.query('update public.team_posts set project_id=$1 where id=$2',[otherProject,team]), /Only your published projects/);
  await owner.query('update public.team_posts set project_id=$1 where id=$2',[ownProject,team]);
  assert.equal((await client.query('select project_id from public.team_posts where id=$1',[team])).rows[0].project_id,ownProject);
  await assert.rejects(applicant.query("insert into public.team_post_requests(team_post_id,user_id,status) values ($1,$2,'accepted')", [team, participants[1].profileId]), /New requests must be pending/);
  await applicant.query("insert into public.team_post_requests(id,team_post_id,user_id,message) values($1,$2,$3,'Hello')", [request,team,participants[1].profileId]);
  assert.equal((await stranger.query('select * from public.team_post_requests where id=$1',[request])).rowCount, 0);
  assert.equal((await applicant.query("update public.team_post_requests set status='accepted' where id=$1 returning id",[request])).rowCount, 0);
  assert.equal((await owner.query("update public.team_post_requests set status='accepted' where id=$1 returning decided_at",[request])).rows[0].decided_at instanceof Date, true);
  await assert.rejects(owner.query("update public.team_post_requests set status='declined' where id=$1",[request]), /Only pending requests/);
  assert.equal((await stranger.query('delete from public.team_post_requests where id=$1 returning id',[request])).rowCount, 0);
  assert.equal((await applicant.query('delete from public.team_post_requests where id=$1 returning id',[request])).rowCount, 1);
  const invite = (await owner.query('select public.invite_team_member($1,$2) id',[team,participants[1].username])).rows[0].id;
  assert.equal((await stranger.query('select id from public.team_invitations where id=$1',[invite])).rowCount, 0);
  await assert.rejects(stranger.query('select public.respond_team_invitation($1,true)',[invite]), /Invitation unavailable/);
  await assert.rejects(applicant.query("update public.team_invitations set status='accepted' where id=$1",[invite]), /permission denied/);
  await applicant.query('select public.respond_team_invitation($1,true)',[invite]);
  const accepted = (await client.query("select id from public.team_post_requests where team_post_id=$1 and user_id=$2 and status='accepted'",[team,participants[1].profileId])).rows[0].id;
  await assert.rejects(stranger.query('select public.remove_team_member($1)',[accepted]), /Membership unavailable/);
  await owner.query('select public.remove_team_member($1)',[accepted]);
  assert.equal((await client.query('select id from public.team_post_requests where id=$1',[accepted])).rowCount,0);
  await client.query('insert into public.blocks(blocker_id,blocked_id) values($1,$2)',[participants[0].profileId,participants[1].profileId]);
  await assert.rejects(owner.query('select public.invite_team_member($1,$2)',[team,participants[1].username]), /Student unavailable/);
  await client.query("update public.feature_flags set enabled=false where key='team_finder'");
  await assert.rejects(stranger.query('insert into public.team_post_requests(team_post_id,user_id) values($1,$2)',[team,participants[2].profileId]), /Team finder disabled/);
  await assert.rejects(owner.query('select public.invite_team_member($1,$2)',[team,participants[2].username]), /Unavailable/);
  console.log('PASS: private requests and invitations, spoofing denial, owner decisions, leave, removal, blocks and flag');
} finally { for (const c of clients) await c.end(); await client.end(); await admin.end(); await pg.stop(); }
