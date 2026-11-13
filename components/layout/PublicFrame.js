import Link from 'next/link';
import { CollegeCrest } from '@/components/brand/Brand';
import { PLATFORM, ROUTES } from '@/lib/constants';

/** Public discovery content and its institutional disclaimer; the shared
 * optional application frame supplies navigation and account controls. */
export function PublicFrame({ children }) {
  return (
    <div className="mx-auto flex w-full max-w-[80rem] flex-col py-6 sm:py-8">
      <div className="flex-1">{children}</div>

      <footer className="public-footer flex flex-col gap-3 pt-5">
        <div className="flex items-start gap-3">
          <CollegeCrest size={40} />
          <p className="max-w-[75ch] text-2xs leading-relaxed text-muted">
            Campus+ is an unofficial student project for {PLATFORM.collegeName}, not affiliated
            with or endorsed by the college. Club and event pages are public; joining, RSVPs, messages and
            administration require an institutional Campus+ account.
          </p>
        </div>
        <p className="flex flex-wrap gap-x-5 gap-y-2 text-2xs">
          <Link href={ROUTES.clubs} className="font-medium text-muted underline underline-offset-2 hover:text-ink">Club directory</Link>
          <Link href="/campus/events" className="font-medium text-muted underline underline-offset-2 hover:text-ink">Events</Link>
          <Link href={ROUTES.legal} className="font-medium text-muted underline underline-offset-2 hover:text-ink">Legal &amp; Institutional Independence</Link>
          <Link href={ROUTES.rules} className="font-medium text-muted underline underline-offset-2 hover:text-ink">Community rules</Link>
        </p>
      </footer>
    </div>
  );
}
