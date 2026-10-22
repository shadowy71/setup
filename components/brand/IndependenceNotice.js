import Link from 'next/link';
import { CollegeCrest } from '@/components/brand/Brand';
import { ROUTES } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * The sign-in independence disclosure.
 *
 * Campus+ is an independent student project, and the sign-in screen says so
 * in reading-size text, next to the controls — never in a tooltip, a collapsed
 * menu or footnote-sized print. The college crest (when configured in
 * `Brand.js`) appears once, small and secondary, purely to identify the
 * institution the disclaimer refers to; it is never combined with the Campus+
 * wordmark and never presented as evidence of affiliation or permission.
 *
 * This component is the single place that placement lives, so removing or
 * replacing the crest later (see `/legal`) is a one-line change here — or
 * clearing `CREST_SRC` in `Brand.js` — with no sign-in redesign. The full
 * notice is at `/legal`, linked below with its full name.
 */
export function IndependenceNotice({ className = '' }) {
  return (
    <div className={cn('glass-cinematic flex items-start gap-3 rounded-[var(--radius-lg)] p-3.5', className)}>
      <CollegeCrest size={44} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[0.8125rem] leading-relaxed text-ink">
          Independent student project — not affiliated with, operated by, or endorsed by PCCOE or PCET.
        </p>
        <Link
          href={ROUTES.legal}
          className="mt-1 inline-block text-[0.8125rem] font-semibold text-ink underline underline-offset-2 hover:text-accent"
        >
          Legal &amp; Institutional Independence
        </Link>
      </div>
    </div>
  );
}
