import { NoticeGallery } from '@/components/campus/NoticeGallery';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getNotice, getNoticeArchiveEntry } from '@/lib/data/campus';
import { ROUTES, UUID_REGEX } from '@/lib/constants';
import { PageHeader, Badge, Notice, Card, LinkButton } from '@/components/ui';
import { NoticeArchiveRecord } from '@/components/campus/NoticeArchive';
import { ReportDialog } from '@/components/social/ReportDialog';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { formatDate, formatDateTime } from '@/lib/utils';

export async function generateMetadata({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return { title: 'Notice' };
  const supabase = await getServerClient();
  const notice = await getNotice(supabase, id);
  return { title: notice?.title || 'Notice' };
}

/**
 * One official notice (spec §27). Read-only for students; staff manage it elsewhere.
 *
 * An archived notice that is registered as an archive record is readable by
 * students too, and is presented as what it is: a historical record with its
 * attribution, never a current announcement. Any other unpublished notice
 * stays staff-only.
 */
export default async function NoticePage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const notice = await getNotice(supabase, id);
  if (!notice) notFound();

  const isStaff = can(actor, 'manage_notices') || can(actor, 'moderate_all');
  const archiveEntry = notice.status === 'archived' ? await getNoticeArchiveEntry(supabase, notice.id) : null;
  if (notice.status !== 'published' && !archiveEntry && !isStaff) notFound();

  // Archive records are text: a title, a written summary and its attribution.
  // The attachment gallery of a current notice is deliberately not rendered.
  if (archiveEntry) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title={notice.title}
          back={{ href: ROUTES.noticeArchive(archiveEntry.section_key), label: 'Archive' }}
          action={
            can(actor, 'manage_notices') ? (
              <LinkButton href={`/campus/noticeboard/${notice.id}/edit`} size="sm" variant="secondary">
                Edit record
              </LinkButton>
            ) : null
          }
        />
        <NoticeArchiveRecord notice={notice} entry={archiveEntry} />
        <div className="flex items-center justify-between">
          <Link href={ROUTES.noticeArchive()} className="text-2xs text-muted underline hover:text-ink">
            All archive records
          </Link>
          {can(actor, 'report_content') ? <ReportDialog targetType="post" targetRef={notice.id} label="this record" /> : null}
        </div>
      </div>
    );
  }

  const expired = notice.expires_at && new Date(notice.expires_at) <= new Date();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={notice.title} back={{ href: '/campus/noticeboard', label: 'Noticeboard' }} />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">Official</Badge>
        <Badge>{notice.category}</Badge>
        {notice.pinned ? <Badge>Pinned</Badge> : null}
        {notice.status !== 'published' ? <Badge tone="danger">{notice.status}</Badge> : null}
      </div>

      {expired ? (
        <Notice tone="warning" icon="clock">
          This notice expired on {formatDate(notice.expires_at)}. It stays online for reference.
        </Notice>
      ) : null}

      <Card className="flex flex-col gap-3 p-4">
        <p className="user-text whitespace-pre-wrap text-[0.9375rem] leading-relaxed"><LinkifiedText text={notice.body} /></p>
        <p className="text-2xs text-muted">
          Published {formatDateTime(notice.published_at || notice.created_at)}
          {notice.updated_by ? ' · edited by staff' : ''}
        </p>
      </Card>

      <NoticeGallery postId={id} />
      <div className="flex items-center justify-between">
        <Link href="/campus/noticeboard" className="text-2xs text-muted underline hover:text-ink">
          All notices
        </Link>
        {can(actor, 'report_content') ? <ReportDialog targetType="post" targetRef={notice.id} label="this notice" /> : null}
      </div>
    </div>
  );
}
