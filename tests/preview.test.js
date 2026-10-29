import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '../next.config.mjs';

afterEach(() => vi.unstubAllEnvs());

describe('local preview backend routing', () => {
  it('only exposes the fixture proxy when explicitly enabled in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_LOCAL_PREVIEW', '1');
    expect(await nextConfig.rewrites()).toEqual([
      { source: '/api/preview-supabase/:path*', destination: 'http://127.0.0.1:3111/:path*' },
    ]);
    vi.stubEnv('NEXT_PUBLIC_LOCAL_PREVIEW', '');
    expect(await nextConfig.rewrites()).toEqual([]);
  });

  it('lets the stub move when the preview proxy owns the default port', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_LOCAL_PREVIEW', '1');
    vi.stubEnv('PREVIEW_BACKEND_ORIGIN', 'http://127.0.0.1:3112');
    expect(await nextConfig.rewrites()).toEqual([
      { source: '/api/preview-supabase/:path*', destination: 'http://127.0.0.1:3112/:path*' },
    ]);
    vi.stubEnv('PREVIEW_BACKEND_ORIGIN', '');
    // Unset falls back to the documented harness port, never to something else.
    expect((await nextConfig.rewrites())[0].destination).toBe('http://127.0.0.1:3111/:path*');
  });

  it('never exposes the fixture proxy in production, even if enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_LOCAL_PREVIEW', '1');
    expect(await nextConfig.rewrites()).toEqual([]);
  });
});
