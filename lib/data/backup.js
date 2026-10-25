import 'server-only';

/**
 * Admin-only backup reads. `backup_status()` and `backup_admin_state()` are
 * SECURITY DEFINER functions that re-check `manage_backups` and return
 * aggregates only: no change-log row images, no Drive credentials and no
 * encryption keys ever reach the browser.
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

const EMPTY_ADMIN_STATE = {
  jobs: { queued: 0, processing: 0, verified: 0, failed: 0 },
  jobs_by_kind: {},
  recent_jobs: [],
  batches: {
    uploading: 0, pending: 0, failed: 0, verified: 0,
    retry_waiting: 0, next_retry_at: null,
  },
  snapshots: { running: 0, failed: 0, last_error: null },
  leases: [],
  active: false,
  last_runs: [],
};

const asObject = (value) => {
  if (!value) return null;
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return parsed && typeof parsed === 'object' ? parsed : null;
};

/**
 * Read operator-visible job/batch/lease state. A missing migration 028 is
 * reported as `unavailable` (the page tells the operator to apply it) instead
 * of failing the whole admin screen.
 */
export async function getBackupAdminState(supabase) {
  if (!supabase) return { ...EMPTY_ADMIN_STATE, unavailable: true };
  try {
    const { data, error } = await supabase.rpc('backup_admin_state');
    if (error) return { ...EMPTY_ADMIN_STATE, unavailable: true, error: 'backup_admin_state' };
    return { ...EMPTY_ADMIN_STATE, ...(asObject(data) || {}), unavailable: false };
  } catch {
    return { ...EMPTY_ADMIN_STATE, unavailable: true, error: 'backup_admin_state' };
  }
}

export async function getBackupStatus(supabase) {
  if (!supabase) return { ...EMPTY_STATUS, unavailable: true, admin: { ...EMPTY_ADMIN_STATE, unavailable: true } };
  const { data, error } = await supabase.rpc('backup_status');
  const admin = await getBackupAdminState(supabase);
  if (error) return { ...EMPTY_STATUS, unavailable: true, error: 'backup_status', admin };
  let status;
  try {
    status = asObject(data);
  } catch {
    return { ...EMPTY_STATUS, unavailable: true, error: 'backup_status', admin };
  }
  return { ...EMPTY_STATUS, ...(status || {}), unavailable: false, admin };
}

/**
 * Persist a compact, secret-free run summary using the ADMIN'S OWN client so
 * the audited actor is the real person, not the service role. Best effort: a
 * logging failure must never turn a verified upload into a reported failure.
 */
export async function recordBackupRun(supabase, { kind, status, record }) {
  if (!supabase || !kind || !status) return null;
  try {
    const { error } = await supabase.rpc('backup_record_run', {
      p_kind: kind,
      p_status: status,
      p_record: record,
    });
    return !error;
  } catch {
    return false;
  }
}

/** Presence-only configuration report. Values are never read or rendered. */
export function getBackupConfiguration(env = process.env) {
  const present = (value) => Boolean(typeof value === 'string' && value.trim() && !/^YOUR_|^your_/.test(value.trim()));
  const cronSecret = present(env.CRON_SECRET) || present(env.BACKUP_CRON_SECRET);
  return [
    { key: 'GOOGLE_DRIVE_CLIENT_ID', configured: present(env.GOOGLE_DRIVE_CLIENT_ID), note: 'Existing Drive-only OAuth client (not the student sign-in client).' },
    { key: 'GOOGLE_DRIVE_CLIENT_SECRET', configured: present(env.GOOGLE_DRIVE_CLIENT_SECRET), note: 'Server only; never NEXT_PUBLIC_*.' },
    { key: 'BACKUP_ENCRYPTION_KEYS', configured: present(env.BACKUP_ENCRYPTION_KEYS || env.BACKUP_ENCRYPTION_KEY), note: '32-byte base64 key(s); key_ref:key,key_ref:key for rotation.' },
    { key: 'BACKUP_DATABASE_URL', configured: present(env.BACKUP_DATABASE_URL), note: 'Direct Postgres connection for consistent full snapshots.' },
    { key: 'CRON_SECRET', configured: cronSecret, note: 'Bearer token Vercel Cron sends automatically. BACKUP_CRON_SECRET is a legacy alias; both are accepted.' },
    { key: 'SUPABASE_SECRET_KEY', configured: present(env.SUPABASE_SECRET_KEY), note: 'Service-role client used by the worker (server only).' },
    { key: 'Drive redirect URI', configured: true, note: PRODUCTION_DRIVE_REDIRECT_URI },
  ];
}
