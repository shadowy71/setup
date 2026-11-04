import { listPublicClubs } from '@/lib/data/public';
import { listPublishedEvents } from '@/lib/data/public-cache';
import { ROUTES } from '@/lib/constants';
import { SITE_URL } from '@/lib/seo';

/**
 * A sitemap of published, explicitly public records only.
 *
 * Both readers go through the anonymous client and the narrow `anon` RLS
 * policies / column grants in migration 041. A draft, a rejected submission, a
 * campus-only or private club, an unpublished event, a member, an attendee and
 * every administrative route are structurally incapable of appearing here —
 * even if someone later adds a broad `select('*')` to one of the readers.
 *
 * The two static directory URLs are always present; dynamic URLs are included
 * only when the database confirms the row is public. Failures degrade to an
 * empty list rather than a 500 (and never to a guessed URL).
 */

export const revalidate = 300;

function entry(path, lastModified, changeFrequency, priority) {
  return {
    url: new URL(path, `${SITE_URL}/`).toString(),
    lastModified: lastModified || undefined,
    changeFrequency,
    priority,
  };
}

export default async function sitemap() {
  const [clubs, events] = await Promise.all([
    listPublicClubs({ limit: 500 }),
    listPublishedEvents({ limit: 500, allDates: true }),
  ]);

  const staticEntries = [
    entry(ROUTES.clubs, null, 'daily', 0.9),
    entry('/campus/events', null, 'daily', 0.8),
  ];

  const clubEntries = (clubs.items || [])
    .filter((club) => club.slug && club.status === 'published' && club.visibility === 'public')
    .map((club) => entry(ROUTES.club(club.slug), club.updated_at || club.created_at, 'weekly', 0.7));

  const eventEntries = (events.items || [])
    .filter((event) => event.id && event.status === 'published')
    .map((event) => entry(ROUTES.event(event.id), event.published_at || event.created_at, 'weekly', 0.6));

  return [...staticEntries, ...clubEntries, ...eventEntries];
}
