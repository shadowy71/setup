#!/usr/bin/env node
/**
 * `npm run check:env` — configuration audit.
 *
 * Verifies, without contacting the network:
 *   - every variable the app needs is present and not a placeholder,
 *   - no secret value hides in a NEXT_PUBLIC_* variable (it would ship to the
 *     browser bundle),
 *   - `.env.local` is git-ignored,
 *   - the Supabase URL/key shapes look right.
 *
 * Exit code 0 means "safe to boot"; 1 means "something must be fixed first".
 * The app itself still boots with missing keys and shows a setup screen — this
 * script exists so the operator finds out before deploying (spec §92, §115).
 */

import { loadEnv, value, looksLikeSecretKey, banner, ok, bad, warn } from './lib/env.mjs';
import { execFileSync } from 'node:child_process';

const env = await loadEnv();
let failures = 0;

banner('Campus+ environment check');

const checks = [
  {
    key: 'NEXT_PUBLIC_SUPABASE_URL',
    required: true,
    hint: 'Supabase → Project Settings → Data API → Project URL',
    validate: (v) => /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(v) || 'must look like https://<ref>.supabase.co',
  },
  {
    key: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    required: true,
    hint: 'Supabase → Project Settings → API Keys → Publishable key (anon)',
    validate: (v) => (looksLikeSecretKey(v) ? 'this is a service_role/secret key — never expose it to the browser' : true),
  },
  {
    key: 'SUPABASE_SECRET_KEY',
    required: false,
    hint: 'Needed by the maintenance scripts only (seed, roles, security verification).',
    validate: (v) => (looksLikeSecretKey(v) ? true : 'does not look like a secret key (sb_secret_… or service_role JWT)'),
  },
  {
    key: 'CAMPUS_ALLOWED_EMAIL_DOMAINS',
    required: false,
    validate: (v) => (/^[a-z0-9.-]+(,[a-z0-9.-]+)*$/i.test(v) ? true : 'comma-separated domains, e.g. pccoepune.org'),
  },
  {
    key: 'GIPHY_API_KEY',
    required: false,
    hint: 'Optional until you want the GIF picker; becomes required by docs/DEPLOYMENT.md.',
  },
  {
    key: 'GIPHY_CONTENT_RATING',
    required: false,
    validate: (v) => (['g', 'pg', 'pg-13', 'r'].includes(v.toLowerCase()) ? true : 'one of g | pg | pg-13 | r'),
  },
  // Encrypted Drive backups are optional at boot: without them the app runs
  // normally and the admin Backups tab reports the missing configuration.
  {
    key: 'GOOGLE_DRIVE_CLIENT_ID',
    required: false,
    hint: 'Existing Drive-only Google OAuth client (Google Cloud Console → Credentials).',
  },
  {
    key: 'GOOGLE_DRIVE_CLIENT_SECRET',
    required: false,
    hint: 'Server-only secret for the Drive OAuth client; never NEXT_PUBLIC_*.',
  },
  {
    key: 'BACKUP_ENCRYPTION_KEYS',
    required: false,
    hint: 'primary:<base64 32-byte key> (comma-separated key ids for rotation).',
    validate: (v) => {
      const parts = v.split(',').map((part) => part.trim()).filter(Boolean);
      for (const part of parts) {
        const encoded = part.includes(':') ? part.slice(part.indexOf(':') + 1) : part;
        let decoded;
        try { decoded = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); } catch { return 'not valid base64'; }
        if (decoded.length !== 32) return `each key must decode to 32 bytes (got ${decoded.length})`;
      }
      return true;
    },
  },
  {
    key: 'BACKUP_DATABASE_URL',
    required: false,
    hint: 'Direct Postgres connection, required only for consistent full snapshots.',
    validate: (v) => (/^postgres(ql)?:\/\//.test(v) ? true : 'must be a postgresql:// connection string'),
  },
  {
    // Vercel Cron sends ONLY this variable as `Authorization: Bearer <...>`.
    // Preferring BACKUP_CRON_SECRET here caused a 401 on every scheduled run.
    key: 'CRON_SECRET',
    required: false,
    hint: 'Vercel Cron sends this automatically as a Bearer token; also used by /api/backup/worker and /api/backup/snapshot.',
    validate: (v) => (v.length >= 24 ? true : 'use at least 24 random characters'),
  },
  {
    key: 'BACKUP_CRON_SECRET',
    required: false,
    hint: 'Legacy alias, still accepted by the endpoints. Set it to the SAME value as CRON_SECRET or remove it.',
    validate: (v) => (v.length >= 24 ? true : 'use at least 24 random characters'),
  },
];

