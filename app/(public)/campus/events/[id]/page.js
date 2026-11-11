import { EventGallery } from '@/components/campus/EventGallery';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getEvent, getEventRsvp, listEventAttendees, getCommunityById } from '@/lib/data/campus';
import { getPublicEventById, getPublicClubIdentityById } from '@/lib/data/public';
import { UUID_REGEX, ROUTES } from '@/lib/constants';
import { eventMetadata, eventSchema, breadcrumbs, noindexMetadata } from '@/lib/seo';
import JsonLd from '@/components/seo/JsonLd';
import { listPublishedEvents } from '@/lib/data/public-cache';
import { eventStartMs, upcomingRelatedEvents } from '@/lib/discovery/public';
import { eventCalendar } from '@/lib/discovery/calendar';
import Countdown from '@/components/discovery/Countdown';
import { ContentCard } from '@/components/content/ContentCard';
import { readIntent } from '@/lib/auth/return-to';
import { PageHeader, Badge, Notice, Card, StaffDot } from '@/components/ui';
import { IdentityLine } from '@/components/identity/IdentityLine';
import { RsvpForm } from '@/components/campus/RsvpForm';
import { EventReviewActions, EventWithdrawAction } from '@/components/campus/EventSubmissionActions';
import { categoryLabel } from '@/components/campus/eventMeta';
import { MessageButton } from '@/components/social/MessageButton';
import { ReportDialog } from '@/components/social/ReportDialog';
import { ExternalLink } from '@/components/content/ExternalLink';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { GuestActionPrompt, IntentNotice } from '@/components/auth/GuestActionPrompt';
import { ShareButton } from '@/components/social/ShareButton';
import { formatDate, formatTime } from '@/lib/utils';

/**
 * Metadata uses ONLY the anonymous published-event projection. A draft that a
 * staff member or its submitter can view must never put its title into an OG
 * card, a canonical URL or a search result for a URL anyone can open.
 */
