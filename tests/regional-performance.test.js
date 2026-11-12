import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: vi.fn(), server: vi.fn(), events: vi.fn(), rsvps: vi.fn(), options: vi.fn(), slugs: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getCurrentUser: mocks.user }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: mocks.server }));
vi.mock('@/lib/permissions/authorization', () => ({ can: () => false, toActor: () => ({}) }));
vi.mock('@/lib/data/campus', () => ({ listEventSubmissions: vi.fn(), listMyEventSubmissions: vi.fn(), listMyRsvps: mocks.rsvps }));
vi.mock('@/lib/data/public-cache', () => ({ listPublishedEvents: mocks.events }));
vi.mock('@/lib/data/public', () => ({ listPublicClubOptions: mocks.options, mapPublicClubSlugs: mocks.slugs }));

const { default: EventsPage } = await import('@/app/(public)/campus/events/page');
const { getMarketSummary } = await import('@/lib/data/marketplace');

describe('regional performance changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ profile: { id: 'viewer' } });
    mocks.events.mockResolvedValue({ items: [{ id: 'event' }], unavailable: false });
    mocks.rsvps.mockResolvedValue(new Map());
    mocks.slugs.mockResolvedValue(new Map());
    mocks.options.mockResolvedValue({ items: [] });
  });

  it('starts events and viewer-specific RSVP reads without waiting for club options', async () => {
    let finishClubs;
    const clubs = new Promise((resolve) => { finishClubs = resolve; });
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => clubs };
    mocks.server.mockResolvedValue({ from: () => query });
    const page = EventsPage({ searchParams: Promise.resolve({}) });
    await vi.waitFor(() => expect(mocks.rsvps).toHaveBeenCalledOnce());
    expect(mocks.events).toHaveBeenCalledOnce();
    expect(mocks.rsvps).toHaveBeenCalledWith(expect.anything(), ['event'], 'viewer');
    finishClubs({ data: [] });
    await expect(page).resolves.toBeTruthy();
  });

  it('does not read viewer RSVP or private club options for guests', async () => {
    mocks.user.mockResolvedValue(null);
    await expect(EventsPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
    expect(mocks.server).not.toHaveBeenCalled();
    expect(mocks.rsvps).not.toHaveBeenCalled();
    expect(mocks.options).toHaveBeenCalledOnce();
  });

  it('counts only the marketplace values displayed in the header', async () => {
    const tables = [];
    const supabase = { from(table) {
      tables.push(table);
      const q = { select: () => q, in: () => q, eq: () => q, then: (resolve) => resolve({ count: 3 }) };
      return q;
    } };
    await expect(getMarketSummary(supabase)).resolves.toEqual({ active: 3, free: 3, sold: 3 });
    expect(tables).toEqual(['marketplace_listings', 'marketplace_listings', 'marketplace_listings']);
  });
});
