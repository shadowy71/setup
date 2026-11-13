import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import {
  listReports,
  listMarketplaceQueue,
  listRandomReports,
  listModerationHistory,
  getReportCounts,
  getReport,
  moderatorTargetUrl,
} from '@/lib/data/moderation';
import { ROUTES, UUID_REGEX, PAGE_SIZE } from '@/lib/constants';
import { Badge, Button, Card, EmptyState, LinkButton, Notice, PageHeader } from '@/components/ui';
import { ModerationActions, PostPinControl, ResolveReportForm, MarketplaceReviewActions, RandomReportActions } from '@/components/moderation/ModerationPanels';
import { formatDateTime, relativeTime } from '@/lib/utils';
import { LinkifiedText } from '@/components/content/LinkifiedText';

export const metadata = { title: 'Moderation' };

const TABS = [
  { key: 'reports', label: 'Report queue' },
  { key: 'marketplace', label: 'Marketplace' },
  { key: 'random', label: 'Random reports' },
  { key: 'content', label: 'Content' },
  { key: 'audit', label: 'Audit history' },
];

/**
 * Moderator surface (spec §51, §52).
 *
 * Human moderation only: a queue, context, an action, an audit entry. There is
 * no automated or AI moderation anywhere in Campus+. Every capability on this
 * page is gated by a permission the database also checks.
 */
