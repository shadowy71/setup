import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

async function jsFiles(relativeDir) {
  const output = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && /\.(js|jsx|mjs)$/.test(entry.name)) output.push(full);
    }
  }
  await walk(path.join(root, relativeDir));
  return output;
}

// Any module that can reach Drive, hold a credential or build the service-role
// client. `admin-run` is the single admin-only exception, and `endpoints` is the
// protected background-entry core.
const BACKUP_IO_MODULES = /@\/lib\/backup\/(drive|runtime|worker|snapshot|store|oauth|processor|admin-run|endpoints)(\.js)?['"]|from ['"][^'"]*lib\/backup\/(drive|runtime|worker|snapshot|store|oauth|processor|admin-run|endpoints)(\.js)?['"]/;
// Only these modules may import the admin run wiring at all.
const ADMIN_RUN_IMPORTERS = ['lib/actions/backup.js'];
const GOOGLE_CALLS = /www\.googleapis\.com|oauth2\.googleapis\.com|accounts\.google\.com\/o\/oauth2|googleapis/;

describe('normal user writes never wait for Google Drive', () => {
  it('no student-facing lib/actions or lib/data module imports a backup I/O module', async () => {
    const files = [...await jsFiles('lib/actions'), ...await jsFiles('lib/data')];
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      // The admin backup action is the ONE sanctioned exception: it is
      // permission-gated and only runs when a Super Admin clicks a button.
      if (relative === 'lib/actions/backup.js') continue;
      const source = await readFile(file, 'utf8');
      expect(source, relative).not.toMatch(BACKUP_IO_MODULES);
      expect(source, relative).not.toMatch(GOOGLE_CALLS);
    }
  });

  it('only the admin backup action may wire the service-role run, and it returns no secret', async () => {
    const all = [...await jsFiles('lib'), ...await jsFiles('app'), ...await jsFiles('components')];
    const importers = [];
    for (const file of all) {
      const source = await readFile(file, 'utf8');
      if (/lib\/backup\/admin-run(\.js)?['"]/.test(source)) importers.push(path.relative(root, file).replace(/\\/g, '/'));
    }
    expect(importers.sort()).toEqual(ADMIN_RUN_IMPORTERS);

    const actions = await read('lib/actions/backup.js');
    // A service-role key, an OAuth secret or a refresh token must never be
    // reachable from the action's return value.
    expect(actions).not.toMatch(/SUPABASE_SECRET_KEY|GOOGLE_DRIVE_CLIENT_SECRET|refresh_token|credential_ciphertext/);
    expect(actions).toContain('recordBackupRun');
  });

  it('no student app route or component imports the Drive client/background worker', async () => {
    const appRoutes = await jsFiles('app');
    const offenders = [];
    for (const file of appRoutes) {
      const relative = path.relative(root, file).replace(/\\/g, '/');
      if (relative.startsWith('app/api/backup/')) continue; // cron + OAuth routes only
      if (relative === 'app/(app)/admin/page.js') continue; // admin Backups tab
      const source = await readFile(file, 'utf8');
      if (BACKUP_IO_MODULES.test(source) || GOOGLE_CALLS.test(source)) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });

  it('admin actions are permission-gated and never touch Drive directly', async () => {
    const actions = await read('lib/actions/backup.js');
    expect(actions).toContain("'use server'");
    // Every action passes through the same authorization gate first.
    expect(actions.match(/await requireBackupAdmin\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(actions).toContain("can(toActor(user), 'manage_backups')");
    expect(actions).toContain('backup_request_job');
    expect(actions).toContain('backup_retry_failed');
    expect(actions).toContain('backup_disconnect');
    // No Drive client, no raw fetch to Google, no service-role construction here.
    expect(actions).not.toMatch(/DriveClient|createBackupRuntime|createDriveForWorker|www\.googleapis\.com|oauth2\.googleapis\.com/);
    // Authorization precedes the run in the processing action.
    const body = actions.slice(actions.indexOf('export async function processBackupNow'));
    expect(body.indexOf('requireBackupAdmin()')).toBeLessThan(body.indexOf('runAdminBackup('));
  });

  it('only the cron routes and CLI scripts wire the service-role runtime', async () => {
    const all = [...await jsFiles('app'), ...await jsFiles('lib'), ...await jsFiles('scripts'), ...await jsFiles('components')];
    const importers = [];
    for (const file of all) {
      const source = await readFile(file, 'utf8');
      // Aliased ('@/lib/backup/runtime.js') and relative ('./runtime.js') forms.
      if (/from ['"][^'"]*backup\/runtime(\.js)?['"]/.test(source) || /from ['"]\.\/runtime(\.js)?['"]/.test(source)) {
        importers.push(path.relative(root, file).replace(/\\/g, '/'));
      }
    }
    // The service-role runtime is reachable from exactly two production entry
    // points — the protected background core and the permission-gated admin
    // wiring — plus the operator CLI. No page, student route or UI module.
    expect(importers.sort()).toEqual([
      'lib/backup/admin-run.js',
      'lib/backup/endpoints.js',
      'scripts/backup/disconnect.mjs',
      'scripts/backup/restore.mjs',
      'scripts/backup/snapshot.mjs',
      'scripts/backup/verify-restore.mjs',
      'scripts/backup/worker.mjs',
    ].sort());
  });

  it('the capture trigger only writes into the transactional outbox', async () => {
    const sql = await read('supabase/migrations/20261025000001_027_backup_change_capture.sql');
    const start = sql.indexOf('create or replace function public.backup_capture_change()');
    const end = sql.indexOf('end $$;', start);
    const body = sql.slice(start, end);
    expect(body).toContain('insert into public.backup_change_log');
    // Comments may explain that Drive/HTTP is deliberately NOT used; only an
    // actual network call would break the same-transaction guarantee.
    expect(body).not.toMatch(/https?:\/\/|fetch\s*\(|pg_net\.\w+\s*\(|net\.http_post\s*\(|perform\s+http/i);
  });

  it('the SQL suite proves same-transaction capture, rollback and delete tombstones', async () => {
    const suite = await read('database/tests/13_backup_change_capture.sql');
    expect(suite).toMatch(/rollback/i);
    expect(suite).toMatch(/delete/i);
    expect(suite).toMatch(/tombstone|row_data is null/i);
    expect(suite).not.toMatch(/https?:\/\//);
  });

  it('cron schedules exist and stay deployable on Vercel Hobby (once per day)', async () => {
    const vercel = JSON.parse(await read('vercel.json'));
    expect(vercel.crons.map((cron) => cron.path)).toEqual(['/api/backup/worker', '/api/backup/snapshot']);
    // Hobby rejects any expression that resolves to more than one run per day,
    // at deploy time — before the build even starts.
    for (const cron of vercel.crons) {
      expect(cron.schedule, `${cron.path} must be a single daily run`).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
    }
  });

  it('shared constants stay dependency-free so the UI cannot pull in secrets', async () => {
    const constants = await read('lib/backup/constants.js');
    expect(constants).not.toMatch(/^\s*import\s/m);
    expect(constants).not.toContain('fetch(');
  });
});
