import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listCommunities, countClubsByCategory } from '@/lib/data/campus';
import { listPendingCommunityJoinRequests } from '@/lib/data/clubs';
import { listPublicClubs, countPublicClubsByCategory } from '@/lib/data/public';
import {
  ROUTES,
  CLUB_CATEGORIES,
  CLUB_SORTS,
  CLUB_ORGANIZATION_TYPES,
  CLUB_DIRECTORY_STATES,
} from '@/lib/constants';
import { publicMetadata } from '@/lib/seo';
import { hasVerifiedRecruitment } from '@/lib/discovery/public';
import { returnToHref } from '@/lib/auth/return-to';
import { Button, EmptyState, LinkButton, Notice, PageHeader, SectionHeader } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { ClubCard } from '@/components/clubs/ClubCard';
import { GuestActionPrompt } from '@/components/auth/GuestActionPrompt';
import { ShareButton } from '@/components/social/ShareButton';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ searchParams }) {
  const params = await searchParams;
  return publicMetadata({
    title: 'PCCOE Clubs & Student Organizations',
    description: 'Explore student clubs, collegiate teams, technical communities, sports groups and student organizations at PCCOE through Campus+.',
    canonical: ROUTES.clubs,
    index: !params || Object.keys(params).length === 0,
  });
}

/** Membership states are only meaningful to a signed-in student. */
const GUEST_STATES = CLUB_DIRECTORY_STATES.filter((entry) =>
  ['all', 'recruiting', 'unassigned'].includes(entry.value),
);

/**
 * The club directory — ONE implementation for guests and students.
 *
 * The catalogue itself is a shared, viewer-independent read: guests use the
 * cached anonymous projection (`listPublicClubs`), signed-in students use their
 * session-scoped read (`listCommunities`) so they also see campus-only clubs
 * they are allowed to view. Both feed the same filters, cards and layout.
 * Viewer-specific joined/pending state is fetched separately, in the same
 * request, and is never placed in a shared cache entry.
 *
 * Management controls, pending administration queues and membership state are
 * only rendered when a real Campus+ profile is present. Guests get a sign-in
 * prompt that returns them to this exact filtered view.
 */
