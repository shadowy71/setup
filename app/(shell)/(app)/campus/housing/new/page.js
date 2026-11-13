import { requireUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { createHousingPost } from '@/lib/actions/campus';

export const metadata = { title: 'Post housing' };

/** Create a housing post (spec §32). Never share a phone number in the text. */
export default async function NewHousingPage() {
  const user = await requireUser();
  const actor = toActor(user);

  if (!can(actor, 'create_housing_post')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Post housing" back={{ href: '/campus/housing', label: 'Housing' }} />
        <Notice tone="warning" icon="lock">Your account cannot post housing right now.</Notice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Post housing"
        description="Describe what you have or what you need. Arrange visits in messages."
        back={{ href: '/campus/housing', label: 'Housing' }}
      />
      <ActionForm
        action={createHousingPost}
        housingAttachments={user.profile.username}
        submitLabel="Publish post"
        successMessage="Published."
        redirectTo="/campus/housing"
        resetOnSuccess={false}
        cancelHref="/campus/housing"
        fields={[
          { name: 'title', label: 'Title', required: true, maxLength: 140, placeholder: 'Single room in Wakad, 10 min from campus' },
          { name: 'description', label: 'Description', type: 'textarea', required: true, maxLength: 1000 },
          { name: 'area', label: 'Area / locality', required: true, maxLength: 120, placeholder: 'Wakad' },
          { name: 'budget', label: 'Monthly budget (₹)', type: 'number', min: 0, step: '100' },
          {
            name: 'room_type',
            label: 'Room type',
            type: 'select',
            options: [
              { value: 'single', label: 'Single' },
              { value: 'shared', label: 'Shared' },
              { value: 'pg', label: 'PG' },
              { value: 'flat', label: 'Flat' },
              { value: 'hostel', label: 'Hostel' },
              { value: 'other', label: 'Other' },
            ],
          },
          { name: 'available_from', label: 'Available from', type: 'date' },
        ]}
      />
      <Notice tone="neutral" icon="shield">
        Do not pay any deposit before visiting. Report anything that looks like a scam.
      </Notice>
    </div>
  );
}
