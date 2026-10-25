#!/usr/bin/env node
/**
 * `npm run verify:security` — deployment safety probe.
 *
 * Runs against a *live* Supabase project with the public (anon) key and proves
 * the boring-but-critical properties: anonymous visitors cannot read private
 * tables, cannot call privileged RPCs, and no secret has leaked into a tracked
 * file or into the built browser bundle.
 *
 * This complements `npm run audit:db`, which inspects the migration history
 * offline (policies, privileges, column names). Run both before a release.
 */

import { createClient } from '@supabase/supabase-js';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadEnv, value, requireValue, banner, ok, bad, warn, root, looksLikeSecretKey } from './lib/env.mjs';

const env = await loadEnv();
const url = requireValue(env, 'NEXT_PUBLIC_SUPABASE_URL');
const anonKey = requireValue(env, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
const secretKey = value(env, 'SUPABASE_SECRET_KEY');

let failures = 0;

/**
 * A network failure is NOT a denial. Without this check an unreachable or
 * misspelled Supabase URL made every probe report "denied" and the whole audit
 * falsely passed.
 */
function isTransportError(error) {
  if (!error) return false;
  const text = `${error.message || ''} ${error.code || ''} ${error.name || ''}`.toLowerCase();
  return /fetch failed|failed to fetch|network|enotfound|econnrefused|econnreset|etimedout|timeout|abort|socket|dns|ssl|getaddrinfo/i.test(text);
}

/** A probe passes when the operation is *denied* or returns no rows. */
async function denied(label, run) {
  try {
    const { data, error } = await run();
    if (error) {
      if (isTransportError(error)) {
        bad(`${label} — COULD NOT REACH the project: ${error.message}`);
        failures += 1;
      } else {
        ok(`${label} — denied (${error.code || 'error'})`);
      }
      return;
    }
    const rows = Array.isArray(data) ? data.length : data === null ? 0 : 1;
    if (rows === 0) ok(`${label} — no rows visible`);
    else {
      bad(`${label} — LEAKED ${rows} row(s) to the anonymous key`);
      failures += 1;
    }
  } catch (error) {
    if (isTransportError(error)) {
      bad(`${label} — COULD NOT REACH the project: ${error.message}`);
      failures += 1;
    } else {
      ok(`${label} — denied (${error.message})`);
    }
  }
}

banner('Anonymous (publishable-key) probes');
const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) },
});

// Fail fast with a real deployment URL if the project is unreachable; do not
// spend minutes probing a host that will never answer.
const reachability = await anon.from('profiles').select('*').limit(1);
if (isTransportError(reachability.error)) {
  bad(`Cannot reach ${url}: ${reachability.error.message}. Live security probes need a real Supabase project URL/key.`);
  process.exit(1);
}

const privateTables = [
  'profiles',
  'profile_private',
  'notifications',
  'audit_logs',
  'moderation_actions',
  'reports',
  'blocks',
  'messages',
  'conversations',
  'random_sessions',
  'random_session_participants',
  'random_messages',
  'rate_limits',
  // Migration 027: outbox row images, worker state and connection metadata are
  // all admin/worker-only. Anonymous probes must see no rows.
  'backup_change_log',
  'backup_batches',
  'backup_checkpoints',
  'backup_snapshots',
  'backup_jobs',
  'backup_drive_connections',
  'backup_tracked_tables',
];

for (const table of privateTables) {
  await denied(`anon cannot read ${table}`, () => anon.from(table).select('*').limit(1));
}

await denied('anon cannot read the seller contact note', () =>
  anon.from('marketplace_listings').select('contact_note').limit(1));
await denied('anon cannot call grant_role()', () => anon.rpc('grant_role', { p_user: '00000000-0000-4000-a000-000000000000', p_role: 'admin' }));
await denied('anon cannot call admin_set_account_status()', () =>
  anon.rpc('admin_set_account_status', { p_user: '00000000-0000-4000-a000-000000000000', p_status: 'banned', p_reason: 'probe', p_days: null }));
await denied('anon cannot call consume_rate_limit() as another key', () =>
  anon.rpc('consume_rate_limit', { p_bucket: 'post_create', p_key: 'someone-else', p_limit: 5, p_window_seconds: 60 }));
await denied('anon cannot read backup health', () => anon.rpc('backup_status'));
await denied('anon cannot claim a backup batch', () =>
  anon.rpc('backup_claim_batch', { p_worker_id: 'probe', p_batch_size: 1, p_lease_seconds: 30 }));
await denied('anon cannot read encrypted Drive credentials', () =>
  anon.rpc('backup_private_get_credentials', { p_connection_ref: '00000000-0000-4000-a000-000000000000' }));
await denied('anon cannot enqueue a backup job', () =>
  anon.rpc('backup_request_job', { p_kind: 'snapshot', p_note: 'probe' }));

banner('Repository hygiene');

// No secret may be committed anywhere in tracked files.
try {
  const tracked = execFileSync('git', ['grep', '-nIE', 'sb_secret_[A-Za-z0-9_-]{8,}|service_role":', '--', '.'], {
    cwd: root,
    stdio: 'pipe',
  })
    .toString()
    .trim();
  if (tracked) {
    bad(`a secret-looking value is committed:\n${tracked.split('\n').slice(0, 5).join('\n')}`);
    failures += 1;
  } else {
    ok('no secret key pattern found in tracked files');
  }
} catch {
  ok('no secret key pattern found in tracked files');
}

try {
  const ignored = execFileSync('git', ['check-ignore', '.env.local'], { cwd: root, stdio: 'pipe' }).toString().trim();
  if (ignored) ok('.env.local is git-ignored');
  else {
    bad('.env.local is not git-ignored');
    failures += 1;
  }
} catch {
  warn('skipped the .env.local ignore check (not a git checkout)');
}

if (looksLikeSecretKey(value(env, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'))) {
  bad('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret key');
  failures += 1;
} else {
  ok('the publishable key is not a secret key');
}

// If a production build exists, the secret must not be inside the browser bundle.
async function scanBundle(dir) {
  let hits = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath || entry.path, entry.name);
    if (!/\.(js|json|html|txt)$/.test(entry.name)) continue;
    const text = await readFile(file, 'utf8');
    const secrets = [
      secretKey,
      value(env, 'GIPHY_API_KEY'),
      value(env, 'GOOGLE_DRIVE_CLIENT_SECRET'),
      value(env, 'BACKUP_ENCRYPTION_KEYS'),
      value(env, 'BACKUP_CRON_SECRET'),
      value(env, 'SUPABASE_SECRET_KEY'),
    ].filter(Boolean);
    if (secrets.some((secret) => text.includes(secret))) hits.push(file);
    else if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(text)) hits.push(file);
  }
  return hits;
}

banner('Browser bundle scan');
const bundleHits = await scanBundle(path.join(root, '.next/static'));
if (bundleHits === null) {
  warn('no production build found (.next/static) — run `npm run build` then re-run this script');
} else if (bundleHits.length) {
  bad(`secret values found in the client bundle: ${bundleHits.slice(0, 5).join(', ')}`);
  failures += 1;
} else {
  ok('no secret values in .next/static');
}

if (failures) {
  console.error(`\n${failures} security check${failures === 1 ? '' : 's'} failed.\n`);
  process.exit(1);
}
console.log('\nAll security probes passed.\n');
