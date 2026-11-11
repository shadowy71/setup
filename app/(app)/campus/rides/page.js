import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listRidePosts } from '@/lib/data/campus';
import { ROUTES } from '@/lib/constants';
import { PageHeader, EmptyState, Notice, LinkButton } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';
import { PostActionsRow } from '@/components/campus/PostActionsRow';
import { OwnBoardActions } from '@/components/campus/OwnBoardActions';
import { formatDate, formatTime } from '@/lib/utils';

export const metadata = { title: 'Rides' };

/** Ride sharing (spec §32). Students coordinate in messages; no payments here. */
export default async function RidesPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const params = await searchParams;
  const kind = ['offer', 'request'].includes(params?.kind) ? params.kind : '';
  const origin = typeof params?.origin === 'string' ? params.origin.trim().slice(0, 120) : '';
  const destination = typeof params?.destination === 'string' ? params.destination.trim().slice(0, 120) : '';
  const rawDate = typeof params?.date === 'string' ? params.date : '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && !Number.isNaN(Date.parse(rawDate)) && new Date(rawDate).toISOString().slice(0, 10) === rawDate ? rawDate : '';
  const { items, unavailable } = await listRidePosts(supabase, { limit: 30, kind, origin, destination, date });
  const canCreate = can(actor, 'create_ride_post');

  const creators = await (async () => {
    const ids = [...new Set(items.map((item) => item.creator_id))];
    if (!ids.length) return new Map();
    const { data } = await supabase.from('public_profiles').select('id, username, display_name').in('id', ids);
    return new Map((data || []).map((person) => [person.id, person]));
  })();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Rides"
        description="Share a cab, find a seat, split a trip home."
        back={{ href: ROUTES.campus, label: 'Campus' }}
        action={canCreate ? <LinkButton href="/campus/rides/new" size="sm" icon="plus">Post a ride</LinkButton> : null}
      />

      <form action="/campus/rides" className="grid gap-2 sm:grid-cols-2" role="search">
        <label className="text-xs text-muted">Ride type<select name="kind" defaultValue={kind} className="control control-select"><option value="">All rides</option><option value="offer">Offers</option><option value="request">Requests</option></select></label>
        <label className="text-xs text-muted">Date<input type="date" name="date" defaultValue={date} className="control control-input" /></label>
        <label className="text-xs text-muted">From<input name="origin" maxLength={120} defaultValue={origin} className="control control-input" /></label>
        <label className="text-xs text-muted">To<input name="destination" maxLength={120} defaultValue={destination} className="control control-input" /></label>
        <div className="flex gap-2"><button type="submit" className="btn btn-secondary btn-sm">Apply filters</button><LinkButton href="/campus/rides" size="sm" variant="ghost">Clear</LinkButton></div>
      </form>
      {unavailable ? <Notice tone="warning" icon="flag">Rides could not be loaded right now.</Notice> : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="bus"
          title="No rides posted"
          description="Weekend trips, station runs and holidays — post one when you have space."
          action={canCreate ? <LinkButton href="/campus/rides/new" variant="primary" size="sm">Post a ride</LinkButton> : null}
        />
      ) : null}

      <section aria-label="Rides" className="flex flex-col gap-3">
        {items.map((ride) => {
          const creator = creators.get(ride.creator_id);
          return (
            <ContentCard
              key={ride.id}
              href={`/campus/rides/${ride.id}`}
              title={`${ride.origin} → ${ride.destination}`}
              description={ride.description}
              icon="bus"
              timestamp={ride.created_at}
              badges={[
                ...(ride.ride_kind ? [{ label: ride.ride_kind === 'offer' ? 'Offer' : 'Request' }] : []),
                { label: formatDate(ride.ride_date), tone: 'accent' },
                ...(ride.ride_time ? [{ label: formatTime(ride.ride_time) }] : []),
                ...(ride.seats ? [{ label: `${ride.seats} seat${ride.seats === 1 ? '' : 's'}` }] : []),
              ]}
              meta={[creator ? `@${creator.username}` : null]}
              footer={
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <PostActionsRow
                    creatorId={ride.creator_id}
                    creatorUsername={creator?.username}
                    isOwner={ride.creator_id === user.profile.id}
                    canReport={can(actor, 'report_content')}
                    canMessage={can(actor, 'send_messages')}
                    reportType="ride_post"
                    reportRef={ride.id}
                  />
                  {ride.creator_id === user.profile.id ? <OwnBoardActions type="rides" id={ride.id} editHref={`/campus/rides/${ride.id}/edit`} /> : null}
                </div>
              }
            />
          );
        })}
      </section>
    </div>
  );
}
