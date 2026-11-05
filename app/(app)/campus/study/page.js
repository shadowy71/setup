import { normalizeBranch } from '@/lib/branches';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { isStudyPostActive, listMyStudyPosts, listStudyPosts } from '@/lib/data/campus';
import { ROUTES, STUDY_AVAILABILITY, STUDY_MODES, STUDY_PURPOSES } from '@/lib/constants';
import { PageHeader, EmptyState, Notice, LinkButton, Card, Badge } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';
import { MessageButton } from '@/components/social/MessageButton';
import { ReportDialog } from '@/components/social/ReportDialog';
import { StudyPostManage } from '@/components/study/StudyPostManage';
import { availabilityLabel, modeLabel, purposeLabel } from '@/components/study/studyMeta';
import { formatDate } from '@/lib/utils';

export const metadata = { title: 'Study partner finder' };

const pick = (value, options) => (options.some((option) => option.value === value) ? value : null);

function FilterForm({ current }) {
  return (
    <form method="get" action="/campus/study" className="card flex flex-col gap-3 p-3" aria-label="Filter study requests">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Search
          <input name="q" defaultValue={current.q} maxLength={80} placeholder="Subject, title, keyword…" className="control control-input" />
        </label>
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Purpose
          <select name="purpose" defaultValue={current.purpose} className="control control-select">
            <option value="">All purposes</option>
            {STUDY_PURPOSES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Mode
          <select name="mode" defaultValue={current.mode} className="control control-select">
            <option value="">On-campus, online, either</option>
            {STUDY_MODES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Availability
          <select name="availability" defaultValue={current.availability} className="control control-select">
            <option value="">Any time</option>
            {STUDY_AVAILABILITY.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-2xs font-semibold text-muted">
          Subject
          <input name="subject" defaultValue={current.subject} maxLength={120} placeholder="e.g. DBMS" className="control control-input" />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-secondary btn-sm">Apply filters</button>
          <LinkButton href="/campus/study" size="sm" variant="ghost">Clear</LinkButton>
        </div>
      </div>
    </form>
  );
}

/**
 * Study Partner Finder: opt-in subject/exam/collaboration requests.
 * Team finder stays project-focused; this board is subject-focused, with
 * coarse availability and no personal calendars anywhere.
 */
export default async function StudyPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const params = await searchParams;

  const filters = {
    q: typeof params?.q === 'string' ? params.q.slice(0, 80) : '',
    subject: typeof params?.subject === 'string' ? params.subject.slice(0, 120) : '',
    purpose: pick(params?.purpose, STUDY_PURPOSES),
    mode: pick(params?.mode, STUDY_MODES),
    availability: pick(params?.availability, STUDY_AVAILABILITY),
  };
  const hasFilters = Boolean(filters.q.trim() || filters.subject.trim() || filters.purpose || filters.mode || filters.availability);

  const [{ items, unavailable }, mine] = await Promise.all([
    listStudyPosts(supabase, {
      limit: 30,
      q: filters.q.trim() || null,
      subject: filters.subject.trim() || null,
      purpose: filters.purpose,
      mode: filters.mode,
      availability: filters.availability,
    }),
    listMyStudyPosts(supabase, user.profile.id),
  ]);

  const creators = await (async () => {
    const ids = [...new Set(items.map((item) => item.creator_id))];
    if (!ids.length) return new Map();
    const { data } = await supabase.from('public_profiles').select('id, username, display_name, is_staff').in('id', ids);
    return new Map((data || []).map((person) => [person.id, person]));
  })();

  const canCreate = can(actor, 'create_study_posts');
  const canMessage = can(actor, 'send_messages');
  const canReport = can(actor, 'report_content');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Study partner finder"
        description="Find peers for a subject, an exam, or academic work. Posting is opt-in — nothing about you is listed until you publish."
        back={{ href: ROUTES.campus, label: 'Campus' }}
        action={canCreate ? <LinkButton href={ROUTES.studyNew} size="sm" icon="plus">Post a request</LinkButton> : null}
      />

      <FilterForm current={filters} />

      {unavailable ? <Notice tone="warning" icon="flag">Study requests could not be loaded right now.</Notice> : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="book"
          title={hasFilters ? 'No requests match those filters' : 'No study requests'}
          description={hasFilters
            ? 'Try fewer filters, or post the request you wish existed.'
            : 'Post what you want to study and when you are roughly free — interested students message you.'}
          action={canCreate ? <LinkButton href={ROUTES.studyNew} variant="primary" size="sm">Post a request</LinkButton> : null}
        />
      ) : null}

      <section aria-label="Study requests" className="flex flex-col gap-3">
        {items.map((post) => {
          const creator = creators.get(post.creator_id);
          const isOwner = post.creator_id === user.profile.id;
          return (
            <ContentCard
              key={post.id}
              title={post.title}
              description={post.description}
              icon="book"
              timestamp={post.created_at}
              badges={[
                { label: purposeLabel(post.purpose), tone: 'accent' },
                { label: modeLabel(post.mode) },
                ...(post.expires_on ? [{ label: `Open till ${formatDate(post.expires_on)}`, tone: 'warning' }] : []),
              ]}
              meta={[
                post.subject,
                [normalizeBranch(post.branch), post.year].filter(Boolean).join(' · ') || null,
                (post.availability || []).map(availabilityLabel).join(', ') || null,
                creator ? `@${creator.username}` : null,
              ]}
              footer={
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <LinkButton href={ROUTES.studyPost(post.id)} size="sm" variant="ghost">Details</LinkButton>
                  {!isOwner && canMessage ? <MessageButton profileId={post.creator_id} label="Message" variant="secondary" size="sm" /> : null}
                  {!isOwner && canReport ? <ReportDialog targetType="user" targetRef={post.creator_id} label={creator ? `@${creator.username}` : 'this student'} /> : null}
                  {isOwner ? <StudyPostManage postId={post.id} closed={Boolean(post.closed_at)} /> : null}
                </span>
              }
            />
          );
        })}
      </section>

      {mine.items.length ? (
        <section aria-label="My study requests" className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">My requests</h2>
          <Card className="divide-y divide-line">
            {mine.items.map((post) => (
              <div key={post.id} className="flex flex-wrap items-center gap-2 p-3">
                <LinkButton href={ROUTES.studyPost(post.id)} size="sm" variant="ghost">{post.title}</LinkButton>
                <Badge tone={isStudyPostActive(post) ? 'success' : 'neutral'}>
                  {isStudyPostActive(post) ? 'Active' : post.closed_at ? 'Closed' : 'Expired'}
                </Badge>
                <span className="ml-auto"><StudyPostManage postId={post.id} closed={Boolean(post.closed_at)} /></span>
              </div>
            ))}
          </Card>
        </section>
      ) : null}
    </div>
  );
}