for (const check of checks) {
  const found = value(env, check.key);
  if (!found) {
    if (check.required) {
      bad(`${check.key} is missing${check.hint ? ` — ${check.hint}` : ''}`);
      failures += 1;
    } else {
      warn(`${check.key} not set${check.hint ? ` — ${check.hint}` : ''}`);
    }
    continue;
  }
  const verdict = check.validate ? check.validate(found) : true;
  if (verdict === true) {
    ok(`${check.key} looks valid`);
  } else {
    bad(`${check.key}: ${verdict}`);
    failures += 1;
  }
}

// A NEXT_PUBLIC_* variable must never hold a secret.
for (const key of Object.keys(env)) {
  if (!key.startsWith('NEXT_PUBLIC_')) continue;
  if (looksLikeSecretKey(value(env, key))) {
    bad(`${key} contains a service-role/secret key; NEXT_PUBLIC_* values are bundled for the browser`);
    failures += 1;
  }
}

// Cron tokens must match. Vercel can only send CRON_SECRET, so a differing
// legacy alias used to make every scheduled invocation return 401.
const primaryCron = value(env, 'CRON_SECRET');
const legacyCron = value(env, 'BACKUP_CRON_SECRET');
if (!primaryCron && !legacyCron) {
  warn('Neither CRON_SECRET nor BACKUP_CRON_SECRET is set — scheduled backup runs will be rejected with 401.');
} else if (!primaryCron && legacyCron) {
  // This exact shape is what made every scheduled run return 401: the endpoints
  // accept the alias, but Vercel Cron only ever sends CRON_SECRET.
  bad('BACKUP_CRON_SECRET is set but CRON_SECRET is not — Vercel Cron can only send CRON_SECRET, so every scheduled run gets 401. Add CRON_SECRET with the same value (and optionally remove the alias).');
  failures += 1;
} else if (primaryCron && legacyCron && primaryCron !== legacyCron) {
  warn('CRON_SECRET and BACKUP_CRON_SECRET differ. Both are accepted, but Vercel Cron only sends CRON_SECRET; set them to the same value to avoid confusion.');
} else {
  ok('cron bearer token configuration is consistent');
}

// Backup secrets must never be duplicated into a browser-exposed variable.
for (const secretName of ['GOOGLE_DRIVE_CLIENT_SECRET', 'BACKUP_ENCRYPTION_KEYS', 'CRON_SECRET', 'BACKUP_CRON_SECRET']) {
  const secret = value(env, secretName);
  if (!secret) continue;
  for (const [key, raw] of Object.entries(env)) {
    if (!key.startsWith('NEXT_PUBLIC_')) continue;
    if (typeof raw === 'string' && raw.includes(secret)) {
      bad(`${key} contains the value of ${secretName}; NEXT_PUBLIC_* values are bundled for the browser`);
      failures += 1;
    }
  }
}

// `.env.local` must be ignored by git before it ever holds a real key.
try {
  const ignored = execFileSync('git', ['check-ignore', '.env.local'], { cwd: process.cwd(), stdio: 'pipe' })
    .toString()
    .trim();
  if (ignored) ok('.env.local is git-ignored');
  else {
    bad('.env.local is NOT git-ignored — remove it from version control before adding real keys');
    failures += 1;
  }
} catch {
  warn('not a git checkout, skipped the .env.local ignore check');
}

if (failures) {
  console.error(`\n${failures} problem${failures === 1 ? '' : 's'} to fix — see docs/DEPLOYMENT.md.\n`);
  process.exit(1);
}
console.log('\nEnvironment looks ready. Start the app with `npm run dev`.\n');
