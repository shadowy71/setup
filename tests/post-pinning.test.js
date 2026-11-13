import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { getCommunityPosts, POST_COLUMNS } from '@/lib/data/feed';
import { MODERATION_VERBS } from '@/lib/constants';
import { settlePostPin } from '@/lib/social/pin-state';

const read = (file) => fs.readFileSync(file, 'utf8');

describe('post pin data contract', () => {
  it('hydrates the existing pin flag without inventing a pin timestamp', () => {
    expect(POST_COLUMNS.split(',').map((column) => column.trim())).toContain('pinned');
    expect(POST_COLUMNS).not.toContain('pinned_at');
  });

  it('keeps pin/unpin in the audited moderation vocabulary', () => {
    expect(MODERATION_VERBS).toContain('pin');
    expect(MODERATION_VERBS).toContain('unpin');
    expect(read('components/posts/PostComposer.js')).not.toMatch(/pinned|pin post/i);
  });

  it('preserves bounded pin-first ordering in the community-scoped query', async () => {
    const orders = [];
    const ranges = [];
    const query = {
      select() { return query; },
      eq() { return query; },
      order(column, options) { orders.push([column, options]); return query; },
      range(from, to) {
        ranges.push([from, to]);
        return Promise.resolve({ data: [], error: null });
      },
    };
    const database = { from: () => query };

    await getCommunityPosts(database, 'community-1', { limit: 20, offset: 20 });

    expect(orders).toEqual([
      ['pinned', { ascending: false }],
      ['created_at', { ascending: false }],
    ]);
    expect(ranges).toEqual([[20, 39]]);
  });

  it('uses the migrated SQL ranking and narrow replica identity, never full-row identity', () => {
    const sql = read('supabase/migrations/20261101000001_038_post_pin_ordering.sql');
    expect(sql).toContain("case when coalesce((meta->>'pinned')::boolean, false) then 1 else 0 end desc");
    expect(sql).toContain('create unique index posts_feed_replica_identity_idx');
    expect(sql).toContain('on public.posts (id, pinned, status)');
    expect(sql).toContain('alter table public.posts replica identity using index posts_feed_replica_identity_idx');
    expect(sql).not.toMatch(/alter\s+table\s+public\.posts\s+replica\s+identity\s+full/i);
    expect(sql).not.toMatch(/grant update[^\n]*pinned/i);
  });
});

describe('optimistic moderator pin confirmation', () => {
  it.each([
    { previous: false, requested: true },
    { previous: true, requested: false },
  ])('settles $requested only after the RPC confirms it', ({ previous, requested }) => {
    const settled = settlePostPin({
      previous,
      requested,
      result: { ok: true, result: { ok: true, pinned: requested } },
    });
    expect(settled).toEqual({ ok: true, pinned: requested, error: null });
  });

  it.each([
    { previous: false, requested: true },
    { previous: true, requested: false },
  ])('rolls back a rejected $requested transition', ({ previous, requested }) => {
    const settled = settlePostPin({
      previous,
      requested,
      result: { ok: false, error: 'Not allowed' },
    });
    expect(settled.ok).toBe(false);
    expect(settled.pinned).toBe(previous);
    expect(settled.error).toBe('Not allowed');
  });

  it('rolls back when a nominal success does not confirm the requested boolean', () => {
    const settled = settlePostPin({ previous: false, requested: true, result: { ok: true, result: {} } });
    expect(settled.ok).toBe(false);
    expect(settled.pinned).toBe(false);
    expect(settled.error).toMatch(/not confirmed/i);
  });

  it('keeps the control on the staff page and invalidates only after confirmation', () => {
    const panel = read('components/moderation/ModerationPanels.js');
    const page = read('app/(shell)/(app)/moderator/page.js');
    expect(panel).toContain('settlePostPin({ previous, requested, result })');
    expect(panel).toContain("feed.invalidate('local', [targetRef])");
    expect(panel.indexOf('settlePostPin({ previous, requested, result })')).toBeLessThan(panel.indexOf("feed.invalidate('local', [targetRef])"));
    expect(page).toContain("focusedPost?.status === 'published'");
    expect(page).toContain('<PostPinControl');
  });
});
