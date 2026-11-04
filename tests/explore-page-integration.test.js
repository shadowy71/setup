import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), listClubs: vi.fn(), listEvents: vi.fn(), hosts: vi.fn(), rpc: vi.fn(), searchProps: [] }));
vi.mock('@/lib/auth/session', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/data/public', () => ({ listPublicClubs: mocks.listClubs, getPublicClubIdentities: mocks.hosts }));
vi.mock('@/lib/data/public-cache', () => ({ listPublishedEvents: mocks.listEvents }));
vi.mock('@/components/social/LiveFeedSync', () => ({ LiveFeedSync: () => null }));
vi.mock('@/components/search/SearchResults', () => ({ SearchResults: (props) => { mocks.searchProps.push(props); return createElement('div', { 'data-search': props.initialQuery }); } }));
const { default: ExplorePage } = await import('@/app/(app)/explore/page');

describe('existing Explore page integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchProps = [];
    mocks.requireUser.mockResolvedValue({ profile: { id: 'user' } });
    mocks.rpc.mockResolvedValue({ data: [] });
    mocks.listClubs.mockResolvedValue({ items: [], unavailable: false });
    mocks.listEvents.mockResolvedValue({ items: [], unavailable: false });
    mocks.hosts.mockResolvedValue({ items: [], unavailable: false });
  });
  it('retains auth, search, browse and trending while loading bounded public sections', async () => {
    const html = renderToStaticMarkup(await ExplorePage({ searchParams: Promise.resolve({}) }));
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.listClubs).toHaveBeenCalledWith({ order: 'name', limit: 30 });
    expect(mocks.listClubs).toHaveBeenCalledWith({ order: 'name', limit: 8, hasRecruitment: true });
    expect(mocks.listEvents).toHaveBeenCalledWith({ limit: 30, upcoming: true });
    expect(mocks.rpc).toHaveBeenCalledWith('trending_posts', expect.any(Object));
    expect(mocks.searchProps[0].hint).toContain('clubs, events');
    for (const text of ['more happening on campus', 'Clubs worth exploring', 'Recruitment information', 'Upcoming campus events', 'Trending now', 'Browse']) expect(html).toContain(text);
    expect(html).toContain('href="/clubs"');
  });
  it('keeps the existing scoped search mode without fetching browse collections', async () => {
    const html = renderToStaticMarkup(await ExplorePage({ searchParams: Promise.resolve({ q: 'robotics', scope: 'events' }) }));
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.listClubs).not.toHaveBeenCalled();
    expect(mocks.listEvents).not.toHaveBeenCalled();
    expect(mocks.searchProps[0]).toMatchObject({ initialQuery: 'robotics', initialScope: 'events' });
    expect(html).toContain('Results for');
  });
  it('does not read discovery data if the authentication gate rejects', async () => {
    mocks.requireUser.mockRejectedValue(new Error('redirect'));
    await expect(ExplorePage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect');
    expect(mocks.listClubs).not.toHaveBeenCalled();
    expect(mocks.listEvents).not.toHaveBeenCalled();
  });
});
