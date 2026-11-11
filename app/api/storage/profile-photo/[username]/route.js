import { NextResponse } from 'next/server';
import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { readProfilePhoto } from '@/lib/storage/profile-photo';
import { USERNAME_REGEX } from '@/lib/constants';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
export async function GET(_request, { params }) {
  const user = await getActiveUser();
  if (!user?.profile?.id || user.needsProfileSetup) return new NextResponse(null, { status: 401, headers });
  const { username } = await params;
  if (!USERNAME_REGEX.test(username || '')) return new NextResponse(null, { status: 404, headers });
  const supabase = await getServerClient();
  if (!supabase) return new NextResponse(null, { status: 503, headers });
  const { data, error } = await supabase.from('public_profiles').select('id,is_active').eq('username', username.toLowerCase()).maybeSingle();
  if (error || !data || !data.is_active) return new NextResponse(null, { status: 404, headers });
  try {
    const photo = await readProfilePhoto(data.id);
    if (!photo) return new NextResponse(null, { status: 404, headers });
    return new NextResponse(photo.bytes, { status: 200, headers: { ...headers, 'Content-Type': photo.mime } });
  } catch { return new NextResponse(null, { status: 503, headers }); }
}
