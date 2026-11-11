import { EventGallery } from '@/components/campus/EventGallery';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { UUID_REGEX, EVENT_CATEGORIES, EVENT_STATUS } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { saveEvent } from '@/lib/actions/campus';
export const metadata = { title: 'Edit event' };
export default async function EditEvent({ params }) {
  const { id } = await params; if (!UUID_REGEX.test(id)) notFound();
  const user = await requireUser(); const actor = toActor(user);
  if (!can(actor, 'manage_events') && !can(actor, 'moderate_all')) notFound();
  const db = await getServerClient();
  const { data: event, error } = await db.from('events').select('id,title,description,starts_on,ends_on,start_time,end_time,location,organizer,registration_info,registration_url,club_id,capacity,category,show_attendees,status,is_official').eq('id', id).maybeSingle();
  if (error || !event) notFound();
  return <div className="flex flex-col gap-4">
    <PageHeader title="Edit event" back={{ href: '/admin?tab=events', label: 'Events management' }} />
    {!event.is_official ? <Notice tone="neutral">This is a student-organized event. Editing it does not make it official.</Notice> : null}
    <EventGallery postId={id} manage username={user.profile.username} />
    <ActionForm action={saveEvent} hidden={{ id, club_id: event.club_id || '' }} resetOnSuccess={false} cancelHref="/admin?tab=events" fields={[
      { name: 'title', label: 'Title', required: true, maxLength: 140, defaultValue: event.title },
      { name: 'description', label: 'Description', type: 'textarea', required: true, maxLength: 2000, defaultValue: event.description },
      { name: 'category', label: 'Category', type: 'select', options: EVENT_CATEGORIES, defaultValue: event.category || '' },
      { name: 'starts_on', label: 'Date', type: 'date', required: true, defaultValue: event.starts_on },
      { name: 'ends_on', label: 'Ends on', type: 'date', defaultValue: event.ends_on || '' },
      { name: 'start_time', label: 'Start time', type: 'time', defaultValue: event.start_time?.slice(0, 5) || '' },
      { name: 'end_time', label: 'End time', type: 'time', defaultValue: event.end_time?.slice(0, 5) || '' },
      { name: 'location', label: 'Location', required: true, maxLength: 140, defaultValue: event.location },
      { name: 'organizer', label: 'Organizer', maxLength: 120, defaultValue: event.organizer || '' },
      { name: 'capacity', label: 'Capacity', type: 'number', min: 1, max: 100000, defaultValue: event.capacity ?? '' },
      { name: 'registration_info', label: 'Registration details', type: 'textarea', maxLength: 500, defaultValue: event.registration_info || '' },
      { name: 'registration_url', label: 'Registration link', defaultValue: event.registration_url || '' },
      { name: 'show_attendees', label: 'Show attendee list to signed-in students', type: 'checkbox', defaultChecked: event.show_attendees },
      { name: 'status', label: 'Status', type: 'select', options: EVENT_STATUS.map((value) => ({ value, label: value })), defaultValue: event.status },
    ]} />
  </div>;
}
