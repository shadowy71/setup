import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import {
  getCommunityBySlug,
  getCommunityMembership,
  listCommunityMembers,
  listJoinRequests,
  getCommunityChatConversation,
  listOpportunities,
} from '@/lib/data/campus';
import { getCommunityJoinRequest } from '@/lib/data/clubs';
import { getCommunityPosts } from '@/lib/data/feed';
import { listPublishedEvents } from '@/lib/data/public-cache';
import {
  getPublicClubBySlug,
  listPublicClubAnnouncements,
  isPubliclyListedClub,
} from '@/lib/data/public';
import { ROUTES, CLUB_SLUG_REGEX } from '@/lib/constants';
import { publicMetadata, noindexMetadata } from '@/lib/seo';
import { readIntent } from '@/lib/auth/return-to';
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
import { GuestActionPrompt, IntentNotice } from '@/components/auth/GuestActionPrompt';
import { ShareButton } from '@/components/social/ShareButton';
import { formatDate, relativeTime, truncate } from '@/lib/utils';

/**
 * Metadata is generated from the ANONYMOUS projection only.
 *
 * That is deliberate: a signed-in manager who can view a draft or a private
 * club must not cause its name/description to appear in a page title, OG card
 * or structured preview for a URL anyone can open. Non-public slugs get a
 * noindex title and no canonical URL.
 */
export async function generateMetadata({ params }) {
  const { slug } = await params;
  if (!CLUB_SLUG_REGEX.test(slug)) return noindexMetadata('Club not found');
  const { item } = await getPublicClubBySlug(slug);
  if (!isPubliclyListedClub(item)) return noindexMetadata('Club');
  return publicMetadata({
    title: item.name,
    description: item.description || `${item.name} — club profile on Campus+.`,
    canonical: ROUTES.club(slug),
    type: 'profile',
  });
}

/**
 * The canonical club profile at `/c/<slug>` (spec §28, public discovery).
 *
 * ONE page for everyone. The base record is the anonymous public projection
 * from `getPublicClubBySlug` — `anon` RLS + the column allow-list in migration
 * 041 decides whether an unsigned visitor may see it at all. A signed-in
 * student additionally reads the full `communities` row through their own
 * session, where the EXISTING RLS policy (`can_view_community`) decides what
 * they may see; that keeps membership-aware club workspaces, drafts for their
 * managers and private clubs for their members working exactly as before.
 *
 * Everything viewer-specific — members, chat, join requests, opportunities,
 * full feed posts, moderation controls — is fetched only when a real Campus+
 * profile exists and is rendered only in that branch. Guests get the public
 * profile, explicitly public announcements, published events and a sign-in
 * prompt that returns to this page with the original intent.
 */
