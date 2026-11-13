import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getGigSummary, listCategories, listGigSkills, listGigs } from '@/lib/data/marketplace';
import { ROUTES, GIG_PAYMENT_TYPES, GIG_SORTS } from '@/lib/constants';
import { Button, EmptyState, LinkButton, Notice, PageHeader, SectionHeader } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { GigCard } from '@/components/gigs/GigCard';

export const metadata = { title: 'Gigs' };

const STATE_TABS = [
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'Everything' },
  { key: 'mine', label: 'Mine' },
];

/**
 * Gigs — the dedicated student work board.
 *
 * A gig is a small piece of work a student offers (tutoring, repairs, design,
 * coding help). It is deliberately not the marketplace: listings sell things,
 * gigs sell time. The board filters by category, skill and lifecycle, sorts by
 * freshness, deadline or pay, and opens a real detail page with an application.
 */
export default async function GigsPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const params = await searchParams;

  const q = typeof params?.q === 'string' && params.q.trim().length >= 2 ? params.q.trim() : null;
  const categoryId = typeof params?.category === 'string' ? params.category : null;
  const skill = typeof params?.skill === 'string' ? params.skill.trim().slice(0, 40) : null;
  const payment = GIG_PAYMENT_TYPES.some((entry) => entry.value === params?.payment) ? params.payment : null;
  const sort = GIG_SORTS.some((entry) => entry.value === params?.sort) ? params.sort : 'newest';
  const view = STATE_TABS.some((tab) => tab.key === params?.view) ? params.view : 'open';
  const mine = view === 'mine';
  const state = view === 'mine' || view === 'all' ? null : view;

  const canPost = can(actor, 'create_gigs');

  const [gigs, categories, skills, summary] = await Promise.all([
    listGigs(supabase, {
      q,
      categoryId: categoryId || null,
      skill,
      paymentType: payment,
      sort,
      state,
      creatorId: mine ? user.profile.id : null,
      status: mine ? ['published', 'draft', 'hidden'] : 'published',
      limit: 30,
    }),
    listCategories(supabase, { scope: 'gig' }),
    listGigSkills(supabase, { limit: 14 }),
    getGigSummary(supabase),
  ]);

  // Poster identities, one query for every card on the page.
  const creatorIds = [...new Set(gigs.items.map((gig) => gig.creator_id))];
  const creators = creatorIds.length
    ? await supabase.from('public_profiles').select('id, username, display_name').in('id', creatorIds)
    : { data: [] };
  const byId = new Map((creators.data || []).map((person) => [person.id, person]));

  const hasFilters = Boolean(q || categoryId || skill || payment || sort !== 'newest' || view !== 'open');

  /** Keep every other filter when one control changes. */
  const hrefWith = (overrides) => {
    const search = new URLSearchParams();
    const current = { q, category: categoryId, skill, payment, sort, view };
    for (const [key, value] of Object.entries({ ...current, ...overrides })) {
      if (!value) continue;
      if (key === 'sort' && value === 'newest') continue;
      if (key === 'view' && value === 'open') continue;
      search.set(key, String(value));
    }
    const query = search.toString();
    return query ? `${ROUTES.gigs}?${query}` : ROUTES.gigs;
  };

  const activeCount = summary.open;
  const newestLabel = view === 'mine' ? 'Your gigs' : 'Latest gigs';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Gigs"
        eyebrow="Student work board"
        description="Short paid and unpaid work offered by students — tutoring, repairs, design, coding help and more."
        action={
          canPost ? (
            <LinkButton href={ROUTES.gigNew} icon="plus" tone="accent">
              Post a Gig
            </LinkButton>
          ) : null
        }
      />

      <section aria-label="Gig board summary" className="gig-stats grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Open', value: summary.open, icon: 'briefcase' },
          { label: 'Paid', value: summary.paid, icon: 'tag' },
          { label: 'Closed', value: summary.closed, icon: 'clock' },
          { label: 'Completed', value: summary.completed, icon: 'checkCircle' },
        ].map((stat) => (
          <div key={stat.label} className="gig-stat card flex items-center gap-2.5 px-3 py-2.5">
            <span className="gig-stat__icon" aria-hidden="true">
              <Icon name={stat.icon} size={15} />
            </span>
            <span>
              <span className="block text-lg font-semibold leading-none">{stat.value}</span>
              <span className="mt-1 block text-2xs uppercase tracking-wide text-muted">{stat.label}</span>
            </span>
          </div>
        ))}
      </section>

      <section className="card flex flex-col gap-3 p-3" aria-label="Filter gigs">
        <nav aria-label="Gig status" className="flex flex-wrap gap-1.5">
          {STATE_TABS.map((tab) => (
            <Link key={tab.key} href={hrefWith({ view: tab.key })} className="chip" data-active={view === tab.key}>
              {tab.key === 'open' ? <span className="gig-live-dot" aria-hidden="true" /> : null}
              {tab.label}
              {tab.key === 'open' && activeCount ? <span className="text-muted-soft">{activeCount}</span> : null}
            </Link>
          ))}
        </nav>

        <form method="get" action={ROUTES.gigs} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <input type="hidden" name="view" value={view} />
          <label className="flex min-w-[13rem] flex-1 flex-col gap-1.5">
            <span className="field-label">Search</span>
            <span className="relative">
              <Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-soft" />
              <input
                name="q"
                defaultValue={q || ''}
                maxLength={80}
                placeholder="Tutoring, poster design, Python…"
                className="control control-input h-9 pl-8"
              />
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="field-label">Category</span>
            <select name="category" defaultValue={categoryId || ''} className="control control-select h-9 w-40 py-0">
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="field-label">Skill</span>
            <select name="skill" defaultValue={skill || ''} className="control control-select h-9 w-36 py-0">
              <option value="">Any skill</option>
              {skills.items.map((entry) => (
                <option key={entry.label} value={entry.label}>
                  {entry.label}
                </option>
              ))}
              {skill && !skills.items.some((entry) => entry.label === skill) ? <option value={skill}>{skill}</option> : null}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="field-label">Pay</span>
            <select name="payment" defaultValue={payment || ''} className="control control-select h-9 w-28 py-0">
              <option value="">Any</option>
              {GIG_PAYMENT_TYPES.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="field-label">Sort</span>
            <select name="sort" defaultValue={sort} className="control control-select h-9 w-36 py-0">
              {GIG_SORTS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          <Button type="submit" size="sm" variant="secondary" icon="filter">
            Apply
          </Button>
          {hasFilters ? (
            <Link href={ROUTES.gigs} className="pb-1.5 text-2xs text-muted underline hover:text-ink">
              Clear
            </Link>
          ) : null}
        </form>

        <div className="flex flex-wrap gap-x-2 gap-y-1.5 text-2xs text-muted">
          <span className="text-muted-soft">Filter by skill:</span>
          {skills.items.slice(0, 8).map((entry) => (
            <Link
              key={entry.label}
              href={hrefWith({ skill: skill === entry.label ? null : entry.label })}
              className="gig-skill gig-skill--link"
              data-active={skill === entry.label}
            >
              {entry.label}
            </Link>
          ))}
          {!skills.items.length ? <span>No skills listed yet.</span> : null}
        </div>
      </section>

      {gigs.unavailable ? (
        <Notice tone="warning" icon="flag">
          Gigs could not be loaded right now. Try again in a moment.
        </Notice>
      ) : null}

      <SectionHeader
        title={newestLabel}
        description={
          view === 'mine'
            ? 'Everything you have posted, including closed work.'
            : `${gigs.items.length} gig${gigs.items.length === 1 ? '' : 's'} on this page.`
        }
      />

      {!gigs.unavailable && !gigs.items.length ? (
        <EmptyState
          icon="briefcase"
          title={hasFilters ? 'No gigs match those filters' : mine ? 'You have not posted a gig yet' : 'No gigs here yet'}
          description={
            hasFilters
              ? 'Try a different category, skill or status.'
              : canPost
                ? 'Post the first one — it takes a minute.'
                : 'Gigs appear here as soon as students post them.'
          }
          action={
            canPost ? (
              <LinkButton href={ROUTES.gigNew} size="sm" tone="accent" icon="plus">
                Post a Gig
              </LinkButton>
            ) : null
          }
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {gigs.items.map((gig) => (
          <GigCard key={gig.id} gig={gig} creator={byId.get(gig.creator_id) || null} />
        ))}
      </div>

      <p className="text-center text-2xs text-muted">
        Agree the details in Messages, meet on campus, and never pay in advance to someone you do not know.
      </p>
    </div>
  );
}
