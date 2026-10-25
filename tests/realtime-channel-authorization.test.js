import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source contract for the Realtime channel authorization rewrite (migration 030).
 *
 * The production log was 81.5% `42501 permission denied for function
 * can_access_random_session`, about one line every 15 seconds, because the `random`
 * branch of the private-channel policies called a function the subscribing role
 * cannot execute — and the function it called was the one whose optional `p_user`
 * argument can answer "is *this other student* in *that* private session".
 *
 * Two directions therefore have to stay true, and neither is checked by a unit test
 * that only runs SQL: nothing in the client may reach for a retired `random:` channel
 * again, and no policy may call the cross-user helper. `npm run audit:db` reads both
 * from the catalog after the migrations are applied; this file is the cheap guard that
 * fails in the same pull request rather than in production.
 */

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

const MIGRATION_030 = 'supabase/migrations/20261027000001_030_random_channel_authorization.sql';
const MIGRATION_029 = 'supabase/migrations/20261026000001_029_feed_realtime_delivery.sql';

/** Strips comments so an explanatory "we do not do X" note cannot satisfy a regex. */
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

async function javascriptFiles(dir) {
  const out = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await javascriptFiles(relative)));
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(relative);
  }
  return out;
}

describe('migration 030: random channel authorization', () => {
  it('adds a current-user-only predicate instead of widening the oracle', async () => {
    const sql = await read(MIGRATION_030);
    expect(sql).toMatch(/create or replace function public\.can_access_own_random_session\s*\(\s*p_session uuid\s*\)/i);
    // Exactly one argument, and the caller is not one of them.
    expect(sql).not.toMatch(/can_access_own_random_session\s*\(\s*p_session uuid,\s*p_user/i);
    expect(sql).toMatch(/rp\.user_id = public\.current_profile_id\(\)/i);
    expect(sql).toMatch(/and rp\.left_at is null/i);
    // It reads tables a student cannot select from, so it must run as its owner with a
    // pinned search_path, like every other definer function in this schema.
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = public, pg_temp/i);
    expect(sql).toMatch(/and rs\.status = 'active'/i);
  });

  it('grants the narrow predicate explicitly and revokes the oracle from client roles', async () => {
    const sql = await read(MIGRATION_030);
    expect(sql).toMatch(/grant execute on function public\.can_access_own_random_session\(uuid\) to authenticated, service_role/i);
    expect(sql).toMatch(/revoke all on function public\.can_access_own_random_session\(uuid\) from public, anon/i);
    expect(sql).toMatch(/revoke all on function public\.can_access_random_session\(uuid, uuid\) from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.can_access_random_session\(uuid, uuid\) to service_role/i);
    // The forbidden shortcut, spelled out because it is the tempting one.
    expect(sql).not.toMatch(/grant execute on function public\.can_access_random_session[^;]*to authenticated/i);
    expect(sql).not.toMatch(/to anon/i);
  });

  it('routes both channel policies through the safe predicate', async () => {
    const sql = await read(MIGRATION_030);
    const readPolicy = sql.match(/create policy campus_channels_read[\s\S]*?;/i)?.[0] ?? '';
    const writePolicy = sql.match(/create policy campus_channels_write[\s\S]*?;/i)?.[0] ?? '';
    expect(readPolicy).not.toBe('');
    expect(writePolicy).not.toBe('');
    for (const policy of [readPolicy, writePolicy]) {
      expect(policy).toMatch(/when 'random' then\s*\n?\s*public\.can_access_own_random_session\(public\.safe_uuid/i);
      expect(policy).not.toMatch(/[^_]can_access_random_session\(/);
      expect(policy).toMatch(/to authenticated/i);
    }
    expect(readPolicy).toMatch(/for select/i);
    expect(writePolicy).toMatch(/for insert/i);
    // Migration 014's branches and 029's feed branch are carried forward verbatim: this
    // is a substitution, not a rewrite of who may receive what.
    for (const branch of ["'conversation'", "'user'", "'random'"]) {
      expect(readPolicy).toContain(`when ${branch} then`);
      expect(writePolicy).toContain(`when ${branch} then`);
    }
    expect(readPolicy).toContain("when 'feed' then");
    expect(readPolicy).toMatch(/else false/i);
    expect(writePolicy).toMatch(/else false/i);
  });

  it('takes nothing away that migration 023 kept on purpose', async () => {
    const sql = await read(MIGRATION_030);
    // The retired feature's tables, views and moderation access stay: 023 retired the
    // surface, not the data. Only the policy branch and the grants change.
    expect(sql).not.toMatch(/drop (table|view|schema|type)\b/i);
    expect(sql).not.toMatch(/drop policy[^;]*on public\.random/i);
    expect(sql).not.toMatch(/revoke[^;]*on (table|view) public\.random/i);
    // The oracle stays for the SECURITY DEFINER RPCs that were written around it.
    expect(sql).not.toMatch(/drop function\b.*can_access_random_session/i);
    // 029's feed branch must not be narrowed by the recreation.
    const feed = await read(MIGRATION_029);
    expect(feed).toMatch(/when 'feed' then\s*\n?\s*public\.safe_uuid\(split_part\(realtime\.topic\(\), ':', 2\)\) = public\.current_profile_id\(\)/i);
  });

  it('documents the diagnosis it is fixing', async () => {
    const sql = await read(MIGRATION_030);
    expect(sql).toContain('42501');
    expect(sql).toContain('can_access_random_session');
    expect(sql).toMatch(/oracle/i);
    expect(sql).toMatch(/left_at is null|current-user-only/i);
  });
});

describe('client surface: nothing reaches for the retired random channel', () => {
  const dirs = ['app', 'components', 'lib'];

  it('subscribes to conversation, user and feed channels only', async () => {
    const offenders = [];
    const callSites = [];
    for (const dir of dirs) {
      for (const file of await javascriptFiles(dir)) {
        const source = code(await read(file));
        for (const match of source.matchAll(/\.channel\(((?:[^()]|\([^()]*\))*)\)/g)) {
          const topic = match[1];
          callSites.push(`${file}: ${topic.trim()}`);
          if (/random/i.test(topic)) offenders.push(`${file} → ${topic.trim()}`);
          if (!/conversation|user:|feed/.test(topic)) offenders.push(`${file} → unknown topic ${topic.trim()}`);
        }
        if (/[`'"]random:/.test(source)) offenders.push(`${file} → a literal random: topic`);
      }
    }
    // Guard against the scan silently matching nothing, which would make the assertion
    // above vacuously true forever.
    expect(callSites.length).toBeGreaterThanOrEqual(3);
    expect(offenders).toEqual([]);
  });

  it('keeps legitimate Realtime messaging wired up', async () => {
    const messaging = await read('lib/messaging/realtime.js');
    const feed = await read('lib/social/realtime.js');
    expect(messaging).toContain('user:');
    expect(messaging).toContain('conversation:');
    expect(feed).toMatch(/feedChannelTopic|feed:/);
    // A client-side subscribe is `private: true` on every one of these; loosening that
    // would be a bigger change than this fix and is not allowed to sneak in.
    for (const source of [messaging, feed]) {
      for (const match of code(source).matchAll(/\.channel\(((?:[^()]|\([^()]*\))*)\)/g)) {
        expect(match[1]).toContain('private: true');
      }
    }
  });

  it('leaves the retired feature unreferenced from the app', async () => {
    for (const dir of dirs) {
      for (const file of await javascriptFiles(dir)) {
        const source = code(await read(file));
        expect(source, file).not.toMatch(/from ['"][^'"]*actions\/random['"]/);
        expect(source, file).not.toMatch(/\/api\/random/);
      }
    }
    // The Random Chat route stays retired (migration 023).
    await expect(read('app/(app)/random/page.js')).rejects.toBeTruthy();
  });

  it('does not expose the oracle to a client-side query', async () => {
    for (const dir of dirs) {
      for (const file of await javascriptFiles(dir)) {
        const source = code(await read(file));
        expect(source, file).not.toMatch(/can_access_random_session/);
      }
    }
  });
});
