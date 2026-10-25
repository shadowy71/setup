/**
 * Bounded, concurrency-safe backup run orchestration.
 *
 * Pure orchestration: every I/O dependency (the store, the Drive client, the
 * sealer and the two unit runners) is injected, so this module can be tested
 * without network access or credentials. It is used by BOTH the protected cron
 * endpoints and the admin-authorized server action, and both paths take the
 * same database lease — a cron tick and an admin click can never run the same
 * kind of backup concurrently.
 *
 * One "unit" is exactly one `runBackupWorker()` / `createSnapshot()` call, each
 * of which claims ONE durable job and (for incremental) ONE ordered batch. A
 * run is bounded by a unit count AND a wall-clock deadline so it always fits
 * inside a Vercel function's 60s budget. Queued jobs are never deleted: they
 * are claimed and only marked done after verification (or after a unit finds
 * there is genuinely no work left for them). A failed unit stops the run, is
 * reported with its backoff, and leaves all untouched jobs pending.
 */

import { BACKUP_DEFAULTS } from './constants.js';
import { createSnapshot } from './snapshot.js';
import { runBackupWorker } from './worker.js';

/** Bounds for a UI-triggered run and for a scheduled cron tick. */
export const PROCESS_LIMITS = {
  admin: {
    incremental: { maxUnits: 12, leaseSeconds: 180, deadlineMs: 45000 },
    snapshot: { maxUnits: 1, leaseSeconds: 300, deadlineMs: 45000 },
  },
  cron: {
    incremental: { maxUnits: 4, leaseSeconds: 180, deadlineMs: 45000 },
    snapshot: { maxUnits: 1, leaseSeconds: 300, deadlineMs: 45000 },
  },
};

