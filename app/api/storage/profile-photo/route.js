import { NextResponse } from 'next/server';
import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { MAX_FILE_BYTES } from '@/lib/storage/validation';
import { cleanProfilePhotos, removeProfilePhoto, uploadProfilePhoto } from '@/lib/storage/profile-photo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
const json = (body, status = 200) => NextResponse.json(body, { status, headers });
function sameOrigin(request) {
  try { return new URL(request.headers.get('origin')).origin === new URL(request.url).origin; } catch { return false; }
}
async function readBounded(request) {
  const size = Number(request.headers.get('content-length'));
  if (Number.isFinite(size) && size > MAX_FILE_BYTES) throw new Error('invalid_file');
  if (!request.body) throw new Error('invalid_file');
  const reader = request.body.getReader();
  const chunks = []; let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FILE_BYTES) { await reader.cancel(); throw new Error('invalid_file'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}
export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'Invalid request.' }, 403);
  const user = await getActiveUser();
  if (!user?.profile?.id || user.needsProfileSetup) return json({ error: 'Sign in to upload.' }, 401);
  if (process.env.CAMPUS_PROFILE_UPLOADS_ENABLED !== '1') return json({ error: 'Profile uploads are not available yet.' }, 503);
  try {
    const id = request.headers.get('x-upload-id') || '';
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) return json({ error: 'Invalid upload request.' }, 400);
    const supabase = await getServerClient();
    if (!supabase) throw new Error('storage_unavailable');
    const usage = await supabase.rpc('storage_account_usage', { p_user: user.profile.id });
    if (usage.error) throw new Error('storage_unavailable');
    if (!usage.data?.[0]?.upload_enabled) throw new Error('permission_denied');
    const name = decodeURIComponent(request.headers.get('x-file-name') || '');
    const mime = request.headers.get('content-type') || '';
    const bytes = await readBounded(request);
    // Stale reservations are retired before deletion. If cleanup is unavailable,
    // cleanup remains pending for reconciliation.
    try { await cleanProfilePhotos(user.profile.id, { stale: true }); } catch { /* retry later */ }
    await uploadProfilePhoto({ owner: user.profile.id, requestId: id, name, mime, bytes });
    return json({ ok: true });
  } catch (error) {
    if (error.message === 'rate_limited') return json({ error: 'Too many photo uploads. Please try again later.' }, 429);
    if (error.message === 'permission_denied') return json({ error: 'File uploads are currently available to selected contributors.' }, 403);
    if (error.message === 'invalid_file') return json({ error: 'Choose a valid JPEG, PNG or WebP image under 3 MiB.' }, 400);
    if (error.message === 'invalid_file') return json({ error: 'Invalid file.' }, 400);
    return json({ error: 'Upload could not be completed. Retry the same file.' }, 503);
  }
}
export async function DELETE(request) {
  if (!sameOrigin(request)) return json({ error: 'Invalid request.' }, 403);
  const user = await getActiveUser();
  if (!user?.profile?.id || user.needsProfileSetup) return json({ error: 'Sign in to remove your photo.' }, 401);
  try {
    const complete = await removeProfilePhoto(user.profile.id);
    return json({ ok: true, cleanupPending: !complete });
  } catch { return json({ error: 'Removal could not be completed. Please retry.' }, 503); }
}
