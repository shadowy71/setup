import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

const MIGRATION = 'supabase/migrations/20261025000001_027_backup_change_capture.sql';

describe('migration 027: RLS, secret isolation and transactional capture', () => {
  it('uses a durable outbox, not a fire-and-forget HTTP webhook', async () => {
    const sql = await read(MIGRATION);
    expect(sql).toContain('create table public.backup_change_log');
    expect(sql).toContain('after insert or update or delete on');
    expect(sql).toMatch(/insert into public\.backup_change_log/i);
    // A comment may mention pg_net to explain why it is NOT used: only a real
    // HTTP call is forbidden here.
    expect(sql).not.toMatch(/net\.http_post\s*\(|pg_net\.\w+\s*\(|http_post\s*\(/i);
    expect(sql).toMatch(/row_data is null/i);
    expect(sql).toContain('transaction_ref');
  });

  it('enables RLS on every public backup table and denies API roles', async () => {
    const sql = await read(MIGRATION);
    for (const table of [
      'backup_tracked_tables', 'backup_change_log', 'backup_drive_connections',
      'backup_snapshots', 'backup_batches', 'backup_checkpoints', 'backup_jobs',
    ]) {
      expect(sql).toContain(`create table public.${table}`);
    }
    expect(sql).toContain('alter table public.backup_change_log        enable row level security');
    expect(sql).toContain("execute format('revoke all on public.%I from public, anon, authenticated'");
    expect(sql).toContain('revoke select on public.backup_change_log from authenticated');
    expect(sql).toContain('grant select (id, schema_name, table_name, operation, transaction_ref, occurred_at, created_at)');
    expect(sql).not.toMatch(/grant\s+select[^;]*row_data/i);
  });

  it('keeps OAuth flows/credentials encrypted in a private schema with no API grants', async () => {
    const sql = await read(MIGRATION);
    expect(sql).toContain('create schema if not exists backup_private');
    expect(sql).toContain('create table if not exists backup_private.oauth_flows');
    expect(sql).toContain('create table if not exists backup_private.oauth_credentials');
    expect(sql).toContain('revoke all on schema backup_private from public, anon, authenticated');
    expect(sql).toContain('revoke all on backup_private.oauth_credentials from public, anon, authenticated');
    expect(sql).toContain('revoke all on backup_private.oauth_flows from public, anon, authenticated');
    expect(sql).toContain('alter default privileges in schema backup_private revoke all on tables from public, anon, authenticated');
    expect(sql).toMatch(/credential_ciphertext\s+text not null/);
    expect(sql).not.toMatch(/refresh_token\s+text\s*,/i);
  });

  it('restricts worker RPCs to service_role and admin RPCs to manage_backups', async () => {
    const sql = await read(MIGRATION);
    for (const fn of [
      'backup_claim_batch', 'backup_complete_batch', 'backup_fail_batch',
      'backup_private_get_credentials', 'backup_private_rotate_credentials',
      'backup_snapshot_watermark', 'backup_start_snapshot', 'backup_complete_snapshot',
      'backup_prune_change_log', 'backup_claim_job',
    ]) {
      expect(sql).toContain(`public.${fn}(`);
    }
    expect(sql).toMatch(/revoke all on function[\s\S]*from public, anon, authenticated/);
    expect(sql).toContain('to service_role');
    expect(sql).toContain("public.has_permission('manage_backups')");
    expect(sql).toContain('manage_backups');
  });

  it('excludes backup tables from capture to prevent recursion', async () => {
    const sql = await read(MIGRATION);
    expect(sql).toContain("tg_table_name like 'backup%'");
    expect(sql).toContain("c.relname not like 'backup%'");
    expect(sql).toContain('create trigger backup_capture');
    expect(sql).toContain('drop trigger if exists backup_capture');
    expect(sql).toContain('backup_sync_triggers()');
  });

  it('declares that snapshots are not complete disaster recovery', async () => {
    const sql = await read(MIGRATION);
    const constants = await read('lib/backup/constants.js');
    const snapshotCode = await read('lib/backup/snapshot.js');
    expect(constants).toContain('DISASTER_RECOVERY_NOTICE');
    expect(constants).toContain("'auth'");
    expect(snapshotCode).toContain('complete_disaster_recovery: false');
    expect(sql).toContain('manage_backups');
  });
});

describe('secrets never reach the browser', () => {
  it('does not expose backup secrets through NEXT_PUBLIC_* or the admin status reader', async () => {
    const envExample = await read('.env.example');
    const statusReader = await read('lib/data/backup.js');
    const adminPage = await read('app/(app)/admin/page.js');
    const runtime = await read('lib/backup/runtime.js');

    expect(envExample).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(GOOGLE_DRIVE|BACKUP_ENCRYPTION|BACKUP_CRON|BACKUP_DATABASE)/);
    expect(envExample).toContain('https://pccoe.in/api/backup/drive/callback');
    // Environment *key names* appear (presence check only); values, ciphertext
    // and refresh tokens must never be returned.
    expect(statusReader).not.toMatch(/credential_ciphertext|refresh_token|client_secret/);
    expect(statusReader).toContain('configured: present(');
    expect(statusReader).not.toMatch(/value:\s*env\.|return\s+env\./);
    expect(adminPage).toContain('getBackupConfiguration()');
    expect(adminPage).toContain('DISASTER_RECOVERY_NOTICE');
    expect(runtime).toContain('SUPABASE_SECRET_KEY');
    expect(runtime).not.toContain('NEXT_PUBLIC_SUPABASE_SECRET');
  });

  it('keeps the exact callback URL out of student auth code', async () => {
    const authFiles = await Promise.all([
      read('app/auth/callback/route.js'),
      read('lib/auth/oauth.js'),
      read('lib/actions/auth.js'),
    ]);
    for (const file of authFiles) {
      expect(file).not.toMatch(/api\/backup|GOOGLE_DRIVE_CLIENT|drive\.file/i);
    }
  });
});
