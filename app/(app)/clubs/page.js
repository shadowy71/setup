import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { countClubsByCategory, listCommunities } from '@/lib/data/campus';
import { listPendingCommunityJoinRequests } from '@/lib/data/clubs';
import {
  ROUTES,
  CLUB_CATEGORIES,
  CLUB_SORTS,
  CLUB_ORGANIZATION_TYPES,
  CLUB_DIRECTORY_STATES,
} from '@/lib/constants';
import { Button, EmptyState, LinkButton, Notice, PageHeader, SectionHeader } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { ClubCard } from '@/components/clubs/ClubCard';

export const metadata = { title: 'Clubs' };

export default async function ClubsPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const params = await searchParams;

  const q = typeof params?.q === 'string' && params.q.trim().length >= 2 ? params.q.trim() : null;
  const category = CLUB_CATEGORIES.some((entry) => entry.value === params?.category) ? params.category : null;
  const organizationType = CLUB_ORGANIZATION_TYPES.some((entry) => entry.value === params?.type) ? params.type : null;
  const state = CLUB_DIRECTORY_STATES.some((entry) => entry.value === params?.state) ? params.state : 'all';
  const sort = CLUB_SORTS.some((entry) => entry.value === params?.sort) ? params.sort : 'members';

  const [directory, counts, memberships, pendingRequests] = await Promise.all([
    listCommunities(supabase, { kind: 'club', q, category, organizationType, order: sort, limit: 500 }),
    countClubsByCategory(supabase),
    supabase
      .from('community_members')
      .select('community_id')
      .eq('user_id', user.profile.id)
      .eq('status', 'active')
      .limit(300),
    listPendingCommunityJoinRequests(supabase, user.profile.id),
  ]);

  const joined = new Set((memberships.data || []).map((row) => row.community_id));
  const pending = new Set(pendingRequests.map((row) => row.community_id));
  const canCreate = can(actor, 'manage_clubs');
  const hasFilters = Boolean(q || category || organizationType || state !== 'all' || sort !== 'members');
  const allItems = directory.items;
  const items = allItems.filter((club) => {
    if (state === 'joined') return joined.has(club.id);
    if (state === 'pending') return pending.has(club.id) && !joined.has(club.id);
    if (state === 'recruiting') return club.admin_assigned && Boolean(club.recruitment_info);
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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Clubs"
        eyebrow="Campus life"
        description="Find collegiate teams, department associations, professional chapters and student organizations. Source, verification and administrator states are shown explicitly."
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href={ROUTES.clubRequest} icon="plus" variant="secondary">Request a club</LinkButton>
            {canCreate ? <LinkButton href={ROUTES.clubNew} icon="plus" tone="accent">Create with admin</LinkButton> : null}
          </div>
        }
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
            <span className="field-label">Membership</span>
            <select name="state" defaultValue={state} className="control control-select h-9 w-full py-0 xl:w-48">
              {CLUB_DIRECTORY_STATES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
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

      {directory.unavailable ? <Notice tone="warning" icon="flag">Clubs could not be loaded right now. Try again in a moment.</Notice> : null}

      <SectionHeader
        title={category ? `${category} clubs` : q ? `Clubs matching “${q}”` : 'Club directory'}
        description={`${items.length} organization${items.length === 1 ? '' : 's'} in this view${state !== 'all' ? ` · ${allItems.length} before the membership-state filter` : ''}.`}
      />

      {!directory.unavailable && !items.length ? (
        <EmptyState
          icon="star"
          title={hasFilters ? 'No clubs match that view' : 'No clubs yet'}
          description={hasFilters ? 'Try another category, organization type or membership state.' : 'Club pages appear here after the catalogue is imported or a request is approved.'}
          action={<LinkButton href={ROUTES.clubRequest} size="sm" tone="accent" icon="plus">Request a club</LinkButton>}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((club) => (
          <ClubCard key={club.id} club={club} joined={joined.has(club.id)} pending={pending.has(club.id)} />
        ))}
      </div>

      <p className="text-center text-2xs leading-relaxed text-muted">
        “Source checked” means the cited source lists the organization; it is not an endorsement of this page. Unassigned clubs cannot accept join requests.
      </p>
    </div>
  );
}
