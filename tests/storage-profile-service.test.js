import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ admin: vi.fn(), upload: vi.fn(), uploadV3: vi.fn(), removeV3: vi.fn(), download: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ getAdminClient: mocks.admin }));
vi.mock('@/lib/storage', () => ({ uploadFile: mocks.upload, uploadFileV3: mocks.uploadV3, deleteFileByUploadKeyV3: mocks.removeV3, downloadFile: mocks.download, deleteFileByUploadKey: mocks.remove }));
import { uploadProfilePhoto, removeProfilePhoto, readProfilePhoto, downloadProfilePhoto, reconcileProfilePhotos } from '@/lib/storage/profile-photo';
const owner = 'owner';
const fileId = 'f4b5c514-200e-4cae-912f-6b8d03f71589';
let rows, admin;
function query() {
  let selected = rows;
  return {
    select() { return this; },
    update() { return this; },
    eq(key, value) { selected = selected.filter((row) => row[key] === value); return this; },
    order() { return this; },
    or() { return this; },
    async maybeSingle() { return { data: selected[0] || null, error: null }; },
    async limit(n) { return { data: selected.slice(0, n), error: null }; },
    then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
  };
}
beforeEach(() => {
  vi.resetAllMocks(); rows = [];
  admin = {
    from: () => query(),
    rpc: vi.fn(async (name, params) => {
      if (name === 'consume_rate_limit') return { data: { allowed: true }, error: null };
      if (name === 'storage_reserve_profile_picture' || name === 'storage_reserve_profile_picture_v3') {
        if (!rows.length) rows.push({ id: fileId, owner_id: owner, resource_type: 'profile_picture', status: 'reserved', gateway_key: name.endsWith('_v3') ? `2000000000000-${fileId}` : null, mime_type: params.p_mime_type, checksum: params.p_checksum });
        return { data: fileId, error: null };
      }
      if (name === 'storage_finalize_profile_picture') {
        for (const row of rows) if (row.status === 'ready') row.status = 'delete_pending';
        const row = rows.find((r) => r.id === params.p_file);
        Object.assign(row, { status: 'ready', provider_file_id: params.p_provider_id });
      }
      if (name === 'storage_retire_profile_pictures' && !params.p_stale_only) for (const row of rows) if (row.status !== 'deleted') row.status = 'delete_pending';
      if (name === 'storage_complete_profile_delete') rows.find((r) => r.id === params.p_file).status = 'deleted';
      return { data: null, error: null };
    }),
  };
  mocks.admin.mockReturnValue(admin);
  mocks.upload.mockImplementation(async ({ bytes, mime }) => ({ id: 'drive_12345678', checksum: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, mime }));
  mocks.uploadV3.mockImplementation(async ({ bytes, mime }) => ({ id: 'drive_12345678', checksum: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, mime }));
  mocks.removeV3.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  delete process.env.CAMPUS_STORAGE_V3_ENABLED;
});
async function image(format) { return sharp({ create: { width: 2, height: 2, channels: 3, background: '#c09070' } })[format]().toBuffer(); }
async function run(bytes, mime, ext) { return uploadProfilePhoto({ owner, requestId: fileId, name: `photo.${ext}`, mime, bytes }); }
describe('profile photo lifecycle service (mocked Drive and ledger)', () => {
  it.each([['jpeg', 'image/jpeg', 'jpg'], ['png', 'image/png', 'png'], ['webp', 'image/webp', 'webp']])('decodes, reserves and finalizes %s', async (format, mime, ext) => {
    const bytes = await image(format);
    expect(await run(bytes, mime, ext)).toBe(fileId);
    expect(rows[0].status).toBe('ready');
    expect(mocks.upload).toHaveBeenCalledWith({ key: fileId, name: `photo.${ext}`, mime, bytes });
    expect(admin.rpc).toHaveBeenCalledWith('storage_finalize_profile_picture', expect.objectContaining({ p_owner: owner, p_file: fileId }));
    await run(bytes, mime, ext);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });
  it('uses a database-reserved V3 key for upload and cleanup after cutover', async () => {
    process.env.CAMPUS_STORAGE_V3_ENABLED = '1';
    try {
      const bytes = await image('png'); await run(bytes, 'image/png', 'png');
      expect(admin.rpc).toHaveBeenCalledWith('storage_reserve_profile_picture_v3', expect.any(Object));
      expect(mocks.uploadV3).toHaveBeenCalledWith(expect.objectContaining({ key: `2000000000000-${fileId}` }));
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(await removeProfilePhoto(owner)).toBe(true);
      expect(mocks.removeV3).toHaveBeenCalledWith(`2000000000000-${fileId}`);
      expect(mocks.remove).not.toHaveBeenCalled();
    } finally { delete process.env.CAMPUS_STORAGE_V3_ENABLED; }
  });
  it('rejects malformed data before reserving an upload', async () => {
    await expect(run(Buffer.from('89504e470d0a1a0a0000', 'hex'), 'image/png', 'png')).rejects.toThrow('invalid_file');
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it('keeps a reservation after failed database finalization so an identical retry can recover', async () => {
    const bytes = await image('png');
    const base = admin.rpc;
    admin.rpc = vi.fn().mockImplementation(async (name, params) => name === 'storage_finalize_profile_picture' && rows[0]?.status === 'reserved' && !admin.failedOnce ? (admin.failedOnce = true, { error: { message: 'database failed' } }) : base(name, params));
    await expect(run(bytes, 'image/png', 'png')).rejects.toThrow('storage_unavailable');
    expect(rows[0].status).toBe('reserved');
    await run(bytes, 'image/png', 'png');
    expect(rows[0].status).toBe('ready');
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(mocks.upload.mock.calls[0][0].key).toBe(mocks.upload.mock.calls[1][0].key);
  });
  it('fails closed when rate limiting fails or is exhausted', async () => {
    const bytes = await image('png');
    admin.rpc = vi.fn().mockResolvedValueOnce({ data: { allowed: false }, error: null });
    await expect(run(bytes, 'image/png', 'png')).rejects.toThrow('rate_limited');
    expect(mocks.upload).not.toHaveBeenCalled();
    admin.rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } });
    await expect(run(bytes, 'image/png', 'png')).rejects.toThrow('storage_unavailable');
  });
  it('reconciles pending deletions in a bounded cron pass', async () => {
    rows.push({ id: fileId, owner_id: owner, resource_type: 'profile_picture', status: 'delete_pending' });
    expect(await reconcileProfilePhotos()).toEqual({ processedOwners: 1, retryPending: false });
    expect(mocks.remove).toHaveBeenCalledWith(fileId);
    expect(rows[0].status).toBe('deleted');
  });
  it('keeps deletion pending and charged when Drive cleanup fails, then retries it', async () => {
    const bytes = await image('png'); await run(bytes, 'image/png', 'png');
    mocks.remove.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(undefined);
    expect(await removeProfilePhoto(owner)).toBe(false);
    expect(rows[0].status).toBe('delete_pending');
    expect(await removeProfilePhoto(owner)).toBe(true);
    expect(rows[0].status).toBe('deleted');
  });
  it('shares concurrent Drive reads and drops the entry after success or failure', async () => {
    const metadata = { provider_file_id: 'drive_12345678', mime_type: 'image/png', checksum: 'a'.repeat(64) };
    let resolve;
    mocks.download.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const first = downloadProfilePhoto(metadata), second = downloadProfilePhoto(metadata);
    expect(mocks.download).toHaveBeenCalledTimes(1);
    resolve(Buffer.from('same'));
    expect(await first).toEqual(await second);
    mocks.download.mockRejectedValueOnce(new Error('unavailable'));
    await expect(downloadProfilePhoto(metadata)).rejects.toThrow('unavailable');
    mocks.download.mockResolvedValueOnce(Buffer.from('retry'));
    expect((await downloadProfilePhoto(metadata)).bytes.toString()).toBe('retry');
    expect(mocks.download).toHaveBeenCalledTimes(3);
  });
  it('returns downloaded bytes only after a ready association was resolved', async () => {
    const bytes = await image('png'); await run(bytes, 'image/png', 'png');
    mocks.download.mockResolvedValue(bytes);
    expect(await readProfilePhoto(owner)).toEqual({ bytes, mime: 'image/png' });
    expect(await readProfilePhoto('other')).toBeNull();
  });
});
