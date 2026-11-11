import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listCategories } from '@/lib/data/marketplace';
import { ROUTES, LIMITS, MARKETPLACE_CONDITIONS } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { createListing } from '@/lib/actions/marketplace';

export const metadata = { title: 'New listing' };

/**
 * Create a listing (spec §18). Text only: a title, a description, a price, an
 * optional location and a contact note that only interested students ever see.
 * Gigs moved to `/gigs/new` — old `?type=gig` links redirect there.
 */
export default async function NewListingPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const params = await searchParams;
  // Gigs have their own form now (/gigs/new). Keep old links working.
  if (params?.type === 'gig') redirect(ROUTES.gigNew);

  if (!can(actor, 'create_marketplace_listing')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Sell something" back={{ href: ROUTES.market, label: 'Market' }} />
        <Notice tone="warning" icon="lock">
          Your account cannot create listings right now.
        </Notice>
      </div>
    );
  }

  const categories = await listCategories(supabase, { scope: 'marketplace' });
  const options = categories.map((category) => ({ value: category.id, label: category.name }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Sell or give away"
        description="Describe the item honestly and add product photos if you like."
        back={{ href: ROUTES.market, label: 'Market' }}
      />

      <ActionForm
        action={createListing}
        marketplaceImages={user.profile.username}
        submitLabel="Publish listing"
        pendingLabel="Publishing…"
        successMessage="Your listing is live. Interested students can now reach you."
        cancelHref={ROUTES.market}
        fields={[
          { name: 'title', label: 'Title', required: true, maxLength: LIMITS.listing.title.max, placeholder: 'Casio FX-991 calculator' },
          { name: 'description', label: 'Description', type: 'textarea', required: true, maxLength: LIMITS.listing.description.max },
          { name: 'category_id', label: 'Category', type: 'select', required: true, options },
          { name: 'price', label: 'Price (₹)', type: 'number', min: 0, step: '1', hint: 'Leave empty for free items — tick the free box below.' },
          { name: 'is_free', label: 'This is a free item', type: 'checkbox' },
          { name: 'is_negotiable', label: 'Price is negotiable', type: 'checkbox' },
          {
            name: 'condition',
            label: 'Condition',
            type: 'select',
            options: MARKETPLACE_CONDITIONS.filter((item) => item.value !== 'not_applicable'),
            defaultValue: 'good',
          },
          { name: 'location', label: 'Location', maxLength: LIMITS.listing.location.max, placeholder: 'PCCOE library, Block A' },
          {
            name: 'contact_note',
            label: 'Note for interested students',
            maxLength: 200,
            hint: 'Only shown after someone taps "I\'m interested". Still, keep it campus-appropriate.',
          },
        ]}
      />

      <Notice tone="neutral" icon="shield">
        Never share passwords or banking details in a listing. Campus+ is a campus marketplace — no
        payments are processed here.
      </Notice>
    </div>
  );
}
