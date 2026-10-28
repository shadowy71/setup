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
} from '@/lib/data/campus';
import { getClubAnalytics, getClubWorkspaceData } from '@/lib/data/clubs';
import { getCommunityPosts } from '@/lib/data/feed';
import { listPublishedEvents } from '@/lib/data/public-cache';
import { CLUB_MANAGE_VIEWS, ROUTES, UUID_REGEX } from '@/lib/constants';
import { Badge, Card, EmptyState, LinkButton, Notice, PageHeader, SectionHeader } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { ContentCard } from '@/components/content/ContentCard';
import { PostComposer } from '@/components/posts/PostComposer';
import { LiveFeedSync } from '@/components/social/LiveFeedSync';
import { ClubManageNavigation } from '@/components/clubs/ClubManageNavigation';
import { ClubMemberPreview } from '@/components/clubs/ClubMemberPreview';
import { ClubMembersPanel } from '@/components/clubs/ClubMembersPanel';
import { ClubJoinRequestsPanel } from '@/components/clubs/ClubJoinRequestsPanel';
import { ClubSettingsForm } from '@/components/clubs/ClubSettingsForm';
import { formatDate, formatDateTime, relativeTime, truncate } from '@/lib/utils';

export const metadata = { title: 'Club management' };

function MetricCard({ label, metric, icon, href }) {
  const content = (
    <>
      <span className="flex items-center gap-2 text-2xs font-medium text-muted"><Icon name={icon} size={14} />{label}</span>
      <strong className="mt-2 block text-2xl font-semibold tracking-tight">{metric?.value === null || !metric ? '—' : metric.value}</strong>
      <span className="mt-1 block text-2xs text-muted">{metric?.unavailable ? 'Unavailable right now' : 'Current database count'}</span>
    </>
  );
  return href ? <Link href={href} className="card block p-4 hover:border-accent">{content}</Link> : <Card className="p-4">{content}</Card>;
}

function ActivityList({ entries, empty = 'No club activity has been recorded yet.' }) {
  if (!entries.length) return <EmptyState icon="history" title="No activity yet" description={empty} />;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {entries.map((entry) => (
        <li key={entry.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
          <Icon name={entry.icon || 'history'} size={15} className="mt-0.5 shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.8125rem] leading-relaxed">{entry.text}</p>
            <p className="mt-1 text-2xs text-muted">{entry.actor ? `${entry.actor} · ` : ''}<time dateTime={entry.at}>{relativeTime(entry.at)}</time></p>
          </div>
          {entry.href ? <Link href={entry.href} className="text-2xs text-muted underline">Open</Link> : null}
        </li>
      ))}
    </ul>
  );
}

