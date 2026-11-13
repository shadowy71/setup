import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { getListing, listCategories } from '@/lib/data/marketplace';
import { ROUTES, UUID_REGEX, LIMITS, MARKETPLACE_CONDITIONS } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { MarketplaceGallery } from '@/components/marketplace/MarketplaceGallery';
import { can, toActor } from '@/lib/permissions/authorization';
import { updateListing } from '@/lib/actions/marketplace';

export const metadata = { title: 'Edit listing' };

/**
 * Edit a listing (spec §18). Only the seller can reach this page; the server
 * action re-checks ownership through RLS, so the guard below is convenience,
 * not security.
 */
export default async function EditListingPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const listing = await getListing(supabase, id);
  if (!listing) notFound();

  if (listing.seller_id !== user.profile.id && !can(toActor(user), 'moderate_marketplace') && !can(toActor(user), 'moderate_all')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Edit listing" back={{ href: ROUTES.listing(id), label: 'Listing' }} />
        <Notice tone="warning" icon="lock">
          Only the seller can edit this listing.
        </Notice>
      </div>
    );
  }

  const categories = await listCategories(supabase, { scope: 'marketplace' });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Edit listing"
        description={listing.title}
        back={{ href: ROUTES.listing(id), label: 'Listing' }}
      />
      {process.env.CAMPUS_MARKET_ATTACHMENTS_ENABLED === '1' && process.env.CAMPUS_STORAGE_V3_ENABLED === '1' ? <MarketplaceGallery listingId={listing.id} username={user.profile.username} manage /> : null}
      <ActionForm
        action={updateListing}
        hidden={{ id: listing.id }}
        submitLabel="Save changes"
        successMessage="Listing updated."
        resetOnSuccess={false}
        redirectTo={ROUTES.listing(id)}
        fields={[
          { name: 'title', label: 'Title', required: true, maxLength: LIMITS.listing.title.max, defaultValue: listing.title },
          {
            name: 'description',
            label: 'Description',
            type: 'textarea',
            required: true,
            maxLength: LIMITS.listing.description.max,
            defaultValue: listing.description,
          },
          {
            name: 'category_id',
            label: 'Category',
            type: 'select',
            required: true,
            defaultValue: listing.category_id || '',
            options: categories.map((category) => ({ value: category.id, label: category.name })),
          },
          { name: 'price', label: 'Price (₹)', type: 'number', min: 0, defaultValue: listing.price ?? '' },
          { name: 'is_free', label: 'This is a free item', type: 'checkbox', defaultChecked: listing.is_free },
          { name: 'is_negotiable', label: 'Price is negotiable', type: 'checkbox', defaultChecked: listing.is_negotiable },
          {
            name: 'condition',
            label: 'Condition',
            type: 'select',
            defaultValue: listing.condition || 'good',
            options: MARKETPLACE_CONDITIONS.filter((item) => item.value !== 'not_applicable'),
          },
          { name: 'location', label: 'Location', maxLength: LIMITS.listing.location.max, defaultValue: listing.location || '' },
          {
            name: 'contact_note',
            label: 'Note for interested students',
            maxLength: 200,
            defaultValue: '',
          },
        ]}
      />
      <Notice tone="warning" icon="lock">
        The contact note on file is not shown here; entering a value replaces it. Everything else stays
        exactly as you wrote it.
      </Notice>
    </div>
  );
}
