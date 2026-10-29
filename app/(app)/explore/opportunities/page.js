import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listOpportunities } from '@/lib/data/campus';
import { OPPORTUNITY_CATEGORIES, ROUTES } from '@/lib/constants';
import { PageHeader, EmptyState, Notice, LinkButton, Card } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { ContentCard } from '@/components/content/ContentCard';
import { formatDate } from '@/lib/utils';

export const metadata = { title: 'Opportunity board' };

const categoryLabel = (value) => OPPORTUNITY_CATEGORIES.find((option) => option.value === value)?.label || value;

// Authoritative homes for opportunity-adjacent discovery. The board links to
// them instead of duplicating their data.
const SOURCES = [
  { href: ROUTES.teams, icon: 'users', label: 'Team finder', description: 'Project collaboration and teammate recruitment live here.' },
  { href: ROUTES.clubs, icon: 'star', label: 'Club recruitment', description: 'Clubs announce recruitment on their own pages.' },
];

function FilterBar({ current }) {
  return (
    <form method="get" action="/explore/opportunities" className="card flex flex-col gap-3 p-3" aria-label="Filter opportunities">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Search
          <input name="q" defaultValue={current.q} maxLength={80} placeholder="Title, organization, keyword…" className="control control-input" />
        </label>
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Category
          <select name="category" defaultValue={current.category} className="control control-select">
            <option value="">All categories</option>
            {OPPORTUNITY_CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Published by
          <select name="source" defaultValue={current.source} className="control control-select">
            <option value="">Official + community</option>
            <option value="official">Official only</option>
            <option value="community">Community only</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Mode
          <select name="mode" defaultValue={current.mode} className="control control-select">
            <option value="">On-site, remote, hybrid</option>
            <option value="onsite">On-site</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Sort
          <select name="sort" defaultValue={current.sort} className="control control-select">
            <option value="newest">Newest first</option>
            <option value="deadline">Deadline: soonest first</option>
          </select>
        </label>
        <label className="check self-end">
          <input type="checkbox" name="expired" value="1" defaultChecked={current.expired} className="check-input" />
          <span className="check-box" aria-hidden="true">
            <svg className="check-mark" viewBox="0 0 24 24" focusable="false"><path d="M5 12.5 10 17.5 19 7" /></svg>
          </span>
          <span className="check-copy"><span className="check-title">Include expired</span></span>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-secondary btn-sm">Apply</button>
          <LinkButton href="/explore/opportunities" size="sm" variant="ghost">Clear</LinkButton>
        </div>
      </div>
    </form>
  );
}

/**
 * Opportunity board: internships, programs, hackathons, competitions and
 * scholarships in one discovery surface, with honest provenance and honest
 * deadlines. Team formation, club recruitment and gigs link out to the
 * surfaces that own them.
 */
export default async function OpportunitiesPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const params = await searchParams;

  const current = {
    q: typeof params?.q === 'string' ? params.q.slice(0, 80) : '',
    category: OPPORTUNITY_CATEGORIES.some((option) => option.value === params?.category) ? params.category : '',
    source: params?.source === 'official' || params?.source === 'community' ? params.source : '',
    mode: ['onsite', 'remote', 'hybrid'].includes(params?.mode) ? params.mode : '',
    sort: params?.sort === 'deadline' ? 'deadline' : 'newest',
    expired: params?.expired === '1',
  };
  const hasFilters = Boolean(current.q.trim() || current.category || current.source || current.mode || current.expired || current.sort === 'deadline');

  const { items, unavailable } = await listOpportunities(supabase, {
    limit: 30,
    q: current.q.trim() || null,
    category: current.category || null,
    source: current.source || null,
    mode: current.mode || null,
    sort: current.sort,
    includeExpired: current.expired,
  });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Opportunity board"
        description="Internships, programs, hackathons, competitions and scholarships — official and community-submitted, clearly labelled."
        back={{ href: ROUTES.explore, label: 'Explore' }}
        action={
          can(actor, 'submit_opportunities') ? (
            <LinkButton href="/explore/opportunities/new" size="sm" icon="plus">Submit one</LinkButton>
          ) : null
        }
      />

      <section aria-label="Related boards" className="grid gap-2 sm:grid-cols-3">
        {SOURCES.map((source) => (
          <Link key={source.href} href={source.href} className="card flex items-start gap-2.5 p-3 hover:no-underline">
            <Icon name={source.icon} size={16} className="mt-0.5 shrink-0 text-muted" />
            <span className="min-w-0">
              <span className="block text-[0.8125rem] font-semibold">{source.label}</span>
              <span className="mt-0.5 block text-2xs leading-relaxed text-muted">{source.description}</span>
            </span>
          </Link>
        ))}
      </section>

      <FilterBar current={current} />

      {unavailable ? <Notice tone="warning" icon="flag">Opportunities could not be loaded right now.</Notice> : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="briefcase"
          title={hasFilters ? 'No opportunities match those filters' : 'No opportunities yet'}
          description={hasFilters
            ? 'Try fewer filters, or check the related boards above.'
            : 'Posted internships and programs appear here, clearly marked as official or community-submitted.'}
          action={
            can(actor, 'submit_opportunities') ? (
              <LinkButton href="/explore/opportunities/new" variant="primary" size="sm">Submit one</LinkButton>
            ) : null
          }
        />
      ) : null}

      <section aria-label="Opportunities" className="flex flex-col gap-3">
        {items.map((item) => {
          const expired = Boolean(item.deadline && item.deadline < today);
          return (
            <ContentCard
              key={item.id}
              href={ROUTES.opportunity(item.id)}
              title={item.title}
              description={item.description}
              icon="briefcase"
              official={item.source === 'official'}
              community={item.source !== 'official'}
              badges={[
                ...(item.category ? [{ label: categoryLabel(item.category) }] : []),
                ...(item.mode ? [{ label: item.mode }] : []),
                ...(item.deadline ? [{ label: expired ? `Closed ${formatDate(item.deadline)}` : `Apply by ${formatDate(item.deadline)}`, tone: expired ? 'danger' : 'warning' }] : []),
              ]}
              meta={[item.organization, item.location]}
            />
          );
        })}
      </section>

      <Card className="p-4 text-2xs leading-relaxed text-muted">
        Community submissions are not verified by the campus — verify before you apply, never pay a
        fee to apply, and report anything misleading, expired, unsafe or inappropriate from the
        opportunity page.
      </Card>
    </div>
  );
}