export default async function ClubPage({ params, searchParams }) {
  const { slug } = await params;
  // Exact slug only: no lowercasing, no UUID lookup, no fuzzy match.
  if (!CLUB_SLUG_REGEX.test(slug)) notFound();
  const intent = readIntent(await searchParams);

  const publicResult = await getPublicClubBySlug(slug);
  const user = await getCurrentUser();
  const viewer = user?.profile ? user : null;

  // A read failure is not a 404. Show an honest unavailable state for a guest
  // instead; a signed-in visitor can still fall back to their own RLS-scoped read.
  if (publicResult.unavailable && !viewer) {
    return (
      <div className="flex flex-col gap-3">
        <PageHeader title="Club temporarily unavailable" back={{ href: ROUTES.clubs, label: 'Clubs' }} />
        <Notice tone="warning" icon="flag">This club could not be read right now. Please try again in a moment.</Notice>
      </div>
    );
  }

  const publicClub = publicResult.item;
  let club = publicClub;
  let supabase = null;
  if (viewer) {
    supabase = await getServerClient();
    if (supabase) {
      const fullRecord = await getCommunityBySlug(supabase, slug);
      if (fullRecord && fullRecord.kind === 'club') club = fullRecord;
    }
  }
  if (!club || club.kind !== 'club') notFound();

  const publiclyListed = isPubliclyListedClub(publicClub);
  const canonicalPath = ROUTES.club(slug);
  const actor = viewer ? toActor(viewer) : null;
  const isStaff = viewer
    ? can(actor, 'manage_clubs') || can(actor, 'moderate_communities') || can(actor, 'moderate_all')
    : false;
  if (club.status !== 'published' && !isStaff && club.created_by !== viewer?.profile.id) notFound();

  let membership = null;
  let joinRequest = null;
  let members = [];
  let opportunities = { items: [] };
  let chat = null;
  let posts = [];
  let requests = [];
  let isMember = false;
  let isOwner = false;
  let canManage = false;
  let canPostHere = false;

  if (viewer && supabase) {
    [membership, joinRequest, members, opportunities, chat, posts] = await Promise.all([
      getCommunityMembership(supabase, club.id, viewer.profile.id),
      getCommunityJoinRequest(supabase, club.id, viewer.profile.id),
      listCommunityMembers(supabase, club.id, { limit: 60 }),
      listOpportunities(supabase, { limit: 5, clubId: club.id }),
      getCommunityChatConversation(supabase, club.id),
      getCommunityPosts(supabase, club.id, { limit: 6, currentProfileId: viewer.profile.id }),
    ]);
    isMember = membership?.status === 'active';
    isOwner = isMember && membership?.role === 'owner';
    canManage = isStaff || isOwner || (isMember && membership?.role === 'moderator');
    requests = canManage ? await listJoinRequests(supabase, club.id) : [];
    canPostHere = (isMember || isStaff) && can(actor, 'create_posts');
  } else {
    // Only posts whose OWN visibility is public, through the anon projection.
    posts = (await listPublicClubAnnouncements(club.id, { limit: 6 })).items;
  }

  // Shared, viewer-independent published-event cache. No RSVP/attendee state.
  const events = await listPublishedEvents({ limit: 5, clubId: club.id, upcoming: true });
  const owner = members.find((member) => member.role === 'owner') || null;

  const activity = viewer
    ? [
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
      ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 5)
    : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Guests have no feed channel: the public frame deliberately carries no
          realtime provider. Only a signed-in viewer's page needs reconciling. */}
      {viewer ? <LiveFeedSync /> : null}

      {intent && viewer ? <IntentNotice intent={intent} /> : null}

      <PageHeader
        title={club.name}
        eyebrow={club.club_category ? `${club.club_category} club` : 'Club'}
        description={`${club.member_count ?? 0} member${club.member_count === 1 ? '' : 's'} · page added ${formatDate(club.created_at)}`}
        back={{ href: ROUTES.clubs, label: 'Clubs' }}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ShareButton path={canonicalPath} label="Share club" title={club.name} />
            {viewer ? (
              <>
                {canManage ? (
                  <LinkButton href={ROUTES.clubManage(club.id)} size="sm" variant="secondary" icon="sliders">
                    Manage club
                  </LinkButton>
                ) : null}
                {!isOwner ? <ReportDialog targetType="club" targetRef={club.id} label={club.name} /> : null}
              </>
            ) : null}
          </div>
        }
      />

      {!publiclyListed && viewer ? (
        <Notice tone="info" icon="lock">
          This club is not listed on the open web. It is visible only to the Campus+ students its
          existing privacy settings allow.
        </Notice>
      ) : null}

      <Card className="club-hero flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start gap-3.5">
          <ClubMonogram name={club.name} id={club.id} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {club.verification_status === 'source_checked' ? <Badge tone="accent" icon="check">Source checked</Badge> : <Badge>Details pending</Badge>}
              {club.is_official ? <Badge tone="accent">Campus+ reviewed</Badge> : null}
              {!club.admin_assigned ? <Badge tone="warning">Admin assignment needed</Badge> : null}
              {club.admin_assigned && club.recruitment_info ? <Badge tone="info" icon="megaphone">Recruiting</Badge> : null}
              {club.admin_assigned && club.join_policy !== 'open' ? <Badge>Approval needed</Badge> : null}
              {isMember ? <Badge tone="success" icon="check">Member</Badge> : null}
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
              <ExternalLink url={club.external_url} className="underline">{club.external_url}</ExternalLink>
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
          <span className="mt-1 block">Source checked means the organization is listed by the cited source; it does not verify every detail on this page. Contact details here are the club&apos;s own public contact fields, not a student&apos;s personal contact.</span>
        </div>

        {club.recruitment_info ? (
          <p className="user-text rounded-[var(--radius-md)] border border-line bg-surface-2 p-3 text-2xs leading-relaxed">
            <span className="font-semibold">Recruitment: </span>
            <LinkifiedText text={club.recruitment_info} />
          </p>
        ) : null}

        {viewer && club.status !== 'published' ? (
          <Notice tone="warning" icon="flag">This club is {club.status}. Only managers and moderators can see it.</Notice>
        ) : null}

        {viewer ? (
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
        ) : (
          <GuestActionPrompt
            title="Join, message and follow this club"
            description="This profile is public. Joining, requesting membership, messaging members and posting announcements require an institutional Campus+ account."
            next={canonicalPath}
            intent="join"
            actionLabel="Sign in to join"
          />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4">
            <SectionHeader
              title="Announcements"
              description={viewer ? "Updates from the club's own feed." : 'Announcements the club has marked public.'}
              icon="megaphone"
              action={viewer ? (
                <Link href={ROUTES.community(club.slug)} className="text-2xs text-muted underline hover:text-ink">Open club feed</Link>
              ) : null}
            />
            {viewer && canPostHere ? <PostComposer communityId={club.id} compact /> : null}
            {posts.length ? (
              <ul className="flex flex-col divide-y divide-line">
                {posts.map((post) => (
                  <li key={post.id} className="py-2.5 first:pt-0 last:pb-0">
                    {viewer ? (
                      <Link href={ROUTES.post(post.id)} className="text-[0.875rem] font-medium hover:underline">
                        {post.title || truncate(post.body, 92)}
                      </Link>
                    ) : (
                      <p className="text-[0.875rem] font-medium">{post.title || truncate(post.body, 92)}</p>
                    )}
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-muted">
                      {viewer ? <span>{post.author_display_name || 'Member'}</span> : <span>Club announcement</span>}
                      <span>·</span>
                      <time dateTime={post.created_at}>{relativeTime(post.created_at)}</time>
                      {post.is_official ? <Badge tone="accent">Official</Badge> : null}
                      {post.kind === 'poll' ? <Badge>Poll</Badge> : null}
                    </p>
                    {post.title && post.body ? (
                      <p className="user-text mt-1 text-[0.8125rem] leading-relaxed text-muted">{truncate(post.body, 160)}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon="megaphone"
                title={viewer ? 'No announcements yet' : 'No public announcements'}
                description={viewer ? (canPostHere ? 'Post the first update — it appears here and in the club feed.' : 'Updates from the club will appear here.') : 'This club has not published a public announcement.'}
              />
            )}
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <SectionHeader title="Upcoming events" icon="calendar" action={
              <Link href="/campus/events" className="text-2xs text-muted underline hover:text-ink">All events</Link>
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

          {viewer ? (
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
          ) : null}
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4">
            <h2 className="text-sm font-semibold">Club facts</h2>
            <dl className="flex flex-col gap-2 text-2xs">
              <div className="flex items-start justify-between gap-3"><dt className="text-muted">Category</dt><dd className="text-right font-medium">{club.club_category || 'Uncategorised'}</dd></div>
              <div className="flex items-start justify-between gap-3"><dt className="text-muted">Organization type</dt><dd className="text-right font-medium">{club.organization_type || 'Not recorded'}</dd></div>
              <div className="flex items-start justify-between gap-3"><dt className="text-muted">Members</dt><dd className="text-right font-medium">{club.member_count ?? 0}</dd></div>
              <div className="flex items-start justify-between gap-3"><dt className="text-muted">Verification</dt><dd className="text-right font-medium">{club.verification_status === 'source_checked' ? 'Source checked' : 'Details pending'}</dd></div>
              <div className="flex items-start justify-between gap-3"><dt className="text-muted">Campus+ review</dt><dd className="text-right font-medium">{club.is_official ? 'Reviewed' : 'Not yet reviewed'}</dd></div>
              <div className="flex items-start justify-between gap-3"><dt className="text-muted">Joining</dt><dd className="text-right font-medium">{club.admin_assigned ? (club.join_policy === 'open' ? 'Open' : 'Approval needed') : 'Administrator pending'}</dd></div>
            </dl>
          </Card>

          {viewer ? (
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
          ) : null}

          {viewer ? (
            <Card className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Members</h2>
                <span className="text-2xs text-muted">{club.member_count}</span>
              </div>
              {canManage ? (
                <ClubMembersPanel clubId={club.id} members={members} isOwner={isOwner} currentUserId={viewer.profile.id} />
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
              {owner && owner.user_id !== viewer.profile.id ? (
                <MessageButton profileId={owner.user_id} label="Message the club lead" variant="secondary" />
              ) : null}
              {members.length > 10 && !canManage ? (
                <p className="text-2xs text-muted">{club.member_count - 10} more members</p>
              ) : null}
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
