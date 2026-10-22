import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { ROUTES } from '@/lib/constants';
import { getCampusFeed, hydratePosts } from '@/lib/data/feed';
import { EmptyState, Notice } from '@/components/ui';
import { PostComposer } from '@/components/posts/PostComposer';
import { DepthField } from '@/components/atmosphere/DepthField';
import { IslandMotion } from '@/components/home/IslandMotion';
import { HomePulse, HomeZone, HomeCoda } from '@/components/home/HomePulse';
import { StreamItem, StreamSlot } from '@/components/home/StreamItem';
import { HomeRail } from '@/components/home/HomeRail';
import { HomeFeatureTiles } from '@/components/home/HomeFeatureTiles';

export const metadata = { title: 'Home' };

/** Modules worth one tap from the contextual rail — real destinations. */
const QUICK_LINKS = [
  { href: '/campus/noticeboard', label: 'Noticeboard', icon: 'megaphone' },
  { href: '/campus/events', label: 'Events', icon: 'calendar' },
  { href: '/campus/lost-found', label: 'Lost & found', icon: 'search' },
  { href: '/explore/resources', label: 'Resources', icon: 'book' },
  { href: '/explore/opportunities', label: 'Opportunities', icon: 'trend' },
  { href: ROUTES.clubs, label: 'Clubs', icon: 'star' },
  { href: ROUTES.gigs, label: 'Gigs', icon: 'briefcase' },
];

/**
 * Home — the living campus.
 *
 * Three movements, one page:
 *
 *   1. the threshold (HomePulse): who you are, the two ways in, and a column of
 *      real counts, set over the depth field rather than inside a card;
 *   2. the works: the composer and the stream on the left, the rail of small
 *      destinations on the right — every entry an island of its own weight;
 *   3. the exit: one rule and one line of plain speaking.
 *
 * All data is real and all reads keep their existing RLS/permission behaviour:
 * the unified `campus_feed()`, the next few official events, the pinned
 * notices, and the same hydrated posts as before. Nothing is mocked, and the
 * absence of content renders as an empty state rather than as filler.
 */
export default async function HomePage() {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const me = user.profile.id;

  const canPost = can(actor, 'create_posts');
  const canModerate = can(actor, 'remove_posts');

  const [{ items: feed, unavailable }, { data: events }, { data: pinnedNotices }] = await Promise.all([
    getCampusFeed(supabase, { limit: 20 }),
    supabase
      .from('events')
      .select('id, title, starts_on, start_time, location, is_official, organizer')
      .eq('status', 'published')
      .gte('starts_on', new Date().toISOString().slice(0, 10))
      .order('starts_on', { ascending: true })
      .limit(3),
    supabase
      .from('notices')
      .select('id, title, category, importance, published_at')
      .eq('status', 'published')
      .order('pinned', { ascending: false })
      .order('published_at', { ascending: false })
      .limit(3),
  ]);

  const feedPosts = feed
    .filter((item) => ['post', 'discussion', 'poll'].includes(item.type))
    .map((item) => item.post)
    .filter(Boolean);
  const hydrated = await hydratePosts(supabase, feedPosts, { currentProfileId: me });
  const postById = new Map(hydrated.map((post) => [post.id, post]));

  const trending = hydrated
    .slice()
    .sort((a, b) => (b.reaction_count || 0) + (b.comment_count || 0) - ((a.reaction_count || 0) + (a.comment_count || 0)))
    .slice(0, 3);

  const marketplace = feed.filter((item) => ['listing', 'deal'].includes(item.type)).slice(0, 3);

  /* The threshold's counts are lengths of what this page already loaded — a
     module with nothing in it is left out rather than shown as a zero. */
  const stats = [
    { label: 'On the feed', value: feed.length },
    { label: 'Events ahead', value: events?.length || 0 },
    { label: 'Notices pinned', value: pinnedNotices?.length || 0 },
    { label: 'Market listings', value: marketplace.length },
  ].filter((stat) => stat.value > 0);

  return (
    <div className="home-stage">
      {/* Loading-layer probe (renders nothing): tells the launch intro that
          Home content has committed so it can complete its reveal and fade. */}

      {/* The environment: one shared canvas behind the whole page, decorative
          and non-interactive, with a CSS composition as its no-WebGL twin. */}
      <DepthField />

      <HomePulse user={user} stats={stats} />

      {/* The two doors: Clubs and Gigs, promoted out of the discovery-chip
          deck into feature tiles a student cannot scroll past unseen. */}
      <HomeFeatureTiles />

      <IslandMotion>
        <div className="home-body">
          <div className="home-body__main">
            <div className="home-composer">
              <p className="home-composer__label">
                New on campus
                <span aria-hidden="true">·</span>
                <span className="text-muted-soft">Posts, discussions and polls</span>
              </p>
              {canPost ? (
                <PostComposer authorName={user.profile.display_name || user.profile.username} />
              ) : (
                <Notice tone="neutral" icon="lock">
                  Your account cannot publish posts right now.
                </Notice>
              )}
            </div>

            {unavailable ? (
              <Notice tone="warning" icon="flag">
                The feed is temporarily unavailable. Refresh to try again.
              </Notice>
            ) : null}

            <section className="flex flex-col gap-4" aria-labelledby="home-stream-title">
              <HomeZone
                id="home-stream-title"
                eyebrow="Campus feed"
                title="What's moving right now"
                note="Ordered by the database, newest first — no ranking, no AI, no engagement theatre."
                aside={
                  feed.length ? (
                    <span className="home-zone__count text-2xs text-muted">
                      {feed.length} {feed.length === 1 ? 'entry' : 'entries'}
                    </span>
                  ) : null
                }
              />

              {feed.length === 0 && !unavailable ? (
                <EmptyState
                  icon="sparkle"
                  title="Nothing on the feed yet"
                  description="When students post, discuss or share official updates, they appear here. Be the first."
                  action={canPost ? null : undefined}
                />
              ) : null}

              <div className="home-stream">
                {feed.map((item) => {
                  const post = postById.get(item.id) || item.post;
                  return (
                    <StreamSlot key={`${item.type}-${item.id}`} kind={item.type}>
                      <StreamItem
                        item={item}
                        post={post}
                        currentUserId={me}
                        canModerate={canModerate}
                        reactions={{
                          count: post?.reaction_count || 0,
                          mine: Boolean(post?.reacted_by_me),
                        }}
                      />
                    </StreamSlot>
                  );
                })}
              </div>

              {feed.length ? (
                <Link href={ROUTES.explore} className="self-start text-xs font-semibold text-accent-ink hover:underline">
                  More on Explore →
                </Link>
              ) : null}
            </section>
          </div>

          <HomeRail
            events={events || []}
            notices={pinnedNotices || []}
            trending={trending}
            marketplace={marketplace}
            quickLinks={QUICK_LINKS}
          />
        </div>
      </IslandMotion>

      <HomeCoda>
        Campus+ is an unofficial student project — no algorithmic ranking, no AI, no advertising. Feed order is
        deterministic and configured in the database.
      </HomeCoda>
    </div>
  );
}
