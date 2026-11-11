import { NextResponse } from 'next/server';
import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { sameOrigin } from '@/lib/storage/post-access';
import { createPostDraft, abandonPostDraft, savePostAttachment } from '@/lib/storage/post-attachments';
import { MAX_FILE_BYTES } from '@/lib/storage/validation';
import { UUID_REGEX } from '@/lib/constants';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
const json = (data,status=200) => NextResponse.json(data,{status,headers});
async function authorize(request, params, write = true) {
  if (!sameOrigin(request)) return { status: 403 };
  const user = await getActiveUser();
  if (!user?.profile?.id || user.needsProfileSetup) return { status: 401 };
  const { id } = await params;
  if (!UUID_REGEX.test(id || '')) return { status: 404 };
  const scope = new URL(request.url).searchParams.get('scope');
  const marketplace = scope === 'marketplace';
  const lostFound = scope === 'lost_found';
  const housing = scope === 'housing';
  const project = scope === 'project';
  const gig = scope === 'gig';
  const achievement = scope === 'achievement';
  const notice = scope === 'notice';
  const event = scope === 'event';
  const space = scope === 'space';
  const team = scope === 'team';
  const ride = scope === 'ride';
  if (write && ((marketplace ? process.env.CAMPUS_MARKET_ATTACHMENTS_ENABLED : lostFound ? process.env.CAMPUS_LOST_FOUND_ATTACHMENTS_ENABLED : housing ? process.env.CAMPUS_HOUSING_ATTACHMENTS_ENABLED : project ? process.env.CAMPUS_PROJECT_ATTACHMENTS_ENABLED : gig ? process.env.CAMPUS_GIG_ATTACHMENTS_ENABLED : achievement ? process.env.CAMPUS_ACHIEVEMENT_ATTACHMENTS_ENABLED : notice ? process.env.CAMPUS_NOTICE_ATTACHMENTS_ENABLED : event ? process.env.CAMPUS_EVENT_ATTACHMENTS_ENABLED : space ? process.env.CAMPUS_SPACE_ATTACHMENTS_ENABLED : team ? process.env.CAMPUS_TEAM_ATTACHMENTS_ENABLED : ride ? process.env.CAMPUS_RIDE_ATTACHMENTS_ENABLED : process.env.CAMPUS_POST_ATTACHMENTS_ENABLED) !== '1' || process.env.CAMPUS_STORAGE_V3_ENABLED !== '1')) return { status: 503 };
  if (write && (lostFound || housing || ride || team || project || gig || achievement || notice || event || space)) { const db = await getServerClient(); if (!db) return { status: 503 }; const flag = await db.rpc('feature_enabled', { p_key: lostFound ? 'lost_found_images' : housing ? 'housing_attachments' : ride ? 'ride_attachments' : team ? 'team_attachments' : project ? 'project_attachments' : gig ? 'gig_attachments' : achievement ? 'achievement_attachments' : notice ? 'notice_attachments' : event ? 'event_attachments' : 'space_attachments' }); if (flag.error || flag.data !== true) return { status: 503 }; }
  return { id, owner: user.profile.id };
}
export async function PUT(request, { params }) {
  const access = await authorize(request, params); if (access.status) return json({ error: 'Unavailable.' }, access.status);
  try { await createPostDraft(access.owner, access.id); return json({ ok: true }); } catch { return json({ error: 'Could not start upload. Check your upload permission and retry.' }, 503); }
}
export async function DELETE(request, { params }) {
  const access = await authorize(request, params, false); if (access.status) return json({ error: 'Unavailable.' }, access.status);
  try { const state = await abandonPostDraft(access.owner, access.id); if (state === 'published') return json({ error: 'This draft was already published. Submit again to recover the post.' }, 409); return json({ ok: true }); } catch { return json({ error: 'Could not discard draft; cleanup will retry.' }, 503); }
}
export async function POST(request, { params }) {
  const access = await authorize(request, params); if (access.status) return json({ error: 'Unavailable.' }, access.status);
  const requestId = request.headers.get('x-upload-id') || '';
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)) return json({ error: 'Invalid upload.' }, 400);
  try {
    if (Number(request.headers.get('content-length')) > MAX_FILE_BYTES || !request.body) throw Error('invalid_file');
    const reader = request.body.getReader(); const chunks=[]; let size=0;
    while (true) { const {value,done}=await reader.read(); if(done) break; size+=value.byteLength; if(size>MAX_FILE_BYTES) { await reader.cancel(); throw Error('invalid_file'); } chunks.push(Buffer.from(value)); }
    const id = await savePostAttachment({ owner: access.owner, draft: access.id, requestId, name: decodeURIComponent(request.headers.get('x-file-name') || ''), mime: request.headers.get('content-type') || '', bytes: Buffer.concat(chunks,size) });
    return json({ id });
  } catch (error) {
    if (error.message === 'invalid_file') return json({ error: 'Choose a valid image or PDF up to 3 MiB.' },400);
    if (error.message === 'attachment_limit') return json({ error: 'Invalid file or eight-file limit reached.' },400);
    if (error.message === 'upload_conflict') return json({ error: 'This upload expired or conflicts with an earlier attempt. Discard the draft and select the files again.' },409);
    if (error.message === 'permission_denied') return json({ error: 'Upload not permitted.' },403);
    if (error.message === 'rate_limited') return json({ error: 'Too many uploads. Try again later.' },429);
    return json({ error: 'Upload failed. Retry the same file.' },503);
  }
}
