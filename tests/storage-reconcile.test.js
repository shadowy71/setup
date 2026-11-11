import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/storage/profile-photo', () => ({ reconcileProfilePhotos: vi.fn() }));
import { reconcileProfilePhotos } from '@/lib/storage/profile-photo';
import { GET } from '@/app/api/storage/reconcile/route';
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('CRON_SECRET', 'x'.repeat(40)); });
describe('profile photo reconciliation endpoint', () => {
  it('rejects missing and incorrect tokens without doing work', async () => {
    expect((await GET(new Request('https://pccoe.in/api/storage/reconcile'))).status).toBe(401);
    expect((await GET(new Request('https://pccoe.in/api/storage/reconcile', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
    expect(reconcileProfilePhotos).not.toHaveBeenCalled();
  });
  it('returns a redacted result for the scheduler and hides errors', async () => {
    const req = () => new Request('https://pccoe.in/api/storage/reconcile', { headers: { authorization: `Bearer ${'x'.repeat(40)}` } });
    reconcileProfilePhotos.mockResolvedValueOnce({ processedOwners: 1, retryPending: false }).mockRejectedValueOnce(Error('private'));
    expect(await (await GET(req())).json()).toEqual({ ok: true, processedOwners: 1, retryPending: false });
    const failure = await GET(req());
    expect(failure.status).toBe(503); expect(JSON.stringify(await failure.json())).not.toContain('private');
  });
});
