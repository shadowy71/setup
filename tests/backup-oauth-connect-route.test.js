import { describe, expect, it, vi } from 'vitest';

// Functional guard: the OAuth start route must reject unauthenticated and
// non-admin callers BEFORE it generates PKCE material or talks to Supabase.
// The Drive OAuth navigation fix must not weaken any of this.
vi.mock('@/lib/auth/session', () => ({ getActiveUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: vi.fn() }));
vi.mock('@/lib/permissions/authorization', () => ({
  can: vi.fn(),
  toActor: (user) => user,
}));

const { GET } = await import('../app/api/backup/drive/connect/route.js');
const { getActiveUser } = await import('@/lib/auth/session');
const { getServerClient } = await import('@/lib/supabase/server');
const { can } = await import('@/lib/permissions/authorization');

const request = () => new Request('https://pccoe.in/api/backup/drive/connect');

describe('GET /api/backup/drive/connect authorization', () => {
  it('redirects an unauthenticated caller to the admin error page without touching Supabase', async () => {
    getActiveUser.mockResolvedValue(null);
    getServerClient.mockClear();
    can.mockClear();

    const response = await GET(request());
    expect(response.headers.get('location')).toContain('backup_error=forbidden');
    expect(getServerClient).not.toHaveBeenCalled();
    expect(can).not.toHaveBeenCalled();
  });

  it('redirects a signed-in user without manage_backups before any OAuth state is created', async () => {
    getActiveUser.mockResolvedValue({ profile: { id: 'profile-1' } });
    can.mockReturnValue(false);
    getServerClient.mockClear();

    const response = await GET(request());
    expect(response.headers.get('location')).toContain('backup_error=forbidden');
    expect(can).toHaveBeenCalledWith(expect.anything(), 'manage_backups');
    expect(getServerClient).not.toHaveBeenCalled();
  });
});
