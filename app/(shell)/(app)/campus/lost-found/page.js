import { LostFoundGallery } from '@/components/campus/LostFoundGallery';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listLostFound } from '@/lib/data/campus';
import { ROUTES } from '@/lib/constants';
import { PageHeader, EmptyState, Notice, LinkButton, Card, Badge } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';
import { PostActionsRow } from '@/components/campus/PostActionsRow';
import { formatDate } from '@/lib/utils';

export const metadata = { title: 'Lost & found' };

/** Lost & found (spec §31). Lost or found, one list, resolved items archived. */
export default async function LostFoundPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const params = await searchParams;
  const kind = ['lost', 'found'].includes(String(params?.kind)) ? String(params.kind) : null;
  const showResolved = params?.resolved === '1';
  const q = typeof params?.q === 'string' ? params.q.trim().slice(0, 120) : '';

  const { items, unavailable } = await listLostFound(supabase, { kind, resolved: showResolved, q, limit: 30 });
  const canCreate = can(actor, 'create_lost_found');

  const creators = await (async () => {
    const ids = [...new Set(items.map((item) => item.creator_id))];
    if (!ids.length) return new Map();
    const { data } = await supabase.from('public_profiles').select('id, username, display_name').in('id', ids);
    return new Map((data || []).map((person) => [person.id, person]));
  })();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Lost & found"
        description="Lost something on campus or found something that is not yours?"
        back={{ href: ROUTES.campus, label: 'Campus' }}
        action={canCreate ? <LinkButton href="/campus/lost-found/new" size="sm" icon="plus">Report an item</LinkButton> : null}
      />

      <Card className="flex flex-wrap items-center gap-1.5 p-3">
        <LinkButton href="/campus/lost-found" size="sm" variant={!kind && !showResolved ? 'secondary' : 'ghost'}>Everything</LinkButton>
        <LinkButton href="/campus/lost-found?kind=lost" size="sm" variant={kind === 'lost' ? 'secondary' : 'ghost'}>Lost</LinkButton>
        <LinkButton href="/campus/lost-found?kind=found" size="sm" variant={kind === 'found' ? 'secondary' : 'ghost'}>Found</LinkButton>
        <LinkButton href="/campus/lost-found?resolved=1" size="sm" variant={showResolved ? 'secondary' : 'ghost'}>Resolved</LinkButton>
      </Card>

      <form action="/campus/lost-found" className="flex flex-wrap gap-2" role="search">
        {kind ? <input type="hidden" name="kind" value={kind} /> : null}
        {showResolved ? <input type="hidden" name="resolved" value="1" /> : null}
        <label className="sr-only" htmlFor="lost-found-search">Search reports</label>
        <input id="lost-found-search" name="q" defaultValue={q} maxLength={120} className="control control-input min-w-0 flex-1" placeholder="Search reports" />
        <button type="submit" className="btn btn-secondary">Search</button>
      </form>
      {unavailable ? <Notice tone="warning" icon="flag">Lost &amp; found could not be loaded right now.</Notice> : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="search"
          title={showResolved ? 'Nothing resolved yet' : 'No reports right now'}
          description="When someone loses or finds something, they post it here."
          action={canCreate ? <LinkButton href="/campus/lost-found/new" variant="primary" size="sm">Report an item</LinkButton> : null}
        />
      ) : null}

      <section aria-label="Items" className="flex flex-col gap-3">
        {items.map((item) => {
          const creator = creators.get(item.creator_id);
          const isOwner = item.creator_id === user.profile.id;
          return (
            <ContentCard
              key={item.id}
              href={`/campus/lost-found/${item.id}`}
              media={<LostFoundGallery reportId={item.id} coverOnly />}
              title={item.title}
              description={item.description}
              icon={item.kind === 'lost' ? 'search' : 'check'}
              timestamp={item.created_at}
              badges={[
                // The kind leads every card — the distinction is the feature.
                { label: item.kind === 'lost' ? 'Lost item' : 'Found item', tone: item.kind === 'lost' ? 'warning' : 'success' },
                ...(item.resolved_at ? [{ label: 'Resolved', tone: 'accent' }] : []),
              ]}
              meta={[item.location, item.occurred_on ? formatDate(item.occurred_on) : null, creator ? `@${creator.username}` : null]}
              footer={
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <PostActionsRow
                    creatorId={item.creator_id}
                    creatorUsername={creator?.username}
                    isOwner={isOwner}
                    canReport={can(actor, 'report_content')}
                    canMessage={can(actor, 'send_messages')}
                    reportType="lost_found"
                    reportRef={item.id}
                    canResolve={!item.resolved_at}
                  />
                </span>
              }
            />
          );
        })}
      </section>

      {showResolved ? <Badge>Resolved items are kept for reference</Badge> : null}
    </div>
  );
}
