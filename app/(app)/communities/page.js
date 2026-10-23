import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { countCommunitiesByKind, listCommunities } from '@/lib/data/campus';
import { ROUTES } from '@/lib/constants';
import { Badge, Button, Card, EmptyState, LinkButton, Notice, PageHeader, SectionHeader, TiltCard } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';
import { LinkifiedText } from '@/components/content/LinkifiedText';

export const metadata = { title: 'Communities' };

// Clubs are their own section now (/clubs). The hub keeps communities and
// study groups, which are the spaces students create themselves.
const TABS = [
  { key: 'all', label: 'All', kinds: ['community', 'study_group'] },
  { key: 'communities', label: 'Communities', kinds: ['community'] },
  { key: 'study_groups', label: 'Study groups', kinds: ['study_group'] },
];

/**
 * Communities hub (spec §26, §28, §33).
 *
 * Communities and study groups share one infrastructure: same table, same
 * membership rules, same chat, same moderation. Study groups are simply
 * communities with a subject. Clubs use the same tables but are presented in
 * their own /clubs section (staff-managed, with a discovery category).
 */
export default async function CommunitiesPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);

  const params = await searchParams;
  // Old links to the clubs tab belong to the dedicated section.
  if (params?.tab === 'clubs') {
    const q = typeof params?.q === 'string' && params.q.trim() ? `?q=${encodeURIComponent(params.q.trim())}` : '';
    redirect(`${ROUTES.clubs}${q}`);
  }
  const tab = TABS.some((item) => item.key === params?.tab) ? params.tab : 'all';
  const q = typeof params?.q === 'string' && params.q.trim().length >= 2 ? params.q.trim() : null;
  const kinds = TABS.find((item) => item.key === tab)?.kinds || null;

  // The list and the three summary figures are independent, and the figures
  // come from one tallied read rather than three `head: true` count queries.
  const [{ items, unavailable }, counts] = await Promise.all([
    listCommunities(supabase, { kind: kinds, q, limit: 30 }),
    countCommunitiesByKind(supabase),
  ]);
  const canCreate = can(actor, 'create_communities');

  const featured =
    !q && items.length > 1
      ? items.slice().sort((a, b) => (b.member_count || 0) - (a.member_count || 0))[0]
      : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Communities"
        description="Communities and study groups built by students. Looking for campus clubs? They have their own section."
        action={
          canCreate ? (
            <LinkButton href="/communities/new" size="sm" icon="plus">
              Create
            </LinkButton>
          ) : null
        }
      />

      <Card className="p-3">
        <nav aria-label="Community kinds" className="flex flex-wrap gap-1.5">
          {TABS.map((item) => (
            <Link
              key={item.key}
              href={item.key === 'all' ? ROUTES.communities : `${ROUTES.communities}?tab=${item.key}`}
              aria-current={tab === item.key ? 'page' : undefined}
              className="chip"
              data-active={tab === item.key}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="mt-2 text-2xs text-muted">
          {counts.communities ?? 0} communities · {counts.studyGroups ?? 0} study groups ·{' '}
          <Link href={ROUTES.clubs} className="underline hover:text-ink">
            {counts.clubs ?? 0} clubs in the clubs section
          </Link>
        </p>
        <form method="get" action={ROUTES.communities} className="mt-2 flex items-end gap-2">
          <input type="hidden" name="tab" value={tab} />
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="field-label">Search</span>
            <input name="q" defaultValue={q || ''} maxLength={60} placeholder="Search by name" className="control control-input h-9" />
          </label>
          <Button type="submit" size="sm" variant="secondary" icon="search">
            Search
          </Button>
        </form>
      </Card>

      {unavailable ? (
        <Notice tone="warning" icon="flag">
          Communities could not be loaded right now. Refresh to try again.
        </Notice>
      ) : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="users"
          title={q ? 'Nothing matched that search' : 'No communities yet'}
          description={
            canCreate
              ? 'Start one for your branch, your batch, your club or a subject you are all struggling with.'
              : 'Communities will appear here once students create them.'
          }
          action={canCreate ? <LinkButton href="/communities/new" variant="primary" size="sm">Create a community</LinkButton> : null}
        />
      ) : null}

      {featured ? (
        <section aria-label="Most members" className="flex flex-col gap-2">
          <SectionHeader title="Biggest right now" description="The community with the most members on Campus+ today." />
          <TiltCard>
            <div className="glass glass-sheen card-glass flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <p className="t-label">{featured.kind === 'club' ? 'Club' : featured.kind === 'study_group' ? 'Study group' : 'Community'}</p>
                <h3 className="t-section mt-1">{featured.name}</h3>
                {featured.description ? (
                  <p className="user-text t-secondary mt-1.5 max-w-xl"><LinkifiedText text={featured.description} /></p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{featured.member_count} members</Badge>
                  {featured.subject ? <Badge>{featured.subject}</Badge> : null}
                  {featured.is_official ? <Badge tone="info">Official</Badge> : null}
                </div>
              </div>
              <LinkButton href={ROUTES.community(featured.slug)} variant="sheen" icon="arrowUpRight">
                Open
              </LinkButton>
            </div>
          </TiltCard>
        </section>
      ) : null}

      <section aria-label="Communities" className="flex flex-col gap-3">
        {items.map((community) => (
          <ContentCard
            key={community.id}
            href={ROUTES.community(community.slug)}
            title={community.name}
            description={community.description}
            icon={community.kind === 'study_group' ? 'book' : community.kind === 'club' ? 'star' : 'users'}
            official={community.is_official}
            community={!community.is_official}
            badges={[
              { label: community.kind === 'study_group' ? 'Study group' : community.kind === 'club' ? 'Club' : 'Community' },
              ...(community.subject ? [{ label: community.subject }] : []),
              ...(community.join_policy !== 'open' ? [{ label: 'Request to join', tone: 'warning' }] : []),
            ]}
            meta={[
              `${community.member_count} member${community.member_count === 1 ? '' : 's'}`,
              `${community.post_count} post${community.post_count === 1 ? '' : 's'}`,
              community.visibility === 'campus' ? 'PCCOE only' : community.visibility,
            ]}
          />
        ))}
      </section>
    </div>
  );
}
