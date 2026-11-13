import { notFound, permanentRedirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { getCommunityById } from '@/lib/data/campus';
import { getPublicClubIdentityById } from '@/lib/data/public';
import { ROUTES, UUID_REGEX } from '@/lib/constants';
import { noindexMetadata } from '@/lib/seo';

/**
 * Pre-section club deep link `/campus/clubs/<uuid>`.
 *
 * Search results and notifications created before clubs had their own section
 * pointed here. Resolve the UUID, confirm it is a club, read its STORED slug
 * and forward (308) to the canonical `/c/<slug>` profile — one hop, no
 * duplicate rendering. Invalid or inaccessible identifiers get a real 404.
 */
export const metadata = noindexMetadata('Club link');

export default async function LegacyCampusClubPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const { item } = await getPublicClubIdentityById(id);
  let club = item;

  if (!club) {
    const user = await getCurrentUser();
    if (user?.profile) {
      const supabase = await getServerClient();
      const found = supabase ? await getCommunityById(supabase, id) : null;
      if (found && found.kind === 'club') club = found;
    }
  }

  if (!club || club.kind !== 'club' || !club.slug) notFound();
  permanentRedirect(ROUTES.club(club.slug));
}
