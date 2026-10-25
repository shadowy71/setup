/**
 * Shared core for the two protected background endpoints.
 *
 * Order matters and is deliberate:
 *   1. bearer-token check FIRST, using every configured cron secret. Vercel
 *      Cron sends `Authorization: Bearer <CRON_SECRET>` and can only send the
 *      variable literally named `CRON_SECRET`; `BACKUP_CRON_SECRET` is kept as
 *      a legacy alias so existing CLI/operator setups keep working. A token
 *      that matches neither is rejected before any secret material, Supabase
 *      client or Drive runtime is constructed.
 *   2. configuration checks, each with a stable machine-readable code so the
 *      response says what is wrong without echoing a value.
 *   3. the bounded run itself.
 *
 * Nothing in here logs a secret, a token, a connection string or a credential.
 * Diagnostics that reach the browser are the whitelisted `{code, message}`
 * pairs from `safeDiagnostic()`.
 */

import { cronSecretCandidates } from './oauth.js';
import { createBackupRuntime, createDriveForWorker, cronAuthorized } from './runtime.js';
import { PROCESS_LIMITS, processBackupRun, safeDiagnostic } from './processor.js';

const UNAUTHORIZED = { status: 401, body: { error: 'unauthorized' } };

function notConfigured(code, message) {
  return { status: 503, body: { status: 'not_configured', code, error: message } };
}

/** Presence only — never returns the value, never logs it. */
function has(env, key) {
  return typeof env[key] === 'string' && env[key].trim().length > 0;
}

export function cronAuthorizationCheck(request, env = process.env) {
  return cronAuthorized(request, cronSecretCandidates(env));
}

/**
 * @returns {Promise<{status: number, body: object}>} a JSON-ready result.
 */
export async function scheduledBackupResponse({
  request,
  kind,
  env = process.env,
  limits = null,
  logger = console,
} = {}) {
  if (!cronAuthorizationCheck(request, env)) return UNAUTHORIZED;

  if (!has(env, 'NEXT_PUBLIC_SUPABASE_URL') || !has(env, 'SUPABASE_SECRET_KEY')) {
    return notConfigured(
      'service_role_not_configured',
      'The backup worker needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the server environment.',
    );
  }
  if (!has(env, 'BACKUP_ENCRYPTION_KEYS') && !has(env, 'BACKUP_ENCRYPTION_KEY')) {
    return notConfigured('encryption_not_configured', 'BACKUP_ENCRYPTION_KEYS is not configured.');
  }
  if (kind === 'snapshot' && !has(env, 'BACKUP_DATABASE_URL')) {
    return notConfigured(
      'database_url_missing',
      'BACKUP_DATABASE_URL is not configured; a consistent full snapshot needs a direct Postgres session.',
    );
  }

  let run;
  try {
    const { config, keyRing, store } = createBackupRuntime({ env });
    const { drive, folderId, seal } = await createDriveForWorker({ store, config, keyRing });
    run = await processBackupRun({
      kind,
      store,
      drive,
      seal,
      folderId,
      workerId: `${kind}-${Date.now()}`,
      limits: limits || PROCESS_LIMITS.cron[kind],
      logger,
    });
  } catch (error) {
    // Startup failures (no Drive connection, undecryptable credential, OAuth
    // client not configured). Only a code + safe sentence leaves the server.
    const diagnostic = safeDiagnostic(error, 'startup_failed');
    logger?.warn?.(`[backup] ${kind} endpoint could not start: ${diagnostic.code}`);
    return {
      status: diagnostic.code === 'drive_not_connected' ? 503 : 500,
      body: { status: 'failed', code: diagnostic.code, error: diagnostic.message },
    };
  }

  const failed = run.status === 'failed';
  return { status: failed ? 500 : 200, body: run };
}
