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

  // Migration 073 imports content only when its publisher profile exists, and a
  // fresh database never has one: applying the history above exercises the
  // manifest checks but not a single insert. Create that profile inside a
  // transaction, run the real migration, run it again, then edit one record and
  // delete another and run it a third time. Everything is rolled back, so the
  // suites below still start from a database with no imported rows.
  const archiveImport = '20261112000027_073_pccoe_noticeboard_archive.sql';
  if (files.includes(archiveImport)) {
    banner('Replaying the noticeboard archive import with its publisher present…');
    try {
      const importSql = await readFile(path.join(migrationsDir, archiveImport), 'utf8');
      const publisher = /c_publisher\s+constant uuid := '([0-9a-f-]{36})'/.exec(importSql)?.[1];
      const batch = /c_batch\s+constant text := '([a-z0-9-]+)'/.exec(importSql)?.[1];
      if (!publisher || !batch) throw new Error('Migration 073 no longer declares its batch and publisher.');

      const snapshot = async () =>
        (
          await client.query(
            `
            with entries as (
              select e.*, n.id as live_id, n.title, n.body, n.status, n.pinned, n.published_at,
                     n.expires_at, n.created_by, n.updated_by
              from public.notice_archive_entries e
              left join public.notices n on n.id = e.notice_id
              where e.source_key like $1 || '/%'
            )
            select
              (select count(*)::int from public.notices) as notices,
              (select count(*)::int from public.notices where status = 'published') as published,
              (select count(*)::int from public.events) as events,
              (select count(*)::int from public.academic_calendar) as calendar,
              (select count(*)::int from public.communities) as communities,
              (select count(*)::int from public.community_members) as members,
              count(*)::int as registered,
              count(live_id)::int as attached,
              count(*) filter (
                where status = 'archived' and not pinned and published_at is null
                  and expires_at is null and created_by = $2::uuid
              )::int as archived,
              count(*) filter (where md5(title || chr(10) || body) = source_checksum)::int as unchanged,
              count(*) filter (where length(btrim(body)) < 100)::int as thin,
              count(distinct sort_order)::int as positions,
              coalesce(min(sort_order), 0)::int as first_position,
              coalesce(max(sort_order), 0)::int as last_position,
              count(distinct section_key)::int as sections,
              count(period)::int as with_period,
              count(source_note)::int as with_note,
              count(*) filter (where attribution = 'institution')::int as institutional,
              count(*) filter (
                where section_key = 'itsa'
                  and community_id = (select id from public.communities where catalogue_key = 'itsa')
              )::int as itsa_linked,
              count(*) filter (
                where section_key in ('sports', 'alphabyte-hackathon', 'placement', 'departmental')
                  and community_id is not null
              )::int as institution_linked
            from entries
            `,
            [batch, publisher],
          )
        ).rows[0];
      const expect = (condition, message) => {
        if (!condition) throw new Error(message);
      };

      await client.query('begin');
      const before = await snapshot();
      expect(before.registered === 0, 'a fresh database must not contain imported archive records');
      await client.query(
        `insert into public.profiles (id, username, display_name) values ($1, 'archive_publisher', 'Archive Publisher')`,
        [publisher],
      );

      await client.query(importSql);
      const first = await snapshot();
      expect(first.registered === 64 && first.attached === 64, `expected 64 imported records, found ${first.attached}`);
      expect(first.notices === before.notices + 64, 'the import must add exactly 64 notices');
      expect(first.archived === 64, 'every imported notice must be archived, unpinned, undated and owned by the publisher');
      expect(first.published === before.published, 'the import must not publish anything as a current notice');
      expect(first.unchanged === 64 && first.thin === 0, 'every record must carry its full source description');
      expect(
        first.positions === 64 && first.first_position === 1 && first.last_position === 64 && first.sections === 11,
        'records must keep manifest order across the 11 sections',
      );
      expect(
        first.with_period === 11 && first.with_note === 7 && first.institutional === 10,
        'periods, source notes and institutional attribution must be stored as supplied',
      );
      expect(first.itsa_linked === 12, 'the ITSA section must link to the existing ITSA club');
      expect(first.institution_linked === 0, 'institutional sections must not be linked to a club');
      expect(
        first.events === before.events && first.calendar === before.calendar &&
          first.communities === before.communities && first.members === before.members,
        'the import must not create events, calendar entries, organisations or memberships',
      );

      await client.query(importSql);
      const second = await snapshot();
      expect(JSON.stringify(second) === JSON.stringify(first), 'a second run must change nothing');

      // Staff edit one record and delete another; a later run must respect both.
      await client.query('savepoint imported');
      const { rows: picked } = await client.query(
        `select notice_id from public.notice_archive_entries where source_key like $1 || '/%' order by sort_order limit 2`,
        [batch],
      );
      await client.query(`update public.notices set body = 'Reworded by staff after the import.' where id = $1`, [picked[0].notice_id]);
      await client.query(`delete from public.notices where id = $1`, [picked[1].notice_id]);
      await client.query(importSql);
      const third = await snapshot();
      expect(third.registered === 64 && third.attached === 63, 'a deleted record must stay deleted and stay registered');
      expect(third.notices === first.notices - 1, 'a third run must not restore the deleted record');
      expect(third.unchanged === 62, 'a third run must not overwrite the staff edit');
      await client.query('rollback to savepoint imported');

      // Migrations 075 and 077 found no imported records when the history above
      // was applied, so they are replayed here on the real batch.
      const returnFile = '20261112000029_075_return_pccoe_noticeboard_to_archive.sql';
      const datesFile = '20261112000031_077_pccoe_noticeboard_dates.sql';
      let laterSummary = '';
      if (files.includes(returnFile) && files.includes(datesFile)) {
        const returnSql = await readFile(path.join(migrationsDir, returnFile), 'utf8');
        const datesSql = await readFile(path.join(migrationsDir, datesFile), 'utf8');
        for (const [name, sql] of [['075', returnSql], ['077', datesSql]]) {
          expect(
            /c_batch\s+constant text := '([a-z0-9-]+)'/.exec(sql)?.[1] === batch,
            `Migration ${name} must address the batch that migration 073 imports.`,
          );
        }
        // What the batch looks like to every "current" reader, and what its
        // records carry. `current` counts everything that reads published
        // notices: the noticeboard, the latest-notice lists and the home feed.
        const state = async () =>
          (
            await client.query(
              `
              with entries as (
                select e.*, n.id as live_id, n.title, n.body, n.status, n.published_at, n.updated_by
                from public.notice_archive_entries e
                left join public.notices n on n.id = e.notice_id
                where e.source_key like $1 || '/%'
              )
              select
                count(*) filter (where status = 'archived' and published_at is null)::int as archived,
                count(*) filter (where status = 'published')::int as current,
                count(*) filter (where md5(title || chr(10) || body) = source_checksum)::int as unchanged,
                (select count(*)::int from public.campus_feed(50, 0, 'newest') f
                   join public.notice_archive_entries a on a.notice_id = f.id) as in_feed,
                (select count(*)::int from public.notifications) as notifications,
                (select count(*)::int from public.events) as events,
                (select count(*)::int from public.academic_calendar) as calendar,
                count(*) filter (where occurred_on is not null and not date_is_approximate)::int as exact,
                count(occurred_until)::int as ranges,
                count(*) filter (where date_is_approximate)::int as year_only,
                count(*) filter (
                  where date_is_approximate and to_char(occurred_on, 'MM-DD') = '01-01' and occurred_until is null
                )::int as placeholders,
                count(*) filter (where occurred_on is null and period is not null)::int as labelled,
                count(*) filter (where occurred_on is null and period is null)::int as undated,
                count(date_note)::int as noted,
                count(period)::int as with_period,
                greatest(max(occurred_until), max(occurred_on))::text as latest,
                md5(string_agg(
                  source_key || '|' || coalesce(occurred_on::text, '-') || '|' || coalesce(occurred_until::text, '-') || '|' ||
                  date_is_approximate::text || '|' || coalesce(period, '-') || '|' || coalesce(date_note, '-') || '|' ||
                  section_key || '|' || organization || '|' || source_category || '|' || coalesce(source_note, '-') || '|' ||
                  sort_order::text || '|' || source_checksum || '|' || coalesce(title, '-') || '|' || coalesce(body, '-'),
                  chr(10) order by sort_order)) as digest
              from entries
              `,
              [batch],
            )
          ).rows[0];
        const changes = async () =>
          (await client.query('select count(*)::int as n from public.backup_change_log')).rows[0].n;

        const imported = await state();
        expect(imported.archived === 64 && imported.current === 0 && imported.in_feed === 0, 'the import must leave nothing current');
        expect(imported.exact + imported.year_only === 0 && imported.noted === 0, 'the import itself must record no dates');

        // 075. Publish the batch the way it was published on the connected
        // project, let staff save one record, then return the batch.
        const publish = `
          update public.notices n
             set status = 'published', published_at = now() - (e.sort_order - 1) * interval '1 millisecond'
            from public.notice_archive_entries e
           where e.notice_id = n.id and e.source_key like $1 || '/%'`;
        await client.query(publish, [batch]);
        const flooded = await state();
        expect(flooded.current === 64 && flooded.in_feed > 0, 'published, the batch reaches the current feed');
        await client.query('savepoint published');
        await client.query(
          `update public.notices set body = 'Kept current by staff.', updated_by = $2
            where id = (select notice_id from public.notice_archive_entries where source_key like $1 || '/%' order by sort_order limit 1)`,
          [batch, publisher],
        );
        await client.query(returnSql);
        const kept = await state();
        expect(kept.archived === 63 && kept.current === 1, 'a record staff saved while it was published must stay as staff left it');
        expect(kept.unchanged === 63, 'returning records to the archive must not alter their text');
        await client.query('rollback to savepoint published');

        await client.query(returnSql);
        const returned = await state();
        expect(returned.archived === 64 && returned.current === 0 && returned.in_feed === 0, 'every untouched record must return to the archive');
        expect(returned.digest === imported.digest, 'returning the batch must restore exactly what was imported');
        const beforeSecondReturn = await changes();
        await client.query(returnSql);
        expect((await changes()) === beforeSecondReturn, 'a second return must write nothing');

        // 077. Record the dates, twice, then once more over a date that is
        // already there.
        await client.query(datesSql);
        const dated = await state();
        expect(dated.exact === 27 && dated.ranges === 3, `expected 27 exact dates, 3 of them over two days; found ${dated.exact} and ${dated.ranges}`);
        expect(dated.year_only === 7 && dated.placeholders === 7, 'a year alone must be stored as a flagged 1 January and nothing else');
        expect(dated.labelled === 7 && dated.undated === 23, 'a record without a date keeps its period label, or nothing');
        expect(dated.noted === 5 && dated.with_period === 14, 'date notes and period labels must be stored as supplied');
        expect(dated.latest === '2026-03-16', `no date may be later than the last one on the boards; found ${dated.latest}`);
        expect(
          dated.archived === 64 && dated.current === 0 && dated.in_feed === 0 && dated.unchanged === 64,
          'recording dates must not make a record current or alter its text',
        );
        expect(
          dated.notifications === imported.notifications && dated.events === imported.events && dated.calendar === imported.calendar,
          'recording dates must not notify anyone or create events or calendar entries',
        );
        expect(dated.events === before.events && dated.calendar === before.calendar, 'the batch must never create events or calendar entries');

        const beforeSecondDates = await changes();
        await client.query(datesSql);
        const datedAgain = await state();
        expect(datedAgain.digest === dated.digest, 'a second run of the dates must change nothing');
        expect((await changes()) === beforeSecondDates, 'a second run of the dates must write nothing');

        await client.query(
          `update public.notice_archive_entries set occurred_on = '2025-07-22' where source_key = $1 || '/itsa/ai-workshop'`,
          [batch],
        );
        const corrected = await state();
        await client.query(datesSql);
        expect((await state()).digest === corrected.digest, 'a date that is already recorded must never be overwritten');
        laterSummary =
          ' Published and returned: 64 back in the archive, a record saved by staff left alone. ' +
          'Dates: 27 exact, 7 years as flagged placeholders, 30 with none; re-runs wrote nothing and kept an existing date.';
      }

      await client.query('rollback');
      console.log(
        `  \x1b[32m✓\x1b[0m ${first.attached} records imported as archived; second run changed nothing; ` +
          `a staff edit and a staff delete survived a third run.${laterSummary} Rolled back.`,
      );
    } catch (error) {
      await client.query('rollback').catch(() => {});
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
