import { Badge, Card, EmptyState } from '@/components/ui';
import { ClubMonogram } from '@/components/clubs/ClubMonogram';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { ContentCard } from '@/components/content/ContentCard';
import { ROUTES } from '@/lib/constants';
import { formatDate, relativeTime, truncate } from '@/lib/utils';

/** Public/member presentation only. No management controls or private rows. */
export function ClubMemberPreview({ club, posts = [], events = [], members = [] }) {
  return (
    <div className="flex flex-col gap-4" data-testid="club-member-preview">
      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <ClubMonogram name={club.name} id={club.id} size={64} />
          <div className="min-w-0">
            <div className="flex flex-wrap gap-1.5">
              {club.verification_status === 'source_checked' ? <Badge tone="accent">Source checked</Badge> : <Badge>Details pending</Badge>}
              {!club.admin_assigned ? <Badge tone="warning">Admin assignment needed</Badge> : null}
              {club.admin_assigned && club.recruitment_info ? <Badge tone="info">Recruiting</Badge> : null}
            </div>
            <p className="mt-2 text-2xs text-muted">{club.member_count} member{club.member_count === 1 ? '' : 's'} · {club.club_category || 'Club'}</p>
          </div>
        </div>
        <p className="user-text text-[0.9375rem] leading-relaxed"><LinkifiedText text={club.description} mentions /></p>
        {club.recruitment_info ? <p className="user-text text-[0.8125rem] leading-relaxed text-muted"><strong className="text-ink">Recruitment:</strong> {club.recruitment_info}</p> : null}
        <p className="text-2xs text-muted">
          {club.admin_assigned ? (club.join_policy === 'open' ? 'Students can join immediately.' : 'Students request to join and a club manager reviews the request.') : 'Membership is closed until an initial administrator is assigned.'}
        </p>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">Announcements</h2>
        {posts.length ? posts.slice(0, 5).map((post) => (
          <div key={post.id} className="border-b border-line pb-3 text-[0.8125rem] last:border-0 last:pb-0">
            <a href={ROUTES.post(post.id)} className="font-medium underline">{post.title || truncate(post.body, 90)}</a>
            <p className="mt-1 text-2xs text-muted">{post.author_display_name || 'Member'} · {relativeTime(post.created_at)}</p>
          </div>
        )) : <EmptyState icon="megaphone" title="No announcements yet" description="Published club posts will appear here." />}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">Upcoming events</h2>
        {events.length ? events.slice(0, 4).map((event) => (
          <ContentCard key={event.id} href={ROUTES.event(event.id)} title={event.title} description={event.description} icon="calendar" official={event.is_official} badges={[{ label: formatDate(event.starts_on), tone: 'accent' }]} meta={[event.location]} />
        )) : <EmptyState icon="calendar" title="No upcoming events" description="Published events linked to this club will appear here." />}
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Members</h2>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-muted">
          {members.length ? `${members.length} active member record${members.length === 1 ? '' : 's'} are visible in this preview.` : 'No active member records are visible yet.'}
        </p>
      </Card>
    </div>
  );
}
