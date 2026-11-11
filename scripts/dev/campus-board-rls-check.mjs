/** Checks existing board RLS using a disposable local PostgreSQL instance. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { startDatabase, applyMigrations } from './perf/lib.mjs';
import { SUPABASE_STUB_SQL, REALTIME_STUB_SQL } from './harness.mjs';
import { seedFixtures } from './perf/seed.mjs';
const { pg, admin, client } = await startDatabase({ port: 55439, database: 'campus_board_rls' });
let owner, other, staff;
try {
  await client.query(SUPABASE_STUB_SQL); await client.query(REALTIME_STUB_SQL); await applyMigrations(client);
  const seed = await seedFixtures(client);
  const peer = seed.users.find((u) => u.profileId !== seed.me.profileId && !u.username.startsWith('perf_'));
  const conn = { connectionString: 'postgresql://postgres:postgres@127.0.0.1:55439/campus_board_rls' };
  owner = new Client(conn); other = new Client(conn); staff = new Client(conn); await owner.connect(); await other.connect(); await staff.connect();
  const staffUser = seed.users.find((u) => u.username === 'perf_admin');
  for (const [c, u] of [[owner, seed.me], [other, peer], [staff, staffUser]]) {
    await c.query('set role authenticated');
    await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)", [u.authId]);
  }
  const fixtures = [
    ['housing_posts', 'title,description,area,room_type', "'Room','A room near campus','Wakad','shared'", 'title'],
    ['ride_posts', 'origin,destination,ride_date,description', "'Campus','Station',current_date,'A ride to the station'", 'origin'],
    ['projects', 'title,description,technologies', "'Project','A small test project','JavaScript'", 'title'],
    ['lost_found', 'kind,title,description', "'lost','Umbrella','A lost umbrella'", 'title'],
  ];
  for (const [table, columns, values, field] of fixtures) {
    const id = randomUUID();
    await client.query(`insert into public.${table} (id,creator_id,${columns}) values ($1,$2,${values})`, [id, seed.me.profileId]);
    assert.equal((await other.query(`update public.${table} set ${field}='Unauthorized' where id=$1 returning id`, [id])).rowCount, 0, `${table}: non-owner update`);
    assert.equal((await other.query(`delete from public.${table} where id=$1 returning id`, [id])).rowCount, 0, `${table}: non-owner delete`);
    assert.equal((await owner.query(`update public.${table} set ${field}='Owner update' where id=$1 returning id`, [id])).rowCount, 1, `${table}: owner update`);
    await client.query(`update public.${table} set status='hidden' where id=$1`, [id]);
    assert.equal((await other.query(`select id from public.${table} where id=$1`, [id])).rowCount, 0, `${table}: hidden from student`);
    assert.equal((await staff.query(`select id from public.${table} where id=$1`, [id])).rowCount, 1, `${table}: visible to moderator`);
    assert.equal((await owner.query(`delete from public.${table} where id=$1 returning id`, [id])).rowCount, 1, `${table}: owner delete`);
  }
  console.log('PASS: four board tables deny non-owner updates/deletes and permit owner updates/deletes');
} finally { await owner?.end(); await other?.end(); await staff?.end(); await client.end(); await admin.end(); await pg.stop(); }
