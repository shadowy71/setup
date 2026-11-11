import { EventGallery } from '@/components/campus/EventGallery';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listEventSubmissions, listMyEventSubmissions, listMyRsvps } from '@/lib/data/campus';
import { listPublishedEvents } from '@/lib/data/public-cache';
import { listPublicClubOptions, mapPublicClubSlugs } from '@/lib/data/public';
import { EVENT_CATEGORIES, ROUTES, PAGE_SIZE } from '@/lib/constants';
import { publicMetadata } from '@/lib/seo';
import { returnToHref } from '@/lib/auth/return-to';
import { PageHeader, EmptyState, Notice, LinkButton, Card, Badge } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';
import { EventCalendar } from '@/components/campus/EventCalendar';
import { EventReviewActions, EventWithdrawAction } from '@/components/campus/EventSubmissionActions';
import { categoryLabel, monthGrid, parseMonthParam } from '@/components/campus/eventMeta';
import { GuestActionPrompt } from '@/components/auth/GuestActionPrompt';
import { formatDate, formatTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ searchParams }) {
  const params = await searchParams;
  return publicMetadata({
    title: 'PCCOE Events & Campus Activities',
    description: 'Discover upcoming events, workshops, competitions and campus activities at PCCOE.',
    canonical: '/campus/events',
    index: !params || Object.keys(params).length === 0,
  });
}

const RSVP_LABELS = { going: 'You’re going', interested: 'Interested', not_going: 'Can’t make it', waitlist: 'Waitlisted' };

