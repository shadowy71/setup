import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import {
  getCommunityById,
  getCommunityMembership,
  listCommunityMembers,
  listJoinRequests,
  getCommunityChatConversation,
  listOpportunities,
} from '@/lib/data/campus';
import { getCommunityJoinRequest } from '@/lib/data/clubs';
import { getCommunityPosts } from '@/lib/data/feed';
import { listPublishedEvents } from '@/lib/data/public-cache';
import { ROUTES, UUID_REGEX } from '@/lib/constants';
import { PageHeader, Badge, Card, EmptyState, LinkButton, Notice, SectionHeader, StaffDot } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { ContentCard } from '@/components/content/ContentCard';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { ExternalLink } from '@/components/content/ExternalLink';
import { IdentityLine } from '@/components/identity/IdentityLine';
import { PostComposer } from '@/components/posts/PostComposer';
import { LiveFeedSync } from '@/components/social/LiveFeedSync';
import { CommunityActions } from '@/components/communities/CommunityActions';
import { MessageButton } from '@/components/social/MessageButton';
import { ReportDialog } from '@/components/social/ReportDialog';
import { ClubMonogram } from '@/components/clubs/ClubMonogram';
import { ClubMembersPanel } from '@/components/clubs/ClubMembersPanel';
import { formatDate, relativeTime, truncate } from '@/lib/utils';

