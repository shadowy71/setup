import { HousingGallery } from '@/components/campus/HousingGallery';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { UUID_REGEX } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { updateOwnCampusBoard } from '@/lib/actions/campus-board';

export const metadata = { title: 'Edit housing' };
export default async function EditPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();
  const user = await requireUser();
  const db = await getServerClient();
  const { data: record, error } = await db.from('housing_posts').select('*').eq('id', id).eq('creator_id', user.profile.id).maybeSingle();
  if (error || !record) notFound();
  return <div className="flex flex-col gap-4">
    <PageHeader title="Edit housing" back={{ href: '/campus/housing', label: 'Housing' }} />
    {record.status !== 'published' ? <Notice tone="warning" icon="flag">Editing does not change this post’s moderation status.</Notice> : null}
    <HousingGallery postId={id} manage username={user.profile.username} />
    <ActionForm action={updateOwnCampusBoard} hidden={{ id, type: 'housing' }} submitLabel="Save changes" cancelHref="/campus/housing" resetOnSuccess={false} fields={[
          { name: 'title', label: 'Title', type: 'text', defaultValue: record.title ?? '', maxLength: 140, required: true },
          { name: 'description', label: 'Description', type: 'textarea', defaultValue: record.description ?? '', maxLength: 1000, required: true },
          { name: 'area', label: 'Area / locality', type: 'text', defaultValue: record.area ?? '', maxLength: 120, required: true },
          { name: 'budget', label: 'Monthly budget (₹)', type: 'text', defaultValue: record.budget ?? '', maxLength: 80 },
          { name: 'room_type', label: 'Room type', type: 'select', defaultValue: record.room_type ?? '', required: true, options: ['single','shared','pg','flat','hostel','other'].map((value) => ({ value, label: value })) },
          { name: 'available_from', label: 'Available from', type: 'date', defaultValue: record.available_from ?? '' },
    ]} />
  </div>;
}
