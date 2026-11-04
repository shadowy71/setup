import { ImageResponse } from 'next/og';
import { UUID_REGEX } from '@/lib/constants';
import { getPublicEventById, getPublicClubIdentityById } from '@/lib/data/public';
import { publicDescription } from '@/lib/seo';
import { SocialImage } from '@/components/discovery/SocialImage';

export async function GET(_request, { params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return new Response(null, { status: 404 });
  const { item, unavailable } = await getPublicEventById(id);
  if (unavailable) return new Response(null, { status: 503 });
  if (!item || item.status !== 'published') return new Response(null, { status: 404 });
  const { item: club } = item.club_id ? await getPublicClubIdentityById(item.club_id) : { item: null };
  const clubName = club?.kind === 'club' && club.status === 'published' && club.visibility === 'public' ? club.name : null;
  const subtitle = [item.starts_on, item.start_time?.slice(0, 5), item.location].filter(Boolean).map((s) => publicDescription(s)).join(' · ');
  return new ImageResponse(<SocialImage kind="CAMPUS EVENT" title={publicDescription(item.title)} subtitle={subtitle} description={clubName ? `With ${publicDescription(clubName)}` : ''} />, { width: 1200, height: 630, headers: { 'Cache-Control': 'no-store' } });
}
