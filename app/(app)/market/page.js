import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listListings, listDeals, listCategories, getMarketSummary } from '@/lib/data/marketplace';
import { ROUTES } from '@/lib/constants';
import { Badge, Button, Card, EmptyState, LinkButton, Notice, PageHeader, SectionHeader, TiltCard } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { formatDate, formatPrice } from '@/lib/utils';

export const metadata = { title: 'Market' };

// Gigs are their own section now. The market keeps things you buy, give away
// or claim — see /gigs for student work.
const TABS = [
  { key: 'all', label: 'Everything' },
  { key: 'free', label: 'Free stuff' },
  { key: 'deals', label: 'Campus deals' },
];

/**
 * Marketplace (spec §17–§20).
 *
 * Listings, free items and official campus deals — the same infrastructure,
 * different intent. Gigs moved to their own /gigs section; this page links
 * there instead of repeating the board. Prices and conditions are the only
 * numbers shown; there are no view counts or "trending" badges.
 */
export default async function MarketPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);

  const params = await searchParams;
  // Old links to the gigs tab (and the "Post a gig" flow) belong to /gigs.
  if (params?.tab === 'gigs') {
    const q = typeof params?.q === 'string' && params.q.trim() ? `?q=${encodeURIComponent(params.q.trim())}` : '';
    redirect(`${ROUTES.gigs}${q}`);
  }
  const tab = TABS.some((item) => item.key === params?.tab) ? params.tab : 'all';
  const q = typeof params?.q === 'string' && params.q.trim().length >= 2 ? params.q.trim() : null;
  const categoryId = typeof params?.category === 'string' && params.category ? params.category : null;

  // The tab's own list, the category list and the summary counts are
  // independent: one fan-out instead of a serial warm-up followed by the list.
  const [categories, summary, listings, deals] = await Promise.all([
    listCategories(supabase),
    getMarketSummary(supabase),
    tab === 'deals'
      ? Promise.resolve({ items: [], unavailable: false })
      : listListings(supabase, { free: tab === 'free' ? true : null, categoryId, q, limit: 24 }),
    tab === 'deals' ? listDeals(supabase, { limit: 24 }) : Promise.resolve({ items: [], unavailable: false }),
  ]);

  const canSell = can(actor, 'create_marketplace_listing');

  // Seller identities for whichever list the tab loaded.
  const sellers = await (async () => {
    const ids = [...new Set(listings.items.map((listing) => listing.seller_id))];
    if (!ids.length) return new Map();
    const { data } = await supabase.from('public_profiles').select('id, username, display_name, is_staff').in('id', ids);
    return new Map((data || []).map((person) => [person.id, person]));
  })();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Market"
        description="Buy, sell, give away and hire — text first, meet on campus."
        action={
          <div className="flex items-center gap-2">
            {canSell ? <LinkButton href="/market/new" size="sm" icon="plus">Sell something</LinkButton> : null}
          </div>
        }
      />

      <Card className="p-3">
        <nav aria-label="Market sections" className="flex flex-wrap gap-1.5">
          {TABS.map((item) => (
            <Link
              key={item.key}
              href={item.key === 'all' ? ROUTES.market : `${ROUTES.market}?tab=${item.key}`}
              className="chip"
              data-active={tab === item.key}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="mt-2 text-2xs text-muted">
          {summary.active} available · {summary.free} free · {summary.sold} completed
        </p>
      </Card>

      <form method="get" action={ROUTES.market} className="glass glass-sheen flex flex-wrap items-end gap-3 rounded-[var(--radius-lg)] p-3">
        <input type="hidden" name="tab" value={tab} />
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
          <span className="field-label">Search</span>
          <input name="q" defaultValue={q || ''} maxLength={80} placeholder="Search listings" className="control control-input h-9" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Category</span>
          <select name="category" defaultValue={categoryId || ''} className="control control-select h-9 w-44 py-0">
            <option value="">All</option>
            {categories
              .filter((category) => category.scope === 'marketplace')
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </select>
        </label>
        <Button type="submit" size="sm" variant="secondary" icon="filter">
          Apply
        </Button>
      </form>

      {listings.unavailable || deals.unavailable ? (
        <Notice tone="warning" icon="flag">
          Part of the marketplace could not be loaded. Refresh to try again.
        </Notice>
      ) : null}

      {tab === 'listings' && !q && !categoryId && featuredListing ? (
        <section aria-label="Featured listing" className="flex flex-col gap-2">
          <SectionHeader title="Just listed" description="The newest item on the campus marketplace." />
          <TiltCard intensity="soft">
            <div className="glass glass-sheen card-glass flex flex-wrap items-end justify-between gap-4 p-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{featuredListing.is_free ? 'Free' : formatPrice(featuredListing.price)}</Badge>
                  {featuredListing.condition && featuredListing.condition !== 'not_applicable' ? (
                    <Badge>{featuredListing.condition.replace(/_/g, ' ')}</Badge>
                  ) : null}
                  {featuredListing.location ? <Badge>{featuredListing.location}</Badge> : null}
                </div>
                <h3 className="t-section mt-2">{featuredListing.title}</h3>
                {featuredListing.description ? (
                  <p className="user-text t-secondary mt-1.5 max-w-xl"><LinkifiedText text={featuredListing.description} /></p>
                ) : null}
                {featuredSeller ? <p className="t-caption mt-2">Listed by @{featuredSeller.username}</p> : null}
              </div>
              <LinkButton href={ROUTES.listing(featuredListing.id)} variant="sheen" icon="arrowUpRight">
                View listing
              </LinkButton>
            </div>
          </TiltCard>
        </section>
      ) : null}

      {!listings.unavailable && listings.items.length ? (
        <section aria-label="Listings" className="flex flex-col gap-3">
          {listings.items.map((listing) => {
            const seller = sellers.get(listing.seller_id);
            return (
              <ContentCard
                key={listing.id}
                href={ROUTES.listing(listing.id)}
                title={listing.title}
                description={listing.description}
                icon="tag"
                timestamp={listing.created_at}
                badges={[
                  { label: listing.is_free ? 'Free' : formatPrice(listing.price), tone: 'accent' },
                  ...(listing.condition && listing.condition !== 'not_applicable'
                    ? [{ label: listing.condition.replace(/_/g, ' ') }]
                    : []),
                  ...(listing.status === 'reserved' ? [{ label: 'Reserved', tone: 'warning' }] : []),
                ]}
                meta={[
                  seller ? `@${seller.username}` : null,
                  listing.location || null,
                ]}
              />
            );
          })}
        </section>
      ) : null}

      {tab === 'deals' && deals.items.length ? (
        <section aria-label="Campus deals" className="flex flex-col gap-3">
          {deals.items.map((deal) => (
            <ContentCard
              key={deal.id}
              title={deal.title}
              description={deal.description}
              icon="star"
              official={deal.is_official}
              badges={[
                ...(deal.discount_details ? [{ label: deal.discount_details, tone: 'accent' }] : []),
                ...(deal.valid_until ? [{ label: `Until ${formatDate(deal.valid_until)}` }] : []),
              ]}
              meta={[deal.merchant, deal.contact_info]}
            />
          ))}
        </section>
      ) : null}

      {!listings.unavailable && !deals.unavailable && !listings.items.length && !deals.items.length ? (
        <EmptyState
          icon="tag"
          title={q ? 'Nothing matched that search' : 'The marketplace is empty'}
          description={
            canSell
              ? 'Nothing has been listed yet. Sell something or give something away — text and a price, that is all it takes.'
              : 'Nothing has been listed yet.'
          }
          action={canSell ? <LinkButton href="/market/new" variant="primary" size="sm">Create the first listing</LinkButton> : null}
        />
      ) : null}

      <p className="pb-2 text-center text-2xs text-muted">
        Listings are text only — no photos, no file uploads, no payments. Meet on campus and settle directly.
      </p>
    </div>
  );
}