export async function generateMetadata({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return { title: 'Club' };
  const supabase = await getServerClient();
  const club = await getCommunityById(supabase, id);
  return { title: club?.name || 'Club' };
}

/**
 * A club's own page (spec §28).
 *
 * The club is the shared `communities` row (membership, join policy, chat and
 * feed are unchanged) presented as a club: monogram, category, announcements,
 * activity, upcoming events, members, and — for its owners and moderators —
 * real member management. Announcements are ordinary posts in the club's feed,
 * so the same composer, reactions, comments and moderation apply.
 */
export default async function ClubPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);

  const club = await getCommunityById(supabase, id);
  if (!club || club.kind !== 'club') notFound();

  const isStaff =
    can(actor, 'manage_clubs') ||
    can(actor, 'moderate_communities') ||
    can(actor, 'moderate_all');
  if (club.status !== 'published' && !isStaff && club.created_by !== user.profile.id) notFound();

  const [membership, joinRequest, members, events, opportunities, chat, posts] = await Promise.all([
    getCommunityMembership(supabase, club.id, user.profile.id),
    getCommunityJoinRequest(supabase, club.id, user.profile.id),
    listCommunityMembers(supabase, club.id, { limit: 60 }),
    listPublishedEvents({ limit: 5, clubId: club.id, upcoming: true }),
    listOpportunities(supabase, { limit: 5, clubId: club.id }),
    getCommunityChatConversation(supabase, club.id),
    getCommunityPosts(supabase, club.id, { limit: 6, currentProfileId: user.profile.id }),
  ]);

  const isMember = membership?.status === 'active';
  const isOwner = isMember && membership?.role === 'owner';
  const canManage = isStaff || isOwner || (isMember && membership?.role === 'moderator');
  const requests = canManage ? await listJoinRequests(supabase, club.id) : [];
  const canPostHere = (isMember || isStaff) && can(actor, 'create_posts');
  const owner = members.find((member) => member.role === 'owner') || null;

  // Recent activity is derived from rows already on the page — posts, joins and
  // the next event. Nothing is inferred and nothing is invented.
  const activity = [
    ...posts.slice(0, 3).map((post) => ({
      key: `post-${post.id}`,
      icon: 'megaphone',
      text: `${post.author_display_name || 'A member'} posted ${post.title ? `“${truncate(post.title, 46)}”` : 'an update'}`,
      at: post.created_at,
    })),
    ...[...members]
      .sort((a, b) => new Date(b.joined_at) - new Date(a.joined_at))
      .slice(0, 3)
      .map((member) => ({
        key: `member-${member.user_id}`,
        icon: 'users',
        text: `${member.display_name || 'A student'} joined the club`,
        at: member.joined_at,
      })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-4">
      {/* Re-reads this board when a post lands somewhere else in campus, so an
          already-open page is not left showing the render it was given. Owns no
          data and renders nothing — see components/social/LiveFeedSync. */}
      <LiveFeedSync />
      <PageHeader
        title={club.name}
        eyebrow={club.club_category ? `${club.club_category} club` : 'Club'}
        description={`${club.member_count} member${club.member_count === 1 ? '' : 's'} · page added ${formatDate(club.created_at)}`}
        back={{ href: ROUTES.clubs, label: 'Clubs' }}
        action={
          <>
            {canManage ? (
              <LinkButton href={ROUTES.clubManage(club.id)} size="sm" variant="secondary" icon="sliders">
                Manage club
              </LinkButton>
            ) : null}
            {!isOwner ? <ReportDialog targetType="club" targetRef={club.id} label={club.name} /> : null}
          </>
        }
      />

      <Card className="club-hero flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start gap-3.5">
          <ClubMonogram name={club.name} id={club.id} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {club.verification_status === 'source_checked' ? <Badge tone="accent" icon="check">Source checked</Badge> : <Badge>Details pending</Badge>}
              {club.is_official ? <Badge tone="accent">Campus+ reviewed</Badge> : null}
              {!club.admin_assigned ? <Badge tone="warning">Admin assignment needed</Badge> : null}
              {club.admin_assigned && club.recruitment_info ? (
                <Badge tone="info" icon="megaphone">Recruiting</Badge>
              ) : null}
              {club.admin_assigned && club.join_policy !== 'open' ? <Badge>Approval needed</Badge> : null}
              {isMember ? (
                <Badge tone="success" icon="check">
                  Member
                </Badge>
              ) : null}
            </div>
            <p className="user-text mt-2.5 text-[0.9375rem] leading-relaxed">
              <LinkifiedText text={club.description} mentions />
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-2xs text-muted">
          {club.meeting_info ? (
            <span className="flex items-center gap-1.5">
              <Icon name="calendar" size={13} /> <span className="user-text"><LinkifiedText text={club.meeting_info} /></span>
            </span>
          ) : null}
          {club.contact_info ? (
            <span className="flex items-center gap-1.5">
              <Icon name="mail" size={13} /> <span className="user-text"><LinkifiedText text={club.contact_info} /></span>
            </span>
          ) : null}
          {club.external_url ? (
            <span className="flex items-center gap-1.5">
              <Icon name="link" size={13} />
              <ExternalLink url={club.external_url} className="underline">
                {club.external_url}
              </ExternalLink>
            </span>
          ) : null}
        </div>

        <div className="rounded-[var(--radius-md)] border border-line bg-surface-2 p-3 text-2xs leading-relaxed text-muted">
          {club.source_url ? (
            <ExternalLink url={club.source_url} className="font-medium text-ink underline">
              Directory source: {club.source_label || club.source_url}
            </ExternalLink>
          ) : (
            <span>{club.source_label ? `Source: ${club.source_label}` : 'Public source and contact details are pending.'}</span>
          )}
          <span className="mt-1 block">Source checked means the organization is listed by the cited source; it does not verify every detail on this page.</span>
        </div>

        {club.recruitment_info ? (
          <p className="user-text rounded-[var(--radius-md)] border border-line bg-surface-2 p-3 text-[0.8125rem] leading-relaxed">
            <span className="mr-1.5 font-semibold">Recruiting:</span>
            <LinkifiedText text={club.recruitment_info} />
          </p>
        ) : null}

        {club.status !== 'published' ? (
          <Notice tone="warning" icon="flag">
            This club is {club.status}. Only managers and moderators can see it.
          </Notice>
        ) : null}

        <CommunityActions
          communityId={club.id}
          slug={club.slug}
          membership={membership}
          joinRequest={joinRequest}
          joinPolicy={club.join_policy}
          canJoin={club.admin_assigned && (can(actor, 'join_clubs') || can(actor, 'create_communities'))}
          joinDisabledReason={!club.admin_assigned ? 'Membership opens after Campus+ staff assign a real club administrator.' : null}
          canChat={isMember && can(actor, 'send_messages')}
          chatConversationId={chat?.id || null}
          pendingRequests={requests}
          canManage={canManage}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4">
            <SectionHeader
              title="Announcements"
              description="Updates from the club's own feed."
              icon="megaphone"
              action={
                <Link href={ROUTES.community(club.slug)} className="text-2xs text-muted underline hover:text-ink">
                  Open club feed
                </Link>
              }
            />
            {canPostHere ? <PostComposer communityId={club.id} compact /> : null}
            {posts.length ? (
              <ul className="flex flex-col divide-y divide-line">
                {posts.map((post) => (
                  <li key={post.id} className="py-2.5 first:pt-0 last:pb-0">
                    <Link href={ROUTES.post(post.id)} className="text-[0.875rem] font-medium hover:underline">
                      {post.title || truncate(post.body, 92)}
                    </Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-muted">
                      <span>{post.author_display_name || 'Member'}</span>
                      <span>·</span>
                      <time dateTime={post.created_at}>{relativeTime(post.created_at)}</time>
                      {post.is_official ? <Badge tone="accent">Official</Badge> : null}
                      {post.kind === 'poll' ? <Badge>Poll</Badge> : null}
                    </p>
                    {post.title && post.body ? (
                      <p className="user-text mt-1 text-[0.8125rem] leading-relaxed text-muted">
                        {truncate(post.body, 160)}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon="megaphone"
                title="No announcements yet"
                description={
                  canPostHere
                    ? 'Post the first update — it appears here and in the club feed.'
                    : 'Updates from the club will appear here.'
                }
              />
            )}
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <SectionHeader title="Upcoming events" icon="calendar" action={
              <Link href="/campus/events" className="text-2xs text-muted underline hover:text-ink">
                All events
              </Link>
            } />
            {events.items.length ? (
              events.items.map((event) => (
                <ContentCard
                  key={event.id}
                  href={ROUTES.event(event.id)}
                  title={event.title}
                  description={event.description}
                  icon="calendar"
                  official={event.is_official}
                  badges={[{ label: formatDate(event.starts_on), tone: 'accent' }]}
                  meta={[event.location, event.organizer]}
                />
              ))
            ) : (
              <EmptyState icon="calendar" title="No upcoming events" description="This club has not scheduled anything yet." />
            )}
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <SectionHeader title="Opportunities" icon="briefcase" action={
              <Link href="/explore/opportunities" className="text-2xs text-muted underline hover:text-ink">All opportunities</Link>
            } />
            {opportunities.items.length ? opportunities.items.map((opportunity) => (
              <ContentCard
                key={opportunity.id}
                href={ROUTES.opportunity(opportunity.id)}
                title={opportunity.title}
                description={opportunity.description}
                icon="briefcase"
                official={opportunity.source === 'official'}
                badges={[{ label: opportunity.source === 'official' ? 'Verified source' : 'Community submitted', tone: 'neutral' }]}
                meta={[opportunity.organization, opportunity.deadline ? `Deadline ${formatDate(opportunity.deadline)}` : null]}
              />
            )) : (
              <EmptyState icon="briefcase" title="No linked opportunities" description="Published opportunities linked to this club will appear here." />
            )}
          </Card>
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4">
            <h2 className="text-sm font-semibold">Recent activity</h2>
            {activity.length ? (
              <ul className="flex flex-col gap-2.5">
                {activity.map((entry) => (
                  <li key={entry.key} className="flex items-start gap-2 text-[0.8125rem]">
                    <Icon name={entry.icon} size={14} className="mt-0.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block leading-snug">{entry.text}</span>
                      <span className="mt-0.5 block text-2xs text-muted-soft">{relativeTime(entry.at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.8125rem] text-muted">Nothing has happened here yet.</p>
            )}
            {events.items[0] ? (
              <p className="flex items-start gap-2 border-t border-line pt-2.5 text-[0.8125rem]">
                <Icon name="calendar" size={14} className="mt-0.5 shrink-0 text-muted" />
                <span>
                  Next event: <Link href={ROUTES.event(events.items[0].id)} className="underline">{events.items[0].title}</Link>
                  <span className="mt-0.5 block text-2xs text-muted-soft">{formatDate(events.items[0].starts_on)}</span>
                </span>
              </p>
            ) : null}
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Members</h2>
              <span className="text-2xs text-muted">{club.member_count}</span>
            </div>
            {canManage ? (
              <ClubMembersPanel
                clubId={club.id}
                members={members}
                isOwner={isOwner}
                currentUserId={user.profile.id}
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {members.slice(0, 10).map((member) => (
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
            )}
            {owner && owner.user_id !== user.profile.id ? (
              <MessageButton profileId={owner.user_id} label="Message the club lead" variant="secondary" />
            ) : null}
            {members.length > 10 && !canManage ? (
              <p className="text-2xs text-muted">{club.member_count - 10} more members</p>
            ) : null}
          </Card>

        </aside>
      </div>
    </div>
  );
}
