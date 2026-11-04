import { ImageResponse } from 'next/og';
import { CLUB_SLUG_REGEX } from '@/lib/constants';
import { getPublicClubBySlug, isPubliclyListedClub } from '@/lib/data/public';
import { publicDescription } from '@/lib/seo';
import { initials, familyHue } from '@/components/clubs/ClubMonogram';
import { SocialImage } from '@/components/discovery/SocialImage';

export async function GET(_request, { params }) {
  const { slug } = await params;
  if (!CLUB_SLUG_REGEX.test(slug)) return new Response(null, { status: 404 });
  const { item, unavailable } = await getPublicClubBySlug(slug);
  if (unavailable) return new Response(null, { status: 503 });
  if (!isPubliclyListedClub(item)) return new Response(null, { status: 404 });
  const name = publicDescription(item.name);
  return new ImageResponse(<SocialImage kind="STUDENT ORGANIZATION" title={name} subtitle={item.club_category ? publicDescription(item.club_category) : ''} description={item.description ? publicDescription(item.description) : ''} initials={initials(name)} hue={familyHue(item.id || name).hue} />, { width: 1200, height: 630, headers: { 'Cache-Control': 'no-store' } });
}
