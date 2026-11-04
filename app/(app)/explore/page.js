import Link from 'next/link';
import '@/app/styles/sections.css';
import { listPublicClubs, getPublicClubIdentities } from '@/lib/data/public';
import { listPublishedEvents } from '@/lib/data/public-cache';
import { publicClubs, selectClubs, upcomingEvents, interestLinks } from '@/lib/explore/campus-discovery';
import { CampusDiscovery } from '@/components/explore/CampusDiscovery';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { ROUTES, TRENDING_WINDOW_HOURS } from '@/lib/constants';
import { PageHeader, EmptyState, SectionHeader } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { SearchResults } from '@/components/search/SearchResults';
import { LiveFeedSync } from '@/components/social/LiveFeedSync';
import { compactNumber } from '@/lib/utils';

export const metadata = { title: 'Explore' };

/**
 * Explore (spec §16, §17) — the discovery hub.
 *
 * Two clearly separated modes, chosen by the address:
 *
 *   ?q=…       SEARCH. One search engine (`global_search()`), one set of scope
 *              tabs, results from the server. The scope is part of the URL, so
 *              `/explore?q=robotics&scope=projects` can be bookmarked.
 *
 *   no q       BROWSE. A bounded public campus selection, the existing module
 *              directory and the deterministic trending list. The club and event
 *              directories remain the authoritative full catalogues.
 *
 * Every destination is a canonical `ROUTES` entry, and every count or row comes
 * from the real tables. An empty database shows "nothing yet", never filler.
 */
/**
 * The directory: each entry is a canonical route that already owns its board.
 * Nothing here filters a partial set, so nothing here can disagree with the
 * page it links to.
 */
const DESTINATIONS = [
  { href: ROUTES.communities, label: 'Communities', icon: 'users', description: 'Subject groups, batch groups and clubs — with their own discussions.' },
  { href: ROUTES.clubs, label: 'Clubs', icon: 'star', description: 'Technical, cultural, sports, arts and social clubs on campus.' },
  { href: '/explore/projects', label: 'Projects', icon: 'sparkle', description: 'What students are building, and who is building it.' },
  { href: '/explore/opportunities', label: 'Opportunities', icon: 'briefcase', description: 'Internships, competitions and calls for applications.' },
  { href: '/explore/resources', label: 'Resources', icon: 'book', description: 'Notes, papers and study material shared by students.' },
  { href: ROUTES.campus, label: 'Campus', icon: 'building', description: 'Noticeboard, events, lost and found, teams and study partners.' },
  { href: ROUTES.market, label: 'Market', icon: 'tag', description: 'Listings and deals from students on campus.' },
  { href: ROUTES.gigs, label: 'Gigs', icon: 'briefcase', description: 'Paid and unpaid work offered by other students.' },
];

/** Scope shortcuts are search links — they set `?q=`'s scope, not a filter. */
const SCOPED_SEARCHES = [
  { href: '/explore?scope=people', label: 'People' },
  { href: '/explore?scope=discussions', label: 'Discussions' },
  { href: '/explore?scope=events', label: 'Events' },
  { href: '/explore?scope=marketplace', label: 'Marketplace' },
  { href: '/explore?scope=study', label: 'Study requests' },
];

