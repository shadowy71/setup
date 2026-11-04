'use client';

/**
 * The public frame's sign-in entry point.
 *
 * It carries the current public page as the validated `next` destination, so a
 * guest who signs in from a club profile or an event page lands back on that
 * exact page. `safeNextPath` is the same pure validator used by the OAuth
 * callback — no open redirect is possible. Action-specific prompts pass their
 * own `next` (with an `intent` query) from the server instead.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { safeNextPath } from '@/lib/auth/oauth';

export function SignInLink({ next = null, label = 'Sign in', className = '' }) {
  const pathname = usePathname();
  const safe = safeNextPath(next || pathname || '/');
  const href = safe ? `/login?next=${encodeURIComponent(safe)}` : '/login';
  return (
    <Link href={href} className={className || 'btn btn-secondary btn-sm'}>
      {label}
    </Link>
  );
}
