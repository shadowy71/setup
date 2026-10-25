/**
 * Server-side wiring for an ADMIN-AUTHORIZED backup run.
 *
 * This module is imported only by `lib/actions/backup.js` (a `'use server'`
 * action). It is the single place where the service-role Supabase client, the
 * encrypted Drive credential and the encryption key ring are assembled for a
 * UI-triggered run. Nothing from here crosses to the browser: the only value
 * returned is a compact, redacted run summary.
 *
 * Student request paths never import this module. The admin action re-checks
 * `manage_backups` before calling it, and every worker RPC additionally
 * requires the service role.
 */

import { createBackupRuntime, createDriveForWorker } from './runtime.js';
import { PROCESS_LIMITS, processBackupRun, safeDiagnostic } from './processor.js';

const NOT_CONFIGURED = {
  database_url_missing: 'BACKUP_DATABASE_URL is not configured. A full snapshot needs a direct, consistent Postgres session; add it in Vercel → Settings → Environment Variables and redeploy.',
};

/** Compact, secret-free payload persisted to backup_run_log for the admin page. */
export function publicRunRecord(summary) {
  const record = {
    status: summary.status,
    code: summary.code || null,
    processed: summary.processed,
    verified: summary.verified,
    failed: summary.failed,
    drainedJobs: summary.drainedJobs,
    retryDelaySeconds: summary.retryDelaySeconds,
    diagnostics: (summary.diagnostics || []).map((entry) => ({ code: entry.code, message: entry.message })),
    objects: (summary.objects || []).map((entry) => ({
      fileId: entry.fileId, sha256: entry.sha256,
      rangeKey: entry.rangeKey, watermark: entry.watermark,
      eventCount: entry.eventCount, rowCount: entry.rowCount,
    })),
  };
  // Belt and braces: never persist an unexpectedly large structure.
  const json = JSON.stringify(record);
  return json.length > 3500 ? { status: record.status, truncated: true, diagnostics: record.diagnostics.slice(0, 3) } : record;
}

/**
 * Execute one bounded run. The caller (the admin server action) persists the
 * returned summary with the USER's RLS-scoped Supabase client — never with the
 * service-role client — so the audit entry carries the real admin identity and
 * the RPC can re-check `manage_backups`.
 */
export async function runAdminBackup({
  kind = 'incremental',
  env = process.env,
  limits = {},
  logger = null,
} = {}) {
  if (kind !== 'incremental' && kind !== 'snapshot') {
    return { status: 'failed', ok: false, code: 'invalid_kind', message: 'Unknown backup kind.', diagnostics: [], objects: [] };
  }

  try {
    const { config, keyRing, store } = createBackupRuntime({ env });

    // Full snapshots MUST have a direct Postgres URL. `store.readAllTables()`
    // also refuses without it, but checking here gives a clear UI diagnostic
    // instead of a failed snapshot row in the history.
    if (kind === 'snapshot' && !config.databaseUrl) {
      return {
        status: 'not_configured', ok: false, code: 'database_url_missing',
        message: NOT_CONFIGURED.database_url_missing, diagnostics: [], objects: [],
        processed: 0, verified: 0, failed: 0, drainedJobs: 0, retryDelaySeconds: 0,
      };
    }

    const { drive, folderId, seal } = await createDriveForWorker({ store, config, keyRing });
    const summary = await processBackupRun({
      kind,
      store,
      drive,
      seal,
      folderId,
      limits: limits.maxUnits ? limits : PROCESS_LIMITS.admin[kind],
      logger,
    });
    return summary;
  } catch (error) {
    // Runtime/Drive construction errors (missing OAuth client, no connection,
    // undecryptable credential, missing service-role key). Only a redacted,
    // whitelisted diagnostic is returned.
    const diagnostic = safeDiagnostic(error, 'startup_failed');
    logger?.warn?.(`[backup] admin ${kind} run could not start: ${diagnostic.code}`);
    return {
      status: 'failed', ok: false, code: diagnostic.code,
      message: `Could not start the ${kind} backup: ${diagnostic.message}`,
      diagnostics: [diagnostic], objects: [],
      processed: 0, verified: 0, failed: 0, drainedJobs: 0, retryDelaySeconds: 0,
    };
  }
}
