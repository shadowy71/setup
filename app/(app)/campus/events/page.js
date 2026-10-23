import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listEventSubmissions, listMyEventSubmissions, listMyRsvps } from '@/lib/data/campus';
import { listPublishedEvents } from '@/lib/data/public-cache';
import { EVENT_CATEGORIES, ROUTES, PAGE_SIZE } from '@/lib/constants';
import { PageHeader, EmptyState, Notice, LinkButton, Card, Badge } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';
import { EventCalendar } from '@/components/campus/EventCalendar';
import { EventReviewActions, EventWithdrawAction } from '@/components/campus/EventSubmissionActions';
import { categoryLabel, monthGrid, parseMonthParam } from '@/components/campus/eventMeta';
import { formatDate, formatTime } from '@/lib/utils';

export const metadata = { title: 'Events' };

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
 * Campus activity calendar: a month grid and a chronological agenda over the
 * same events, with RSVP status on every card. Official events and reviewed
 * student-organized events share the calendar but never share a label.
 */
export default async function EventsPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const params = await searchParams;

  const view = params?.view === 'calendar' ? 'calendar' : 'agenda';
  const past = params?.when === 'past';
  const offset = Math.max(0, Number.parseInt(params?.offset || '0', 10) || 0);
  const club = typeof params?.club === 'string' && params.club ? params.club : '';
  const category = EVENT_CATEGORIES.some((option) => option.value === params?.category) ? params.category : '';
  const source = params?.source === 'official' || params?.source === 'community' ? params.source : '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params?.day || '') ? params.day : '';
  const { year, month } = parseMonthParam(params?.month);
  const today = new Date().toISOString().slice(0, 10);

  const canSubmit = can(actor, 'submit_events');
  const canReview = can(actor, 'manage_events') || can(actor, 'moderate_all');

  const { data: clubs } = await supabase
    .from('communities')
    .select('id, name')
    .eq('status', 'published')
    .eq('kind', 'club')
    .order('name', { ascending: true })
    .limit(100);

  const current = { view, month: params?.month || '', when: past ? 'past' : 'upcoming', club, category, source };

  // The published list is public and cached; the review queue and the viewer's
  // own drafts do not depend on it, so all three start together. RSVP state is
  // the only read that has to wait for the ids.
  const eventsQuery =
    view === 'calendar'
      ? (() => {
          const grid = monthGrid(year, month);
          return listPublishedEvents({
            limit: 200,
            from: grid[0],
            to: grid[grid.length - 1],
            clubId: club || null,
            category: category || null,
            source: source || null,
          });
        })()
      : day
        ? listPublishedEvents({ limit: 60, from: day, to: day, clubId: club || null, category: category || null, source: source || null })
        : listPublishedEvents({
            limit: PAGE_SIZE.default,
            offset,
            upcoming: !past,
            clubId: club || null,
            category: category || null,
            source: source || null,
          });

  const [result, submissions, mine] = await Promise.all([
    eventsQuery,
    canReview ? listEventSubmissions(supabase) : Promise.resolve({ items: [], unavailable: false }),
    canSubmit && !canReview ? listMyEventSubmissions(supabase, user.profile.id) : Promise.resolve({ items: [], unavailable: false }),
  ]);
  const items = result.items;
  const unavailable = result.unavailable;

  const rsvps = await listMyRsvps(supabase, items.map((event) => event.id), user.profile.id);

  const agendaQuery = (overrides) => {
    const query = new URLSearchParams({ view: 'agenda', when: past ? 'past' : 'upcoming', club, category, source, day, ...overrides });
    for (const [key, value] of [...query.entries()]) {
      if (!value || (key === 'when' && value === 'upcoming')) query.delete(key);
    }
    return `/campus/events?${query.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Events"
        description="The campus activity calendar — official events and reviewed student-organized events, with RSVP."
        back={{ href: ROUTES.campus, label: 'Campus' }}
        action={canSubmit ? <LinkButton href="/campus/events/new" size="sm" icon="plus">Submit an event</LinkButton> : null}
      />

      <Card className="flex flex-wrap items-center gap-1.5 p-3">
        <LinkButton href={agendaQuery({ view: 'agenda', day: '' })} size="sm" variant={view === 'agenda' ? 'secondary' : 'ghost'}>
          Agenda
        </LinkButton>
        <LinkButton href={`/campus/events?view=calendar${club ? `&club=${club}` : ''}${category ? `&category=${category}` : ''}${source ? `&source=${source}` : ''}`} size="sm" variant={view === 'calendar' ? 'secondary' : 'ghost'}>
          Calendar
        </LinkButton>
        {view === 'agenda' ? (
          <>
            <span className="rule mx-1 h-5 w-px" aria-hidden="true" />
            <LinkButton href={agendaQuery({ when: 'upcoming', offset: '0', day: '' })} size="sm" variant={past ? 'ghost' : 'secondary'}>
              Upcoming
            </LinkButton>
            <LinkButton href={agendaQuery({ when: 'past', offset: '0', day: '' })} size="sm" variant={past ? 'secondary' : 'ghost'}>
              Past
            </LinkButton>
            {day ? (
              <span className="ml-auto flex items-center gap-2">
                <Badge tone="accent">{formatDate(day)}</Badge>
                <LinkButton href={agendaQuery({ day: '' })} size="sm" variant="ghost">Clear day</LinkButton>
              </span>
            ) : null}
          </>
        ) : null}
      </Card>

      <FilterBar current={{ ...current, month: params?.month || '' }} clubs={clubs || []} />

      {unavailable ? <Notice tone="warning" icon="flag">Events could not be loaded right now.</Notice> : null}

      {canReview && submissions.items.length ? (
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

      {mine.items.length ? (
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
            {items.map((event) => (
              <ContentCard
                key={event.id}
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
                  ...(rsvps.get(event.id) ? [{ label: RSVP_LABELS[rsvps.get(event.id)] || rsvps.get(event.id), tone: 'success' }] : []),
                ]}
                meta={[event.location, event.organizer]}
              />
            ))}
          </section>

          {!day && items.length === PAGE_SIZE.default ? (
            <div className="flex justify-end">
              <LinkButton href={agendaQuery({ offset: String(offset + PAGE_SIZE.default) })} size="sm" variant="secondary">
                More events
              </LinkButton>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
