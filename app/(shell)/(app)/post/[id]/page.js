import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getPostDetail } from '@/lib/data/feed';
import { ROUTES, UUID_REGEX } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ShareButton } from '@/components/social/ShareButton';
import { PostCard } from '@/components/posts/PostCard';
import { CommentThread } from '@/components/posts/CommentThread';

/**
 * Post detail (spec §13).
 *
 * One post, its thread and nothing else — comments are plain text (+ GIF), the
 * reply hierarchy is one level deep, and visibility (blocks, community
 * membership, moderation state) is applied by RLS in `getPostDetail`.
 */
export async function generateMetadata({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return { title: 'Post not found' };
  const user = await requireUser();
  const supabase = await getServerClient();
  const detail = await getPostDetail(supabase, id, { currentProfileId: user.profile.id });
  if (!detail?.post) return { title: 'Post not found' };
  const post = detail.post;
  const title = post.title || (post.body ? `${post.body.slice(0, 60)}${post.body.length > 60 ? '…' : ''}` : 'Post');
  return { title, description: post.body?.slice(0, 160) || undefined };
}

export default async function PostDetailPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const detail = await getPostDetail(supabase, id, { currentProfileId: user.profile.id });

  if (!detail?.post) notFound();

  const { post, comments } = detail;
  const canComment = can(actor, 'create_comments');
  const canModerate = can(actor, 'remove_posts');

  const closed = post.status === 'deleted' || post.status === 'removed' || post.status === 'hidden';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={post.kind === 'discussion' ? 'Discussion' : post.kind === 'poll' ? 'Poll' : 'Post'}
        back={{ href: ROUTES.home, label: 'Home' }}
        action={<ShareButton path={`/post/${post.id}`} title={post.title || 'A post on Campus+'} />}
      />

      {post.status === 'removed' || post.status === 'hidden' ? (
        <Notice tone="warning" icon="flag">
          This post is {post.status} and is only visible to you and moderators.
        </Notice>
      ) : null}

      <PostCard
        post={post}
        currentUserId={user.profile.id}
        canModerate={canModerate}
        reactions={{ count: post.reaction_count || 0, mine: Boolean(post.reacted_by_me) }}
        poll={post.poll}
        detail
      />

      {!closed ? (
        <CommentThread
          comments={comments}
          postId={post.id}
          currentUserId={user.profile.id}
          canComment={canComment}
          commentDisabledReason="Your account cannot comment right now."
        />
      ) : (
        <p className="text-[0.8125rem] text-muted">
          Comments are closed on this post.{' '}
          <Link href={ROUTES.home} className="underline">
            Back to the feed
          </Link>
        </p>
      )}
    </div>
  );
}
