import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ calls: [], fail: false }));
vi.mock('next/cache', () => ({ unstable_cache: (fn) => fn }));
vi.mock('@/lib/supabase/public', () => ({
  getPublicClient: () => ({ from: (table) => {
    state.calls.push(['from', table]);
    const query = {};
    for (const method of ['select', 'eq', 'not', 'neq', 'order', 'in', 'range']) query[method] = (...args) => { state.calls.push([method, ...args]); return query; };
    query.then = (resolve) => resolve(state.fail ? { data: null, error: 'unavailable' } : { data: [], error: null });
    return query;
  } }),
}));
const { listPublicClubs, getPublicClubIdentities } = await import('@/lib/data/public');
const id = '15fe0000-0000-4000-a000-000000000001';

describe('Explore public catalogue queries', () => {
  beforeEach(() => { state.calls = []; state.fail = false; });
  it('queries bounded public clubs with real recruitment information', async () => {
    await listPublicClubs({ order: 'name', limit: 8, hasRecruitment: true });
    expect(state.calls).toContainEqual(['eq', 'kind', 'club']);
    expect(state.calls).toContainEqual(['eq', 'status', 'published']);
    expect(state.calls).toContainEqual(['eq', 'visibility', 'public']);
    expect(state.calls).toContainEqual(['not', 'recruitment_info', 'is', null]);
    expect(state.calls).toContainEqual(['neq', 'recruitment_info', '']);
    expect(state.calls).toContainEqual(['range', 0, 7]);
  });
  it('fetches only public event hosts in one bounded anonymous query', async () => {
    await getPublicClubIdentities([id, id, 'invalid']);
    expect(state.calls).toContainEqual(['in', 'id', [id]]);
    expect(state.calls.filter((call) => call[0] === 'from')).toHaveLength(1);
    expect(state.calls).toContainEqual(['eq', 'visibility', 'public']);
    expect(state.calls).toContainEqual(['eq', 'status', 'published']);
    state.calls = [];
    expect(await getPublicClubIdentities(['invalid'])).toEqual({ items: [], unavailable: false });
    expect(state.calls).toEqual([]);
  });
  it('returns an unavailable state instead of caching a failed read', async () => {
    state.fail = true;
    expect((await getPublicClubIdentities([id])).unavailable).toBe(true);
    expect((await listPublicClubs({ hasRecruitment: true })).unavailable).toBe(true);
  });
});
