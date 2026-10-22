import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/lib/constants';
import { BrandLockup, CollegeCrest } from '@/components/brand/Brand';

/**
 * The public frame.
 *
 * Sign-in, onboarding, the rules, the configuration screen and account status
 * all share it: one centred column, the Campus+ identity at the top, one clear
 * heading and copy that stays readable on a 320px phone.
 *
 * It renders no data and has no state, so it is safe on the server.
 */
export function PublicShell({ eyebrow = null, title = null, description = null, width = 'md', children, footer = null }) {
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };

  return (
    <div className="relative mx-auto flex min-h-dvh w-full flex-col justify-center px-5 py-10 sm:py-14">
      <BrandLockup href="/" size="lg" className="mb-8 w-fit" />

      <div className={cn('w-full', widths[width] || widths.md)}>
        {eyebrow ? <p className="t-label">{eyebrow}</p> : null}
        {title ? <h1 className="t-display mt-2 break-anywhere">{title}</h1> : null}
        {description ? <p className="t-secondary mt-2.5 max-w-xl">{description}</p> : null}
        <div className="mt-6">{children}</div>
        {footer ? <div className="mt-8">{footer}</div> : null}
        <div className="mt-7 flex items-start gap-3">
          <CollegeCrest size={44} />
          <p className="text-2xs leading-relaxed text-muted-soft">
            Campus+ is an unofficial student project for PCCOE, not affiliated with or endorsed by the college.{' '}
            <Link href={ROUTES.legal} className="font-semibold text-muted underline underline-offset-2 hover:text-ink">
              Legal &amp; Institutional Independence
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