export default async function ClubsPage({ searchParams }) {
  const params = await searchParams;
  const q = typeof params?.q === 'string' && params.q.trim().length >= 2 ? params.q.trim() : null;
  const category = CLUB_CATEGORIES.some((entry) => entry.value === params?.category) ? params.category : null;
  const organizationType = CLUB_ORGANIZATION_TYPES.some((entry) => entry.value === params?.type) ? params.type : null;
  const sort = CLUB_SORTS.some((entry) => entry.value === params?.sort) ? params.sort : 'members';

  const user = await getCurrentUser();
  const viewer = user?.profile ? user : null;
  const allowedStates = viewer ? CLUB_DIRECTORY_STATES : GUEST_STATES;
  const requestedState = allowedStates.some((entry) => entry.value === params?.state) ? params.state : 'all';
  const state = requestedState;

  let directory = { items: [], unavailable: true };
  let counts = { counts: {}, total: 0, unavailable: true };
  const joined = new Set();
  const pending = new Set();

  if (viewer) {
    const supabase = await getServerClient();
    if (supabase) {
      const [list, categoryCounts, memberships, pendingRequests] = await Promise.all([
        listCommunities(supabase, { kind: 'club', q, category, organizationType, order: sort, limit: 500 }),
        countClubsByCategory(supabase),
        supabase
          .from('community_members')
          .select('community_id')
          .eq('user_id', viewer.profile.id)
          .eq('status', 'active')
          .limit(300),
        listPendingCommunityJoinRequests(supabase, viewer.profile.id),
      ]);
      directory = list;
      counts = categoryCounts;
      for (const row of memberships.data || []) joined.add(row.community_id);
      for (const row of pendingRequests) pending.add(row.community_id);
    }
  } else {
    // Anonymous projection: `anon` RLS + column grants in migration 041. The
    // cache key is the filter tuple, so search/filter/sort all work with cache.
    [directory, counts] = await Promise.all([
      listPublicClubs({ q, category, organizationType, order: sort, limit: 500 }),
      countPublicClubsByCategory(),
    ]);
  }

  const canCreate = viewer ? can(toActor(viewer), 'manage_clubs') : false;
  const hasFilters = Boolean(q || category || organizationType || state !== 'all' || sort !== 'members');
  const allItems = directory.items;
  const items = allItems.filter((club) => {
    if (!viewer && (state === 'joined' || state === 'pending')) return true;
    if (state === 'joined') return joined.has(club.id);
    if (state === 'pending') return pending.has(club.id) && !joined.has(club.id);
    if (state === 'recruiting') return hasVerifiedRecruitment(club);
    if (state === 'unassigned') return !club.admin_assigned;
    return true;
  });

  const hrefWith = (overrides) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ q, category, type: organizationType, state, sort, ...overrides })) {
      if (!value || value === 'all') continue;
      if (key === 'sort' && value === 'members') continue;
      search.set(key, String(value));
    }
    const query = search.toString();
    return query ? `${ROUTES.clubs}?${query}` : ROUTES.clubs;
  };

  const currentHref = hrefWith({});
  const headerAction = viewer ? (
    <div className="flex flex-wrap gap-2">
      <LinkButton href={ROUTES.clubRequest} icon="plus" variant="secondary">Request a club</LinkButton>
      {canCreate ? <LinkButton href={ROUTES.clubNew} icon="plus" tone="accent">Create with admin</LinkButton> : null}
    </div>
  ) : (
    <LinkButton href={returnToHref(currentHref, 'request_club')} icon="lock" tone="accent" size="sm">
      Sign in to request a club
    </LinkButton>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Clubs"
        eyebrow="Campus life"
        description="Find collegiate teams, department associations, professional chapters and student organizations. Source, verification and administrator states are shown explicitly."
        action={headerAction}
      />

      <section aria-label="Club discovery filters" className="card flex flex-col gap-3 p-3">
        <nav className="flex flex-wrap gap-1.5" aria-label="Club categories">
          <Link href={hrefWith({ category: null })} className="chip" data-active={!category}>
            <Icon name="star" size={12} />All clubs<span className="text-muted-soft">{counts.total}</span>
          </Link>
          {CLUB_CATEGORIES.map((entry) => (
            <Link key={entry.value} href={hrefWith({ category: entry.value })} className="chip" data-active={category === entry.value}>
              <Icon name={entry.icon} size={12} />{entry.label}
              {counts.counts[entry.value] ? <span className="text-muted-soft">{counts.counts[entry.value]}</span> : null}
            </Link>
          ))}
        </nav>

        <form method="get" action={ROUTES.clubs} className="grid items-end gap-2 border-t border-line pt-3 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1fr)_repeat(3,auto)_auto]">
          {category ? <input type="hidden" name="category" value={category} /> : null}
          <label className="flex min-w-0 flex-col gap-1.5 sm:col-span-2 xl:col-span-1">
            <span className="field-label">Search names, aliases or interests</span>
            <span className="relative">
              <Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-soft" />
              <input name="q" defaultValue={q || ''} maxLength={60} placeholder="GDSC, robotics, IEEE…" className="control control-input h-9 w-full pl-8" />
            </span>
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="field-label">Organization type</span>
            <select name="type" defaultValue={organizationType || ''} className="control control-select h-9 w-full py-0 xl:w-48">
              <option value="">All organization types</option>
              {CLUB_ORGANIZATION_TYPES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="field-label">Directory state</span>
            <select name="state" defaultValue={state} className="control control-select h-9 w-full py-0 xl:w-48">
              {allowedStates.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="field-label">Sort</span>
            <select name="sort" defaultValue={sort} className="control control-select h-9 w-full py-0 xl:w-44">
              {CLUB_SORTS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" variant="secondary" icon="search">Apply</Button>
            {hasFilters ? <Link href={ROUTES.clubs} className="text-2xs text-muted underline hover:text-ink">Clear</Link> : null}
          </div>
        </form>
      </section>

      {!viewer && user ? (
        <Notice tone="info" icon="user">
          Finish setting up your Campus+ account to join clubs.{' '}
          <Link href={ROUTES.onboarding} className="font-semibold underline">Complete your profile</Link>
        </Notice>
      ) : null}

      {directory.unavailable ? <Notice tone="warning" icon="flag">Clubs could not be loaded right now. Try again in a moment.</Notice> : null}

      {!viewer ? (
        <GuestActionPrompt
          title="Looking around? No account needed."
          description="Everything in this directory is public. Sign in with your institutional Google account when you want to join a club, message its members or follow its announcements."
          next={currentHref}
          intent="join"
          actionLabel="Sign in with Google"
          linkLabel="Read the first-visit guide"
          linkHref={ROUTES.guide}
        />
      ) : null}

      <SectionHeader
        title={category ? `${category} clubs` : q ? `Clubs matching “${q}”` : 'Club directory'}
        description={`${items.length} organization${items.length === 1 ? '' : 's'} in this view${state !== 'all' ? ` · ${allItems.length} before the directory-state filter` : ''}.`}
      />

      {!directory.unavailable && !items.length ? (
        <EmptyState
          icon="star"
          title={hasFilters ? 'No clubs match that view' : 'No clubs yet'}
          description={hasFilters ? 'Try another category, organization type or directory state.' : 'Club pages appear here after the catalogue is imported or a request is approved.'}
          action={viewer ? <LinkButton href={ROUTES.clubRequest} size="sm" tone="accent" icon="plus">Request a club</LinkButton> : null}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((club) => (
          <div key={club.id} className="flex flex-col gap-1.5">
            <ClubCard club={club} joined={joined.has(club.id)} pending={pending.has(club.id)} viewer={Boolean(viewer)} />
            {club.slug ? (
              <div className="flex justify-end px-1">
                <ShareButton path={ROUTES.club(club.slug)} label="Copy club link" size="sm" variant="ghost" title={club.name} />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <p className="text-center text-2xs leading-relaxed text-muted">
        “Source checked” means the cited source lists the organization; it is not an endorsement of this page. Unassigned clubs cannot accept join requests.
      </p>
    </div>
  );
}
