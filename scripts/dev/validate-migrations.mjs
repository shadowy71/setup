#!/usr/bin/env node
/**
 * Local schema validation (development tool).
 *
 * Boots a disposable PostgreSQL instance, installs the minimal Supabase
 * compatibility surface, applies the authoritative migration history in
 * `supabase/migrations/` in order, then runs the SQL test suites in
 * `database/tests/`.
 *
 * Usage:
 *   npm install --no-save embedded-postgres
 *   npm run db:test            # or: node scripts/dev/validate-migrations.mjs
 *
 * Production migrations run through the Supabase CLI (`supabase db push`).
 */

import { banner, applyMigrations, runTestSuites, shutdown, startDatabase, migrationFiles } from './harness.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { migrationsDir } from './harness.mjs';

async function main() {
  const { pg, client } = await startDatabase({ port: 55432 });

  const files = await migrationFiles();
  let failed = false;

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    process.stdout.write(`  → ${file} … `);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('commit');
      console.log('\x1b[32mok\x1b[0m');
    } catch (error) {
      await client.query('rollback');
      console.log('\x1b[31mFAILED\x1b[0m');
      console.error(`\n  ${error.message}`);
      const position = error.position ? Number(error.position) : null;
      if (position) {
        const lines = sql.split('\n');
        const lineNo = sql.slice(0, position).split('\n').length;
        for (let i = Math.max(0, lineNo - 4); i < Math.min(lines.length, lineNo + 3); i += 1) {
          const marker = i === lineNo - 1 ? '»' : ' ';
          console.error(`  ${marker} ${String(i + 1).padStart(4)} | ${lines[i]}`);
        }
      }
      failed = true;
      break;
    }
  }

  if (failed) {
    await shutdown(pg, client);
    process.exit(1);
  }

  // Migration 037 is deliberately safe to replay after live grant drift. Remove
  // only the narrow predicate's grants (never re-open the cross-user oracle),
  // then execute the actual migration twice. Suites 15/16 subsequently prove
  // own-channel access and cross-user denial against this repaired state.
  const authorizationRepair = '20261029000005_037_realtime_authorization_grants.sql';
  if (files.includes(authorizationRepair)) {
    banner('Replaying the Realtime grant repair after deliberate drift…');
    try {
      await client.query(`
        revoke all on function public.can_access_own_random_session(uuid) from authenticated;
        revoke all on function public.can_access_own_random_session(uuid) from supabase_realtime;
      `);
      const repairSql = await readFile(path.join(migrationsDir, authorizationRepair), 'utf8');
      await client.query(repairSql);
      await client.query(repairSql);
      const repaired = await client.query(`
        select
          has_function_privilege('authenticated', 'public.can_access_own_random_session(uuid)', 'execute') as api_role,
          has_function_privilege('supabase_realtime', 'public.can_access_own_random_session(uuid)', 'execute') as realtime_role
      `);
      if (!repaired.rows[0].api_role || !repaired.rows[0].realtime_role) {
        throw new Error('Migration 037 replay did not restore both narrow-predicate grants.');
      }
      console.log('  \x1b[32m✓\x1b[0m missing grants repaired; idempotent second replay passed.');
    } catch (error) {
      console.error(`  \x1b[31m✗\x1b[0m ${error.message}`);
      await shutdown(pg, client);
      process.exit(1);
    }
  }

  banner('Installing test helpers…');
  const { TEST_HELPER_SQL } = await import('./harness.mjs');
  await client.query(TEST_HELPER_SQL);

  // -------------------------------------------------------------------------
  // Migration 027 contract: the outbox must cover EVERY application table and
  // must never capture its own bookkeeping. Re-sync first so a future migration
  // that adds a table is validated by exactly the code that would fix it.
  // -------------------------------------------------------------------------
  banner('Validating transactional backup capture…');
  const synced = (await client.query('select public.backup_sync_triggers() as n')).rows[0].n;
  const missingTriggers = (
    await client.query(`
      select c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname not like 'backup%' and c.relname not like '\\_\\_test%'
        and not exists (select 1 from pg_trigger t
                        where t.tgrelid = c.oid and t.tgname = 'backup_capture' and not t.tgisinternal)
      order by 1
    `)
  ).rows.map((row) => row.name);
  const recursiveTriggers = (
    await client.query(`
      select c.relname as name from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname like 'backup%' and t.tgname = 'backup_capture'
    `)
  ).rows.map((row) => row.name);
  const untracked = (
    await client.query(`
      select c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname not like 'backup%' and c.relname not like '\\_\\_test%'
        and not exists (select 1 from public.backup_tracked_tables t
                        where t.schema_name = 'public' and t.table_name = c.relname)
    `)
  ).rows.map((row) => row.name);
  const publicBackupRls = (
    await client.query(`
      select c.relname as name from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname like 'backup%' and not c.relrowsecurity
    `)
  ).rows.map((row) => row.name);
  const exposedWorkerRpc = (
    await client.query(`
      select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('backup_claim_batch', 'backup_complete_batch', 'backup_private_get_credentials',
                          'backup_snapshot_watermark', 'backup_complete_snapshot', 'backup_prune_change_log')
        and (has_function_privilege('anon', p.oid, 'EXECUTE')
             or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    `)
  ).rows.map((row) => row.sig);

  const captureProblems = [
    missingTriggers.length ? `missing capture trigger: ${missingTriggers.join(', ')}` : null,
    recursiveTriggers.length ? `recursive trigger on backup table: ${recursiveTriggers.join(', ')}` : null,
    untracked.length ? `missing snapshot catalogue row: ${untracked.join(', ')}` : null,
    publicBackupRls.length ? `missing RLS: ${publicBackupRls.join(', ')}` : null,
    exposedWorkerRpc.length ? `worker RPC exposed to clients: ${exposedWorkerRpc.join(', ')}` : null,
  ].filter(Boolean);

  if (captureProblems.length) {
    for (const problem of captureProblems) console.error(`  \x1b[31m✗\x1b[0m ${problem}`);
    await shutdown(pg, client);
    process.exit(1);
  }
  console.log(`  \x1b[32m✓\x1b[0m ${synced} application tables tracked and triggered; backup tables excluded; worker RPCs isolated.`);

  banner('Running database test suites…');
  const results = await runTestSuites(client, {
    onSuite: (file) => process.stdout.write(`  → ${file} … `),
  });

  let testsFailed = false;
  for (const result of results) {
    if (result.ok) {
      console.log('\x1b[32mpassed\x1b[0m');
      continue;
    }
    console.log('\x1b[31mFAILED\x1b[0m');
    console.error(`\n  ${result.error.message}`);
    if (result.error.failedStatement) {
      const preview = result.error.failedStatement.split('\n').slice(0, 4).join('\n      ');
      console.error(`\n  failed statement:\n      ${preview}`);
    }
    testsFailed = true;
  }

  await shutdown(pg, client);

  if (testsFailed) {
    console.error('\n\x1b[31mTest suites failed.\x1b[0m');
    process.exit(1);
  }

  banner('All migrations applied cleanly and every test suite passed.');
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
