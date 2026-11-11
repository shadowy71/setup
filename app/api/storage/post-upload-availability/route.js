import { NextResponse } from 'next/server';
import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  const user = await getActiveUser();
  if (!user?.profile?.id || user.needsProfileSetup) return NextResponse.json({ enabled: false, reason: 'sign_in' }, { status: 401, headers });
  const scope = request && new URL(request.url).searchParams.get('scope');
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
  if ((marketplace ? process.env.CAMPUS_MARKET_ATTACHMENTS_ENABLED : lostFound ? process.env.CAMPUS_LOST_FOUND_ATTACHMENTS_ENABLED : housing ? process.env.CAMPUS_HOUSING_ATTACHMENTS_ENABLED : project ? process.env.CAMPUS_PROJECT_ATTACHMENTS_ENABLED : gig ? process.env.CAMPUS_GIG_ATTACHMENTS_ENABLED : achievement ? process.env.CAMPUS_ACHIEVEMENT_ATTACHMENTS_ENABLED : notice ? process.env.CAMPUS_NOTICE_ATTACHMENTS_ENABLED : event ? process.env.CAMPUS_EVENT_ATTACHMENTS_ENABLED : space ? process.env.CAMPUS_SPACE_ATTACHMENTS_ENABLED : team ? process.env.CAMPUS_TEAM_ATTACHMENTS_ENABLED : ride ? process.env.CAMPUS_RIDE_ATTACHMENTS_ENABLED : process.env.CAMPUS_POST_ATTACHMENTS_ENABLED) !== '1' || process.env.CAMPUS_STORAGE_V3_ENABLED !== '1') return NextResponse.json({ enabled: false, reason: 'disabled' }, { headers });
  const db = await getServerClient();
  if (!db) return NextResponse.json({ enabled: false, reason: 'unavailable' }, { status: 503, headers });
  if (marketplace || lostFound || housing || ride || team || project || gig || achievement || notice || event || space) { const flag = await db.rpc('feature_enabled', { p_key: marketplace ? 'marketplace_images' : lostFound ? 'lost_found_images' : housing ? 'housing_attachments' : ride ? 'ride_attachments' : team ? 'team_attachments' : project ? 'project_attachments' : gig ? 'gig_attachments' : achievement ? 'achievement_attachments' : notice ? 'notice_attachments' : event ? 'event_attachments' : 'space_attachments' }); if (flag.error) return NextResponse.json({ enabled: false, reason: 'unavailable' }, { status: 503, headers }); if (flag.data !== true) return NextResponse.json({ enabled: false, reason: 'disabled' }, { headers }); }
  const { data, error } = await db.rpc('storage_account_usage', { p_user: user.profile.id });
  if (error) return NextResponse.json({ enabled: false, reason: 'unavailable' }, { status: 503, headers });
  const enabled = data?.[0]?.upload_enabled === true;
  return NextResponse.json({ enabled, reason: enabled ? null : 'permission' }, { headers });
}
