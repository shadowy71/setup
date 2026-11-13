import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { listNoticeArchive } from '@/lib/data/campus';
import { ROUTES } from '@/lib/constants';
import { PageHeader } from '@/components/ui';
import { NoticeArchiveList } from '@/components/campus/NoticeArchive';

export const metadata = { title: 'Noticeboard archive' };

const SECTION_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Noticeboard archive: a record of past noticeboard activity, kept apart from
 * the noticeboard itself. Every row is a notice with `status = 'archived'` that
 * is registered as an archive record (migration 072); current notices are
 * `published` and are never read by this page.
 */
export default async function NoticeArchivePage({ searchParams }) {
  await requireUser();
  const params = await searchParams;
  const section = typeof params?.section === 'string' && SECTION_KEY.test(params.section) ? params.section : null;

  // Read per request through the student's own session: the archive policy
  // decides what is visible, and nothing here is shared between readers.
  const supabase = await getServerClient();
  const { sections, total, unavailable } = await listNoticeArchive(supabase);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Noticeboard"
        title="Archive"
        description={
          total
            ? `${total} records of past activities and displays from campus noticeboards, grouped by the board they came from.`
            : 'Records of past activities and displays from campus noticeboards.'
        }
        back={{ href: ROUTES.noticeboard, label: 'Noticeboard' }}
      />
      <NoticeArchiveList sections={sections} activeSection={section} unavailable={unavailable} />
    </div>
  );
}
