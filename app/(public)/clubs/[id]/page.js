import { notFound, permanentRedirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { getCommunityById } from '@/lib/data/campus';
import { getPublicClubIdentityById } from '@/lib/data/public';
import { ROUTES, UUID_REGEX } from '@/lib/constants';
import { noindexMetadata } from '@/lib/seo';

/**
 * Legacy `/clubs/<uuid>` compatibility route.
 *
 * Old bookmarks, notifications printed before migration 041 and search results
 * cached by a third party still address clubs by UUID. This page resolves the
 * UUID, confirms it is a club, reads its STORED `communities.slug` and issues a
 * permanent 308 redirect to the canonical `/c/<slug>` profile.
 *
 * It never looks up a club by slug and never invents a slug from a name. It
 * does not render club content, so there is no duplicate page competing with
 * the canonical URL. `/clubs/<id>/manage` and `/clubs/<id>/edit` remain
 * separate, UUID-addressed authenticated routes in `app/(app)/`.
 *
 * Unlisted (campus/private) clubs that a signed-in student may view under the
 * existing RLS policy also resolve, so their old links keep working; a guest
 * gets a 404 for those, which is the same boundary the canonical page applies.
 */
export const metadata = noindexMetadata('Club link');

export default async function LegacyClubPage({ params }) {
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
