import Link from 'next/link';
import { ClubCard } from '@/components/clubs/ClubCard';
import { ContentCard } from '@/components/content/ContentCard';
import { SectionHeader } from '@/components/ui';
import { ROUTES } from '@/lib/constants';
import { formatDate, formatTime, truncate } from '@/lib/utils';

/** Server-rendered, viewer-independent selections from the existing directories. */
export function CampusDiscovery({ clubs, recruitment, events, hosts, interests, clubsUnavailable, recruitmentUnavailable, eventsUnavailable }) {
  return (
    <>
      <section aria-label="Clubs worth exploring" className="flex flex-col gap-3">
        <SectionHeader title="Clubs worth exploring" description="A selection from the public club directory." action={<Link href={ROUTES.clubs} className="text-2xs text-muted underline hover:text-ink">All clubs</Link>} />
        {clubs.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{clubs.map((club) => <ClubCard key={club.slug} club={club} showRecruitmentStatus={false} />)}</div> : <p className="card p-4 text-sm text-muted">{clubsUnavailable ? 'Clubs are temporarily unavailable.' : 'No public clubs to show yet.'}</p>}
      </section>

      <section aria-label="Recruitment information" className="card flex flex-col gap-3 p-4">
        <SectionHeader title="Recruitment information" description="From club profiles. Check with the club for current availability; these details do not confirm applications are open." action={<Link href={ROUTES.clubs} className="text-2xs text-muted underline hover:text-ink">Browse clubs</Link>} />
        {recruitment.length ? <ul className="divide-y divide-line">{recruitment.map((club) => <li key={club.slug} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"><Link href={ROUTES.club(club.slug)} className="text-sm font-semibold underline">{club.name}</Link><p className="user-text text-2xs leading-relaxed text-muted">{truncate(club.recruitment_info, 180)}</p></li>)}</ul> : <p className="text-sm text-muted">{recruitmentUnavailable ? 'Recruitment information is temporarily unavailable.' : 'No public recruitment information is available yet.'}</p>}
      </section>

      <section aria-label="Upcoming campus events" className="flex flex-col gap-3">
        <SectionHeader title="Upcoming campus events" description="Published events that have not started yet." action={<Link href="/campus/events" className="text-2xs text-muted underline hover:text-ink">All events</Link>} />
        {events.length ? <div className="grid gap-2 md:grid-cols-2">{events.map((event) => {
          const host = hosts.get(event.club_id);
          return <div key={event.id} className="flex flex-col gap-1"><ContentCard href={ROUTES.event(event.id)} title={event.title} description={event.description} icon="calendar" badges={[{ label: [formatDate(event.starts_on), formatTime(event.start_time)].filter(Boolean).join(' · '), tone: 'accent' }]} meta={[event.location]} />{host?.slug ? <Link href={ROUTES.club(host.slug)} className="px-2 text-2xs text-muted underline hover:text-ink">Hosted by {host.name}</Link> : null}</div>;
        })}</div> : <p className="card p-4 text-sm text-muted">{eventsUnavailable ? 'Events are temporarily unavailable.' : 'No upcoming events in this selection. Browse all events for more.'}</p>}
      </section>

      {interests.length ? <section aria-label="Explore by interest" className="card flex flex-col gap-3 p-4"><SectionHeader title="Explore by interest" description="Follow a category or a topic found in public club profiles." /><nav className="flex flex-wrap gap-2" aria-label="Club interests">{interests.map((interest) => <Link key={interest.label} className="chip" href={interest.href}>{interest.label}</Link>)}</nav></section> : null}
    </>
  );
}
