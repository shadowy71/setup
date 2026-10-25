#!/usr/bin/env node
/**
 * Shared disposable-PostgreSQL harness (development tool).
 *
 * Boots a throwaway PostgreSQL cluster, installs the minimal Supabase
 * compatibility surface (auth schema, anon/authenticated/service_role,
 * auth.uid(), PostgREST-style grants), then applies every migration from the
 * single authoritative history in `supabase/migrations/`.
 *
 * Used by:
 *   scripts/dev/validate-migrations.mjs   — apply migrations + run SQL test suites
 *   scripts/dev/audit.mjs                 — catalog-level schema/RLS audit
 *
 * Requires the optional dev dependency:
 *   npm install --no-save embedded-postgres
 */

import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** The one authoritative migration history (Supabase CLI layout). */
export const migrationsDir = path.join(root, 'supabase/migrations');
export const testsDir = path.join(root, 'database/tests');

// ---------------------------------------------------------------------------
// Supabase compatibility surface
// ---------------------------------------------------------------------------
// Production has all of this already; locally we reproduce just enough that the
// migrations and their tests behave the same. Keeping the grants identical
// matters: a missing grant would mask a missing policy.
export const SUPABASE_STUB_SQL = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin noinherit; end if;
end $$;

create schema if not exists auth;
create schema if not exists extensions;
grant usage on schema auth to anon, authenticated, service_role, public;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

-- Mirrors Supabase: reads the sub from either the single claim or the claims blob.
create or replace function auth.uid()
returns uuid
language plpgsql
stable
as $$
begin
  return coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub'
  )::uuid;
exception when others then
  return null;
end;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;

-- PostgREST-style helper used by Supabase projects.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

grant select, insert, update, delete on auth.users to supabase_auth_admin, postgres;

-- PostgREST connects as the authenticator role and switches to anon or
-- authenticated, so those roles hold broad table grants and RLS filters rows.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
`;

/**
 * Realtime compatibility surface.
 *
 * Supabase ships a `realtime` schema whose `messages` table backs Private
 * Broadcast channels, plus `realtime.topic()`. Reproducing it locally is what
 * lets the channel-authorization policies in migration 014 be created *and*
 * tested here instead of only in production.
 *
 * It also maintains the `supabase_realtime` publication, which is the only thing
 * Realtime reads Postgres Changes from. Creating it here means the guarded
 * `alter publication` blocks in the migrations are exercised rather than skipped —
 * a publication the app depends on is exactly the kind of thing that must not be
 * discovered only in production.
 */
export const REALTIME_STUB_SQL = `
create schema if not exists realtime;

do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