export async function generateMetadata({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return noindexMetadata('Event not found');
  const { item } = await getPublicEventById(id);
  if (!item || item.status !== 'published') return noindexMetadata('Event');
  const { item: club } = item.club_id ? await getPublicClubIdentityById(item.club_id) : { item: null };
  return eventMetadata(item, club?.kind === 'club' && club?.visibility === 'public' && club?.status === 'published' ? club : null);
}

/**
 * Event detail at `/campus/events/<id>` (spec §30, public discovery).
 *
 * The base record comes from the cached anonymous projection and is pinned to
 * `status = 'published'` plus the `anon` column allow-list. Guest-visible
 * fields are title, description, dates, timings, location, organizer text,
 * official/student status, the linked public club (`/c/<slug>`) and the two
 * intentionally public registration fields. Attachments are shown only to signed-in viewers through their session-authorized endpoint.
 *
 * RSVP, attendee identities, organizer profile lookup, staff review queues,
 * personal submissions and report controls are fetched and rendered only for a
 * signed-in Campus+ profile with the existing scoped permissions. A guest gets
 * a sign-in prompt that returns to this exact event with `intent=rsvp`.
 */
export default async function EventPage({ params, searchParams }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();
  const intent = readIntent(await searchParams);

  const publicResult = await getPublicEventById(id);
  const user = await getCurrentUser();
  const viewer = user?.profile ? user : null;
  const supabase = viewer ? await getServerClient() : null;
  const actor = viewer ? toActor(viewer) : null;

  // A failed read is not a missing record; never answer it with a cached 404.
  if (publicResult.unavailable && !viewer) {
    return (
      <div className="flex flex-col gap-3">
        <PageHeader title="Event temporarily unavailable" back={{ href: '/campus/events', label: 'Events' }} />
        <Notice tone="warning" icon="flag">This event could not be read right now. Please try again in a moment.</Notice>
      </div>
    );
  }

  let event = publicResult.item;
  if (viewer && supabase) {
    const full = await getEvent(supabase, id);
    if (full) event = full;
  }
  if (!event) notFound();

  const isStaff = viewer ? can(actor, 'manage_events') || can(actor, 'moderate_all') : false;
  const isCreator = viewer ? event.created_by === viewer.profile.id : false;
  // Drafts remain visible to staff (review) and their own submitter (tracking).
  if (event.status !== 'published' && !isStaff && !isCreator) notFound();

  let rsvp = null;
  let attendees = [];
  let organizerProfile = null;
  if (viewer && supabase) {
    [rsvp, attendees] = await Promise.all([
      getEventRsvp(supabase, event.id, viewer.profile.id),
      event.show_attendees ? listEventAttendees(supabase, event.id) : Promise.resolve([]),
    ]);
    if (event.organizer) {
      const { data } = await supabase
        .from('public_profiles')
        .select('id, username, display_name, is_staff')
        .eq('username', String(event.organizer).replace(/^@/, '').toLowerCase())
        .maybeSingle();
      organizerProfile = data || null;
    }
  }

  // Associated club: canonical slug, never a UUID, from the stored column.
  let linkedClub = null;
  if (event.club_id) {
    const { item: publicClub } = await getPublicClubIdentityById(event.club_id);
    linkedClub = publicClub;
    if (!linkedClub && viewer && supabase) {
      const found = await getCommunityById(supabase, event.club_id);
      if (found && found.kind === 'club') linkedClub = found;
    }
  }

  const going = attendees.filter((row) => row.status === 'going').length;
  const interested = attendees.filter((row) => row.status === 'interested').length;
  const canonicalPath = ROUTES.event(id);
  const publicEvent = publicResult.item?.status === 'published' ? publicResult.item : null;
  const start = publicEvent ? eventStartMs(publicEvent) : null;
  const related = publicEvent ? await listPublishedEvents({ limit: 100, upcoming: true }) : { items: [] };
  const relatedEvents = upcomingRelatedEvents(related.items, id);

  return (
    <div className="flex flex-col gap-4">
      {publicResult.item?.status === 'published' ? <><JsonLd value={eventSchema(publicResult.item, linkedClub?.visibility === 'public' && linkedClub?.status === 'published' ? linkedClub : null)} /><JsonLd value={breadcrumbs([['Campus+', '/'], ['Events', '/campus/events'], [publicResult.item.title, ROUTES.event(id)]])} /></> : null}
      {intent && viewer ? <IntentNotice intent={intent} /> : null}

      <nav aria-label="Breadcrumb" className="text-2xs text-muted"><Link href="/" className="underline">Campus+</Link> / <Link href="/campus/events" className="underline">Events</Link> / <span aria-current="page">{event.title}</span></nav>
      <PageHeader
        title={event.title}
        description={[formatDate(event.starts_on), event.start_time ? formatTime(event.start_time) : null, event.location].filter(Boolean).join(' · ')}
        back={{ href: '/campus/events', label: 'Events' }}
        action={<ShareButton path={canonicalPath} label="Share event" title={event.title} />}
      />

      {start !== null ? <Countdown startsAt={start} /> : null}
      {publicEvent && eventCalendar(publicEvent) ? <a href={`/api/public/event-calendar/${id}`} className="text-sm font-semibold underline" download>Add to calendar (.ics)</a> : null}
      <div className="flex flex-wrap items-center gap-2">
        {event.is_official ? <Badge tone="accent">Official</Badge> : <Badge>Student-organized</Badge>}
        {event.status === 'published' ? <Badge>Published</Badge> : null}
        {viewer && event.status !== 'published' ? <Badge tone={event.status === 'draft' ? 'warning' : 'danger'}>{event.status === 'draft' ? 'In review' : event.status}</Badge> : null}
        {linkedClub ? <Link href={ROUTES.club(linkedClub.slug)} className="chip">Hosted by {linkedClub.name}</Link> : (event.club_id ? <Badge>Club event</Badge> : null)}
        {categoryLabel(event.category) ? <Badge>{categoryLabel(event.category)}</Badge> : null}
      </div>

      {/* Staff/creator-only review queues: never rendered or fetched for guests. */}
      {viewer && event.status === 'draft' && isStaff ? (
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="text-sm font-semibold">Review this submission</h2>
          <p className="text-2xs text-muted">Publishing keeps it labelled student-organized — never official.</p>
          <EventReviewActions eventId={event.id} />
        </Card>
      ) : null}

      {viewer && event.status === 'draft' && isCreator && !isStaff ? (
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="text-sm font-semibold">Your submission is in review</h2>
          <p className="text-2xs text-muted">Staff will publish or decline it. You can withdraw it any time before then.</p>
          <EventWithdrawAction eventId={event.id} />
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3 p-4">
        {event.description ? (
          <p className="user-text whitespace-pre-wrap text-[0.9375rem] leading-relaxed"><LinkifiedText text={event.description} /></p>
        ) : null}
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
          <div className="flex gap-1"><dt>Starts</dt><dd>{[formatDate(event.starts_on), event.start_time ? formatTime(event.start_time) : null].filter(Boolean).join(' · ')}</dd></div>
          {event.ends_on ? <div className="flex gap-1"><dt>Ends</dt><dd>{formatDate(event.ends_on)}</dd></div> : null}
          {event.end_time ? <div className="flex gap-1"><dt>Until</dt><dd>{formatTime(event.end_time)}</dd></div> : null}
          {event.location ? <div className="flex gap-1"><dt>Venue</dt><dd>{event.location}</dd></div> : null}
          {event.organizer ? <div className="flex gap-1"><dt>Organizer</dt><dd>{event.organizer}</dd></div> : null}
          {event.capacity ? <div className="flex gap-1"><dt>Capacity</dt><dd>{event.capacity}</dd></div> : null}
        </dl>
        {event.registration_info ? <p className="user-text text-[0.8125rem] text-muted"><LinkifiedText text={event.registration_info} /></p> : null}
        {event.registration_url ? (
          <p className="text-[0.8125rem]">
            Registration:{' '}
            <ExternalLink url={event.registration_url} className="underline">{event.registration_url}</ExternalLink>
          </p>
        ) : null}
        <p className="text-2xs text-muted">Campus+ is text-first: events have no uploaded artwork or attachments.</p>
      </Card>

      {viewer ? <EventGallery postId={id} manage={event.status === 'draft'} username={viewer.profile.username} /> : null}
      {viewer ? (
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold">Your RSVP</h2>
          <RsvpForm eventId={event.id} currentStatus={rsvp?.status || null} canRsvp={event.status === 'published' && can(actor, 'rsvp_events')} />
          {event.show_attendees ? <p className="text-2xs text-muted">{going} going · {interested} interested</p> : null}
          {event.capacity ? <p className="text-2xs text-muted">Going RSVPs are limited by the listed capacity. Follow the organizer’s registration instructions as well.</p> : null}
        </Card>
      ) : (
        <GuestActionPrompt
          title="RSVP to this event"
          description="Event details are public. RSVPs, attendee lists and messaging the organizer require an institutional Campus+ account."
          next={canonicalPath}
          intent="rsvp"
          actionLabel="Sign in to RSVP"
        />
      )}

      {event.organizer ? (
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold">Organizer</h2>
          {viewer && organizerProfile ? (
            <>
              <IdentityLine
                username={organizerProfile.username}
                displayName={organizerProfile.display_name}
                isStaff={organizerProfile.is_staff}
                badge={organizerProfile.is_staff ? <StaffDot label="Campus+ staff" /> : null}
              />
              {organizerProfile.id !== viewer.profile.id ? (
                <MessageButton profileId={organizerProfile.id} label="Message the organizer" />
              ) : (
                <p className="text-2xs text-muted">This is your event.</p>
              )}
            </>
          ) : (
            <>
              <p className="text-[0.8125rem]">{event.organizer}</p>
              <p className="text-2xs text-muted">Sign in to contact the organizer through Campus+ messages.</p>
            </>
          )}
        </Card>
      ) : null}

      {/* Attendee identities are private: never read or rendered anonymously. */}
      {viewer && event.show_attendees && attendees.length ? (
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="text-sm font-semibold">Who is coming</h2>
          <ul className="flex flex-col gap-2">
            {attendees.slice(0, 20).map((attendee) => (
              <li key={`${attendee.user_id}-${attendee.status}`}>
                <IdentityLine username={attendee.username} displayName={attendee.display_name} size="sm" badge={<Badge>{attendee.status.replace('_', ' ')}</Badge>} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {publicEvent ? <section className="flex flex-col gap-3" aria-label="Related events"><h2 className="text-sm font-semibold">Related events</h2>{relatedEvents.length ? relatedEvents.map((item) => <ContentCard key={item.id} href={ROUTES.event(item.id)} title={item.title} description={item.description} icon="calendar" badges={[{ label: formatDate(item.starts_on), tone: 'accent' }]} meta={[item.location]} />) : <p className="text-2xs text-muted">No other upcoming events are available right now.</p>}</section> : null}
      <div className="flex items-center justify-between">
        <Link href="/campus/events" className="text-2xs text-muted underline hover:text-ink">All events</Link>
        {viewer && can(actor, 'report_content') ? <ReportDialog targetType="event" targetRef={event.id} label="this event" /> : null}
      </div>

      <Notice tone="neutral" icon="shield">
        Campus+ has no payments and no ticket sales. Anything asking for money upfront is not part of this platform.
      </Notice>
    </div>
  );
}
