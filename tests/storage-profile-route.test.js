import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth/session', () => ({ getActiveUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: vi.fn() }));
vi.mock('@/lib/storage/profile-photo', () => ({ cleanProfilePhotos: vi.fn(), uploadProfilePhoto: vi.fn(), removeProfilePhoto: vi.fn(), getProfilePhotoMetadata: vi.fn(), downloadProfilePhoto: vi.fn() }));
import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { cleanProfilePhotos, uploadProfilePhoto, removeProfilePhoto, getProfilePhotoMetadata, downloadProfilePhoto } from '@/lib/storage/profile-photo';
import { POST, DELETE } from '@/app/api/storage/profile-photo/route';
import { GET } from '@/app/api/storage/profile-photo/[username]/route';

const user = { profile: { id: 'profile-owner', username: 'alice' } };
const uploadId = 'd6c50c2c-c061-497e-ae3a-0289944cd024';
const origin = 'https://pccoe.in';
const image = Buffer.from('89504e470d0a1a0a0000', 'hex');
function request(method = 'POST', headers = {}) {
  return new Request(`${origin}/api/storage/profile-photo`, { method, headers: { origin, 'content-type': 'image/png', 'x-file-name': 'photo.png', 'x-upload-id': uploadId, ...headers }, ...(method === 'POST' ? { body: image } : {}) });
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('CAMPUS_PROFILE_UPLOADS_ENABLED', '1'); });
describe('profile photo routes', () => {
  it('rejects unauthenticated and cross-origin writes', async () => {
    expect((await POST(request('POST', { origin: 'https://evil.example' }))).status).toBe(403);
    getActiveUser.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(uploadProfilePhoto).not.toHaveBeenCalled();
  });
  it('independently checks the entitlement before accepting an upload', async () => {
    getActiveUser.mockResolvedValue(user);
    getServerClient.mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ data: [{ upload_enabled: false }], error: null }) });
    expect((await POST(request())).status).toBe(403);
    expect(uploadProfilePhoto).not.toHaveBeenCalled();
  });
  it('passes authenticated owner and data to the central server service, not browser owner input', async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: [{ upload_enabled: true }], error: null }) };
    getActiveUser.mockResolvedValue(user); getServerClient.mockResolvedValue(supabase);
    cleanProfilePhotos.mockResolvedValue(true); uploadProfilePhoto.mockResolvedValue('private-record');
    const res = await POST(request('POST', { 'x-owner-id': 'attacker' }));
    expect(res.status).toBe(200);
    expect(uploadProfilePhoto).toHaveBeenCalledWith({ owner: 'profile-owner', requestId: uploadId, name: 'photo.png', mime: 'image/png', bytes: image });
    expect(JSON.stringify(await res.json())).not.toContain('private-record');
  });
  it('rejects oversized inputs and disables writes by default', async () => {
    getActiveUser.mockResolvedValue(user);
    getServerClient.mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ data: [{ upload_enabled: true }], error: null }) });
    expect((await POST(request('POST', { 'content-length': String(3 * 1024 * 1024 + 1) }))).status).toBe(400);
    vi.stubEnv('CAMPUS_PROFILE_UPLOADS_ENABLED', '0');
    expect((await POST(request())).status).toBe(503);
  });
  it('permits signed-in owners to remove and retry failed cleanup', async () => {
    getActiveUser.mockResolvedValue(user); removeProfilePhoto.mockResolvedValue(false);
    const res = await DELETE(request('DELETE'));
    expect(await res.json()).toEqual({ ok: true, cleanupPending: true });
    expect(removeProfilePhoto).toHaveBeenCalledWith(user.profile.id);
  });
  it('rejects signed-out and inactive-profile image requests', async () => {
    getActiveUser.mockResolvedValueOnce(null).mockResolvedValueOnce(user);
    const context = { params: Promise.resolve({ username: 'alice' }) };
    expect((await GET(null, context)).status).toBe(401);
    getServerClient.mockResolvedValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'visible', is_active: false }, error: null }) }) }) }) });
    expect((await GET(null, context)).status).toBe(404);
    expect(getProfilePhotoMetadata).not.toHaveBeenCalled();
  });
  it('returns 304 only after authentication and current profile visibility checks', async () => {
    const req = new Request('https://pccoe.in/api/storage/profile-photo/alice', { headers: { 'if-none-match': `"${'a'.repeat(64)}"` } });
    const ctx = { params: Promise.resolve({ username: 'alice' }) };
    getActiveUser.mockResolvedValueOnce(null).mockResolvedValue(user);
    expect((await GET(req, ctx)).status).toBe(401);
    const maybeSingle = vi.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValue({ data: { id: 'visible', is_active: true }, error: null });
    getServerClient.mockResolvedValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) });
    expect((await GET(req, ctx)).status).toBe(404);
    expect(getProfilePhotoMetadata).not.toHaveBeenCalled();
    getProfilePhotoMetadata.mockResolvedValueOnce({ checksum: 'a'.repeat(64), mime_type: 'image/png', provider_file_id: 'private' }).mockResolvedValueOnce(null);
    const cached = await GET(req, ctx);
    expect(cached.status).toBe(304);
    expect(cached.headers.get('cache-control')).toBe('private, no-cache, must-revalidate');
    expect(cached.headers.get('vary')).toContain('Cookie');
    expect(downloadProfilePhoto).not.toHaveBeenCalled();
    expect((await GET(req, ctx)).status).toBe(404); // deleted, not a stale 304
  });
  it('downloads replacement bytes when the cached validator is stale', async () => {
    const req = new Request('https://pccoe.in/api/storage/profile-photo/alice', { headers: { 'if-none-match': `"${'a'.repeat(64)}"` } });
    getActiveUser.mockResolvedValue(user);
    getServerClient.mockResolvedValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'visible', is_active: true }, error: null }) }) }) }) });
    getProfilePhotoMetadata.mockResolvedValue({ checksum: 'b'.repeat(64), mime_type: 'image/png', provider_file_id: 'private' });
    downloadProfilePhoto.mockResolvedValue({ bytes: image, mime: 'image/png' });
    const response = await GET(req, { params: Promise.resolve({ username: 'alice' }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe(`"${'b'.repeat(64)}"`);
    expect(downloadProfilePhoto).toHaveBeenCalledTimes(1);
  });
  it('checks the block-aware profile projection before accessing private ledger', async () => {
    getActiveUser.mockResolvedValue(user);
    const maybeSingle = vi.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: { id: 'visible', is_active: true }, error: null });
    getServerClient.mockResolvedValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) });
    expect((await GET(null, { params: Promise.resolve({ username: 'alice' }) })).status).toBe(404);
    expect(getProfilePhotoMetadata).not.toHaveBeenCalled();
    getProfilePhotoMetadata.mockResolvedValue({ provider_file_id: 'private', mime_type: 'image/png', checksum: 'a'.repeat(64) });
    downloadProfilePhoto.mockResolvedValue({ bytes: image, mime: 'image/png' });
    const response = await GET(null, { params: Promise.resolve({ username: 'alice' }) });
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-cache, must-revalidate');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(image);
    expect(getProfilePhotoMetadata).toHaveBeenCalledWith('visible');
  });
});
