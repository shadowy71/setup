import { NextResponse } from 'next/server';
import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  const user = await getActiveUser();
  if (!user?.profile?.id || user.needsProfileSetup) return NextResponse.json({ enabled: false, reason: 'sign_in' }, { status: 401, headers });
  const marketplace = request && new URL(request.url).searchParams.get('scope') === 'marketplace';
  if ((marketplace ? process.env.CAMPUS_MARKET_ATTACHMENTS_ENABLED : process.env.CAMPUS_POST_ATTACHMENTS_ENABLED) !== '1' || process.env.CAMPUS_STORAGE_V3_ENABLED !== '1') return NextResponse.json({ enabled: false, reason: 'disabled' }, { headers });
  const db = await getServerClient();
  if (!db) return NextResponse.json({ enabled: false, reason: 'unavailable' }, { status: 503, headers });
  if (marketplace) { const flag = await db.rpc('feature_enabled', { p_key: 'marketplace_images' }); if (flag.error) return NextResponse.json({ enabled: false, reason: 'unavailable' }, { status: 503, headers }); if (flag.data !== true) return NextResponse.json({ enabled: false, reason: 'disabled' }, { headers }); }
  const { data, error } = await db.rpc('storage_account_usage', { p_user: user.profile.id });
  if (error) return NextResponse.json({ enabled: false, reason: 'unavailable' }, { status: 503, headers });
  const enabled = data?.[0]?.upload_enabled === true;
  return NextResponse.json({ enabled, reason: enabled ? null : 'permission' }, { headers });
}
