import Link from 'next/link';
import '@/app/styles/market-grid.css';
import { Icon } from '@/components/ui/icons';
import { MarketPlaceholder } from '@/components/marketplace/MarketPlaceholder';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listListings, listDeals, listCategories, getMarketSummary } from '@/lib/data/marketplace';
import { ROUTES } from '@/lib/constants';
import { Button, Card, EmptyState, LinkButton, Notice, PageHeader } from '@/components/ui';
import { MarketplaceGallery } from '@/components/marketplace/MarketplaceGallery';
import { ContentCard } from '@/components/content/ContentCard';
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

  const marketImages = process.env.CAMPUS_MARKET_ATTACHMENTS_ENABLED === '1' && process.env.CAMPUS_STORAGE_V3_ENABLED === '1';
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
        description="Find something useful, give it a new home, and connect with students on campus."
        action={
          <div className="flex items-center gap-2">
            <LinkButton href={ROUTES.gigs} size="sm" variant="secondary" icon="briefcase">
              Student gigs
            </LinkButton>
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

      {!listings.unavailable && listings.items.length ? (
        <section aria-label="Listings" className="market-grid">
          {listings.items.map((listing) => {
            const seller = sellers.get(listing.seller_id);
            return (
              <Link key={listing.id} href={ROUTES.listing(listing.id)} className="market-product">
                <div className="market-product__image">
                  {marketImages ? <MarketplaceGallery listingId={listing.id} coverOnly /> : <MarketPlaceholder />}
                  {listing.status === 'reserved' ? <span className="market-product__reserved">Reserved</span> : null}
                </div>
                <div className="market-product__body">
                  <span className="market-product__price">{listing.is_free ? 'Free' : formatPrice(listing.price)}</span>
                  <h2>{listing.title}</h2>
                  {listing.description ? <p className="market-product__description">{listing.description}</p> : null}
                  <div className="market-product__meta">
                    {listing.condition && listing.condition !== 'not_applicable' ? <span>{listing.condition.replace(/_/g, ' ')}</span> : null}
                    {listing.location ? <span><Icon name="mapPin" size={13} />{listing.location}</span> : null}
                  </div>
                  {seller ? <p className="market-product__seller">Listed by @{seller.username}</p> : null}
                </div>
              </Link>
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
              ? 'Nothing has been listed yet. Sell something or give something away to another student.'
              : 'Nothing has been listed yet.'
          }
          action={canSell ? <LinkButton href="/market/new" variant="primary" size="sm">Create the first listing</LinkButton> : null}
        />
      ) : null}

      <p className="pb-2 text-center text-2xs text-muted">
        Meet on campus and settle directly. Campus+ does not process payments.
      </p>
    </div>
  );
}
