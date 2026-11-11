'use client';

/**
 * The one notification list.
 *
 * Rows carry a deep link, the notification's own text and an unread marker.
 * Marking read and dismissing are server actions; the list is purely the
 * presentation layer and never decides visibility itself.
 *
 * Hierarchy comes from type and tone, not from decoration: what kind of thing
 * happened, how urgent it is, and when.
 */

import { useTransition } from 'react';
import Link from 'next/link';
import { cn, relativeTime } from '@/lib/utils';
import { Badge, Button, EmptyState, IdentityMark, Notice } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { markNotificationRead, clearNotification, markAllNotificationsRead } from '@/lib/actions/notifications';

const LABEL_BY_TYPE = {
  dm_new: 'Direct message',
  mention: 'Mention',
  comment: 'Comment',
  reply: 'Reply',
  reaction: 'Reaction',
  marketplace_message: 'Marketplace message',
  marketplace_status: 'Marketplace update',
  marketplace_rating: 'Rating',
  event_update: 'Event update',
  event_reminder: 'Event reminder',
  community_activity: 'Community',
  club_activity: 'Club',
  moderation_notice: 'Moderation notice',
  report_result: 'Report result',
  system: 'Campus+',
};

const ICON_BY_TYPE = {
  dm_new: 'chat',
  mention: 'at',
  comment: 'comment',
  reply: 'comment',
  reaction: 'heart',
  marketplace_message: 'tag',
  marketplace_status: 'tag',
  marketplace_rating: 'star',
  event_update: 'calendar',
  event_reminder: 'calendar',
  community_activity: 'users',
  club_activity: 'users',
  moderation_notice: 'shield',
  report_result: 'flag',
  system: 'megaphone',
};

/** Only the types that carry real urgency get a coloured marker. */
const TONE_BY_TYPE = {
  moderation_notice: 'danger',
  report_result: 'accent',
  system: 'info',
};

export function NotificationList({ items = [], emptyTitle = 'No notifications yet' }) {
  const [pending, startTransition] = useTransition();

  if (!items.length) {
    return (
      <EmptyState
        icon="bell"
        title={emptyTitle}
        description="Replies, mentions, messages and official updates appear here. Campus+ sends nothing by email or push."
      />
    );
  }

  const open = (item) => {
    if (!item.read_at) {
      const data = new FormData();
      data.set('id', item.id);
      startTransition(() => {
        markNotificationRead(data);
      });
    }
  };

  const dismiss = (item) => {
    const data = new FormData();
    data.set('id', item.id);
    startTransition(() => {
      clearNotification(data);
    });
  };

  const markAll = () => {
    startTransition(() => {
      markAllNotificationsRead();
    });
  };

  const unread = items.filter((item) => !item.read_at).length;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-2xs font-semibold text-muted">
          <span className="t-numeric">{unread}</span> unread of <span className="t-numeric">{items.length}</span>
        </p>
        <Button variant="ghost" size="sm" icon="check" onClick={markAll} disabled={pending || unread === 0}>
          Mark all read
        </Button>
      </div>

      <ul className="card divide-y divide-line overflow-hidden" aria-busy={pending || undefined}>
        {items.map((item) => {
          const tone = TONE_BY_TYPE[item.type];
          const body = (
            <span className="flex min-w-0 items-start gap-3 p-3.5">
              {item.actor?.username ? <IdentityMark name={item.actor.display_name || item.actor.username} username={item.actor.username} size={32} /> : <span
                className={cn(
                  'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border',
                  item.read_at ? 'border-line bg-surface-2 text-muted' : 'border-accent/30 bg-accent-soft text-accent-ink',
                )}
              >
                <Icon name={ICON_BY_TYPE[item.type] || 'bell'} size={15} />
              </span>}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cn('truncate text-[0.875rem]', item.read_at ? 'font-normal text-ink-soft' : 'font-semibold text-ink')}>
                    {item.title}
                  </span>
                  {!item.read_at ? <span className="unread-dot" aria-label="Unread" /> : null}
                </span>
                {item.body ? <span className="mt-0.5 block text-[0.8125rem] leading-relaxed text-muted">{item.body}</span> : null}
                <span className="mt-1.5 flex items-center gap-2 text-2xs text-muted-soft">
                  {tone ? (
                    <Badge tone={tone}>{LABEL_BY_TYPE[item.type] || 'Campus+'}</Badge>
                  ) : (
                    <span className="font-semibold">{LABEL_BY_TYPE[item.type] || 'Campus+'}</span>
                  )}
                  <time dateTime={item.created_at}>{relativeTime(item.created_at)}</time>
                </span>
              </span>
            </span>
          );

          return (
            <li key={item.id} className="flex items-stretch">
              {item.url ? (
                <Link href={item.url} onClick={() => open(item)} className="min-w-0 flex-1 transition-colors hover:bg-surface-2 hover:no-underline">
                  {body}
                </Link>
              ) : (
                <button type="button" onClick={() => open(item)} className="min-w-0 flex-1 text-left transition-colors hover:bg-surface-2">
                  {body}
                </button>
              )}
              <button
                type="button"
                onClick={() => dismiss(item)}
                aria-label="Dismiss notification"
                className="px-3 text-muted-soft transition-colors hover:text-ink"
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function NotificationError({ message }) {
  return (
    <Notice tone="warning" icon="flag">
      {message || 'Notifications could not be loaded. Refresh to try again.'}
    </Notice>
  );
}