export default async function ModeratorPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);

  const canReview = can(actor, 'review_reports') || can(actor, 'moderate_all');
  const canMarketplace = can(actor, 'moderate_marketplace') || can(actor, 'moderate_all');
  const canRandom = can(actor, 'moderate_random') || can(actor, 'moderate_all');
  const canLogs = can(actor, 'view_moderation_logs') || can(actor, 'moderate_all');

  if (!canReview && !canMarketplace && !canRandom && !canLogs) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Moderation" />
        <Notice tone="warning" icon="lock">
          Moderation tools are not available for your account.
        </Notice>
      </div>
    );
  }

  const params = await searchParams;
  const targetType = typeof params?.target === 'string' ? params.target : null;
  const targetId = typeof params?.id === 'string' && UUID_REGEX.test(params.id) ? params.id : null;
  const activeTab = TABS.some((item) => item.key === params?.tab)
    ? params.tab
    : targetType
      ? 'content'
      : 'reports';

  const counts = canReview || canRandom ? await getReportCounts(supabase) : { pending: 0, reviewing: 0, resolved: 0, random: 0 };

  const [reports, marketplace, randomReports, history, focused, focusedPostResult] = await Promise.all([
    activeTab === 'reports' && canReview ? listReports(supabase, { status: ['pending', 'reviewing'], limit: PAGE_SIZE.admin }) : Promise.resolve({ items: [], unavailable: false }),
    activeTab === 'marketplace' && canMarketplace ? listMarketplaceQueue(supabase) : Promise.resolve({ pending: [], flagged: [] }),
    activeTab === 'random' && canRandom ? listRandomReports(supabase) : Promise.resolve([]),
    activeTab === 'audit' && canLogs ? listModerationHistory(supabase, { limit: 40 }) : Promise.resolve([]),
    activeTab === 'content' && targetType && targetId && canReview ? getReport(supabase, targetId) : Promise.resolve(null),
    activeTab === 'content' && targetType === 'post' && targetId
      ? supabase.from('posts').select('id, pinned, status').eq('id', targetId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const focusedPost = focusedPostResult?.data || null;

  return (
    <div className="page-grid">
      <PageHeader
        title="Moderation"
        description="Reports, marketplace review, Random reports and the audit trail."
      />

      <Card className="flex flex-wrap gap-1.5 p-3">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`${ROUTES.moderator}?tab=${tab.key}`}
            className="chip"
            data-active={activeTab === tab.key}
          >
            {tab.label}
          </Link>
        ))}
        <span className="ml-auto text-2xs text-muted">
          {counts.pending} pending · {counts.reviewing} in review · {counts.random} Random
        </span>
      </Card>

      {activeTab === 'reports' ? (
        <section aria-label="Report queue" className="flex flex-col gap-3">
          {reports.items.length === 0 ? (
            <EmptyState icon="flag" title="The queue is clear" description="No reports are waiting for review." />
          ) : null}
          {reports.items.map((report) => (
            <Card key={report.id} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={report.status === 'pending' ? 'warning' : 'accent'}>{report.status}</Badge>
                <Badge>{report.target_type.replace(/_/g, ' ')}</Badge>
                <Badge>{report.reason}</Badge>
                <span className="text-2xs text-muted">Reported {relativeTime(report.created_at)}</span>
              </div>

              <div className="min-w-0">
                <p className="text-[0.875rem] font-medium">
                  {report.summary || (report.random_session_id ? 'Random session' : `Target ${report.target_id}`)}
                </p>
                {report.details ? <p className="user-text mt-1 text-[0.8125rem] text-muted"><LinkifiedText text={report.details} /></p> : null}
                <p className="mt-1 text-2xs text-muted">
                  Reporter @{report.reporter_username || 'unknown'}
                  {report.moderator_url ? (
                    <>
                      {' · '}
                      <Link href={report.moderator_url} className="underline">
                        Open the content
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>

              {report.target_type === 'random_session' ? (
                <RandomReportActions reportId={report.id} />
              ) : (
                <>
                  <ModerationActions
                    targetType={report.target_type}
                    targetRef={report.target_id}
                    reportId={report.id}
                    allowed={['hide', 'remove', 'restore']}
                  />
                  <ResolveReportForm reportId={report.id} />
                </>
              )}
            </Card>
          ))}
        </section>
      ) : null}

      {activeTab === 'marketplace' ? (
        <section aria-label="Marketplace review" className="flex flex-col gap-3">
          {!marketplace.pending.length && !marketplace.flagged.length ? (
            <EmptyState icon="tag" title="Nothing to review" description="No pending or flagged listings." />
          ) : null}

          {marketplace.pending.length ? <h2 className="text-sm font-semibold">Waiting for approval</h2> : null}
          {marketplace.pending.map((listing) => (
            <Card key={listing.id} className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warning">pending</Badge>
                <span className="text-[0.875rem] font-medium">{listing.title}</span>
                <span className="text-2xs text-muted">
                  @{listing.seller_username || 'unknown'} · {listing.is_free ? 'Free' : `₹${listing.price ?? '—'}`}
                </span>
              </div>
              <p className="user-text text-[0.8125rem] text-muted"><LinkifiedText text={listing.description} /></p>
              <div className="flex flex-wrap items-center gap-3">
                <MarketplaceReviewActions listingId={listing.id} currentStatus={listing.status} />
                <Link href={ROUTES.listing(listing.id)} className="text-2xs underline hover:text-ink">
                  Open listing
                </Link>
              </div>
            </Card>
          ))}

          {marketplace.flagged.length ? <h2 className="text-sm font-semibold">Hidden, removed or rejected</h2> : null}
          {marketplace.flagged.map((listing) => (
            <Card key={listing.id} className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="danger">{listing.status}</Badge>
                <span className="text-[0.875rem] font-medium">{listing.title}</span>
                <span className="text-2xs text-muted">@{listing.seller_username || 'unknown'}</span>
              </div>
              {listing.moderation_reason ? <p className="user-text text-2xs text-muted">Reason: <LinkifiedText text={listing.moderation_reason} /></p> : null}
              <MarketplaceReviewActions listingId={listing.id} currentStatus={listing.status} />
            </Card>
          ))}
        </section>
      ) : null}

      {activeTab === 'random' ? (
        <section aria-label="Random reports" className="flex flex-col gap-3">
          <Notice tone="neutral" icon="shield">
            Reporting a Random session keeps the participants&apos; identities hidden from you unless you hold the
            &quot;view Random session identities&quot; permission — and every such access is audited.
          </Notice>
          {randomReports.length === 0 ? (
            <EmptyState icon="sparkle" title="No Random reports" description="Reported sessions appear here." />
          ) : null}
          {randomReports.map((report) => (
            <Card key={report.id} className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warning">{report.status}</Badge>
                <Badge>{report.reason}</Badge>
                <span className="text-2xs text-muted">Reported {relativeTime(report.created_at)}</span>
              </div>
              {report.details ? <p className="user-text text-[0.8125rem] text-muted"><LinkifiedText text={report.details} /></p> : null}
              <p className="text-2xs text-muted">Session {report.session_id}</p>
              <RandomReportActions reportId={report.id} />
            </Card>
          ))}
        </section>
      ) : null}

      {activeTab === 'content' ? (
        <section aria-label="Content moderation" className="flex flex-col gap-3">
          {focused && targetType && targetId ? (
            <Card className="flex flex-col gap-3 p-4">
              <h2 className="text-sm font-semibold">Focused report</h2>
              <p className="text-[0.8125rem]">
                {focused.summary || focused.target_id} · {focused.reason} · {focused.status}
              </p>
              {focused.details ? <p className="user-text text-2xs text-muted"><LinkifiedText text={focused.details} /></p> : null}
              <ModerationActions
                targetType={focused.target_type}
                targetRef={focused.target_id}
                reportId={focused.id}
                allowed={['hide', 'remove', 'restore']}
              />
              <ResolveReportForm reportId={focused.id} />
            </Card>
          ) : targetType && targetId ? (
            <Card className="flex flex-col gap-3 p-4">
              <h2 className="text-sm font-semibold">Moderate {targetType.replace(/_/g, ' ')}</h2>
              <p className="text-2xs text-muted">Target {targetId}</p>
              <ModerationActions targetType={targetType} targetRef={targetId} allowed={['hide', 'remove', 'restore']} />
              {focusedPost?.status === 'published' ? (
                <PostPinControl
                  key={`${focusedPost.id}:${focusedPost.pinned}`}
                  targetRef={focusedPost.id}
                  currentPinned={focusedPost.pinned}
                />
              ) : null}
              {moderatorTargetUrl(targetType, targetId) ? (
                <Link href={moderatorTargetUrl(targetType, targetId)} className="text-2xs underline hover:text-ink">
                  Open in the app
                </Link>
              ) : null}
            </Card>
          ) : (
            <EmptyState
              icon="shield"
              title="Nothing selected"
              description="Open a report from the queue, or arrive here from a post or listing's Moderate link."
            />
          )}

          <Card className="flex flex-col gap-2 p-4">
            <h2 className="text-sm font-semibold">Jump to a target</h2>
            <form method="get" action={ROUTES.moderator} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="tab" value="content" />
              <label className="flex flex-col gap-1.5">
                <span className="field-label">Type</span>
                <select name="target" className="control control-input h-9">
                  {['post', 'comment', 'marketplace_listing', 'gig', 'community', 'club', 'project', 'lost_found', 'housing_post', 'ride_post'].map((value) => (
                    <option key={value} value={value}>
                      {value.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1.5">
                <span className="field-label">Id</span>
                <input
                  name="id"
                  required
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className="control control-input h-9"
                />
              </label>
              <Button type="submit" size="sm" variant="secondary">
                Open
              </Button>
            </form>
          </Card>
        </section>
      ) : null}

      {activeTab === 'audit' ? (
        <section aria-label="Moderation history" className="flex flex-col gap-3">
          {history.length === 0 ? (
            <EmptyState icon="archive" title="No moderation actions yet" description="Every staff action appears here with its author and outcome." />
          ) : null}
          <ul className="card divide-y divide-line">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 p-3">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge>{entry.action.replace(/_/g, ' ')}</Badge>
                  <span className="text-[0.8125rem]">
                    {entry.target_type ? `${entry.target_type.replace(/_/g, ' ')} · ${entry.target_id}` : 'platform'}
                  </span>
                </span>
                <span className="text-2xs text-muted">
                  @{entry.moderator_username || 'staff'} · {formatDateTime(entry.created_at)}
                  {entry.previous_status || entry.new_status ? ` · ${entry.previous_status || '—'} → ${entry.new_status || '—'}` : ''}
                </span>
                {entry.note ? <span className="text-2xs text-muted">{entry.note}</span> : null}
              </li>
            ))}
          </ul>
          {can(actor, 'view_audit_logs') ? (
            <LinkButton href={`${ROUTES.admin}?tab=audit`} size="sm" variant="secondary">
              Full audit log
            </LinkButton>
          ) : null}
        </section>
      ) : null}

      <p className="pb-2 text-center text-2xs text-muted">
        Signed in as @{user.profile.username} · human moderation only, every action audited.
      </p>
    </div>
  );
}
