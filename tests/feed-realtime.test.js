import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

import { authenticateRealtime, feedChannelTopic, subscribeToFeedPosts } from '@/lib/social/realtime';

/**
 * The delivery half of the fix: how an open feed learns that somebody else
 * published something.
 *
 * A Realtime payload for `posts` is a raw table row — no author block, no poll
 * options, no viewer reaction state — so the contract these tests pin is a narrow
 * one: the subscriber's own private channel, the three events that matter, an
 * id-and-kind signal handed to the surface, and a teardown that actually tears
 * down. Anything wider would either leak a row the student could not have fetched
 * or render a half-populated card.
 */

const PROFILE_ID = '15fe0000-0000-4000-a000-000000000001';
const POST_ID = '15fe0000-0000-4000-b000-000000000001';

const read = (file) => fs.readFileSync(file, 'utf8');

function fakeChannel() {
  const channel = {
    bindings: [],
    subscribed: null,
    statusCallbacks: [],
    on(_type, config, handler) {
      channel.bindings.push({ type: _type, config, handler });
      return channel;
    },
    subscribe(callback) {
      channel.subscribed = callback;
      return channel;
    },
  };
  return channel;
}

function fakeClient(channel = fakeChannel()) {
  return {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
    channels: [channel],
    realtime: { setAuth: vi.fn() },
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } }, error: null })) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the feed channel', () => {
  it("is named after the subscriber's own profile id", () => {
    expect(feedChannelTopic(PROFILE_ID)).toBe(`feed:${PROFILE_ID}`);
    // The profile id, never the auth uid: the authorization policy in migration 029
    // compares the topic against `current_profile_id()`.
    expect(feedChannelTopic(PROFILE_ID)).not.toContain('user:');
  });

  it('is a private channel, so Realtime checks authorization before joining', () => {
    const client = fakeClient();

    subscribeToFeedPosts(client, PROFILE_ID, {});

    expect(client.channel).toHaveBeenCalledTimes(1);
    expect(client.channel.mock.calls[0][0]).toBe(`feed:${PROFILE_ID}`);
    expect(client.channel.mock.calls[0][1]).toEqual({ config: { private: true } });
  });

  it('binds the three post events once, and filters updates to publication state', () => {
    const client = fakeClient();

    subscribeToFeedPosts(client, PROFILE_ID, {});

    const bindings = client.channels[0].bindings;
    expect(bindings.every((binding) => binding.type === 'postgres_changes')).toBe(true);
    expect(bindings.map((binding) => binding.config)).toEqual([
      { event: 'INSERT', schema: 'public', table: 'posts' },
      { event: 'UPDATE', schema: 'public', table: 'posts', filter: 'status=neq.published' },
      { event: 'DELETE', schema: 'public', table: 'posts' },
    ]);
    // One table, bound three ways — and not one more. The feed fix must not widen
    // what Realtime streams, so no private table may appear in a binding or a filter.
    const bound = bindings.map((binding) => binding.config.table);
    expect(bound).toEqual(['posts', 'posts', 'posts']);
    const tables = [...read('lib/social/realtime.js').matchAll(/table: '([a-z_]+)'/g)].map((m) => m[1]);
    expect([...new Set(tables)]).toEqual(['posts']);
  });

  it('hands the surface only an id, an event kind and a status', () => {
    const client = fakeClient();
    const changes = [];

    subscribeToFeedPosts(client, PROFILE_ID, { onPostChange: (event) => changes.push(event) });
    const [insert, update, removed] = client.channels[0].bindings;
    insert.handler({
      new: {
        id: POST_ID,
        status: 'published',
        body: 'private-ish text',
        author_id: 'someone',
        deleted_at: null,
      },
    });
    update.handler({ new: { id: POST_ID, status: 'hidden' } });
    // A hard delete carries only the primary key, which is all an invalidation needs.
    removed.handler({ old: { id: POST_ID } });

    expect(changes).toEqual([
      { eventType: 'INSERT', postId: POST_ID, status: 'published' },
      { eventType: 'UPDATE', postId: POST_ID, status: 'hidden' },
      { eventType: 'DELETE', postId: POST_ID, status: null },
    ]);
    // No row content crosses the boundary, so nothing can render an unaugmented
    // record and no field the reader could not have fetched arrives either.
    expect(JSON.stringify(changes)).not.toContain('private-ish text');
  });

  it('ignores an event with no id, rather than invalidating on a guess', () => {
    const client = fakeClient();
    const onPostChange = vi.fn();

    subscribeToFeedPosts(client, PROFILE_ID, { onPostChange });
    client.channels[0].bindings[0].handler({ new: { status: 'published' } });
    client.channels[0].bindings[2].handler({ old: null });

    expect(onPostChange).not.toHaveBeenCalled();
  });

  it("does not need a filter on INSERT: visibility is RLS's job", () => {
    const client = fakeClient();

    subscribeToFeedPosts(client, PROFILE_ID, {});

    expect(client.channels[0].bindings[0].config.filter).toBeUndefined();
    expect(client.channels[0].bindings[1].config.filter).toBe('status=neq.published');
  });

  it('reports status changes to the caller so a surface can degrade, not break', () => {
    const client = fakeClient();
    const onStatus = vi.fn();

    subscribeToFeedPosts(client, PROFILE_ID, { onStatus });
    client.channels[0].subscribed('SUBSCRIBED');
    client.channels[0].subscribed('CHANNEL_ERROR', new Error('socket closed'));

    expect(onStatus.mock.calls[0][0]).toBe('SUBSCRIBED');
    expect(onStatus.mock.calls[1][0]).toBe('CHANNEL_ERROR');
  });

  it('tears the channel down once, and stops calling back after teardown', () => {
    const client = fakeClient();
    const onPostChange = vi.fn();
    const onStatus = vi.fn();

    const cleanup = subscribeToFeedPosts(client, PROFILE_ID, { onPostChange, onStatus });
    cleanup();
    cleanup();
    cleanup();

    expect(client.removeChannel).toHaveBeenCalledTimes(1);
    client.channels[0].bindings[0].handler({ new: { id: POST_ID, status: 'published' } });
    client.channels[0].subscribed('CLOSED');
    expect(onPostChange).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('does nothing without a signed-in profile, and still returns a cleanup', () => {
    const client = fakeClient();

    const cleanup = subscribeToFeedPosts(client, null, {});
    cleanup();

    expect(client.channel).not.toHaveBeenCalled();
    expect(client.removeChannel).not.toHaveBeenCalled();
    expect(cleanup).toBeTypeOf('function');
    expect(subscribeToFeedPosts(null, PROFILE_ID, {})).toBeTypeOf('function');
  });
});

