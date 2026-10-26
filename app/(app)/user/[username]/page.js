import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getPublicProfile, getProfileCounts, isBlockingProfile } from '@/lib/data/profiles';
import { getPostsByAuthor } from '@/lib/data/feed';
import { LiveFeedSync } from '@/components/social/LiveFeedSync';
import { ROUTES, USERNAME_REGEX } from '@/lib/constants';
import { Badge, Card, EmptyState, IdentityMark, PageHeader, StaffDot } from '@/components/ui';
import { ShareButton } from '@/components/social/ShareButton';
import { PostCard } from '@/components/posts/PostCard';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { ProfileActions } from '@/components/profile/ProfileActions';
import { formatDate } from '@/lib/utils';

/**
 * Public profile (spec §12).
 *
 * The public identity of a student is their username — never their email, never
 * their PRN. This page shows only what `public_profiles` exposes: display name,
 * bio, optional branch/year, and their posts. There is no presence indicator
 * anywhere on Campus+.
 */
export async function generateMetadata({ params }) {
  const { username } = await params;
  const handle = String(username || '').toLowerCase();
  if (!USERNAME_REGEX.test(handle)) return { title: 'Profile' };
  const supabase = await getServerClient();
  // Same argument as the page body — React `cache` shares the read.
  const profile = await getPublicProfile(supabase, handle);
  return { title: profile ? `${profile.display_name || `@${profile.username}`} (@${profile.username})` : 'Profile not found' };
}

export default async function UserProfilePage({ params }) {
  const { username } = await params;
  const handle = String(username || '').toLowerCase();
  if (!USERNAME_REGEX.test(handle)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);

  const profile = await getPublicProfile(supabase, handle);
  // Blocked people and deactivated accounts are simply not there (spec §60).
  if (!profile || profile.is_active === false) notFound();

  const isSelf = profile.id === user.profile.id;

  const [posts, counts, blockedByMe] = await Promise.all([
    getPostsByAuthor(supabase, profile.id, { limit: 20, currentProfileId: user.profile.id }),
    getProfileCounts(supabase, profile.id),
    isBlockingProfile(supabase, user.profile.id, profile.id),
  ]);

  const name = profile.display_name || `@${profile.username}`;

  return (
    <div className="flex flex-col gap-4">
      {/* Re-reads this board when a post lands somewhere else in campus, so an
          already-open page is not left showing the render it was given. Owns no
          data and renders nothing — see components/social/LiveFeedSync. */}
      <LiveFeedSync />
      <PageHeader
        title={name}
        back={{ href: ROUTES.home, label: 'Home' }}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ShareButton path={`/user/${profile.username}`} title={`@${profile.username} on Campus+`} />
            <ProfileActions
              profileId={profile.id}
              username={profile.username}
              isSelf={isSelf}
              isBlocked={blockedByMe}
              canMessage={can(actor, 'send_messages')}
              canBlock={can(actor, 'block_users')}
              canReport={can(actor, 'report_content')}
            />
          </div>
        }
      />

      <Card className="p-4">
        <div className="flex items-start gap-4">
          <IdentityMark name={name} size={48} tone="accent" square={false} />
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[1.0625rem] font-semibold">
              <span className="truncate">{name}</span>
              {profile.is_staff ? <StaffDot label="Campus+ staff" /> : null}
            </h2>
            <p className="mt-0.5 text-[0.8125rem] text-muted">@{profile.username}</p>
            {profile.bio ? <p className="user-text mt-2 text-[0.9375rem] leading-relaxed"><LinkifiedText text={profile.bio} mentions /></p> : null}
            <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted">
              {profile.branch || profile.year ? (
                <div className="flex items-center gap-1">
                  <dt className="sr-only">Branch and year</dt>
                  <dd>{[profile.branch, profile.year].filter(Boolean).join(' · ')}</dd>
                </div>
              ) : null}
              <div className="flex items-center gap-1">
                <dt className="sr-only">Joined</dt>
                <dd>Joined {formatDate(profile.created_at)}</dd>
              </div>
              <div className="flex items-center gap-1">
                <dt className="sr-only">Posts</dt>
                <dd>{counts.posts} post{counts.posts === 1 ? '' : 's'}</dd>
              </div>
              <div className="flex items-center gap-1">
                <dt className="sr-only">Comments</dt>
                <dd>{counts.comments} comment{counts.comments === 1 ? '' : 's'}</dd>
              </div>
              {profile.marketplace_completed_count > 0 ? (
                <div className="flex items-center gap-1">
                  <dt className="sr-only">Completed marketplace deals</dt>
                  <dd>{profile.marketplace_completed_count} completed deal{profile.marketplace_completed_count === 1 ? '' : 's'}</dd>
                </div>
              ) : null}
            </dl>
            {blockedByMe ? (
              <p className="mt-2">
                <Badge tone="danger">You blocked this student</Badge>
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <section aria-label="Posts" className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Posts</h2>
        {posts.length === 0 ? (
          <EmptyState
            icon="comment"
            title={isSelf ? 'You have not posted yet' : `${name} has not posted yet`}
            description={isSelf ? 'Anything you publish on the campus feed appears here.' : undefined}
            action={isSelf ? <Link href={ROUTES.home} className="underline">Go to the feed</Link> : null}
          />
        ) : null}
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            currentUserId={user.profile.id}
            canModerate={can(actor, 'remove_posts')}
            reactions={{ count: post.reaction_count || 0, mine: Boolean(post.reacted_by_me) }}
            poll={post.poll}
          />
        ))}
      </section>
    </div>
  );
}
