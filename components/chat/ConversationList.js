'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, EmptyState } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { ROUTES } from '@/lib/constants';
import { formatUnread } from '@/lib/notifications/format';
import {
  conversationTitle,
  messagePreview,
  sortConversations,
  upsertConversationMessage,
  upsertConversationSummary,
} from '@/lib/messaging/state';
import { cn, relativeTime, truncate } from '@/lib/utils';
import { useMessagingActions, useMessagingStatus } from '@/components/layout/MessagingProvider';

function inboxPatch(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    community_id: row.community_id,
    status: row.status,
    last_message_at: row.last_message_at,
    created_at: row.created_at,
    is_muted: row.is_muted === true,
    unread: row.unread || 0,
    lastMessage: row.last_message_created_at
      ? {
          id: row.last_message_id,
          conversation_id: row.id,
          sender_id: row.last_message_sender_id,
          body: row.last_message_body,
          gif: row.last_message_gif,
          created_at: row.last_message_created_at,
        }
      : null,
  };
}

/** The existing inbox presentation with targeted live state updates. */
export function ConversationList({ initialConversations = [], currentUserId }) {
  const [conversations, setConversations] = useState(initialConversations);
  const conversationsRef = useRef(initialConversations);
  const pendingSummaries = useRef(new Set());
  const actions = useMessagingActions();
  const status = useMessagingStatus();

  const update = useCallback((updater) => {
    setConversations((current) => {
      const next = updater(current);
      conversationsRef.current = next;
      return next;
    });
  }, []);

  const loadSummary = useCallback(async (conversationId) => {
    if (pendingSummaries.current.has(conversationId)) return;
    pendingSummaries.current.add(conversationId);
    try {
      const payload = await actions.sync({ conversationId, summary: true });
      if (!payload?.conversation) return;
      const unread = payload.unread?.find((row) => row.conversation_id === conversationId)?.unread_count || 0;
      update((current) => upsertConversationSummary(current, { ...payload.conversation, unread }));
    } catch {
      // The next event/reconnect retries only this missing summary. Existing
      // rows stay usable and no full inbox refresh is triggered per message.
    } finally {
      pendingSummaries.current.delete(conversationId);
    }
  }, [actions, update]);

  useEffect(() => {
    const unregister = actions.registerInbox();
    const unsubscribe = actions.subscribe((event) => {
      if (event.type === 'message') {
        const exists = conversationsRef.current.some((item) => item.id === event.message.conversation_id);
        update((current) => upsertConversationMessage(current, event.message, {
          eventType: event.eventType,
          unreadCount: event.unreadCount,
        }).conversations);
        if (!exists) void loadSummary(event.message.conversation_id);
        return;
      }

      if (event.type === 'read') {
        update((current) => current.map((conversation) => (
          conversation.id === event.conversationId ? { ...conversation, unread: 0 } : conversation
        )));
        return;
      }

      if (event.type !== 'sync') return;
      const counts = new Map((event.unread || []).map((row) => [row.conversation_id, row.unread_count || 0]));

      if (!event.inbox) {
        update((current) => current.map((conversation) => ({
          ...conversation,
          unread: counts.get(conversation.id) || 0,
        })));
        return;
      }

      // Reconnecting on the inbox reconciles lightweight RPC previews. Only a
      // conversation not already on screen needs its member/profile summary.
      const rows = new Map(event.inbox.map((row) => [row.id, row]));
      update((current) => sortConversations(
        current
          .filter((conversation) => rows.has(conversation.id))
          .map((conversation) => ({ ...conversation, ...inboxPatch(rows.get(conversation.id)) })),
      ));
      for (const id of rows.keys()) {
        if (!conversationsRef.current.some((item) => item.id === id)) void loadSummary(id);
      }
    });

    // Navigation can follow reads on another device. This is one lightweight
    // snapshot per inbox mount, not a poll and not a query per message.
    void actions.sync({ inbox: true }).catch(() => null);
    return () => {
      unsubscribe();
      unregister();
    };
  }, [actions, loadSummary, update]);

  if (!conversations.length) {
    return (
      <>
        {status === 'reconnecting' ? <p className="text-2xs text-muted" role="status">Reconnecting for live updates…</p> : null}
        <EmptyState
          icon="chat"
          title="No conversations yet"
          description="Start one from any profile, or message a seller from the marketplace. Everyone uses the same inbox."
        />
      </>
    );
  }

  return (
    <>
      {status === 'reconnecting' ? <p className="text-2xs text-muted" role="status">Reconnecting for live updates…</p> : null}
      <ul className="card divide-y divide-line">
        {conversations.map((conversation) => {
          const title = conversationTitle(conversation, conversation.other, conversation.members);
          const last = conversation.lastMessage;
          const mine = last && last.sender_id === currentUserId;
          const unread = formatUnread(conversation.unread, 'Messages');
          return (
            <li key={conversation.id}>
              <Link
                href={ROUTES.conversation(conversation.id)}
                className={cn('flex items-start gap-3 p-3 hover:bg-canvas hover:no-underline', unread.visible && 'bg-canvas/40')}
              >
                <span className="mt-0.5 shrink-0 text-muted">
                  <Icon name={conversation.kind === 'direct' ? 'chat' : 'users'} size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[0.875rem] font-medium">{title}</span>
                    {conversation.kind !== 'direct' ? <Badge>Community chat</Badge> : null}
                    {conversation.is_muted ? <Badge>Muted</Badge> : null}
                    {unread.visible ? <Badge tone="accent" title={unread.aria}>{unread.text}</Badge> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[0.8125rem] text-muted">
                    {last ? `${mine ? 'You: ' : ''}${truncate(messagePreview(last), 90)}` : 'No messages yet'}
                  </span>
                  <span className="mt-0.5 block text-2xs text-muted">
                    {last ? relativeTime(last.created_at) : relativeTime(conversation.created_at)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
