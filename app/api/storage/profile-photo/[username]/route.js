import { NextResponse } from 'next/server';
import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { getProfilePhotoMetadata, downloadProfilePhoto } from '@/lib/storage/profile-photo';
import { USERNAME_REGEX } from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
// The browser may store the response privately, but must revalidate on every
// reuse. A shared cache must never store the image. Access is checked before 304.
const imageHeaders = { ...headers, 'Cache-Control': 'private, no-cache, must-revalidate' };
function matchesETag(value, tag) {
  return typeof value === 'string' && value.split(',').some((part) => {
    const candidate = part.trim();
    return candidate === '*' || candidate === tag || candidate === `W/${tag}`;
  });
}
export async function GET(request, { params }) {
  const user = await getActiveUser();
  if (!user?.profile?.id || user.needsProfileSetup) return new NextResponse(null, { status: 401, headers });
  const { username } = await params;
  if (!USERNAME_REGEX.test(username || '')) return new NextResponse(null, { status: 404, headers });
  const supabase = await getServerClient();
  if (!supabase) return new NextResponse(null, { status: 503, headers });
  const { data, error } = await supabase.from('public_profiles').select('id,is_active').eq('username', username.toLowerCase()).maybeSingle();
  if (error || !data || !data.is_active) return new NextResponse(null, { status: 404, headers });
  try {
    const metadata = await getProfilePhotoMetadata(data.id);
    if (!metadata) return new NextResponse(null, { status: 404, headers });
    // The checksum belongs to the immutable verified bytes, not a Drive ID.
    if (!/^[a-f0-9]{64}$/.test(metadata.checksum || '')) throw new Error('invalid_metadata');
    const etag = `"${metadata.checksum}"`;
    const responseHeaders = { ...imageHeaders, ETag: etag };
    if (matchesETag(request?.headers?.get('if-none-match'), etag)) {
      return new NextResponse(null, { status: 304, headers: responseHeaders });
    }
    const photo = await downloadProfilePhoto(metadata);
    return new NextResponse(photo.bytes, { status: 200, headers: { ...responseHeaders, 'Content-Type': photo.mime } });
  } catch { return new NextResponse(null, { status: 503, headers }); }
}
