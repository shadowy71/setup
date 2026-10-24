'use client';

import { useUnreadMessages } from '@/components/layout/MessagingProvider';
import { formatUnread } from '@/lib/notifications/format';

/** The existing navigation badge treatments, fed by the shared message count. */
export function MessageUnreadBadge({ variant = 'nav' }) {
  const unread = formatUnread(useUnreadMessages(), 'Messages');
  if (!unread.visible) return null;

  return (
    <span className={variant === 'icon' ? 'notification-badge' : 'nav-count'} aria-label={unread.aria}>
      {unread.text}
    </span>
  );
}
