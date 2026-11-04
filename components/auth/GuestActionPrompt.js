import Link from 'next/link';
import { LinkButton, Notice } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { returnToHref } from '@/lib/auth/return-to';
import { ROUTES } from '@/lib/constants';

/**
 * The public-facing replacement for an authenticated action.
 *
 * Server-rendered: a guest never receives a form wired to a server action, so
 * there is nothing to submit and nothing to fail silently. The sign-in link
 * preserves both the destination and the intended action.
 */
export function GuestActionPrompt({
  title = 'Sign in to take part',
  description = 'Browsing clubs and events is open to everyone. Joining, RSVPs, messages and club administration need an institutional Campus+ account.',
  next,
  intent = null,
  actionLabel = 'Sign in to continue',
  linkLabel = null,
  linkHref = null,
}) {
  return (
    <div className="card flex flex-col gap-3 p-4" data-testid="guest-action-prompt">
      <div className="flex items-start gap-2.5">
        <Icon name="lock" size={16} className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-2xs leading-relaxed text-muted">{description}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <LinkButton href={returnToHref(next, intent)} size="sm" tone="accent" icon="arrowUpRight">
          {actionLabel}
        </LinkButton>
        {linkLabel && linkHref ? (
          <Link href={linkHref} className="text-2xs text-muted underline underline-offset-2 hover:text-ink">
            {linkLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** Small confirmation shown after the visitor returns from a successful login. */
export function IntentNotice({ intent, subject }) {
  const copy = {
    join: 'You are signed in. Complete your request to join below.',
    rsvp: 'You are signed in. Choose your RSVP below.',
    submit_event: 'You are signed in. You can submit an event now.',
    request_club: 'You are signed in. You can request a club now.',
  }[intent];
  if (!copy) return null;
  return (
    <Notice tone="accent" icon="checkCircle">
      {copy}{subject ? ` ${subject}` : ''}
    </Notice>
  );
}

/** Reusable "back to the public directory" link for standalone public pages. */
export function PublicBackLink({ href = ROUTES.clubs, label = 'Club directory' }) {
  return (
    <Link href={href} className="text-2xs text-muted underline underline-offset-2 hover:text-ink">
      ← {label}
    </Link>
  );
}
