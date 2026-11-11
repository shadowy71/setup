import { describe, expect, it, vi } from 'vitest';
import { getAdminStorageSummary } from '@/lib/data/admin';

describe('admin storage summary data', () => {
  it('returns the redacted database result without querying Drive', async () => {
    const summary = { charged_bytes: 100, reserved_count: 1, ready_count: 0, delete_pending_count: 0, recent: [] };
    const rpc = vi.fn().mockResolvedValue({ data: summary, error: null });
    expect(await getAdminStorageSummary({ rpc })).toEqual(summary);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('admin_storage_summary');
  });
  it('fails closed when the database or migration is unavailable', async () => {
    expect(await getAdminStorageSummary(null)).toBeNull();
    expect(await getAdminStorageSummary({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'unavailable' } }) })).toBeNull();
  });
});
