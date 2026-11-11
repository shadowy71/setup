import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { UUID_REGEX } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { updateOwnCampusBoard } from '@/lib/actions/campus-board';

export const metadata = { title: 'Edit ride' };
export default async function EditPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();
  const user = await requireUser();
  const db = await getServerClient();
  const { data: record, error } = await db.from('ride_posts').select('*').eq('id', id).eq('creator_id', user.profile.id).maybeSingle();
  if (error || !record) notFound();
  return <div className="flex flex-col gap-4">
    <PageHeader title="Edit ride" back={{ href: '/campus/rides', label: 'Ride' }} />
    {record.status !== 'published' ? <Notice tone="warning" icon="flag">Editing does not change this post’s moderation status.</Notice> : null}
    <ActionForm action={updateOwnCampusBoard} hidden={{ id, type: 'rides' }} submitLabel="Save changes" cancelHref="/campus/rides" resetOnSuccess={false} fields={[
          { name: 'ride_kind', label: 'Ride type', type: 'select', defaultValue: record.ride_kind ?? '', options: [{ value: 'offer', label: 'Offering a ride' }, { value: 'request', label: 'Looking for a ride' }], placeholder: 'Not specified' },
          { name: 'origin', label: 'From', type: 'text', defaultValue: record.origin ?? '', maxLength: 120, required: true },
          { name: 'destination', label: 'To', type: 'text', defaultValue: record.destination ?? '', maxLength: 120, required: true },
          { name: 'ride_date', label: 'Date', type: 'date', defaultValue: record.ride_date ?? '', required: true },
          { name: 'ride_time', label: 'Time', type: 'time', defaultValue: record.ride_time ?? '' },
          { name: 'seats', label: 'Seats available', type: 'number', defaultValue: record.seats ?? '', min: 1, max: 10, step: 1 },
          { name: 'description', label: 'Details', type: 'textarea', defaultValue: record.description ?? '', maxLength: 800, required: true },
    ]} />
  </div>;
}
