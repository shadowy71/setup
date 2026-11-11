import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/storage/post-access', () => ({ visiblePost: vi.fn(), sameOrigin: vi.fn() }));
vi.mock('@/lib/storage/post-attachments', () => ({ listPostAttachments: vi.fn(), savePostAttachment: vi.fn(), reorderPostAttachments: vi.fn(), thumbnailPostAttachment: vi.fn(), getPostAttachment: vi.fn(), downloadPostAttachment: vi.fn(), removePostAttachment: vi.fn() }));
import { visiblePost, sameOrigin } from '@/lib/storage/post-access';
import { listPostAttachments, savePostAttachment, reorderPostAttachments, thumbnailPostAttachment, getPostAttachment, downloadPostAttachment, removePostAttachment } from '@/lib/storage/post-attachments';
import { GET as list, POST, PATCH } from '@/app/api/storage/posts/[id]/route';
import { GET, DELETE } from '@/app/api/storage/posts/[id]/[file]/route';
const id = 'd6c50c2c-c061-497e-ae3a-0289944cd024';
const file = 'f4b5c514-200e-4cae-912f-6b8d03f71589';
const ctx = { params: Promise.resolve({ id, file }) };
const user = { profile: { id: 'owner' } };
const meta = { id: file, checksum: 'a'.repeat(64), mime_type: 'image/png', provider_file_id: 'private-drive-id' };
function request(method = 'GET', headers = {}) { return new Request(`https://pccoe.in/api/storage/posts/${id}/${file}`, { method, headers: { origin: 'https://pccoe.in', ...headers }, ...(method === 'POST' ? { body: Buffer.from('file') } : {}) }); }
beforeEach(() => { vi.resetAllMocks(); sameOrigin.mockReturnValue(true); visiblePost.mockResolvedValue({ user, post: { id, author_id: 'owner' } }); vi.stubEnv('CAMPUS_POST_ATTACHMENTS_ENABLED', '1'); vi.stubEnv('CAMPUS_STORAGE_V3_ENABLED', '1'); });
describe('post attachment routes', () => {
  it('rejects invisible posts and does not access the privileged ledger', async () => {
    visiblePost.mockResolvedValue({ status: 404 });
    expect((await list(request(), ctx)).status).toBe(404);
    expect((await GET(request('GET', { 'if-none-match': `"${meta.checksum}"` }), ctx)).status).toBe(404);
    expect(listPostAttachments).not.toHaveBeenCalled(); expect(getPostAttachment).not.toHaveBeenCalled();
  });
  it('checks ownership and feature gates before upload', async () => {
    const headers = { 'x-upload-id': file, 'x-file-name': 'a.png', 'content-type': 'image/png' };
    visiblePost.mockResolvedValueOnce({ user, post: { id, author_id: 'other' } });
    expect((await POST(request('POST', headers), ctx)).status).toBe(403);
    vi.stubEnv('CAMPUS_POST_ATTACHMENTS_ENABLED', '0');
    expect((await POST(request('POST', headers), ctx)).status).toBe(503);
    expect(savePostAttachment).not.toHaveBeenCalled();
  });
  it('validates origin and size and derives owner from session', async () => {
    const headers = { 'x-upload-id': file, 'x-file-name': 'a.png', 'content-type': 'image/png' };
    sameOrigin.mockReturnValueOnce(false);
    expect((await POST(request('POST', headers), ctx)).status).toBe(403);
    expect((await POST(request('POST', { ...headers, 'content-length': '3145729' }), ctx)).status).toBe(400);
    savePostAttachment.mockResolvedValue(file);
    expect((await POST(request('POST', headers), ctx)).status).toBe(200);
    expect(savePostAttachment).toHaveBeenCalledWith(expect.objectContaining({ owner: 'owner', post: id, requestId: file }));
  });
  it('returns 304 without Drive access only after visibility and ready checks', async () => {
    getPostAttachment.mockResolvedValueOnce(meta).mockResolvedValueOnce(null);
    const req = request('GET', { 'if-none-match': `"${meta.checksum}"` });
    const response = await GET(req, ctx); expect(response.status).toBe(304);
    expect(response.headers.get('cache-control')).toContain('private'); expect(downloadPostAttachment).not.toHaveBeenCalled();
    expect((await GET(req, ctx)).status).toBe(404);
  });
  it('requests a private thumbnail and revalidates without processing on 304', async () => {
    getPostAttachment.mockResolvedValue(meta); thumbnailPostAttachment.mockResolvedValue(Buffer.from('thumb'));
    const url = `https://pccoe.in/api/storage/posts/${id}/${file}?size=thumb`;
    const res = await GET(new Request(url), ctx);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('etag')).toBe(`"${meta.checksum}-thumb-v1"`);
    expect(thumbnailPostAttachment).toHaveBeenCalledOnce();
    expect((await GET(new Request(url, { headers: { 'if-none-match': `"${meta.checksum}-thumb-v1"` } }), ctx)).status).toBe(304);
    expect(thumbnailPostAttachment).toHaveBeenCalledOnce();
  });
  it('permits only owners to submit a bounded order', async () => {
    const req = () => new Request(`https://pccoe.in/api/storage/posts/${id}`, { method: 'PATCH', body: JSON.stringify({ files: [file] }), headers: { origin: 'https://pccoe.in' } });
    visiblePost.mockResolvedValueOnce({ user, post: { id, author_id: 'other' } });
    expect((await PATCH(req(), ctx)).status).toBe(403);
    expect((await PATCH(req(), ctx)).status).toBe(200);
    expect(reorderPostAttachments).toHaveBeenCalledWith('owner', id, [file]);
  });
  it('downloads changed bytes and authorizes removal', async () => {
    getPostAttachment.mockResolvedValue(meta); downloadPostAttachment.mockResolvedValue(Buffer.from('new'));
    expect((await GET(request('GET', { 'if-none-match': '"old"' }), ctx)).status).toBe(200);
    visiblePost.mockResolvedValueOnce({ user, post: { id, author_id: 'other' } });
    expect((await DELETE(request('DELETE'), ctx)).status).toBe(403);
    removePostAttachment.mockResolvedValue(false);
    expect(await (await DELETE(request('DELETE'), ctx)).json()).toEqual({ ok: true, cleanupPending: true });
    expect(removePostAttachment).toHaveBeenCalledWith('owner', file);
  });
});
