import { NextResponse } from 'next/server';
import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
export const dynamic = 'force-dynamic';
export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  const user = await getActiveUser();
  if (!user?.profile?.id || user.needsProfileSetup) return NextResponse.json({ enabled: false }, { status: 401, headers });
  if (process.env.CAMPUS_POST_ATTACHMENTS_ENABLED !== '1' || process.env.CAMPUS_STORAGE_V3_ENABLED !== '1') return NextResponse.json({ enabled: false }, { headers });
  const db = await getServerClient();
  if (!db) return NextResponse.json({ enabled: false }, { status: 503, headers });
  const { data, error } = await db.rpc('storage_account_usage', { p_user: user.profile.id });
  if (error) return NextResponse.json({ enabled: false }, { status: 503, headers });
  return NextResponse.json({ enabled: data?.[0]?.upload_enabled === true }, { headers });
}