export default async function ClubManagePage({ params, searchParams }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const query = await searchParams;
  const preview = query?.preview === 'member';
  const view = CLUB_MANAGE_VIEWS.some((entry) => entry.value === query?.view) ? query.view : 'overview';

  const club = await getCommunityById(supabase, id);
  if (!club || club.kind !== 'club') notFound();
  const membership = await getCommunityMembership(supabase, club.id, user.profile.id);
  const isStaff = can(actor, 'manage_clubs') || can(actor, 'moderate_communities') || can(actor, 'moderate_all');
  const isMember = membership?.status === 'active';
  const isOwner = isMember && membership.role === 'owner';
  const canManage = isStaff || (isMember && ['owner', 'moderator'].includes(membership.role));
  if (!canManage) notFound();

  if (preview) {
    const [posts, members, events] = await Promise.all([
      getCommunityPosts(supabase, club.id, { limit: 8, currentProfileId: user.profile.id }),
      listCommunityMembers(supabase, club.id, { limit: 12 }),
      listPublishedEvents({ limit: 6, clubId: club.id, upcoming: true }),
    ]);
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title={`Member preview: ${club.name}`}
          eyebrow="Presentation preview"
          description="Your permissions have not changed. This preview uses published club content and hides management controls."
          back={{ href: ROUTES.clubManage(club.id), label: 'Back to management' }}
          action={<LinkButton href={ROUTES.club(club.id)} size="sm" variant="secondary" icon="eye">Open actual club page</LinkButton>}
        />
        <Notice tone="neutral" icon="info">Preview only. Join, chat, and management actions are intentionally not reproduced here; the actual club page applies each viewer’s own membership and RLS.</Notice>
        <ClubMemberPreview club={club} posts={posts} members={members} events={events.items} />
      </div>
    );
  }

  const [members, requests, posts, analytics, workspace] = await Promise.all([
    listCommunityMembers(supabase, club.id, { limit: 100 }),
    listJoinRequests(supabase, club.id, { limit: 60 }),
    getCommunityPosts(supabase, club.id, { limit: 30, currentProfileId: user.profile.id }),
    getClubAnalytics(supabase, club.id),
    getClubWorkspaceData(supabase, club.id, user.profile.id),
  ]);

  const activity = [
    ...workspace.audit.map((row) => ({
      key: `audit-${row.id}`,
      icon: 'history',
      text: row.action.replaceAll('_', ' '),
      actor: row.actor_username ? `@${row.actor_username}` : 'Campus+ system',
      at: row.created_at,
    })),
    ...posts.map((post) => ({
      key: `post-${post.id}`,
      icon: 'megaphone',
      text: `${post.author_display_name || 'A member'} posted ${post.title ? `“${truncate(post.title, 70)}”` : 'an update'}`,
      at: post.created_at,
      href: ROUTES.post(post.id),
    })),
    ...members.map((member) => ({
      key: `member-${member.user_id}`,
      icon: 'users',
      text: `${member.display_name || `@${member.username}` || 'A student'} has an active ${member.role} membership`,
      at: member.joined_at,
    })),
    ...workspace.events.map((event) => ({
      key: `event-${event.id}`,
      icon: 'calendar',
      text: `Event “${event.title}” · ${event.status}`,
      at: event.created_at,
      href: ROUTES.event(event.id),
    })),
    ...workspace.opportunities.map((opportunity) => ({
      key: `opportunity-${opportunity.id}`,
      icon: 'briefcase',
      text: `Opportunity “${opportunity.title}” · ${opportunity.status}`,
      at: opportunity.created_at,
      href: ROUTES.opportunity(opportunity.id),
    })),
  ].filter((entry) => entry.at).sort((a, b) => new Date(b.at) - new Date(a.at));

  const canPostHere = (isMember || can(actor, 'moderate_communities') || can(actor, 'moderate_all')) && can(actor, 'create_posts');
  const activeLabel = CLUB_MANAGE_VIEWS.find((entry) => entry.value === view)?.label || 'Dashboard';

  return (
    <div className="flex flex-col gap-4">
      <LiveFeedSync />
      <PageHeader
        title={`Manage ${club.name}`}
        eyebrow={activeLabel}
        description="Club-scoped tools backed by real membership, content, notification and audit records. No platform-wide powers are granted here."
        back={{ href: ROUTES.club(club.id), label: 'Public club page' }}
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`${ROUTES.clubManage(club.id)}?preview=member`} size="sm" variant="secondary" icon="eye">View as member</LinkButton>
            <LinkButton href={ROUTES.club(club.id)} size="sm" variant="ghost" icon="arrowUpRight">Public page</LinkButton>
          </div>
        }
      />

      {!club.admin_assigned ? (
        <Notice tone="warning" icon="alert">This club has no active owner. A Campus+ club administrator must assign one before students can join.</Notice>
      ) : null}
      {club.status !== 'published' ? <Notice tone="warning">This club is {club.status}; it is not visible in the published directory.</Notice> : null}

      <div className="grid items-start gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <ClubManageNavigation clubId={club.id} activeView={view} />
        <div className="flex min-w-0 flex-col gap-4">
          {view === 'overview' || view === 'analytics' ? (
            <>
              <section className="flex flex-col gap-3" aria-labelledby="club-metrics">
                <SectionHeader
                  title={view === 'analytics' ? 'Current club analytics' : 'Club dashboard'}
                  description="Current counts from accessible database rows. No engagement estimates, historical series, or invented trends."
                />
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-5" id="club-metrics">
                  <MetricCard label="Active members" metric={analytics.members} icon="users" href={ROUTES.clubManage(club.id, 'members')} />
                  <MetricCard label="Pending requests" metric={analytics.pendingRequests} icon="inbox" href={ROUTES.clubManage(club.id, 'members')} />
                  <MetricCard label="Published posts" metric={analytics.posts} icon="megaphone" href={ROUTES.clubManage(club.id, 'feed')} />
                  <MetricCard label="Published events" metric={analytics.events} icon="calendar" href={ROUTES.clubManage(club.id, 'events')} />
                  <MetricCard label="Opportunities" metric={analytics.opportunities} icon="briefcase" href={ROUTES.clubManage(club.id, 'opportunities')} />
                </div>
              </section>
              {view === 'overview' ? (
                <>
                  <Card className="flex flex-col gap-3 p-4">
                    <SectionHeader title="Working actions" description="Each link opens a real workflow." />
                    <div className="flex flex-wrap gap-2">
                      <LinkButton href={ROUTES.clubManage(club.id, 'feed')} size="sm" tone="accent" icon="megaphone">Post an update</LinkButton>
                      {can(actor, 'submit_events') ? <LinkButton href={ROUTES.eventNew(club.id)} size="sm" variant="secondary" icon="calendar">Submit event</LinkButton> : null}
                      {can(actor, 'submit_opportunities') ? <LinkButton href={ROUTES.opportunityNew(club.id)} size="sm" variant="secondary" icon="briefcase">Submit opportunity</LinkButton> : null}
                      <LinkButton href={ROUTES.clubManage(club.id, 'settings')} size="sm" variant="secondary" icon="settings">Edit club</LinkButton>
                    </div>
                  </Card>
                  <Card className="flex flex-col gap-3 p-4">
                    <SectionHeader title="Recent activity" action={<Link href={ROUTES.clubManage(club.id, 'activity')} className="text-2xs text-muted underline">View all</Link>} />
                    <ActivityList entries={activity.slice(0, 6)} />
                  </Card>
                </>
              ) : (
                <Notice tone="neutral" icon="info">Counts can be temporarily unavailable; an em dash is shown instead of guessing. Membership and publication changes appear after refreshing this server-rendered view.</Notice>
              )}
            </>
          ) : null}

          {view === 'feed' ? (
            <Card className="flex flex-col gap-4 p-4">
              <SectionHeader title="Posts & feed" description="The existing Campus+ composer, comments, reactions and moderation apply here." />
              {canPostHere ? <PostComposer communityId={club.id} /> : <Notice tone="neutral">Your account can manage this club but does not currently have permission to post in its feed.</Notice>}
              {posts.length ? posts.map((post) => (
                <article key={post.id} className="border-t border-line pt-3">
                  <Link href={ROUTES.post(post.id)} className="text-[0.875rem] font-medium underline-offset-2 hover:underline">{post.title || truncate(post.body, 120)}</Link>
                  <p className="mt-1 text-2xs text-muted">{post.author_display_name || 'Member'} · {formatDateTime(post.created_at)} · {post.comment_count || 0} comments</p>
                  {post.title && post.body ? <p className="user-text mt-2 text-[0.8125rem] leading-relaxed text-muted">{truncate(post.body, 220)}</p> : null}
                </article>
              )) : <EmptyState icon="megaphone" title="No club posts yet" description="Use the composer above to publish the first update if your account can post." />}
            </Card>
          ) : null}

          {view === 'members' ? (
            <>
              <Card className="flex flex-col gap-3 p-4">
                <SectionHeader title="Join requests" description={`${requests.length} pending request${requests.length === 1 ? '' : 's'}. Approval creates the active member in the same transaction.`} />
                <ClubJoinRequestsPanel clubId={club.id} requests={requests} />
              </Card>
              <Card className="flex flex-col gap-3 p-4">
                <SectionHeader title="Members & roles" description="Club roles apply only to this club. Owners cannot be demoted or removed through member controls." />
                <ClubMembersPanel clubId={club.id} members={members} isOwner={isOwner} canChangeRoles={isOwner || can(actor, 'manage_clubs')} currentUserId={user.profile.id} />
              </Card>
            </>
          ) : null}

          {view === 'activity' ? (
            <Card className="flex flex-col gap-3 p-4">
              <SectionHeader title="Club activity" description="Actual club-scoped audit entries, posts, memberships and linked content. Unrelated moderation logs and private messages are excluded." />
              {workspace.unavailable.audit ? <Notice tone="warning">The scoped audit trail could not be loaded; other actual activity is still shown.</Notice> : null}
              <ActivityList entries={activity.slice(0, 50)} />
            </Card>
          ) : null}

          {view === 'inbox' ? (
            <Card className="flex flex-col gap-3 p-4">
              <SectionHeader title="Club inbox" description="Your own notifications whose reference is this club. This is not a private-message inbox and other managers’ notifications are not visible." />
              {workspace.unavailable.inbox ? <Notice tone="warning">Club notifications could not be loaded. Refresh to try again.</Notice> : null}
              {!workspace.unavailable.inbox && !workspace.inbox.length ? <EmptyState icon="inbox" title="No club notifications" description="Notifications about this club that are sent to your account will appear here." /> : null}
              <ul className="flex flex-col divide-y divide-line">
                {workspace.inbox.map((notification) => (
                  <li key={notification.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[0.875rem] font-medium">{notification.title}</h3>
                      {!notification.read_at ? <Badge tone="accent">Unread</Badge> : null}
                    </div>
                    <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">{notification.body}</p>
                    <p className="mt-1 text-2xs text-muted">{formatDateTime(notification.created_at)}{notification.url?.startsWith('/') ? <> · <Link href={notification.url} className="underline">Open related page</Link></> : null}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {view === 'events' ? (
            <Card className="flex flex-col gap-3 p-4">
              <SectionHeader
                title="Club events"
                description="Published events and any drafts visible to your account through event RLS."
                action={can(actor, 'submit_events') ? <LinkButton href={ROUTES.eventNew(club.id)} size="sm" tone="accent" icon="plus">Submit event</LinkButton> : null}
              />
              {workspace.unavailable.events ? <Notice tone="warning">Events could not be loaded.</Notice> : null}
              {!workspace.unavailable.events && !workspace.events.length ? <EmptyState icon="calendar" title="No club events" description="Submit an event for review. Community submissions remain non-official drafts until staff publish them." /> : null}
              {workspace.events.map((event) => (
                <ContentCard key={event.id} href={ROUTES.event(event.id)} title={event.title} description={event.description} icon="calendar" official={event.is_official} badges={[{ label: event.status, tone: event.status === 'published' ? 'success' : 'warning' }, { label: formatDate(event.starts_on), tone: 'neutral' }]} meta={[event.location, event.organizer]} />
              ))}
            </Card>
          ) : null}

          {view === 'opportunities' ? (
            <Card className="flex flex-col gap-3 p-4">
              <SectionHeader
                title="Club opportunities"
                description="Real opportunities linked to this club; source and moderation status remain visible."
                action={can(actor, 'submit_opportunities') ? <LinkButton href={ROUTES.opportunityNew(club.id)} size="sm" tone="accent" icon="plus">Submit opportunity</LinkButton> : null}
              />
              {workspace.unavailable.opportunities ? <Notice tone="warning">Opportunities could not be loaded.</Notice> : null}
              {!workspace.unavailable.opportunities && !workspace.opportunities.length ? <EmptyState icon="briefcase" title="No linked opportunities" description="Submit an opportunity with this club selected. It keeps its community-submitted source state." /> : null}
              {workspace.opportunities.map((opportunity) => (
                <ContentCard key={opportunity.id} href={ROUTES.opportunity(opportunity.id)} title={opportunity.title} description={opportunity.description} icon="briefcase" official={opportunity.source === 'official'} badges={[{ label: opportunity.status, tone: opportunity.status === 'published' ? 'success' : 'warning' }]} meta={[opportunity.organization, opportunity.deadline ? `Deadline ${formatDate(opportunity.deadline)}` : null]} />
              ))}
            </Card>
          ) : null}

          {view === 'settings' ? (
            <>
              <Notice tone="neutral" icon="lock">The stable link, catalogue key and source verification are protected. Public profile fields use the scoped update_club_profile RPC.</Notice>
              <ClubSettingsForm club={club} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
