import { normalizeBranch } from '@/lib/branches';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listResources, listResourceSubjects } from '@/lib/data/campus';
import { BRANCHES, YEARS, SEMESTERS, RESOURCE_TYPES, ROUTES } from '@/lib/constants';
import { PageHeader, EmptyState, Notice, LinkButton, Card, Badge } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { ContentCard } from '@/components/content/ContentCard';
import { formatDate } from '@/lib/utils';

export const metadata = { title: 'Resources' };

const typeLabel = (value) => RESOURCE_TYPES.find((type) => type.value === value)?.label || value;

function FilterBar({ current }) {
  return (
    <form method="get" action="/explore/resources" className="card flex flex-col gap-3 p-3" aria-label="Filter resources">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Search
          <input name="q" defaultValue={current.q} maxLength={80} placeholder="Title, subject, keyword…" className="control control-input" />
        </label>
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Subject
          <input name="subject" defaultValue={current.subject} maxLength={120} placeholder="e.g. Operating Systems" className="control control-input" />
        </label>
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Branch
          <select name="branch" defaultValue={current.branch} className="control control-select">
            <option value="">All branches</option>
            {BRANCHES.map((branch) => (
              <option key={branch} value={branch}>{branch}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Year
          <select name="year" defaultValue={current.year} className="control control-select">
            <option value="">All years</option>
            {YEARS.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Semester
          <select name="semester" defaultValue={current.semester} className="control control-select">
            <option value="">All semesters</option>
            {SEMESTERS.map((semester) => (
              <option key={semester} value={semester}>Sem {semester}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Type
          <select name="type" defaultValue={current.type} className="control control-select">
            <option value="">All types</option>
            {RESOURCE_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
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
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-secondary btn-sm">Apply</button>
          <LinkButton href="/explore/resources" size="sm" variant="ghost">Clear</LinkButton>
        </div>
      </div>
    </form>
  );
}

/**
 * Knowledge exchange: the resource hub with subject collections, full
 * filtering and clear official/community provenance. Text-first and
 * link-based — nothing is hosted on Campus+.
 */
export default async function ResourcesPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const params = await searchParams;

  const current = {
    q: typeof params?.q === 'string' ? params.q.slice(0, 80) : '',
    subject: typeof params?.subject === 'string' ? params.subject.slice(0, 120) : '',
    branch: BRANCHES.includes(normalizeBranch(params?.branch)) ? normalizeBranch(params.branch) : '',
    year: YEARS.includes(params?.year) ? params.year : '',
    semester: SEMESTERS.includes(params?.semester) ? params.semester : '',
    type: RESOURCE_TYPES.some((type) => type.value === params?.type) ? params.type : '',
    source: params?.source === 'official' || params?.source === 'community' ? params.source : '',
  };
  const hasFilters = Object.values(current).some((value) => String(value).trim());

  const [{ items, unavailable }, subjects] = await Promise.all([
    listResources(supabase, {
      limit: 30,
      q: current.q.trim() || null,
      subject: current.subject.trim() || null,
      branch: current.branch || null,
      year: current.year || null,
      semester: current.semester || null,
      type: current.type || null,
      source: current.source || null,
    }),
    listResourceSubjects(supabase),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Knowledge exchange"
        description="Notes, previous papers and reference material shared by students and staff."
        back={{ href: ROUTES.explore, label: 'Explore' }}
        action={can(actor, 'submit_resources') ? <LinkButton href="/explore/resources/new" size="sm" icon="plus">Submit a resource</LinkButton> : null}
      />

      {subjects.items.length ? (
        <section aria-label="Browse by subject" className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Browse by subject</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {subjects.items.map((entry) => (
              <li key={entry.subject}>
                <Link
                  href={`/explore/resources?subject=${encodeURIComponent(entry.subject)}`}
                  className="card flex items-center gap-2 p-3 hover:no-underline"
                >
                  <Icon name="book" size={15} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">{entry.subject}</span>
                  <Badge>{entry.count}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <FilterBar current={current} />

      {unavailable ? <Notice tone="warning" icon="flag">Resources could not be loaded right now.</Notice> : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="book"
          title={hasFilters ? 'No resources match those filters' : 'No resources yet'}
          description={hasFilters
            ? 'Try fewer filters, or submit the resource you wish existed.'
            : 'Share a link to notes or a paper you found useful. Links must be public and safe to open.'}
          action={can(actor, 'submit_resources') ? <LinkButton href="/explore/resources/new" variant="primary" size="sm">Submit a resource</LinkButton> : null}
        />
      ) : null}

      <section aria-label="Resources" className="flex flex-col gap-3">
        {items.map((resource) => (
          <ContentCard
            key={resource.id}
            href={ROUTES.resource(resource.id)}
            title={resource.title}
            description={resource.description}
            icon="book"
            official={resource.is_official}
            community={!resource.is_official}
            badges={[
              ...(resource.type ? [{ label: typeLabel(resource.type) }] : []),
              ...(resource.branch ? [{ label: normalizeBranch(resource.branch) }] : []),
              ...(resource.semester ? [{ label: `Sem ${resource.semester}` }] : []),
            ]}
            meta={[resource.subject, `Published ${formatDate(resource.published_at || resource.created_at)}`]}
          />
        ))}
      </section>

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="text-sm font-semibold">Keep exploring</h2>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/explore/projects" size="sm" variant="secondary">Project showcase</LinkButton>
          <LinkButton href="/explore?scope=discussions" size="sm" variant="secondary">Academic discussions</LinkButton>
          <LinkButton href={ROUTES.study} size="sm" variant="secondary">Find a study partner</LinkButton>
        </div>
        <p className="text-2xs text-muted">
          Inaccurate, broken, unsafe or inappropriate? Every resource page has a report button — a moderator reviews it.
        </p>
      </Card>
    </div>
  );
}
