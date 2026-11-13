import { notFound, redirect } from 'next/navigation';
import { ROUTES, UUID_REGEX } from '@/lib/constants';

/**
 * Legacy address for a gig.
 *
 * Gigs moved to their own section (`/gigs/<id>`). Every notification, search
 * result and bookmarked link created before the move points here, so this
 * route keeps resolving instead of 404ing. `tests/spec.test.js` pins the path.
 */
export default async function LegacyGigPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();
  redirect(ROUTES.gig(id));
}
