#!/usr/bin/env node
// Disposable PostgreSQL only. Never points at a remote database.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { startDatabase, migrationsDir } from './perf/lib.mjs';
import { SUPABASE_STUB_SQL, REALTIME_STUB_SQL } from './harness.mjs';

const { pg, admin, client } = await startDatabase();
try {
  await client.query(SUPABASE_STUB_SQL);
  await client.query(REALTIME_STUB_SQL);
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const migration = '20261112000032_078_klipy_gif_references.sql';
  for (const file of files.filter((f) => f < migration)) {
    await client.query(await readFile(path.join(migrationsDir, file), 'utf8'));
  }
  const policies = async () => (await client.query(`select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname = 'public' order by tablename, policyname`)).rows;
  const before = await policies();
  const beforeFunction = (await client.query("select pg_get_functiondef('public.send_random_message(uuid,text,jsonb)'::regprocedure) as def")).rows[0].def;
  await client.query('begin');
  await client.query(await readFile(path.join(migrationsDir, migration), 'utf8'));
  await client.query('commit');
  assert.deepEqual(await policies(), before, 'RLS policies changed');
  const afterFunction = (await client.query("select pg_get_functiondef('public.send_random_message(uuid,text,jsonb)'::regprocedure) as def")).rows[0].def;
  assert.equal(afterFunction, beforeFunction.replace("coalesce(p_gif->>'provider', '') <> 'giphy'", "coalesce(p_gif->>'provider', '') not in ('giphy', 'klipy')"));

  for (const table of ['posts', 'comments', 'messages', 'random_messages']) {
    // Clone the actual deployed constraints into a minimal temporary table so
    // each case exercises their PostgreSQL semantics without unrelated FKs.
    const constraints = (await client.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = $1::regclass and conname in ($2, $3) order by conname`, [`public.${table}`, `${table}_gif_provider`, `${table}_gif_url_host`])).rows;
    assert.equal(constraints.length, 2);
    await client.query(`create temporary table gif_check (gif jsonb, ${constraints.map(({ def }) => def).join(', ')})`);
    for (const ref of [null, { provider: 'giphy', url: 'https://media.giphy.com/media/abc/giphy.gif' }, ...['static', 'static1', 'static2'].map((host) => ({ provider: 'klipy', url: `https://${host}.klipy.com/ii/example.gif?tracking=1` }))]) {
      await client.query('insert into gif_check values ($1)', [ref === null ? null : JSON.stringify(ref)]);
    }
    for (const ref of [{ provider: 'klipy', url: 'https://evil.example/a.gif' }, { provider: 'klipy', url: 'https://static.klipy.com.evil.example/a.gif' }, { provider: 'klipy', url: 'https://media.giphy.com/a.gif' }, { provider: 'giphy', url: 'https://static.klipy.com/a.gif' }, { provider: 'other', url: 'https://static.klipy.com/a.gif' }, { provider: 'klipy' }, { url: 'https://static.klipy.com/a.gif' }]) {
      await assert.rejects(client.query('insert into gif_check values ($1)', [JSON.stringify(ref)]), (e) => e.code === '23514');
    }
    await client.query('drop table gif_check');
    console.log(`${table}: valid provider/host pairs accepted, spoofing rejected`);
  }
  console.log('Migration applied; RLS policies and unrelated RPC logic unchanged.');
} finally {
  await client.end();
  await admin.end();
  await pg.stop();
}
