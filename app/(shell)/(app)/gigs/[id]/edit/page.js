import { GigGallery } from '@/components/campus/GigGallery';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { getGig, listCategories } from '@/lib/data/marketplace';
import { ROUTES, UUID_REGEX, LIMITS, GIG_PAYMENT_TYPES } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { updateGig } from '@/lib/actions/marketplace';

export const metadata = { title: 'Edit gig' };

/**
 * Edit a gig. Only the poster sees this page at all; RLS enforces the same rule
 * again on the UPDATE, so a hand-typed id cannot change someone else's work.
 */
export default async function EditGigPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const gig = await getGig(supabase, id);
  if (!gig) notFound();
  if (gig.creator_id !== user.profile.id) notFound();

  const categories = await listCategories(supabase, { scope: 'gig' });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Edit gig"
        eyebrow={gig.title}
        description="Changes appear on the board immediately. The gig keeps its link and its applications."
        back={{ href: ROUTES.gig(gig.id), label: 'Back to the gig' }}
      />

      {gig.status !== 'published' ? (
        <Notice tone="warning" icon="flag">
          This gig is {gig.status}. Editing it does not republish it — moderators handle that.
        </Notice>
      ) : null}

      <GigGallery postId={id} manage username={user.profile.username} />
      <ActionForm
        action={updateGig}
        hidden={{ id: gig.id, category: gig.category }}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        successMessage="Saved."
        cancelHref={ROUTES.gig(gig.id)}
        fields={[
          {
            name: 'title',
            label: 'What is the gig?',
            required: true,
            maxLength: LIMITS.gig.title.max,
            defaultValue: gig.title,
          },
          {
            name: 'description',
            label: 'Describe the work',
            type: 'textarea',
            required: true,
            rows: 6,
            maxLength: LIMITS.gig.description.max,
            defaultValue: gig.description,
          },
          {
            name: 'category_id',
            label: 'Category',
            type: 'select',
            defaultValue: gig.category_id || '',
            placeholder: 'Keep the current category',
            options: categories.map((category) => ({ value: category.id, label: category.name })),
            hint: 'Pick one to move the gig to a different category.',
          },
          {
            name: 'skills',
            label: 'Required skills',
            maxLength: 480,
            defaultValue: (gig.skills || []).join(', '),
            hint: `Comma-separated, up to ${LIMITS.gig.maxSkills}.`,
          },
          {
            name: 'payment_type',
            label: 'Payment',
            type: 'select',
            required: true,
            defaultValue: gig.payment_type || 'unpaid',
            options: GIG_PAYMENT_TYPES,
          },
          {
            name: 'compensation',
            label: 'Rate or amount',
            maxLength: LIMITS.gig.compensation.max,
            defaultValue: gig.compensation || '',
          },
          {
            name: 'deadline',
            label: 'Apply by',
            type: 'date',
            defaultValue: gig.deadline || '',
          },
          {
            name: 'availability',
            label: 'Availability',
            maxLength: LIMITS.gig.availability.max,
            defaultValue: gig.availability || '',
          },
          {
            name: 'contact_details',
            label: 'What should applicants tell you?',
            type: 'textarea',
            rows: 3,
            maxLength: LIMITS.gig.contact.max,
            defaultValue: gig.contact_details || '',
          },
        ]}
      />
    </div>
  );
}
