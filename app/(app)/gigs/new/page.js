import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listCategories } from '@/lib/data/marketplace';
import { ROUTES, LIMITS, GIG_PAYMENT_TYPES, GIG_STATES } from '@/lib/constants';
import { PageHeader, Notice, Badge } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { createGig } from '@/lib/actions/marketplace';

export const metadata = { title: 'Post a gig' };

/**
 * The dedicated gig form.
 *
 * A gig answers four questions: what is the work, what does it require, what
 * does it pay, and by when. The application note is where the poster says what
 * they want to know from applicants — contact still happens in Messages.
 */
export default async function NewGigPage() {
  const user = await requireUser();
  const actor = toActor(user);

  if (!can(actor, 'create_gigs')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Post a gig" back={{ href: ROUTES.gigs, label: 'Gigs' }} />
        <Notice tone="warning" icon="lock">
          Your account cannot post gigs right now. Ask an admin if you think this is a mistake.
        </Notice>
      </div>
    );
  }

  const supabase = await getServerClient();
  const categories = await listCategories(supabase, { scope: 'gig' });

  const fields = [
    {
      name: 'title',
      label: 'What is the gig?',
      required: true,
      maxLength: LIMITS.gig.title.max,
      placeholder: 'Maths tutoring for first-year engineering',
    },
    {
      name: 'description',
      label: 'Describe the work',
      type: 'textarea',
      required: true,
      rows: 6,
      maxLength: LIMITS.gig.description.max,
      hint: 'Scope, hours, where it happens and what a good outcome looks like.',
    },
    {
      name: 'category_id',
      label: 'Category',
      type: 'select',
      required: true,
      defaultValue: categories[0]?.id || '',
      placeholder: 'Choose a category',
      options: categories.map((category) => ({ value: category.id, label: category.name })),
    },
    {
      name: 'skills',
      label: 'Required skills',
      maxLength: 480,
      placeholder: 'Python, React, Figma',
      hint: `Comma-separated, up to ${LIMITS.gig.maxSkills}. These become the skill filters on the gig board.`,
    },
    {
      name: 'payment_type',
      label: 'Payment',
      type: 'select',
      required: true,
      defaultValue: 'paid',
      options: GIG_PAYMENT_TYPES,
    },
    {
      name: 'compensation',
      label: 'Rate or amount',
      maxLength: LIMITS.gig.compensation.max,
      placeholder: '₹500 per session',
      hint: 'Optional for unpaid gigs. Never pay anyone in advance.',
    },
    {
      name: 'deadline',
      label: 'Apply by',
      type: 'date',
      hint: 'Applications close on this date. You can close the gig earlier at any time.',
    },
    {
      name: 'availability',
      label: 'Availability',
      maxLength: LIMITS.gig.availability.max,
      placeholder: 'Weekday evenings, campus library',
    },
    {
      name: 'contact_details',
      label: 'What should applicants tell you?',
      type: 'textarea',
      rows: 3,
      maxLength: LIMITS.gig.contact.max,
      placeholder: 'Your year and branch, a sample of your work, when you are free.',
      hint: 'Shown on the gig page. Keep it campus-appropriate — no phone numbers or payment handles.',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Post a Gig"
        eyebrow="Student work board"
        description="Offer a service — tutoring, repairs, design, coding help. Text only, and the whole campus can see it."
        back={{ href: ROUTES.gigs, label: 'Gigs' }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="success" icon="checkCircle">
          Open
        </Badge>
        <span className="text-2xs text-muted">
          New gigs are {GIG_STATES[0].label.toLowerCase()} and accept applications until you close them.
        </span>
      </div>

      <ActionForm
        action={createGig}
        gigAttachments={user.profile.username}
        submitLabel="Publish gig"
        pendingLabel="Publishing…"
        successMessage="Your gig is live on the board."
        cancelHref={ROUTES.gigs}
        fields={fields}
      />

      <Notice tone="neutral" icon="shield">
        Agree the details in Messages, meet on campus, and never pay in advance to someone you do not know.
      </Notice>
    </div>
  );
}