create table if not exists realtime.messages (
  id            bigserial primary key,
  topic         text not null,
  extension     text not null default 'broadcast',
  payload       jsonb,
  event         text,
  private       boolean not null default true,
  inserted_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table realtime.messages enable row level security;

-- Supabase: the current channel topic, set by the Realtime server per request.
create or replace function realtime.topic()
returns text
language sql
stable
as $$
  select nullif(current_setting('realtime.topic', true), '');
$$;

grant usage on schema realtime to anon, authenticated, service_role;
grant all on realtime.messages to authenticated, service_role;
grant usage, select on all sequences in schema realtime to authenticated, service_role;
`;

/** Test-only helpers. Never part of the production schema. */
export const TEST_HELPER_SQL = `
create or replace function public.test_assert(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
end;
$$;

create or replace function public.test_assert_denied(p_sql text, p_message text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;  -- denied: expected
  end;
  raise exception 'ASSERTION FAILED (operation was allowed): %', p_message;
end;
$$;

-- Scratch space so a test can hand a real row id to a student and then prove
-- that knowing the id is not enough to reach the row.
create table if not exists public.__test_scratch (
  key text primary key,
  value uuid
);
alter table public.__test_scratch enable row level security;
drop policy if exists __test_scratch_all on public.__test_scratch;
create policy __test_scratch_all on public.__test_scratch
  for all to authenticated using (true) with check (true);
grant all on public.__test_scratch to authenticated, service_role;

grant execute on function public.test_assert(boolean, text) to authenticated, anon, service_role;
grant execute on function public.test_assert_denied(text, text) to authenticated, anon, service_role;
`;

/**
 * Split a SQL file into individual statements, respecting dollar-quoted blocks
 * ($$ … $$, $sql$ … $sql$), string literals and comments. Running statements one
 * at a time is what lets a failing assertion name the exact statement.
 */
export function splitStatements(sql) {
  const statements = [];
  let current = '';
  let dollarTag = null;
  let inSingle = false;
  let inLineComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += char;
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (dollarTag) {
      if (char === '$' && sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
      } else {
        current += char;
      }
      continue;
    }

    if (inSingle) {
      current += char;
      if (char === "'" && next === "'") {
        current += next;
        i += 1;
      } else if (char === "'") {
        inSingle = false;
      }
      continue;
    }

    if (char === '-' && next === '-') {
      inLineComment = true;
      current += char;
      continue;
    }

    if (char === "'") {
      inSingle = true;
      current += char;
      continue;
    }

    if (char === '$') {
      const match = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
    }

    if (char === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

export function banner(text) {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

export async function loadEmbeddedPostgres() {
  try {
    const mod = await import('embedded-postgres');
    return mod.default;
  } catch {
    console.error(
      '\nembedded-postgres is not installed.\n' +
        'Run: npm install --no-save embedded-postgres\n' +
        '(a dev-only dependency; production migrations run with the Supabase CLI)\n'
    );
    process.exit(1);
  }
}

/** Boot a clean cluster and return `{ pg, client }` (client already connected). */
export async function startDatabase({ port = 55432, database = 'campus_plus', dataDirName = 'pg-data' } = {}) {
  const EmbeddedPostgres = await loadEmbeddedPostgres();
  const dataDir = path.join(root, 'node_modules/.cache', dataDirName);
  // Always start from a clean cluster so repeated runs are deterministic.
  await rm(dataDir, { recursive: true, force: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  });

  banner('Starting disposable PostgreSQL…');
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(database);
  const client = pg.getPgClient();
  await client.connect();

  banner('Installing Supabase compatibility surface…');
  await client.query(SUPABASE_STUB_SQL);
  await client.query(REALTIME_STUB_SQL);

  return { pg, client };
}

export async function shutdown(pg, client) {
  if (client) await client.end();
  if (pg) await pg.stop();
}

/** Migration files in authoritative order (lexicographic = timestamp order). */
export async function migrationFiles() {
  return (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
}

/**
 * Apply the migration history. Each file runs in its own transaction, exactly
 * like `supabase db push`, so a failure can never leave a half-applied file.
 * `client.query` sends the whole file as one implicit transaction in this driver.
 */
export async function applyMigrations(client, { onFile } = {}) {
  const files = await migrationFiles();
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    if (onFile) onFile(file);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      error.migrationFile = file;
      error.migrationSql = sql;
      throw error;
    }
  }
  return files;
}

/** Run every SQL suite in database/tests, statement by statement. */
export async function runTestSuites(client, { onSuite } = {}) {
  const { readdir } = await import('node:fs/promises');
  const testFiles = (await readdir(testsDir)).filter((f) => f.endsWith('.sql')).sort();
  const results = [];

  for (const file of testFiles) {
    const sql = await readFile(path.join(testsDir, file), 'utf8');
    if (onSuite) onSuite(file);
    // Each suite starts from a clean session: a suite that ends while still
    // impersonating a student must not leak that role into the next file.
    await client.query('reset role');
    await client.query(
      "select set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false)"
    );
    try {
      for (const statement of splitStatements(sql)) {
        try {
          await client.query(statement);
        } catch (statementError) {
          statementError.failedStatement = statement;
          throw statementError;
        }
      }
      results.push({ file, ok: true });
    } catch (error) {
      results.push({ file, ok: false, error });
    }
  }
  return results;
}