export default async function ExplorePage({ searchParams }) {
  // Auth gate only: browse mode reads nothing private and shows nothing that
  // depends on who is asking.
  await requireUser();
  const params = await searchParams;
  const query = typeof params?.q === 'string' ? params.q.slice(0, 80) : '';
  const scope = typeof params?.scope === 'string' ? params.scope : 'all';

  if (query.trim().length >= 2) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Explore" description={`Results for “${query}”`} />
        <SearchResults initialQuery={query} initialScope={scope} />
      </div>
    );
  }

  const supabase = await getServerClient();

  // Bounded, anonymous catalogue reads are shared; trending remains session-scoped.
  const [trendingResult, clubResult, recruitmentResult, eventResult] = await Promise.all([
    supabase.rpc('trending_posts', { p_limit: 5, p_hours: TRENDING_WINDOW_HOURS }),
    listPublicClubs({ order: 'name', limit: 30 }),
    listPublicClubs({ order: 'name', limit: 8, hasRecruitment: true }),
    listPublishedEvents({ limit: 30, upcoming: true }),
  ]);
  const trending = trendingResult.data;
  const clubs = publicClubs(clubResult.items);
  const recruitment = publicClubs(recruitmentResult.items).filter((club) => typeof club.recruitment_info === 'string' && club.recruitment_info.trim()).slice(0, 4);
  const events = upcomingEvents(eventResult.items);
  const identities = await getPublicClubIdentities(events.map((event) => event.club_id));
  const hosts = new Map(publicClubs(identities.items).map((club) => [club.id, club]));

  return (
    <div className="flex flex-col gap-6">
      {/* Re-reads this board when a post lands somewhere else in campus, so an
          already-open page is not left showing the render it was given. Owns no
          data and renders nothing — see components/social/LiveFeedSync. */}
      <LiveFeedSync />
      <PageHeader title="Explore" description="Search, trending, and the modules you might not have opened yet." />
      <section aria-labelledby="campus-life-heading" className="card flex flex-col gap-3 p-4 sm:p-5">
        <div><h2 id="campus-life-heading">There&apos;s more happening on campus.</h2><p className="mt-2 text-sm text-muted">Find student communities, explore clubs and discover what&apos;s happening at PCCOE.</p></div>
        <SearchResults initialQuery="" initialScope="all" hint="Search clubs, events, interests and more…" />
      </section>

      <CampusDiscovery clubs={selectClubs(clubs)} recruitment={recruitment} events={events} hosts={hosts} interests={interestLinks(clubs)} clubsUnavailable={clubResult.unavailable} recruitmentUnavailable={recruitmentResult.unavailable} eventsUnavailable={eventResult.unavailable} />

      <section aria-label="Browse campus" className="flex flex-col gap-3">
        <SectionHeader
          title="Browse"
          description="Every module has its own page. These are the doors, not a second copy of the boards."
        />
        <div className="grid gap-2 sm:grid-cols-2">
          {DESTINATIONS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="card group flex items-start gap-3 p-3.5 hover:no-underline"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 text-muted transition-colors group-hover:text-ink">
                <Icon name={item.icon} size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-[0.875rem] font-semibold text-ink">{item.label}</span>
                <span className="mt-0.5 block text-2xs leading-relaxed text-muted">{item.description}</span>
              </span>
              <Icon name="chevronRight" size={14} className="ml-auto mt-1 shrink-0 text-muted-soft" />
            </Link>
          ))}
        </div>
      </section>

      <section aria-label="Trending" className="flex flex-col gap-3">
        <SectionHeader
          title="Trending now"
          description="Deterministic score from reactions and comments in the recent window — no algorithm, no AI."
        />
        {trending?.length ? (
          <ul className="card divide-y divide-line">
            {trending.map((item) => (
              <li key={item.id}>
                <Link href={ROUTES.post(item.id)} className="flex items-start gap-3 p-3 hover:bg-canvas hover:no-underline">
                  <Icon name="sparkle" size={16} className="mt-0.5 shrink-0 text-muted" />
                  <span className="min-w-0">
                    <span className="block truncate text-[0.875rem] font-medium">
                      {item.title || (item.body ? `${item.body.slice(0, 90)}…` : 'Post')}
                    </span>
                    <span className="mt-0.5 block text-2xs text-muted">
                      @{item.username} · {compactNumber(item.reaction_count)} reactions · {compactNumber(item.comment_count)} comments
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon="sparkle"
            title="No trending posts yet"
            description={`Trending is computed from real reactions and comments in the last ${TRENDING_WINDOW_HOURS} hours.`}
          />
        )}
      </section>

      <section aria-label="Search a specific scope" className="card flex flex-wrap items-center gap-2 p-3.5">
        <p className="text-[0.8125rem] text-muted">Looking for one kind of thing?</p>
        <div className="flex flex-wrap gap-1.5">
          {SCOPED_SEARCHES.map((item) => (
            <Link key={item.href} href={item.href} className="chip" data-active="false">
              {item.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
