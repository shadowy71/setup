import { requireUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { createRidePost } from '@/lib/actions/campus';

export const metadata = { title: 'Post a ride' };

/** Create a ride post (spec §32). */
export default async function NewRidePage() {
  const user = await requireUser();
  const actor = toActor(user);

  if (!can(actor, 'create_ride_post')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Post a ride" back={{ href: '/campus/rides', label: 'Rides' }} />
        <Notice tone="warning" icon="lock">Your account cannot post rides right now.</Notice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Post a ride"
        description="Be specific about the time and the pickup point."
        back={{ href: '/campus/rides', label: 'Rides' }}
      />
      <ActionForm
        action={createRidePost}
        rideAttachments={user.profile.username}
        submitLabel="Publish ride"
        successMessage="Published. Interested students will message you."
        redirectTo="/campus/rides"
        resetOnSuccess={false}
        cancelHref="/campus/rides"
        fields={[
          { name: 'ride_kind', label: 'Ride type', type: 'select', defaultValue: 'offer', options: [{ value: 'offer', label: 'Offering a ride' }, { value: 'request', label: 'Looking for a ride' }], placeholder: 'Not specified' },
          { name: 'origin', label: 'From', required: true, maxLength: 120, placeholder: 'PCCOE main gate' },
          { name: 'destination', label: 'To', required: true, maxLength: 120, placeholder: 'Pune airport' },
          { name: 'ride_date', label: 'Date', type: 'date', required: true },
          { name: 'ride_time', label: 'Time', type: 'time' },
          { name: 'seats', label: 'Seats available', type: 'number', min: 1, max: 10, step: '1' },
          { name: 'description', label: 'Details', type: 'textarea', required: true, maxLength: 800 },
        ]}
      />
      <Notice tone="neutral" icon="shield">
        Share only what is needed to coordinate. Never share bank details in a ride post.
      </Notice>
    </div>
  );
}
