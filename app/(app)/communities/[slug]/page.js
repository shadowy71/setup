import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import {
  getCommunityBySlug,
  getCommunityMembership,
  listCommunityMembers,
  listJoinRequests,
  getCommunityChatConversation,
} from '@/lib/data/campus';
import { getCommunityPosts } from '@/lib/data/feed';
import { ROUTES } from '@/lib/constants';
import { PageHeader, Badge, Notice, EmptyState, Card, StaffDot } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { PostCard } from '@/components/posts/PostCard';
import { PostComposer } from '@/components/posts/PostComposer';
import { LiveFeedSync } from '@/components/social/LiveFeedSync';
import { IdentityLine } from '@/components/identity/IdentityLine';
import { CommunityActions } from '@/components/communities/CommunityActions';
import { MessageButton } from '@/components/social/MessageButton';
import { ReportDialog } from '@/components/social/ReportDialog';
import { ExternalLink } from '@/components/content/ExternalLink';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { formatDate } from '@/lib/utils';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const supabase = await getServerClient();
  const community = await getCommunityBySlug(supabase, String(slug || '').toLowerCase());
  return { title: community?.name || 'Community' };
}

/**
 * A community, study group or club (spec §26–§28).
 *
 * Members see the shared feed and can open the community chat (the same chat
 * infrastructure as DMs, as a group conversation). Non-members see exactly what
 * the database allows: the description, member count and public posts.
 */
export default async function CommunityPage({ params }) {
  const { slug } = await params;
  const handle = String(slug || '').toLowerCase();
  if (!handle) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);

  const community = await getCommunityBySlug(supabase, handle);
  if (!community) notFound();

  const isStaff = can(actor, 'moderate_communities') || can(actor, 'moderate_all');
  if (community.status !== 'published' && !isStaff && community.created_by !== user.profile.id) notFound();

  const [membership, members, chat] = await Promise.all([
    getCommunityMembership(supabase, community.id, user.profile.id),
    listCommunityMembers(supabase, community.id, { limit: 40 }),
    getCommunityChatConversation(supabase, community.id),
  ]);

  const isMember = membership?.status === 'active';
  const isOwner = membership?.role === 'owner' || community.created_by === user.profile.id;
  const canManage = isOwner || membership?.role === 'moderator' || isStaff;
  // Mirrors `can_post_in_community`: membership (or moderation power) plus the
  // platform-wide posting permission the home composer already gates on.
  const canPostHere = (isMember || isStaff) && can(actor, 'create_posts');

  const [posts, requests] = await Promise.all([
    getCommunityPosts(supabase, community.id, { limit: 20, currentProfileId: user.profile.id }),
    canManage ? listJoinRequests(supabase, community.id) : Promise.resolve([]),
  ]);

  const owner = members.find((member) => member.role === 'owner') || members[0] || null;
  const kindLabel = community.kind === 'study_group' ? 'Study group' : community.kind === 'club' ? 'Club' : 'Community';

  return (
    <div className="flex flex-col gap-4">
      {/* Re-reads this board when a post lands somewhere else in campus, so an
          already-open page is not left showing the render it was given. Owns no
          data and renders nothing — see components/social/LiveFeedSync. */}
      <LiveFeedSync />
      <PageHeader
        title={community.name}
        description={`${kindLabel} · ${community.member_count} member${community.member_count === 1 ? '' : 's'}`}
        back={{ href: ROUTES.communities, label: 'Communities' }}
        action={
          canManage ? (
            <Link href={`/moderator?target=community&id=${community.id}`} className="text-2xs text-muted underline hover:text-ink">
              Moderate
            </Link>
          ) : null
        }
      />

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {community.is_official ? <Badge tone="accent">Official</Badge> : <Badge>Student-run</Badge>}
          {community.subject ? <Badge>{community.subject}</Badge> : null}
          {community.branch || community.year ? (
            <Badge>{[community.branch, community.year].filter(Boolean).join(' · ')}</Badge>
          ) : null}
          <Badge>{community.visibility === 'campus' ? 'PCCOE only' : community.visibility}</Badge>
          {community.join_policy !== 'open' ? <Badge tone="warning">Approval needed</Badge> : null}
        </div>

        <p className="user-text text-[0.9375rem] leading-relaxed"><LinkifiedText text={community.description} mentions /></p>

        {community.meeting_info ? (
          <p className="flex items-center gap-2 text-[0.8125rem] text-muted">
            <Icon name="calendar" size={14} /> <span className="user-text"><LinkifiedText text={community.meeting_info} /></span>
          </p>
        ) : null}
        {community.contact_info ? (
          <p className="flex items-center gap-2 text-[0.8125rem] text-muted">
            <Icon name="mail" size={14} /> <span className="user-text"><LinkifiedText text={community.contact_info} /></span>
          </p>
        ) : null}
        {community.external_url ? (
          <p className="text-[0.8125rem]">
            <ExternalLink url={community.external_url} className="underline">
              {community.external_url}
            </ExternalLink>
          </p>
        ) : null}
        {community.recruitment_info ? (
          <p className="user-text text-[0.8125rem] text-muted"><LinkifiedText text={community.recruitment_info} /></p>
        ) : null}

        <p className="text-2xs text-muted">Created {formatDate(community.created_at)}</p>

        <CommunityActions
          communityId={community.id}
          slug={community.slug}
          membership={membership}
          joinPolicy={community.join_policy}
          canJoin={can(actor, 'join_clubs') || can(actor, 'create_communities')}
          canChat={isMember && can(actor, 'send_messages')}
          chatConversationId={chat?.id || null}
          pendingRequests={requests}
          canManage={canManage}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <section aria-label="Community posts" className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Posts</h2>
          {canPostHere ? <PostComposer communityId={community.id} compact /> : null}
          {posts.length === 0 ? (
            <EmptyState
              icon="comment"
              title="Nothing posted here yet"
              description={isMember ? 'Posts shared with this community appear here.' : 'Members see posts here.'}
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
              showCommunity={false}
            />
          ))}
        </section>

        <aside className="flex flex-col gap-3">
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Members</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {members.slice(0, 12).map((member) => (
                <li key={member.user_id}>
                  <IdentityLine
                    username={member.username}
                    displayName={member.display_name}
                    isStaff={member.is_staff}
                    size="sm"
                    badge={
                      <>
                        {member.role !== 'member' ? <Badge tone="accent">{member.role}</Badge> : null}
                        {member.is_staff ? <StaffDot label="Campus+ staff" /> : null}
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
            {members.length > 12 ? (
              <p className="mt-2 text-2xs text-muted">{community.member_count - 12} more members</p>
            ) : null}
          </Card>

          {owner && owner.user_id !== user.profile.id ? (
            <Card className="flex flex-col gap-2 p-4">
              <h2 className="text-sm font-semibold">Contact</h2>
              <p className="text-2xs text-muted">
                {owner.display_name || `@${owner.username}`} runs this {kindLabel.toLowerCase()}.
              </p>
              <MessageButton profileId={owner.user_id} label={`Message @${owner.username}`} />
            </Card>
          ) : null}

          {community.status !== 'published' ? (
            <Notice tone="warning" icon="flag">
              This community is {community.status}. Only its managers and moderators can see it.
            </Notice>
          ) : null}

          <div className="flex justify-end">
            <ReportDialog targetType={community.kind === 'club' ? 'club' : 'community'} targetRef={community.id} label={community.name} />
          </div>
        </aside>
      </div>
    </div>
  );
}
