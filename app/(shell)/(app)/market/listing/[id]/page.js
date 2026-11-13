import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import {
  getListing,
  getListingSeller,
  getListingContactNote,
  getMyListingInterest,
  getListingRating,
} from '@/lib/data/marketplace';
import { ROUTES, UUID_REGEX } from '@/lib/constants';
import { PageHeader, Badge, Notice, LinkButton, StaffDot, Card } from '@/components/ui';
import { IdentityLine } from '@/components/identity/IdentityLine';
import { MarketplaceGallery } from '@/components/marketplace/MarketplaceGallery';
import { ListingActions } from '@/components/marketplace/ListingActions';
import { ReportDialog } from '@/components/social/ReportDialog';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { formatPrice, formatDate } from '@/lib/utils';

/**
 * Listing detail (spec §18).
 *
 * The contact note is only ever rendered after the server released it through
 * `record_listing_interest()`. Sellers get status controls; moderators get the
 * standard moderation entry point, which is audited like every staff action.
 */
export async function generateMetadata({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return { title: 'Listing' };
  const supabase = await getServerClient();
  const listing = await getListing(supabase, id);
  return { title: listing?.title || 'Listing' };
}

export default async function ListingPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);

  const listing = await getListing(supabase, id);
  if (!listing) notFound();

  const isSeller = listing.seller_id === user.profile.id;
  const canModerateMarketplace = can(actor, 'moderate_marketplace') || can(actor, 'moderate_all');
  const visible = ['active', 'reserved', 'sold'].includes(listing.status) || isSeller || canModerateMarketplace;
  if (!visible) notFound();

  const [seller, interest, rating] = await Promise.all([
    getListingSeller(supabase, listing.seller_id),
    getMyListingInterest(supabase, listing.id, user.profile.id),
    getListingRating(supabase, listing.id, user.profile.id),
  ]);
  const contactNote = interest && !isSeller ? await getListingContactNote(supabase, listing.id) : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={listing.title}
        back={{ href: ROUTES.market, label: 'Market' }}
        action={
          isSeller || canModerateMarketplace ? (
            <LinkButton href={`${ROUTES.listing(listing.id)}/edit`} size="sm" variant="secondary">
              Edit listing
            </LinkButton>
          ) : null
        }
      />

      {process.env.CAMPUS_MARKET_ATTACHMENTS_ENABLED === '1' && process.env.CAMPUS_STORAGE_V3_ENABLED === '1' ? <MarketplaceGallery listingId={listing.id} /> : null}
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{listing.is_free ? 'Free' : formatPrice(listing.price)}</Badge>
          {listing.is_negotiable && !listing.is_free ? <Badge>Negotiable</Badge> : null}
          {listing.condition && listing.condition !== 'not_applicable' ? (
            <Badge>{listing.condition.replace(/_/g, ' ')}</Badge>
          ) : null}
          <Badge>{listing.status}</Badge>
          {listing.is_official ? <Badge tone="accent">Official</Badge> : null}
        </div>

        <p className="user-text text-[0.9375rem] leading-relaxed"><LinkifiedText text={listing.description} mentions /></p>

        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
          <div className="flex gap-1">
            <dt>Listed</dt>
            <dd>{formatDate(listing.created_at)}</dd>
          </div>
          {listing.location ? (
            <div className="flex gap-1">
              <dt>Location</dt>
              <dd>{listing.location}</dd>
            </div>
          ) : null}
          <div className="flex gap-1">
            <dt>Category</dt>
            <dd>{listing.category_id ? 'Listed category' : 'Uncategorised'}</dd>
          </div>
        </dl>
      </Card>

      {listing.status === 'pending' ? (
        <Notice tone="warning" icon="clock">
          This listing is waiting for marketplace review. It is visible to you and to moderators only.
        </Notice>
      ) : null}
      {listing.status === 'hidden' || listing.status === 'removed' || listing.status === 'rejected' ? (
        <Notice tone="warning" icon="flag">
          This listing was {listing.status} by a moderator{listing.moderation_reason ? <>{': '}<LinkifiedText text={listing.moderation_reason} /></> : '.'}
        </Notice>
      ) : null}

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">Seller</h2>
        {seller ? (
          <IdentityLine
            username={seller.username}
            displayName={seller.display_name}
            isStaff={seller.is_staff}
            badge={
              <>
                {seller.marketplace_completed_count > 0 ? (
                  <Badge>{seller.marketplace_completed_count} completed</Badge>
                ) : null}
                {seller.is_staff ? <StaffDot label="Campus+ staff" /> : null}
              </>
            }
          />
        ) : (
          <p className="text-[0.8125rem] text-muted">Seller profile unavailable.</p>
        )}
        <p className="text-2xs text-muted">
          {seller?.marketplace_completed_count > 0
            ? `${seller.marketplace_completed_count} completed exchanges · ${
                seller.reputation_count ? `${seller.reputation_score}/${seller.reputation_count} reputation` : 'no ratings yet'
              }`
            : 'No completed exchanges yet.'}
        </p>

        <ListingActions
          listingId={listing.id}
          sellerId={listing.seller_id}
          sellerUsername={seller?.username || null}
          isSeller={isSeller}
          status={listing.status}
          isFree={Boolean(listing.is_free)}
          canMessage={can(actor, 'send_messages')}
          canReport={can(actor, 'report_content')}
          canRate={Boolean(rating === null && can(actor, 'rate_users') && listing.status === 'sold')}
          alreadyInterested={Boolean(interest)}
          initialNote={contactNote}
        />

        {rating ? (
          <Notice tone="success">
            You rated this exchange {rating.score}/5{rating.comment ? <> — “<LinkifiedText text={rating.comment} />”</> : ''}.
          </Notice>
        ) : null}
      </Card>

      {canModerateMarketplace ? (
        <Card className="flex flex-wrap items-center gap-3 p-3">
          <span className="text-2xs text-muted">Moderator</span>
          <Link
            href={`/moderator?target=marketplace_listing&id=${listing.id}`}
            className="text-2xs underline hover:text-ink"
          >
            Open in the moderation queue
          </Link>
          <ReportDialog targetType="marketplace_listing" targetRef={listing.id} label="this listing" />
        </Card>
      ) : null}

      <p className="pb-2 text-center text-2xs text-muted">
        Keep it on campus. If something feels wrong, report it — moderators review every report.
      </p>
    </div>
  );
}
