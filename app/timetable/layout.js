import Link from 'next/link';
import { BrandLockup } from '@/components/brand/Brand';
import { TIMETABLE_SOURCE } from '@/lib/timetable/meta';
import { ROUTES } from '@/lib/constants';

/**
 * Public chrome for the timetable pages.
 *
 * These routes are deliberately OUTSIDE the authenticated app shell: a
 * first-year student with a shared link and no account must be able to open
 * their division's timetable in a fresh tab. The frame is the same public
 * pattern as /legal — Campus+ wordmark, a way back into the app (which
 * routes signed-out visitors to sign-in and signed-in students home), and
 * an honest source footer.
 */
export default function TimetableLayout({ children }) {
  return (
    <div className="mx-auto w-full max-w-[96rem] px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <BrandLockup href="/" size="lg" className="w-fit" />
        <Link
          href={ROUTES.home}
          className="inline-flex min-h-10 items-center rounded-[var(--radius-md)] border border-line px-3.5 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-line-strong hover:no-underline"
        >
          Open Campus+
        </Link>
      </div>

      {children}

      <footer className="mt-14 border-t border-line pt-6">
        <p className="max-w-[75ch] text-[0.8125rem] leading-relaxed text-muted">
          Source: {TIMETABLE_SOURCE.title} — {TIMETABLE_SOURCE.department}, Academic Year{' '}
          {TIMETABLE_SOURCE.academicYear}, {TIMETABLE_SOURCE.semester} ({TIMETABLE_SOURCE.fileTitle}). Subject
          codes, batch splits, faculty initials and room numbers are reproduced as printed; where the timetable
          changes, official department notices prevail over this page.
        </p>
        <p className="mt-2 max-w-[75ch] text-[0.8125rem] leading-relaxed text-muted">
          Campus+ is an independent student project, not an official PCCOE service.{' '}
          <Link href={ROUTES.legal} className="font-semibold text-ink underline underline-offset-2">
            Legal &amp; Institutional Independence
          </Link>
        </p>
        <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[0.8125rem]">
          <Link href={ROUTES.timetable} className="font-medium text-muted underline hover:text-ink">
            All divisions
          </Link>
          <Link href={ROUTES.rules} className="font-medium text-muted underline hover:text-ink">
            Community rules
          </Link>
        </p>
      </footer>
    </div>
  );
}
