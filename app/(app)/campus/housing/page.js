import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listHousingPosts } from '@/lib/data/campus';
import { ROUTES } from '@/lib/constants';
import { PageHeader, EmptyState, Notice, LinkButton } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';
import { PostActionsRow } from '@/components/campus/PostActionsRow';
import { OwnBoardActions } from '@/components/campus/OwnBoardActions';
import { formatDate } from '@/lib/utils';

export const metadata = { title: 'Housing' };

/** Housing and roommates (spec §32). Posts are text; contact is a normal DM. */
export default async function HousingPage() {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const { items, unavailable } = await listHousingPosts(supabase, { limit: 30 });
  const canCreate = can(actor, 'create_housing_post');

  const creators = await (async () => {
    const ids = [...new Set(items.map((item) => item.creator_id))];
    if (!ids.length) return new Map();
    const { data } = await supabase.from('public_profiles').select('id, username, display_name').in('id', ids);
    return new Map((data || []).map((person) => [person.id, person]));
  })();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Housing"
        description="Rooms, flats, PGs and roommate posts near campus."
        back={{ href: ROUTES.campus, label: 'Campus' }}
        action={canCreate ? <LinkButton href="/campus/housing/new" size="sm" icon="plus">Post housing</LinkButton> : null}
      />

      {unavailable ? <Notice tone="warning" icon="flag">Housing posts could not be loaded right now.</Notice> : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="building"
          title="No housing posts yet"
          description="When students post rooms or look for roommates, it appears here."
          action={canCreate ? <LinkButton href="/campus/housing/new" variant="primary" size="sm">Post housing</LinkButton> : null}
        />
      ) : null}

      <section aria-label="Housing posts" className="flex flex-col gap-3">
        {items.map((post) => {
          const creator = creators.get(post.creator_id);
          return (
            <ContentCard
              key={post.id}
              href={`/campus/housing/${post.id}`}
              title={post.title}
              description={post.description}
              icon="building"
              timestamp={post.created_at}
              badges={[
                ...(post.budget ? [{ label: `₹${post.budget}`, tone: 'accent' }] : []),
                ...(post.room_type ? [{ label: post.room_type.replace('_', ' ') }] : []),
                ...(post.available_from ? [{ label: `From ${formatDate(post.available_from)}` }] : []),
              ]}
              meta={[post.area, creator ? `@${creator.username}` : null]}
              footer={
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <PostActionsRow
                    creatorId={post.creator_id}
                    creatorUsername={creator?.username}
                    isOwner={post.creator_id === user.profile.id}
                    canReport={can(actor, 'report_content')}
                    canMessage={can(actor, 'send_messages')}
                    reportType="housing_post"
                    reportRef={post.id}
                  />
                  {post.creator_id === user.profile.id ? <OwnBoardActions type="housing" id={post.id} editHref={`/campus/housing/${post.id}/edit`} /> : null}
                </div>
              }
            />
          );
        })}
      </section>
    </div>
  );
}