function FilterBar({ current, clubs }) {
  return (
    <form method="get" action="/campus/events" className="card flex flex-col gap-3 p-3" aria-label="Filter events">
      <input type="hidden" name="view" value={current.view} />
      {current.view === 'calendar' ? <input type="hidden" name="month" value={current.month} /> : null}
      {current.view === 'agenda' && current.when === 'past' ? <input type="hidden" name="when" value="past" /> : null}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Club / organizer
          <select name="club" defaultValue={current.club} className="control control-select">
            <option value="">All clubs</option>
            {clubs.map((club) => (
              <option key={club.id} value={club.id}>{club.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Category
          <select name="category" defaultValue={current.category} className="control control-select">
            <option value="">All categories</option>
            {EVENT_CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Published by
          <select name="source" defaultValue={current.source} className="control control-select">
            <option value="">Official + student</option>
            <option value="official">Official only</option>
            <option value="community">Student-organized only</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-secondary btn-sm">Apply</button>
          <LinkButton href={`/campus/events?view=${current.view}`} size="sm" variant="ghost">Clear</LinkButton>
        </div>
      </div>
    </form>
  );
}

/**
 * The campus activity calendar — ONE page for guests and students.
 *
 * The published-event list is the shared anonymous cache (`listPublishedEvents`)
 * for everyone: `anon` RLS allows published rows only and the projection has no
 * attendee, RSVP or review fields. Viewer-specific RSVP state, staff review
 * queues and personal submissions are fetched separately with the session
 * client, only when a real Campus+ profile exists, and are never cached.
 *
 * Guests can browse, filter, paginate, switch to the calendar and date-filter;
 * they get no management controls, no drafts and no personal RSVP badges.
 */
export default async function EventsPage({ searchParams }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const viewer = user?.profile ? user : null;
  const supabase = viewer ? await getServerClient() : null;
  const actor = viewer ? toActor(viewer) : null;

  const view = params?.view === 'calendar' ? 'calendar' : 'agenda';
  const past = params?.when === 'past';
  const offset = Math.max(0, Number.parseInt(params?.offset || '0', 10) || 0);
  const club = typeof params?.club === 'string' && params.club ? params.club : '';
  const category = EVENT_CATEGORIES.some((option) => option.value === params?.category) ? params.category : '';
  const source = params?.source === 'official' || params?.source === 'community' ? params.source : '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params?.day || '') ? params.day : '';
  const { year, month } = parseMonthParam(params?.month);
  const today = new Date().toISOString().slice(0, 10);

  const canSubmit = viewer ? can(actor, 'submit_events') : false;
  const canReview = viewer ? can(actor, 'manage_events') || can(actor, 'moderate_all') : false;
  const current = { view, month: params?.month || '', when: past ? 'past' : 'upcoming', club, category, source };

  // Club filter options: signed-in students keep their full visible set; guests
  // get the anonymous public catalogue only. `mapPublicClubSlugs` links each
  // event card back to `/c/<slug>` without a second private lookup.
  const [clubOptions, publicClubs] = await Promise.all([
    viewer && supabase
      ? supabase.from('communities').select('id, name').eq('status', 'published').eq('kind', 'club').order('name', { ascending: true }).limit(100)
      : Promise.resolve(null),
    mapPublicClubSlugs(),
  ]);
  const clubs = viewer
    ? (clubOptions?.data || [])
    : (await listPublicClubOptions()).items;

  const eventsQuery =
    view === 'calendar'
      ? (() => {
          const grid = monthGrid(year, month);
          return listPublishedEvents({
            limit: 200, from: grid[0], to: grid[grid.length - 1],
            clubId: club || null, category: category || null, source: source || null,
          });
        })()
      : day
        ? listPublishedEvents({ limit: 60, from: day, to: day, clubId: club || null, category: category || null, source: source || null })
        : listPublishedEvents({
            limit: PAGE_SIZE.default, offset, upcoming: !past,
            clubId: club || null, category: category || null, source: source || null,
          });

  const [result, submissions, mine] = await Promise.all([
    eventsQuery,
    canReview && supabase ? listEventSubmissions(supabase) : Promise.resolve({ items: [], unavailable: false }),
    canSubmit && !canReview && supabase ? listMyEventSubmissions(supabase, viewer.profile.id) : Promise.resolve({ items: [], unavailable: false }),
  ]);
  const items = result.items;
  const unavailable = result.unavailable;
  const rsvps = viewer && supabase && items.length
    ? await listMyRsvps(supabase, items.map((event) => event.id), viewer.profile.id)
    : new Map();

  const agendaQuery = (overrides) => {
    const query = new URLSearchParams({ view: 'agenda', when: past ? 'past' : 'upcoming', club, category, source, day, ...overrides });
    for (const [key, value] of [...query.entries()]) {
      if (!value || (key === 'when' && value === 'upcoming')) query.delete(key);
    }
    return `/campus/events?${query.toString()}`;
  };

  const guestNext = `/campus/events${view !== 'agenda' || past || club || category || source || day || offset ? `?${new URLSearchParams({ view, ...(past ? { when: 'past' } : {}), ...(club ? { club } : {}), ...(category ? { category } : {}), ...(source ? { source } : {}), ...(day ? { day } : {}), ...(offset ? { offset: String(offset) } : {}) }).toString()}` : ''}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Events"
        description="The campus activity calendar — official events and reviewed student-organized events. Browsing is open to everyone; RSVPs need a Campus+ account."
        back={{ href: viewer ? ROUTES.campus : ROUTES.clubs, label: viewer ? 'Campus' : 'Clubs' }}
        action={
          viewer
            ? (canSubmit ? <LinkButton href="/campus/events/new" size="sm" icon="plus">Submit an event</LinkButton> : null)
            : <LinkButton href={returnToHref(guestNext, 'submit_event')} size="sm" icon="lock" tone="accent">Sign in to submit an event</LinkButton>
        }
      />

      <Card className="flex flex-wrap items-center gap-1.5 p-3">
        <LinkButton href={agendaQuery({ view: 'agenda', day: '' })} size="sm" variant={view === 'agenda' ? 'secondary' : 'ghost'}>Agenda</LinkButton>
        <LinkButton href={`/campus/events?view=calendar${club ? `&club=${club}` : ''}${category ? `&category=${category}` : ''}${source ? `&source=${source}` : ''}`} size="sm" variant={view === 'calendar' ? 'secondary' : 'ghost'}>Calendar</LinkButton>
        {view === 'agenda' ? (
          <>
            <span className="rule mx-1 h-5 w-px" aria-hidden="true" />
            <LinkButton href={agendaQuery({ when: 'upcoming', offset: '0', day: '' })} size="sm" variant={past ? 'ghost' : 'secondary'}>Upcoming</LinkButton>
            <LinkButton href={agendaQuery({ when: 'past', offset: '0', day: '' })} size="sm" variant={past ? 'secondary' : 'ghost'}>Past</LinkButton>
            {day ? (
              <span className="ml-auto flex items-center gap-2">
                <Badge tone="accent">{formatDate(day)}</Badge>
                <LinkButton href={agendaQuery({ day: '' })} size="sm" variant="ghost">Clear day</LinkButton>
              </span>
            ) : null}
          </>
        ) : null}
      </Card>

      <FilterBar current={{ ...current, month: params?.month || '' }} clubs={clubs} />

      {unavailable ? <Notice tone="warning" icon="flag">Events could not be loaded right now.</Notice> : null}

      {!viewer ? (
        <GuestActionPrompt
          title="Everyone can see what’s happening"
          description="The calendar, filters and event pages are public. Sign in with your institutional Google account to RSVP, submit an event or see your own submissions."
          next={guestNext}
          intent="submit_event"
          actionLabel="Sign in with Google"
          linkLabel="Browse clubs instead"
          linkHref={ROUTES.clubs}
        />
      ) : null}

      {/* Staff-only: never rendered, fetched or cached for a guest. */}
      {viewer && canReview && submissions.items.length ? (
        <section aria-label="Events awaiting review" className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Awaiting review <Badge>{submissions.items.length}</Badge></h2>
          <p className="text-2xs text-muted">Student submissions. Publishing keeps them labelled student-organized — never official.</p>
          {submissions.items.map((event) => (
            <ContentCard
              key={event.id}
              title={event.title}
              description={event.description}
              icon="calendar"
              badges={[{ label: formatDate(event.starts_on), tone: 'accent' }, { label: 'Awaiting review', tone: 'warning' }]}
              meta={[event.location, categoryLabel(event.category)]}
              footer={
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <LinkButton href={ROUTES.event(event.id)} size="sm" variant="ghost">Review</LinkButton>
                  <EventReviewActions eventId={event.id} />
                </span>
              }
            />
          ))}
        </section>
      ) : null}

      {viewer && mine.items.length ? (
        <section aria-label="My submitted events" className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">My submissions</h2>
          {mine.items.map((event) => (
            <Card key={event.id} className="flex flex-wrap items-center gap-2 p-3">
              <LinkButton href={ROUTES.event(event.id)} size="sm" variant="ghost">{event.title}</LinkButton>
              <Badge tone="warning">In review</Badge>
              <span className="ml-auto"><EventWithdrawAction eventId={event.id} /></span>
            </Card>
          ))}
        </section>
      ) : null}

      {view === 'calendar' ? (
        <EventCalendar year={year} month={month} events={items} today={today} query={{ club, category, source }} />
      ) : (
        <>
          {!unavailable && !items.length ? (
            <EmptyState
              icon="calendar"
              title={past ? 'No past events' : day ? 'Nothing on this day' : 'No upcoming events'}
              description="Events published by clubs and the campus appear here."
            />
          ) : null}

          <section aria-label="Events" className="flex flex-col gap-3">
            {items.map((event) => {
              const linkedClub = event.club_id ? publicClubs.get(event.club_id) : null;
              return (
                <div key={event.id}>
                {viewer ? <EventGallery postId={event.id} coverOnly /> : null}
                <ContentCard
                  href={ROUTES.event(event.id)}
                  title={event.title}
                  description={event.description}
                  icon="calendar"
                  official={event.is_official}
                  community={!event.is_official}
                  badges={[
                    { label: formatDate(event.starts_on), tone: 'accent' },
                    ...(event.start_time ? [{ label: formatTime(event.start_time) }] : []),
                    ...(categoryLabel(event.category) ? [{ label: categoryLabel(event.category) }] : []),
                    ...(viewer && rsvps.get(event.id) ? [{ label: RSVP_LABELS[rsvps.get(event.id)] || rsvps.get(event.id), tone: 'success' }] : []),
                  ]}
                  meta={[event.location, event.organizer]}
                  footer={linkedClub ? (
                    <Link href={ROUTES.club(linkedClub.slug)} className="text-2xs text-muted underline underline-offset-2 hover:text-ink">
                      Hosted by {linkedClub.name}
                    </Link>
                  ) : null}
                />
                </div>
              );
            })}
          </section>

          {!day && items.length === PAGE_SIZE.default ? (
            <div className="flex justify-end">
              <LinkButton href={agendaQuery({ offset: String(offset + PAGE_SIZE.default) })} size="sm" variant="secondary">More events</LinkButton>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
