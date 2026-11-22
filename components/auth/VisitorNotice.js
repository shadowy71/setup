'use client';

/**
 * The Visitor sign-in notice.
 *
 * Shown once, immediately after a successful *external* Google sign-in, and
 * only then. Everything it claims is derived from the authenticated session:
 *
 *   * it renders only when the server wrote the one-shot indicator cookie in
 *     `app/auth/callback/route.js` (see `lib/auth/visitor-notice.js`), and the
 *     cookie is consumed on read, so navigation and refresh never re-show it;
 *   * the email address comes from the session, not from the URL;
 *   * it cannot appear for an institutional account: the callback only writes
 *     the indicator for a visitor, and this component additionally refuses to
 *     render unless the account really is external.
 *
 * There is deliberately no Student/Visitor choice, no role selector and no
 * "request access" button. The account classification is decided by the address
 * the person signed in with; the only way to student access is to sign in with
 * an eligible institutional account. Presenting a button here would suggest
 * otherwise.
 */

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/overlays';
import { Button } from '@/components/ui/buttons';
import { Icon } from '@/components/ui/icons';
import { consumeVisitorNoticeCookie } from '@/lib/auth/visitor-notice';

const ABILITIES = [
  { icon: 'search', label: 'Explore publicly available Campus+ content' },
  { icon: 'calendar', label: 'View public campus events and clubs' },
  { icon: 'users', label: 'Browse public communities and profiles' },
  { icon: 'settings', label: 'Manage your own basic profile' },
];

/**
 * @param {{ email?: string|null, accountType?: string|null }} props
 */
export function VisitorNotice({ email = null, accountType = null }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Read-and-clear, once per successful external sign-in. `accountType` is a
    // belt-and-braces check: if the session is institutional (a stale cookie, a
    // classification change between the callback and this render) the notice
    // must not appear at all.
    if (accountType !== 'visitor') return;
    let shown = false;
    try {
      shown = consumeVisitorNoticeCookie();
    } catch {
      shown = false;
    }
    // Synchronize with the browser-only signal read above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (shown) setOpen(true);
  }, [accountType]);

  if (accountType !== 'visitor') return null;

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      size="md"
      closeLabel="Dismiss the visitor notice"
      title="Welcome to Campus+!"
      description="You're signing in with a non-institutional email address."
      footer={
        <Button type="button" onClick={() => setOpen(false)} autoFocus>
          Got it, continue
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
          <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-muted">Signed in as</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="break-anywhere text-sm font-medium text-ink">{email || 'External account'}</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-2xs font-semibold text-ink">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
              Visitor
            </span>
          </div>
        </div>

        <div>
          <p className="text-sm text-ink">
            Your account has automatically been assigned <strong className="font-semibold">Visitor</strong> access.
          </p>
          <p className="mt-1 text-sm text-muted">As a visitor, you can:</p>
          <ul className="mt-2 space-y-1.5">
            {ABILITIES.map((ability) => (
              <li key={ability.label} className="flex items-start gap-2 text-sm text-ink">
                <Icon name={ability.icon} size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
                <span>{ability.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-sm text-ink">
            Publishing posts, comments, listings and other content is disabled by default.
          </p>
          <p className="text-sm text-muted">
            Additional permissions may be granted by a Campus+ administrator.
          </p>
          <p className="text-2xs text-muted">
            Student access requires signing in with an eligible institutional Google account.
          </p>
        </div>
      </div>
    </Modal>
  );
}
