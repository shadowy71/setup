/**
 * Backup wire format and Google Drive endpoints (shared, dependency-free).
 *
 * This module is deliberately free of `server-only`, `next/*` and network
 * imports: the worker, the admin routes, the CLI tools and the unit tests all
 * use exactly these same constants.
 */

/** Envelope format version. Bump only with a documented migration path. */
export const BACKUP_FORMAT = 'campus-plus-backup/v1';
export const INCREMENTAL_FORMAT = 'campus-plus-incremental/v1';
export const SNAPSHOT_FORMAT = 'campus-plus-snapshot/v1';

export const ENVELOPE_ALGORITHM = 'AES-256-GCM';
export const ENVELOPE_COMPRESSION = 'gzip';
export const ENVELOPE_SUFFIX = '.cpbe';

/** AAD purposes — a secret can never be decrypted as a backup object. */
export const PURPOSE_BACKUP = 'backup-object';
export const PURPOSE_CREDENTIAL = 'oauth-credential';
export const PURPOSE_VERIFIER = 'oauth-verifier';

/**
 * The EXACT production redirect URI registered on the existing Drive-only
 * Google OAuth client. It is intentionally hard-coded: a typo here produces a
 * `redirect_uri_mismatch` at Google, and a mutable default could silently send
 * a refresh token to the wrong deployment. Local development may override it
 * through BACKUP_DRIVE_REDIRECT_URI, but only outside production (see oauth.js).
 */
export const PRODUCTION_DRIVE_REDIRECT_URI = 'https://pccoe.in/api/backup/drive/callback';
export const DRIVE_CALLBACK_PATH = '/api/backup/drive/callback';
export const DRIVE_CONNECT_PATH = '/api/backup/drive/connect';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_USERINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
export const DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_APP_PROPERTY = 'campusPlusBackup';
export const DRIVE_FOLDER_NAME = 'Campus+ Backups (private)';

/** Only these schemas are backed up. Everything else must be reprovisioned. */
export const SNAPSHOT_SCHEMAS = ['public'];
export const EXCLUDED_SNAPSHOT_SCHEMAS = [
  'auth', 'auth_audit', 'storage', 'realtime', 'supabase_functions',
  'supabase_migrations', 'vault', 'extensions', 'backup_private',
];
export const EXCLUDED_SNAPSHOT_TABLES = [
  'public.backup_change_log', 'public.backup_batches', 'public.backup_checkpoints',
  'public.backup_snapshots', 'public.backup_jobs', 'public.backup_drive_connections',
  'public.backup_tracked_tables',
];
export const DISASTER_RECOVERY_NOTICE =
  'This is an application-data backup of schema public only. It does NOT include Supabase Auth users/sessions/refresh tokens, Storage objects, Realtime configuration, secrets, OAuth provider settings or database roles/grants. A restore is not complete disaster recovery: reprovision those separately.';

export const BACKUP_DEFAULTS = {
  batchSize: 500,
  leaseSeconds: 300,
  maxAttempts: 8,
  baseBackoffSeconds: 30,
  maxBackoffSeconds: 3600,
  keepSnapshots: 14,
  minRetentionAgeDays: 7,
};

/** Deterministic Drive object name for one backup range/snapshot horizon. */
export function backupObjectName(kind, start, end, sha256) {
  const digest = String(sha256 || '').replace(/[^a-f0-9]/gi, '').slice(0, 16);
  if (digest.length < 16) throw new Error('a full SHA-256 digest is required to name a backup object');
  return `${kind}-${start}-${end}-${digest}${ENVELOPE_SUFFIX}`;
}
