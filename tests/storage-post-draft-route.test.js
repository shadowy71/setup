import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth/session', () => ({ getActiveUser: vi.fn() }));
vi.mock('@/lib/storage/post-access', () => ({ sameOrigin: vi.fn() }));
vi.mock('@/lib/storage/post-attachments', () => ({ createPostDraft: vi.fn(), abandonPostDraft: vi.fn(), savePostAttachment: vi.fn() }));
import { getActiveUser } from '@/lib/auth/session';
import { sameOrigin } from '@/lib/storage/post-access';
import { createPostDraft, abandonPostDraft, savePostAttachment } from '@/lib/storage/post-attachments';
import { PUT, POST, DELETE } from '@/app/api/storage/post-drafts/[id]/route';
const id='d6c50c2c-c061-497e-ae3a-0289944cd024', ctx={params:Promise.resolve({id})};
const request=(method, extra={}) => new Request(`https://pccoe.in/api/storage/post-drafts/${id}`,{method,headers:{origin:'https://pccoe.in','x-upload-id':id,'x-file-name':'test.png','content-type':'image/png', ...extra},...(method==='POST'?{body:Buffer.from('image')}:{})});
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('CAMPUS_POST_ATTACHMENTS_ENABLED','1'); vi.stubEnv('CAMPUS_STORAGE_V3_ENABLED','1'); sameOrigin.mockReturnValue(true); getActiveUser.mockResolvedValue({profile:{id:'owner'}}); });
describe('post draft routes', () => {
  it('fails closed without session, origin or gates', async () => {
    sameOrigin.mockReturnValueOnce(false); expect((await PUT(request('PUT'),ctx)).status).toBe(403);
    getActiveUser.mockResolvedValueOnce(null); expect((await PUT(request('PUT'),ctx)).status).toBe(401);
    vi.stubEnv('CAMPUS_STORAGE_V3_ENABLED','0'); expect((await PUT(request('PUT'),ctx)).status).toBe(503);
    expect(createPostDraft).not.toHaveBeenCalled();
  });
  it('derives owner from the session, bounds uploads and supports abandoning the draft', async () => {
    expect((await PUT(request('PUT'),ctx)).status).toBe(200);
    expect(createPostDraft).toHaveBeenCalledWith('owner',id);
    expect((await POST(request('POST',{'content-length':'3145729'}),ctx)).status).toBe(400);
    savePostAttachment.mockResolvedValue(id);
    expect((await POST(request('POST',{'x-owner-id':'other'}),ctx)).status).toBe(200);
    expect(savePostAttachment).toHaveBeenCalledWith(expect.objectContaining({owner:'owner',draft:id,requestId:id}));
    expect((await DELETE(request('DELETE'),ctx)).status).toBe(200); expect(abandonPostDraft).toHaveBeenCalledWith('owner',id);
    abandonPostDraft.mockResolvedValueOnce('published'); expect((await DELETE(request('DELETE'),ctx)).status).toBe(409);
  });
});
