import Link from 'next/link';
import { BrandLockup, CollegeCrest } from '@/components/brand/Brand';
import { SignInLink } from '@/components/auth/SignInLink';
import { getCurrentUser } from '@/lib/auth/session';
import { PLATFORM, ROUTES } from '@/lib/constants';
import { LinkButton } from '@/components/ui';

/**
 * The lightweight public frame.
 *
 * Deliberately NOT the authenticated `AppShell`: it renders no private student
 * navigation, no unread badges, no Create menu and no membership data. The
 * single optional session read is used ONLY to swap the sign-in button for a
 * "back to Campus+ home" link for a signed-in student — it never changes what
 * public content is served, and nothing here is cached.
 *
 * Pages inside `app/(public)/` inherit this layout; protected pages stay inside
 * `app/(app)/` with `AppShell`. Both share the same tokens, brand and UI
 * primitives, so the Campus+ identity is unchanged.
 */
export async function PublicFrame({ children }) {
  const user = await getCurrentUser();
  const signedIn = Boolean(user?.profile);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[80rem] flex-col px-4 py-6 sm:px-6 sm:py-8">
      <header className="public-header flex flex-wrap items-center justify-between gap-3 pb-4">
        <BrandLockup href={ROUTES.clubs} size="lg" className="w-fit" />
        <nav aria-label="Public discovery" className="flex flex-wrap items-center gap-2">
          <Link href={ROUTES.clubs} className="chip">Clubs</Link>
          <Link href="/campus/events" className="chip">Events</Link>
          {signedIn ? (
            <LinkButton href={ROUTES.home} size="sm" variant="secondary" icon="arrowUpRight">
              Campus+ home
            </LinkButton>
          ) : (
            <SignInLink />
          )}
        </nav>
      </header>

      <main className="flex-1 py-6 sm:py-8">{children}</main>

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
