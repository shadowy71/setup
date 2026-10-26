import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listCommunities, getCampusSummary } from '@/lib/data/campus';
import { listPublishedEvents, listPublishedNotices } from '@/lib/data/public-cache';
import { ROUTES } from '@/lib/constants';
import { PageHeader, Card, Notice, EmptyState } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { ContentCard } from '@/components/content/ContentCard';
import { formatDate, formatTime } from '@/lib/utils';

export const metadata = { title: 'Campus' };

const SECTIONS = [
  { href: '/campus/noticeboard', label: 'Noticeboard', icon: 'megaphone', description: 'Official notices and announcements.' },
  { href: '/campus/events', label: 'Events', icon: 'calendar', description: 'What is happening, with RSVP.' },
  { href: ROUTES.clubs, label: 'Clubs', icon: 'star', description: 'Campus clubs and how to join.' },
  { href: '/campus/lost-found', label: 'Lost & found', icon: 'search', description: 'Lost something? Found something?' },
  { href: '/campus/housing', label: 'Housing', icon: 'building', description: 'Rooms, flats and PG posts.' },
  { href: '/campus/rides', label: 'Rides', icon: 'bus', description: 'Share a ride home or to the station.' },
  { href: '/campus/teams', label: 'Team finder', icon: 'users', description: 'Find teammates for a project or hackathon.' },
  { href: '/campus/study', label: 'Study partner finder', icon: 'book', description: 'Find peers for a subject or exam.' },
  { href: '/campus/utilities', label: 'Campus utilities', icon: 'book', description: 'Directory, services, cafeteria, transport, calendar, forms and help.' },
];

/**
 * Campus hub (spec §25–§46).
 *
 * Everything campus-owned in one place, text first. Counts are real counts from
 * the database — an empty campus shows an empty campus, never placeholder
 * content.
 */
export default async function CampusPage() {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);

  // Notices and events are public and cached; the club list asks PostgREST for
  // its exact count on the same request, so the hub no longer issues separate
  // count round trips for events and clubs.
  const [
    { items: notices, unavailable: noticesUnavailable },
    { items: events, count: eventCount },
    { items: clubs, count: clubCount },
    summary,
  ] = await Promise.all([
    listPublishedNotices({ limit: 3 }),
    listPublishedEvents({ limit: 3, withCount: true }),
    listCommunities(supabase, { kind: 'club', limit: 3, withCount: true }),
    getCampusSummary(supabase, { withEvents: false, withClubs: false }),
  ]);
  const counts = {
    ...summary,
    events: eventCount ?? summary.events,
    clubs: clubCount ?? summary.clubs,
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Campus"
        description="Notices, events, clubs and the everyday information you need on campus."
      />

      <div className="grid gap-2 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <Link key={section.href} href={section.href} className="card flex items-start gap-3 p-3 hover:no-underline">
            <span className="mt-0.5 text-muted">
              <Icon name={section.icon} size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-[0.875rem] font-medium">{section.label}</span>
              <span className="mt-0.5 block text-2xs text-muted">{section.description}</span>
            </span>
          </Link>
        ))}
      </div>

      <Card className="p-3">
        <p className="text-2xs text-muted">
          {counts.notices} published notices · {counts.events} upcoming events · {counts.clubs} clubs ·{' '}
          {counts.resources} resources · {counts.opportunities} opportunities · {counts.projects} projects ·{' '}
          {counts.study} open study requests
        </p>
      </Card>

      {noticesUnavailable ? (
        <Notice tone="warning" icon="flag">
          Official content could not be loaded right now.
        </Notice>
      ) : null}

      <section aria-label="Latest notices" className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          Latest official notices
          <Link href="/campus/noticeboard" className="text-2xs text-muted underline hover:text-ink">
            All notices
          </Link>
        </h2>
        {notices.length ? (
          notices.map((notice) => (
            <ContentCard
              key={notice.id}
              href={ROUTES.notice(notice.id)}
              title={notice.title}
              description={notice.body}
              icon="megaphone"
              official
              badges={[{ label: notice.category, tone: 'accent' }, ...(notice.pinned ? [{ label: 'Pinned' }] : [])]}
              meta={[`Published ${formatDate(notice.published_at || notice.created_at)}`]}
            />
          ))
        ) : (
          <EmptyState icon="megaphone" title="No notices yet" description="Official announcements appear here." />
        )}
      </section>

      <section aria-label="Upcoming events" className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          Upcoming events
          <Link href="/campus/events" className="text-2xs text-muted underline hover:text-ink">
            All events
          </Link>
        </h2>
        {events.length ? (
          events.map((event) => (
            <ContentCard
              key={event.id}
              href={ROUTES.event(event.id)}
              title={event.title}
              description={event.description}
              icon="calendar"
              official={event.is_official}
              badges={[
                { label: formatDate(event.starts_on), tone: 'accent' },
                ...(event.start_time ? [{ label: formatTime(event.start_time) }] : []),
              ]}
              meta={[event.location, event.organizer]}
            />
          ))
        ) : (
          <EmptyState icon="calendar" title="No upcoming events" description="Events published by the campus appear here." />
        )}
      </section>

      {clubs.length ? (
        <section aria-label="Clubs" className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            Clubs
            <Link href={ROUTES.clubs} className="text-2xs text-muted underline hover:text-ink">
              All clubs
            </Link>
          </h2>
          {clubs.map((club) => (
            <ContentCard
              key={club.id}
              href={ROUTES.club(club.id)}
              title={club.name}
              description={club.description}
              icon="star"
              official={club.is_official}
              badges={[club.is_official ? { label: 'Official', tone: 'accent' } : { label: 'Student-run' }]}
              meta={[`${club.member_count} member${club.member_count === 1 ? '' : 's'}`]}
            />
          ))}
        </section>
      ) : null}

      {can(actor, 'manage_notices') || can(actor, 'manage_events') ? (
        <Notice tone="neutral" icon="shield">
          Staff tools for notices, events and official content live in{' '}
          <Link href={ROUTES.moderator} className="underline">
            moderation
          </Link>{' '}
          and{' '}
          <Link href={ROUTES.admin} className="underline">
            administration
          </Link>
          .
        </Notice>
      ) : null}
    </div>
  );
}