const DEFAULT_WORKER_ID = (kind) => `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

/**
 * Turn a technical failure into a short, user-safe diagnostic. Raw exception
 * text can contain Drive URLs, bearer tokens, connection strings or key ids;
 * none of that is ever returned to the browser. Known conditions get a stable
 * code and actionable wording; everything else is redacted and truncated.
 */
const KNOWN = [
  [/no active admin google drive connection/i, 'drive_not_connected', 'Google Drive is not connected. Connect it from Admin → Backups first.'],
  [/restricted folder|not marked as a restricted/i, 'folder_not_private', 'The Drive folder is not marked private. Reconnect Google Drive.'],
  [/GOOGLE_DRIVE_CLIENT/i, 'oauth_not_configured', 'The Drive OAuth client is not configured on the server.'],
  [/BACKUP_ENCRYPTION_KEY/i, 'encryption_not_configured', 'The backup encryption key is not configured on the server.'],
  [/BACKUP_DATABASE_URL/i, 'database_url_missing', 'BACKUP_DATABASE_URL is not configured. A full snapshot needs a direct Postgres connection.'],
  [/SUPABASE_SECRET_KEY|NEXT_PUBLIC_SUPABASE_URL/i, 'service_role_not_configured', 'The server-side Supabase service configuration is incomplete.'],
  [/verification failed|could not be verified/i, 'verification_failed', 'The uploaded object could not be verified by downloading it again. Nothing was marked successful.'],
  [/credential|refresh token|decrypt/i, 'credential_error', 'The stored Drive credential could not be used. Reconnect Google Drive.'],
  [/table catalogue is empty/i, 'catalogue_empty', 'The snapshot table catalogue is empty. Re-run backup_sync_triggers().'],
];

/** Strip anything that could carry a secret before showing an error in the UI. */
export function redactDiagnostic(value) {
  return String(value === null || value === undefined ? '' : (value?.message || value))
    .replace(/[\r\n]+/g, ' ')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]')
    .trim()
    .slice(0, 300);
}

export function safeDiagnostic(value, fallbackCode = 'backup_failed') {
  const raw = String(value === null || value === undefined ? '' : (value?.message || value));
  for (const [pattern, code, message] of KNOWN) {
    if (pattern.test(raw)) return { code, message };
  }
  const redacted = redactDiagnostic(raw);
  return {
    code: fallbackCode,
    message: redacted
      ? `Backup step failed: ${redacted}`
      : 'Backup step failed. Check the server logs for details.',
  };
}

/** Compact, secret-free view of one unit's result for the admin UI. */
function publicResult(result) {
  const item = {
    status: result?.status || 'failed',
    jobId: result?.jobId || null,
    batchId: result?.batchId || null,
    snapshotId: result?.snapshotId || null,
    rangeKey: result?.rangeKey || null,
    eventCount: Number(result?.eventCount) || 0,
    rowCount: Number(result?.rowCount) || 0,
    watermark: Number(result?.watermark) || 0,
    fileId: result?.fileId || null,
    sha256: result?.sha256 || null,
    reuse: Boolean(result?.reused),
    retryDelaySeconds: Number(result?.retryDelaySeconds) || 0,
  };
  if (result?.status === 'failed') item.diagnostic = safeDiagnostic(result.error, 'batch_failed');
  return item;
}

export function summarizeRun(kind, results, { status: forcedStatus = null } = {}) {
  const verified = results.filter((result) => result.status === 'verified');
  const failed = results.filter((result) => result.status === 'failed');
  const drained = results.filter((result) => result.status === 'idle' && result.jobId);
  const idle = results.filter((result) => result.status === 'idle' && !result.jobId);
  const retryDelaySeconds = Math.max(0, ...failed.map((result) => Number(result.retryDelaySeconds) || 0));

  let status = forcedStatus;
  if (!status) {
    if (failed.length) status = 'failed';
    else if (verified.length) status = 'verified';
    else if (drained.length) status = 'drained';
    else status = 'idle';
  }

  const diagnostics = failed.map((result) => safeDiagnostic(result.error, 'batch_failed'));
  let message;
  if (status === 'failed') {
    message = `${failed.length} ${kind} batch${failed.length === 1 ? '' : 'es'} failed. `
      + (retryDelaySeconds ? `Automatic retry is available in about ${retryDelaySeconds}s. ` : '')
      + 'Any untouched queued jobs are still pending — they were not marked successful.';
  } else if (status === 'verified') {
    message = `${verified.length} ${kind} ${verified.length === 1 ? 'object' : 'objects'} uploaded and verified in the restricted Drive folder.`
      + (drained.length ? ` ${drained.length} queued job(s) had no remaining changes.` : '')
      + (idle.length ? ' The queue is now drained.' : ' Click again to continue if work remains.');
  } else if (status === 'drained') {
    message = `No pending changes. ${drained.length} queued job(s) completed with nothing to export.`;
  } else {
    message = 'Nothing to do — no queued jobs and no pending changes.';
  }

  return {
    ok: status !== 'failed',
    status,
    kind,
    processed: results.length,
    verified: verified.length,
    failed: failed.length,
    drainedJobs: drained.length,
    retryDelaySeconds,
    diagnostics,
    objects: verified.map((result) => ({
      fileId: result.fileId || null,
      sha256: result.sha256 || null,
      rangeKey: result.rangeKey || null,
      watermark: Number(result.watermark) || 0,
      eventCount: Number(result.eventCount) || 0,
      rowCount: Number(result.rowCount) || 0,
    })),
    results: results.map(publicResult),
    message,
  };
}

/**
 * Run up to `maxUnits` units of one kind under a single database lease.
 * Never throws for an expected operational failure: those become a summary
 * with a safe diagnostic. Throws only for programmer/setup errors.
 */
export async function processBackupRun({
  kind = 'incremental',
  store,
  drive,
  seal,
  folderId,
  limits = {},
  workerId = DEFAULT_WORKER_ID(kind),
  acquireRunLease = null,
  releaseRunLease = null,
  runWorker = runBackupWorker,
  runSnapshot = createSnapshot,
  now = () => Date.now(),
  logger = null,
} = {}) {
  if (kind !== 'incremental' && kind !== 'snapshot') {
    return { ...summarizeRun(kind, [], { status: 'failed' }), code: 'invalid_kind', message: 'Unknown backup kind.' };
  }
  if (!store) throw new Error('processBackupRun requires a store');

  const base = PROCESS_LIMITS.admin[kind];
  const maxUnits = Math.max(1, Math.min(24, Number(limits.maxUnits ?? base.maxUnits) || 1));
  const leaseSeconds = Math.max(30, Math.min(900, Number(limits.leaseSeconds ?? base.leaseSeconds) || 180));
  const deadlineMs = Math.max(1000, Math.min(120000, Number(limits.deadlineMs ?? base.deadlineMs) || 45000));
  const deadline = now() + deadlineMs;

  const acquire = acquireRunLease
    || (() => store.acquireRunLease({ kind, workerId, leaseSeconds }));
  const release = releaseRunLease
    || (() => store.releaseRunLease({ kind, workerId }));

  let acquired = false;
  try {
    acquired = Boolean(await acquire({ kind, workerId, leaseSeconds }));
  } catch (error) {
    const diagnostic = safeDiagnostic(error, 'lease_unavailable');
    logger?.warn?.(`[backup] could not acquire the ${kind} lease: ${diagnostic.code}`);
    return {
      ...summarizeRun(kind, [], { status: 'failed' }),
      code: diagnostic.code,
      message: `Could not start a backup run: ${diagnostic.message}`,
      diagnostics: [diagnostic],
    };
  }

  if (!acquired) {
    return {
      ...summarizeRun(kind, [], { status: 'idle' }),
      status: 'busy',
      ok: true,
      code: 'busy',
      message: `A ${kind} backup run is already in progress. No new job was queued; refresh in a moment to see its result.`,
      diagnostics: [],
    };
  }

  try {
    const results = [];
    for (let i = 0; i < maxUnits && now() < deadline; i += 1) {
      const unit = kind === 'snapshot'
        ? await runSnapshot({ store, drive, seal, folderId, workerId })
        : await runWorker({
          store,
          drive,
          seal,
          folderId,
          workerId,
          batchSize: BACKUP_DEFAULTS.batchSize,
          leaseSeconds: BACKUP_DEFAULTS.leaseSeconds,
        });
      const result = unit || { status: 'failed', error: 'empty worker result' };
      results.push(result);
      // A failure stops the run: the batch keeps its backoff, untouched jobs
      // stay pending, and nothing is silently reported as successful.
      if (result.status === 'failed') break;
      // `idle` with a jobId means an empty queued job was completed; keep going
      // so a backlog of empty jobs (e.g. 12 stuck requests) is actually drained.
      if (result.status === 'idle' && !result.jobId) break;
      if (result.status !== 'verified' && result.status !== 'idle') break;
    }
    return summarizeRun(kind, results, { status: null });
  } catch (error) {
    // An unexpected throw (Drive client construction, network, decryption).
    // The units already verified keep their durable state; anything unclaimed
    // stays pending. Only a redacted diagnostic reaches the browser.
    const diagnostic = safeDiagnostic(error, 'run_failed');
    logger?.warn?.(`[backup] ${kind} run aborted: ${diagnostic.code}`);
    const summary = summarizeRun(kind, [], { status: 'failed' });
    return {
      ...summary,
      code: diagnostic.code,
      message: `Backup run stopped: ${diagnostic.message} Verified objects are safe; unfinished jobs remain queued.`,
      diagnostics: [diagnostic],
    };
  } finally {
    try {
      await release({ kind, workerId });
    } catch (error) {
      // The lease expires on its own; never turn a successful run into a
      // reported failure just because the release RPC hiccuped.
      logger?.warn?.(`[backup] could not release the ${kind} lease: ${error?.message || error}`);
    }
  }
}
