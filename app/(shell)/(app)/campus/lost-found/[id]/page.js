import { LostFoundGallery } from '@/components/campus/LostFoundGallery';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getLostFound } from '@/lib/data/campus';
import { PageHeader, Notice, Badge, Card } from '@/components/ui';
import { OwnBoardActions } from '@/components/campus/OwnBoardActions';
import { PostActionsRow } from '@/components/campus/PostActionsRow';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { formatDate, formatTime } from '@/lib/utils';
import { ROUTES } from '@/lib/constants';

export const metadata = { title: 'Item report' };

/**
 * One lost & found report (spec §31). The kind leads everything — banner,
 * title, status — so a "Lost" report can never be read as a "Found" one at
 * any zoom level. Same data, same actions as the list.
 */
export default async function LostFoundDetailPage({ params }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const { id } = await params;

  const item = await getLostFound(supabase, id);
  if (!item || (item.status !== 'published' && item.creator_id !== user.profile.id && !can(actor, 'moderate_all'))) notFound();

  const isLost = item.kind === 'lost';
  const isOwner = item.creator_id === user.profile.id;
  const { data: creator } = await supabase
    .from('public_profiles')
    .select('id, username, display_name')
    .eq('id', item.creator_id)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={item.title}
        back={{ href: ROUTES.lostFound, label: 'Lost & found' }}
        action={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={isLost ? 'warning' : 'accent'}>{isLost ? 'Lost item' : 'Found item'}</Badge>
            {item.resolved_at ? <Badge tone="success">Resolved</Badge> : null}
            {item.status !== 'published' ? <Badge tone="danger">{item.status}</Badge> : null}
          </span>
        }
      />

      {/* The kind banner: unmistakable at the top of every report. */}
      <div className={`lf-banner ${isLost ? 'lf-banner--lost' : 'lf-banner--found'}`}>
        <p className="lf-banner__kicker">{isLost ? 'Someone lost this' : 'Someone found this'}</p>
        <p className="lf-banner__line">
          {isLost
            ? 'If you have seen it, message the owner. If it is with you, hand it over and mark this resolved.'
            : 'If it is yours, claim it — but prove it first: answer a question only the owner would know.'}
        </p>
      </div>

      <Card className="flex flex-col gap-3 p-5">
        <p className="user-text whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-ink"><LinkifiedText text={item.description} /></p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.8125rem]">
          <dt className="text-muted">Where</dt>
          <dd className="text-ink">{item.location || 'Not given'}</dd>
          <dt className="text-muted">{isLost ? 'When lost' : 'When found'}</dt>
          <dd className="text-ink">{item.occurred_on ? formatDate(item.occurred_on) : 'Not given'}</dd>
          <dt className="text-muted">Posted</dt>
          <dd className="text-ink">
            {formatDate(item.created_at)}
            {item.created_at ? ` · ${formatTime(item.created_at)}` : ''}
          </dd>
          <dt className="text-muted">Posted by</dt>
          <dd className="text-ink">{creator ? `@${creator.username}` : 'Unknown'}</dd>
        </dl>
        <span className="flex flex-wrap items-center gap-2">
          <PostActionsRow
            creatorId={item.creator_id}
            creatorUsername={creator?.username}
            isOwner={isOwner}
            canReport={can(actor, 'report_content')}
            canMessage={can(actor, 'send_messages')}
            reportType="lost_found"
            reportRef={item.id}
            canResolve={!item.resolved_at}
          />
        </span>
      </Card>

      <LostFoundGallery reportId={id} />
      {isOwner ? <OwnBoardActions type="lostfound" id={item.id} editHref={`/campus/lost-found/${item.id}/edit`} /> : null}

      {item.resolved_at ? (
        <Notice tone="success" icon="check">
          This report is resolved{item.resolved_at ? ` · ${formatDate(item.resolved_at)}` : ''}. It stays
          visible for reference and appears under the Resolved filter.
        </Notice>
      ) : (
        <Notice tone="neutral" icon="shield">
          Claiming an item? Ask a question only the owner could answer rather than describing it first.
        </Notice>
      )}
    </div>
  );
}
