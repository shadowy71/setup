import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { globalSearch } from '@/lib/search';

/**
 * Search pagination contract.
 *
 * `global_search()` returns rows, not a count. The previous implementation
 * reported `total = rows.length` (the page it had just fetched) and the client
 * used `total > 20` as "there is more", so "Load more" could never appear. The
 * fix is a page-size + 1 probe: if the extra row exists, `hasMore` is true.
 *
 * These tests pin that contract — including the absence of a fabricated total —
 * and the client behaviour that depends on it.
 */

/** Supabase double whose `global_search` returns `count` synthetic rows. */
function searchStub(count, { fail = null } = {}) {
  const calls = [];
  return {
    calls,
    supabase: {
      rpc(name, params) {
        calls.push({ name, params });
        if (fail) return Promise.resolve({ data: null, error: fail });
        const rows = Array.from({ length: count }, (_, index) => ({
          scope: 'posts',
          id: `post-${params.p_offset + index}`,
          title: `Result ${params.p_offset + index}`,
          subtitle: null,
          snippet: 'body',
          url: `/post/post-${params.p_offset + index}`,
          meta: null,
          rank: 1,
        }));
        return Promise.resolve({ data: rows, error: null });
      },
    },
  };
}

const search = (stub, options = {}) =>
  globalSearch(stub.supabase, { query: 'robotics', enforceLimit: false, ...options });

describe('globalSearch pagination', () => {
  it('asks Postgres for one row more than the page', async () => {
    const stub = searchStub(0);
    await search(stub, { limit: 20, offset: 0 });
    expect(stub.calls[0].params).toMatchObject({ p_limit: 21, p_offset: 0, p_scope: 'all' });
  });

  it('reports hasMore when the probe row exists and trims it from the page', async () => {
    const stub = searchStub(21);
    const result = await search(stub, { limit: 20, offset: 0 });
    expect(result.hasMore).toBe(true);
    expect(result.groups[0].items).toHaveLength(20);
    expect(result.groups[0].items.at(-1).id).toBe('post-19');
  });

  it('reports no continuation on a full final page', async () => {
    const stub = searchStub(20);
    const result = await search(stub, { limit: 20, offset: 0 });
    expect(result.hasMore).toBe(false);
    expect(result.groups[0].items).toHaveLength(20);
  });

  it('reports no continuation on a short page', async () => {
    const stub = searchStub(3);
    const result = await search(stub, { limit: 20, offset: 0 });
    expect(result.hasMore).toBe(false);
    expect(result.groups[0].items).toHaveLength(3);
  });

  it('carries the continuation offset through unchanged', async () => {
    const stub = searchStub(7);
    const result = await search(stub, { limit: 20, offset: 40 });
    expect(stub.calls[0].params.p_offset).toBe(40);
    expect(result.offset).toBe(40);
    expect(result.groups[0].items[0].id).toBe('post-40');
  });

  it('never invents a total', async () => {
    const stub = searchStub(21);
    const result = await search(stub, { limit: 20, offset: 0 });
    expect(result).not.toHaveProperty('total');
    // The old bug: total equalled the page length, so `total > 20` was false.
    expect(JSON.stringify(result)).not.toContain('"total"');
  });

  it('clamps the page size to a sane range', async () => {
    const tiny = searchStub(0);
    await search(tiny, { limit: 0 });
    expect(tiny.calls[0].params.p_limit).toBe(21);

    const huge = searchStub(0);
    await search(huge, { limit: 500 });
    expect(huge.calls[0].params.p_limit).toBe(51);

    const negativeOffset = searchStub(0);
    await search(negativeOffset, { offset: -10 });
    expect(negativeOffset.calls[0].params.p_offset).toBe(0);
  });

  it('returns an unavailable shape without a client', async () => {
    const result = await globalSearch(null, { query: 'robotics', enforceLimit: false });
    expect(result).toMatchObject({ groups: [], hasMore: false, unavailable: true });
  });

  it('refuses a term shorter than two characters', async () => {
    const stub = searchStub(0);
    await expect(search(stub, { query: 'a' })).rejects.toThrow(/at least 2/i);
  });
});

describe('SearchResults client contract', () => {
  const source = fs.readFileSync('components/search/SearchResults.js', 'utf8');

  it('drives Load more from hasMore, never from a total', () => {
    expect(source).toContain('payload.hasMore');
    expect(source).not.toMatch(/total\s*>\s*20/);
    expect(source).not.toMatch(/setTotal\(/);
    expect(source).toContain('{canLoadMore && hasResults ? (');
  });

  it('advances the offset by the page size and resets it for a new term', () => {
    expect(source).toContain('const next = offset.current + PAGE_SIZE');
    expect(source).toContain('offset.current = 0');
  });

  it('drops a stale response instead of letting it win', () => {
    expect(source).toContain('const id = ++requestId.current');
    expect(source).toContain('if (id !== requestId.current) return;');
  });

  it('merges continuation pages without duplicating a row', () => {
    expect(source).toContain('const seen = new Set(target.items.map((item) => item.id))');
    expect(source).toContain('if (seen.has(item.id)) continue;');
  });

  it('keeps q and scope in the address without a router navigation', () => {
    expect(source).toContain('window.history.replaceState');
    expect(source).toContain("params.set('q', term)");
    expect(source).toContain("params.set('scope', scope)");
    expect(source).toContain("window.addEventListener('popstate', onPop)");
    expect(source).not.toContain('useRouter');
    expect(source).not.toContain('router.push');
  });

  it('renders only internal links', () => {
    expect(source).toContain("return value.startsWith('/') ? value : '/explore';");
  });
});
