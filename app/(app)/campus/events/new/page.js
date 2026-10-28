import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { EVENT_CATEGORIES, ROUTES, UUID_REGEX } from '@/lib/constants';
import { PageHeader, Notice, Card } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { submitEvent } from '@/lib/actions/campus';

export const metadata = { title: 'Submit an event' };

export default async function NewEventPage({ searchParams }) {
  const user = await requireUser();
  const actor = toActor(user);
  const params = await searchParams;
  if (!can(actor, 'submit_events')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Submit an event" back={{ href: '/campus/events', label: 'Events' }} />
        <Notice tone="warning" icon="lock">Your account cannot submit events right now.</Notice>
      </div>
    );
  }

  const supabase = await getServerClient();
  const canLinkAnyClub = can(actor, 'manage_events') || can(actor, 'manage_clubs') || can(actor, 'moderate_communities') || can(actor, 'moderate_all');
  const [{ data: clubs }, { data: memberships }] = await Promise.all([
    supabase.from('communities').select('id, name').eq('status', 'published').eq('kind', 'club').order('name', { ascending: true }).limit(100),
    canLinkAnyClub
      ? Promise.resolve({ data: [] })
      : supabase.from('community_members').select('community_id').eq('user_id', user.profile.id).eq('status', 'active').in('role', ['owner', 'moderator']).limit(100),
  ]);
  const managedIds = new Set((memberships || []).map((row) => row.community_id));
  const choices = (clubs || []).filter((club) => canLinkAnyClub || managedIds.has(club.id));
  const requestedClub = UUID_REGEX.test(String(params?.club_id || '')) && choices.some((club) => club.id === params.club_id)
    ? params.club_id
    : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Submit an event"
        description="Tell us what is happening. Staff review every submission before it appears on the calendar. Only clubs you manage can be linked."
        back={requestedClub ? { href: ROUTES.clubManage(requestedClub, 'events'), label: 'Club events' } : { href: '/campus/events', label: 'Events' }}
      />
      <Card className="p-4 text-[0.8125rem] leading-relaxed text-muted">
        <strong className="text-ink">Community submissions stay community.</strong> Your event will be labelled student-organized even after review. Linking a club is checked again in the Server Action and PostgreSQL.
      </Card>
      {params?.club_id && !requestedClub ? <Notice tone="warning" icon="lock">The requested club is not one your account manages, so it was not preselected.</Notice> : null}
      <ActionForm
        action={submitEvent}
        submitLabel="Submit for review"
        successMessage="Submitted. Staff will review it before it appears on the calendar."
        redirectTo={requestedClub ? ROUTES.clubManage(requestedClub, 'events') : '/campus/events'}
        resetOnSuccess={false}
        cancelHref={requestedClub ? ROUTES.clubManage(requestedClub, 'events') : '/campus/events'}
        fields={[
          { name: 'title', label: 'Event title', required: true, maxLength: 140 },
          { name: 'description', label: 'What is happening?', type: 'textarea', required: true, maxLength: 2000 },
          { name: 'category', label: 'Category', type: 'select', options: EVENT_CATEGORIES.map((option) => ({ value: option.value, label: option.label })) },
          { name: 'starts_on', label: 'Date', type: 'date', required: true },
          { name: 'start_time', label: 'Start time', type: 'time' },
          { name: 'end_time', label: 'End time', type: 'time' },
          { name: 'location', label: 'Venue', required: true, maxLength: 140, placeholder: 'e.g. Main auditorium' },
          { name: 'organizer', label: 'Organizer', maxLength: 120, placeholder: 'Club or team name' },
          {
            name: 'club_id', label: 'Managed club (optional)', type: 'select', defaultValue: requestedClub || '',
            options: choices.map((club) => ({ value: club.id, label: club.name })),
            hint: choices.length ? 'Only clubs you manage, or all clubs for authorized content staff.' : 'You do not manage a club, so no club can be linked.',
          },
          { name: 'registration_info', label: 'Registration details', type: 'textarea', maxLength: 500 },
          { name: 'registration_url', label: 'Registration link', maxLength: 300, placeholder: 'https://…' },
          { name: 'capacity', label: 'Capacity', type: 'number', min: 1, max: 100000, step: '1' },
        ]}
      />
    </div>
  );
}