describe('session hand-off to Realtime', () => {
  it('sets the auth token from the browser session before a channel is trusted', async () => {
    const client = fakeClient();

    await expect(authenticateRealtime(client)).resolves.toBe(true);
    expect(client.realtime.setAuth).toHaveBeenCalledWith('tok');
  });

  it('fails closed with no session, so a channel is never joined anonymously', async () => {
    const client = fakeClient();
    client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(authenticateRealtime(client)).resolves.toBe(false);
    expect(client.realtime.setAuth).not.toHaveBeenCalled();

    client.auth.getSession.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(authenticateRealtime(client)).resolves.toBe(false);

    await expect(authenticateRealtime(null)).resolves.toBe(false);
  });
});

describe('the subscription lives in the shell, never in a card', () => {
  const surfaces = [
    'components/posts/PostCard.js',
    'components/posts/PostActions.js',
    'components/home/StreamItem.js',
    'components/home/HomeFeedClient.js',
  ];

  it.each(surfaces)('%s creates no channel of its own', (file) => {
    const source = read(file);

    expect(source).not.toMatch(/\.channel\(/);
    expect(source).not.toMatch(/subscribeToFeedPosts|postgres_changes/);
  });

  it('has exactly one call site, in the shell provider', () => {
    const files = [
      'components/layout/LiveFeedProvider.js',
      'components/social/LiveFeedSync.js',
      'components/home/HomeFeedClient.js',
      'components/posts/PostComposer.js',
    ];
    const callSites = files.filter((file) => read(file).includes('subscribeToFeedPosts(client'));

    expect(callSites).toEqual(['components/layout/LiveFeedProvider.js']);
  });

  it('authorizes the channel before subscribing, and authenticates once per mount', () => {
    const source = read('components/layout/LiveFeedProvider.js');
    const authenticatedAt = source.indexOf('await authenticateRealtime(client)');
    const subscribedAt = source.indexOf('subscribeToFeedPosts(client');

    expect(authenticatedAt).toBeGreaterThan(-1);
    expect(subscribedAt).toBeGreaterThan(authenticatedAt);
    // A reconnect replays what the channel missed: the seen-set is cleared and the
    // surfaces are told to re-read, so a post published mid-disconnect is not lost.
    expect(source).toMatch(/if \(next === 'SUBSCRIBED'\)[\s\S]*?deduper\.clear\(\);[\s\S]*?queue\('reconcile'\)/);
    expect(source).toMatch(/onAuthStateChange[\s\S]*?SIGNED_OUT[\s\S]*?removeChannel\?\.\(\)/);
    expect(source).toMatch(/return \(\) => \{\s*\n\s*cancelled = true;\s*\n\s*removeChannel\?\.\(\);\s*\n\s*authSubscription\?\.unsubscribe\(\);/);
  });

  it('does not poll while the channel is live', () => {
    const source = read('components/layout/LiveFeedProvider.js');

    // The slow interval is a gap-recovery path with an explicit live-status guard,
    // not a refresh timer: `live` feeds never tick.
    expect(source).toMatch(
      /if \(\['live', 'signed-out', 'unconfigured'\]\.includes\(statusRef\.current\)\) return;/,
    );
    expect(source.match(/setInterval/g)).toHaveLength(1);
    // …and it never re-fetches posts itself; it only invalidates.
    expect(source).not.toMatch(/fetch\(/);
    expect(source).not.toMatch(/\.from\('posts'\)/);
  });
});

describe('no privileged client reaches the browser, and no extra table is exposed', () => {
  const clientFiles = [
    'components/layout/LiveFeedProvider.js',
    'components/social/LiveFeedSync.js',
    'components/home/HomeFeedClient.js',
    'components/posts/PostComposer.js',
    'components/posts/PostActions.js',
    'lib/social/realtime.js',
    'lib/social/feed-state.js',
  ];

  // Comments explain the boundary in the same words the boundary forbids, so the
  // check runs against the code only.
  const code = (file) => read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*--.*$/gm, '');

  it.each(clientFiles)('%s uses only the browser client', (file) => {
    const source = code(file);

    expect(source).not.toMatch(/SERVICE_ROLE|service_role|service-role/);
    expect(source).not.toMatch(/createClient\(/);
    expect(source).not.toMatch(/SUPABASE_SECRET|DATABASE_URL/);
    expect(source).not.toMatch(/process\.env\[/);
    // Whatever client it uses is the browser one, handed down by the shell.
    if (source.includes('getBrowserClient')) expect(source).toMatch(/getBrowserClient\(\)/);
    expect(source).not.toMatch(/supabase\.js.*key|legacyAnonKey/);
  });

  it('adds the publication and channel policy in one narrow migration', () => {
    const file = 'supabase/migrations/20261026000001_029_feed_realtime_delivery.sql';
    const migration = read(file);
    const migrationCode = code(file);

    expect(migration).toMatch(/alter publication supabase_realtime add table public\.posts;/);
    // Exactly one table joins the stream.
    const added = [...new Set([...migration.matchAll(/add table ([a-z_.]+)/g)].map((match) => match[1]))];
    expect(added).toEqual(['public.posts']);
    expect(migration).not.toMatch(/add table public\.(blocks|poll_votes|reactions|profile_private|audit_logs)/);

    // The channel policy is *replaced* under the name migration 014 already owns,
    // so there is one read policy on realtime.messages rather than a pile of
    // overlapping ones that a later tightening would have to remember.
    expect(migrationCode).toMatch(/drop policy if exists campus_channels_read on realtime\.messages;/);
    expect(migrationCode).toMatch(/create policy campus_channels_read on realtime\.messages\s+for select to authenticated/);
    // …and the only new authority is the feed branch, comparing the topic against
    // the caller's own profile id.
    expect(migrationCode).toMatch(
      /when 'feed' then\s+public\.safe_uuid\(split_part\(realtime\.topic\(\), ':', 2\)\) = public\.current_profile_id\(\)/,
    );
    // The other branches are carried over verbatim: recreating the policy must not
    // narrow chat or the per-user channel the shell already uses.
    for (const branch of ['conversation', 'random', 'user']) {
      expect(migrationCode).toContain(`when '${branch}' then`);
    }
    // Nothing about the *write* policy moves: a student still cannot broadcast on a
    // feed channel, which is why the feed change has to be a database fact.
    expect(migrationCode).not.toMatch(/campus_channels_write/);
    // No new grant, no revoked grant, no anon access, no service-role anything.
    expect(migrationCode).not.toMatch(/\bgrant\b/i);
    expect(migrationCode).not.toMatch(/\brevoke\b/i);
    expect(migrationCode).not.toMatch(/service_role/i);
  });
});
