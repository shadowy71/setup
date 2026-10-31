import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getServerClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  isGiphyConfigured: vi.fn(),
  searchGifs: vi.fn(),
  trendingGifs: vi.fn(),
  can: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: mocks.getServerClient }));
vi.mock('@/lib/ratelimit', () => ({ enforceRateLimit: mocks.enforceRateLimit }));
vi.mock('@/lib/giphy', () => ({
  isGiphyConfigured: mocks.isGiphyConfigured,
  searchGifs: mocks.searchGifs,
  trendingGifs: mocks.trendingGifs,
  GIPHY_ATTRIBUTION: { text: 'Powered by GIPHY', url: 'https://giphy.com' },
}));
vi.mock('@/lib/permissions/authorization', () => ({
  can: mocks.can,
  toActor: (user) => user,
}));

import { GET } from '@/app/api/giphy/search/route';

const request = () => new Request('http://campus.test/api/giphy/search?q=cat');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.can.mockReturnValue(true);
  mocks.isGiphyConfigured.mockReturnValue(true);
  mocks.getServerClient.mockResolvedValue({ rpc: vi.fn() });
  mocks.enforceRateLimit.mockResolvedValue({ allowed: true });
  mocks.searchGifs.mockResolvedValue({ results: [], totalCount: 0 });
});

/**
 * The route used to answer every `AppError` with 500 because the catch block
 * chained `fromPostgresError(error) || error`, and `fromPostgresError()` never
 * returns a falsy value (its own fallback is `errors.internal()`). These pin the
 * status the browser actually sees.
 */
describe('GET /api/giphy/search status mapping', () => {
  it('answers 401 — not 500 — for an anonymous caller', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'unauthenticated' });
  });

  it('answers 403 when the account may not use GIFs', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      profile: { id: 'me', account_status: 'active' },
      needsProfileSetup: false,
    });
    mocks.can.mockReturnValue(false);

    const response = await GET(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'forbidden' });
  });

  it('answers 429 with the bucket message when the rate limit is exhausted', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      profile: { id: 'me', account_status: 'active' },
      needsProfileSetup: false,
    });
    const { errors } = await import('@/lib/errors');
    mocks.enforceRateLimit.mockRejectedValue(
      errors.rateLimited('You have reached the limit for GIF search. Try again in about 1 minute.', {
        retryAfterSeconds: 60,
      }),
    );

    const response = await GET(request());

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'rate_limited' });
  });

  it('still answers 503 when GIPHY is not configured', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      profile: { id: 'me', account_status: 'active' },
      needsProfileSetup: false,
    });
    mocks.isGiphyConfigured.mockReturnValue(false);

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: 'configuration' });
  });
});
