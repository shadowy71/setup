import { normalizeBranch } from '@/lib/branches';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getStudyPost, isStudyPostActive } from '@/lib/data/campus';
import { ROUTES, UUID_REGEX } from '@/lib/constants';
import { PageHeader, Badge, Card, Notice } from '@/components/ui';
import { IdentityLine } from '@/components/identity/IdentityLine';
import { MessageButton } from '@/components/social/MessageButton';
import { ReportDialog } from '@/components/social/ReportDialog';
import { StudyPostManage } from '@/components/study/StudyPostManage';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { availabilityLabel, modeLabel, purposeLabel } from '@/components/study/studyMeta';
import { formatDate } from '@/lib/utils';

export async function generateMetadata({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return { title: 'Study request' };
  const supabase = await getServerClient();
  const post = await getStudyPost(supabase, id);
  return { title: post?.title || 'Study request' };
}

/** Study request detail: creator identity, coarse availability, contact by DM. */
export default async function StudyPostPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const post = await getStudyPost(supabase, id);
  if (!post) notFound();

  const isOwner = post.creator_id === user.profile.id;
  const active = isStudyPostActive(post);
  // Closed, expired and moderated requests stay visible to their creator (so
  // they can manage them) but read as unavailable to everyone else.
  if (!active && !isOwner && post.status === 'published') {
    // Still render: the state badges below explain closed/expired honestly.
  }
  if (post.status !== 'published' && !isOwner) notFound();

  const { data: creator } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, is_staff')
    .eq('id', post.creator_id)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={post.title}
        description={[post.subject, purposeLabel(post.purpose)].filter(Boolean).join(' · ')}
        back={{ href: ROUTES.study, label: 'Study finder' }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={active ? 'success' : 'neutral'}>{active ? 'Open' : post.closed_at ? 'Closed' : post.expires_on ? 'Expired' : post.status}</Badge>
        <Badge tone="accent">{purposeLabel(post.purpose)}</Badge>
        <Badge>{modeLabel(post.mode)}</Badge>
        {(post.availability || []).map((slot) => (
          <Badge key={slot}>{availabilityLabel(slot)}</Badge>
        ))}
      </div>

      <Card className="p-4">
        <IdentityLine
          username={creator?.username}
          displayName={creator?.display_name}
          isStaff={creator?.is_staff === true}
          timestamp={post.created_at}
        />
        <p className="user-text mt-3 whitespace-pre-wrap text-[0.9375rem] leading-relaxed"><LinkifiedText text={post.description} mentions /></p>
        <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
          <div className="flex gap-1"><dt>Subject</dt><dd className="text-ink">{post.subject}</dd></div>
          {post.branch ? <div className="flex gap-1"><dt>Branch</dt><dd>{normalizeBranch(post.branch)}</dd></div> : null}
          {post.year ? <div className="flex gap-1"><dt>Year</dt><dd>{post.year}</dd></div> : null}
          {post.academic_context ? <div className="flex gap-1"><dt>Context</dt><dd>{post.academic_context}</dd></div> : null}
          {post.expires_on ? <div className="flex gap-1"><dt>Open till</dt><dd>{formatDate(post.expires_on)}</dd></div> : null}
        </dl>
      </Card>

      {!active ? (
        <Notice tone="warning" icon="clock">
          {post.closed_at ? 'The creator closed this request — it is no longer looking for partners.' : 'This request has expired.'}
          {isOwner ? ' Reopen it from here if plans change.' : ' Browse the board for open requests instead.'}
        </Notice>
      ) : null}

      <Card className="flex flex-wrap items-center gap-2 p-4">
        {isOwner ? (
          <>
            <span className="w-full text-2xs text-muted">This is your request.</span>
            <StudyPostManage postId={post.id} closed={Boolean(post.closed_at)} />
          </>
        ) : (
          <>
            {can(actor, 'send_messages') ? <MessageButton profileId={post.creator_id} label={`Message @${creator?.username || 'creator'}`} variant="primary" size="sm" /> : null}
            {can(actor, 'report_content') ? <ReportDialog targetType="user" targetRef={post.creator_id} label={creator ? `@${creator.username}` : 'this student'} /> : null}
          </>
        )}
      </Card>

      <Notice tone="info" icon="lock">
        Keep first meetings public and on campus, and never share personal contact details, exact
        schedules or live locations on Campus+.
      </Notice>
    </div>
  );
}
