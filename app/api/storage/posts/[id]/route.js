import { NextResponse } from 'next/server';
import { visiblePost, sameOrigin } from '@/lib/storage/post-access';
import { listPostAttachments, savePostAttachment, reorderPostAttachments } from '@/lib/storage/post-attachments';
import { MAX_FILE_BYTES } from '@/lib/storage/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200) => NextResponse.json(body, { status, headers });
export async function GET(_request, { params }) {
  const { id } = await params; const access = await visiblePost(id);
  if (access.status) return json({ error: 'Unavailable.' }, access.status);
  try { return json({ attachments: await listPostAttachments(id), canUpload: access.post.author_id === access.user.profile.id && process.env.CAMPUS_POST_ATTACHMENTS_ENABLED === '1' && process.env.CAMPUS_STORAGE_V3_ENABLED === '1' }); } catch { return json({ error: 'Unavailable.' }, 503); }
}
export async function POST(request, { params }) {
  if (!sameOrigin(request)) return json({ error: 'Invalid request.' }, 403);
  const { id } = await params; const access = await visiblePost(id);
  if (access.status) return json({ error: 'Unavailable.' }, access.status);
  if (access.post.author_id !== access.user.profile.id) return json({ error: 'Not permitted.' }, 403);
  if (process.env.CAMPUS_POST_ATTACHMENTS_ENABLED !== '1' || process.env.CAMPUS_STORAGE_V3_ENABLED !== '1') return json({ error: 'Attachments are not enabled.' }, 503);
  const requestId = request.headers.get('x-upload-id') || '';
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)) return json({ error: 'Invalid upload.' }, 400);
  try {
    if (Number(request.headers.get('content-length')) > MAX_FILE_BYTES || !request.body) throw Error('invalid_file');
    const reader = request.body.getReader(); const chunks = []; let length = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > MAX_FILE_BYTES) { await reader.cancel(); throw Error('invalid_file'); } chunks.push(Buffer.from(value)); }
    const file = await savePostAttachment({ owner: access.user.profile.id, post: id, requestId, name: decodeURIComponent(request.headers.get('x-file-name') || ''), mime: request.headers.get('content-type') || '', bytes: Buffer.concat(chunks, length) });
    return json({ id: file });
  } catch (error) {
    const code = error.message;
    if (code === 'invalid_file') return json({ error: 'Choose a valid image or PDF up to 3 MiB.' }, 400);
    if (code === 'quota_or_limit') return json({ error: 'Storage quota or eight-file limit reached.' }, 400);
    if (code === 'permission_denied') return json({ error: 'Uploads are not enabled for this account.' }, 403);
    if (code === 'rate_limited') return json({ error: 'Too many uploads. Try again later.' }, 429);
    return json({ error: 'Upload failed. Retry the same file.' }, 503);
  }
}

export async function PATCH(request, { params }) {
  if (!sameOrigin(request)) return json({ error: 'Invalid request.' }, 403);
  const { id } = await params; const access = await visiblePost(id);
  if (access.status) return json({ error: 'Unavailable.' }, access.status);
  if (access.post.author_id !== access.user.profile.id) return json({ error: 'Not permitted.' }, 403);
  try {
    if (Number(request.headers.get('content-length')) > 2048) return json({ error: 'Invalid order.' }, 400);
    if (!request.body) return json({ error: 'Invalid order.' }, 400);
    const reader = request.body.getReader(); const chunks = []; let size = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2048) { await reader.cancel(); return json({ error: 'Invalid order.' }, 400); } chunks.push(Buffer.from(value)); }
    const text = Buffer.concat(chunks, size).toString('utf8');
    const { files } = JSON.parse(text);
    if (!Array.isArray(files) || files.length > 8 || files.some((file) => typeof file !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(file))) return json({ error: 'Invalid order.' }, 400);
    await reorderPostAttachments(access.user.profile.id, id, files);
    return json({ ok: true });
  } catch { return json({ error: 'Attachments changed or could not be reordered. Refresh and retry.' }, 409); }
}
