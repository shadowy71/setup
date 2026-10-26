import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { ROUTES } from '@/lib/constants';
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
 *   no q       BROWSE. A compact directory of the modules that already have
 *              their own pages, plus the deterministic trending list. It does
 *              not re-implement those boards here — a second copy would drift
 *              from the page it imitates.
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

  // Browse mode is a directory, not six miniature boards: each module keeps its
  // own page (and its own pagination). The only content read left here is the
  // deterministic trending list, which exists nowhere else.
  const { data: trending } = await supabase.rpc('trending_posts', { p_limit: 5, p_hours: 72 });

  return (
    <div className="flex flex-col gap-6">
      {/* Re-reads this board when a post lands somewhere else in campus, so an
          already-open page is not left showing the render it was given. Owns no
          data and renders nothing — see components/social/LiveFeedSync. */}
      <LiveFeedSync />
      <PageHeader title="Explore" description="Search, trending, and the modules you might not have opened yet." />
      <SearchResults initialQuery="" initialScope="all" />

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
          description="Deterministic score from reactions, comments and participants — no algorithm, no AI."
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
            description="Trending is computed from real reactions and comments in the last 72 hours."
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
