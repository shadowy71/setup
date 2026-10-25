import 'server-only';

/**
 * Admin-only backup reads. `backup_status()` is a SECURITY DEFINER function that
 * re-checks `manage_backups` and returns aggregates only: no change-log row
 * images, no Drive credentials and no encryption keys ever reach the browser.
 */

import { PRODUCTION_DRIVE_REDIRECT_URI } from '@/lib/backup/constants.js';

const EMPTY_STATUS = {
  connection: null,
  checkpoint: null,
  queue_depth: 0,
  oldest_pending_at: null,
  failed_batches: 0,
  pending_jobs: 0,
  errors: [],
  history: [],
  snapshots: [],
  scope: null,
};

export async function getBackupStatus(supabase) {
  if (!supabase) return { ...EMPTY_STATUS, unavailable: true };
  const { data, error } = await supabase.rpc('backup_status');
  if (error) return { ...EMPTY_STATUS, unavailable: true, error: 'backup_status' };
  const status = typeof data === 'string' ? JSON.parse(data) : data;
  return { ...EMPTY_STATUS, ...(status || {}), unavailable: false };
}

/** Presence-only configuration report. Values are never read or rendered. */
export function getBackupConfiguration(env = process.env) {
  const present = (value) => Boolean(typeof value === 'string' && value.trim() && !/^YOUR_|^your_/.test(value.trim()));
  return [
    { key: 'GOOGLE_DRIVE_CLIENT_ID', configured: present(env.GOOGLE_DRIVE_CLIENT_ID), note: 'Existing Drive-only OAuth client (not the student sign-in client).' },
    { key: 'GOOGLE_DRIVE_CLIENT_SECRET', configured: present(env.GOOGLE_DRIVE_CLIENT_SECRET), note: 'Server only; never NEXT_PUBLIC_*.' },
    { key: 'BACKUP_ENCRYPTION_KEYS', configured: present(env.BACKUP_ENCRYPTION_KEYS || env.BACKUP_ENCRYPTION_KEY), note: '32-byte base64 key(s); key_ref:key,key_ref:key for rotation.' },
    { key: 'BACKUP_DATABASE_URL', configured: present(env.BACKUP_DATABASE_URL), note: 'Direct Postgres connection for consistent full snapshots.' },
    { key: 'BACKUP_CRON_SECRET', configured: present(env.BACKUP_CRON_SECRET || env.CRON_SECRET), note: 'Bearer token protecting the cron endpoints.' },
    { key: 'SUPABASE_SECRET_KEY', configured: present(env.SUPABASE_SECRET_KEY), note: 'Service-role client used by the worker.' },
    { key: 'Drive redirect URI', configured: true, note: PRODUCTION_DRIVE_REDIRECT_URI },
  ];
}
