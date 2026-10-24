'use client';

/**
 * Shell-scoped live messaging state.
 *
 * One private user channel fans canonical rows out to the open thread, inbox,
 * and navigation badge. Only small contexts are consumed by each surface, so a
 * busy conversation never rerenders the rest of the application shell.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyIncomingUnread,
  applyReadReceipt,
  createMessageDeduper,
  normalizeUnreadRows,
  unreadRows,
  unreadTotal,
} from '@/lib/messaging/state';
import { authenticateRealtime, subscribeToUserMessaging } from '@/lib/messaging/realtime';

const UnreadMessagesContext = createContext(0);
const MessagingStatusContext = createContext('unconfigured');
const MessagingActionsContext = createContext(null);
const FALLBACK_INTERVAL_MS = 15_000;
const FOCUS_REFRESH_MS = 30_000;
const EVENT_BATCH_MS = 32;
const SEEN_LIMIT = 1_000;

const noopActions = {
  subscribe: () => () => {},
  registerActiveConversation: () => () => {},
  registerInbox: () => () => {},
  clearConversationUnread: () => {},
  noteCanonicalMessages: () => {},
  publishOptimisticMessage: () => {},
  confirmMessage: () => {},
  reconcile: async () => null,
  sync: async () => null,
};

export function useUnreadMessages() {
  return useContext(UnreadMessagesContext);
}

export function useMessagingStatus() {
  return useContext(MessagingStatusContext);
}

export function useMessagingActions() {
  return useContext(MessagingActionsContext) || noopActions;
}

export function MessagingProvider({ userId, initialUnread = [], children }) {
  const [initialState] = useState(() => normalizeUnreadRows(initialUnread));
  const unreadRef = useRef(initialState);
  const totalRef = useRef(unreadTotal(initialState));
  const [total, setTotal] = useState(() => unreadTotal(initialState));
  const [status, setStatus] = useState(userId ? 'connecting' : 'signed-out');
  const statusRef = useRef(status);
  const listenersRef = useRef(new Set());
  const activeRef = useRef(null);
  const inboxRef = useRef(null);
  const queueRef = useRef([]);
  const flushTimerRef = useRef(null);
  const seenRef = useRef(createMessageDeduper(SEEN_LIMIT));
  const versionsRef = useRef(new Map());
  const requestsRef = useRef(new Map());
  const lastReconcileRef = useRef(0);
  const sessionVersionRef = useRef(0);

  const emit = useCallback((event) => {
    for (const listener of listenersRef.current) listener(event);
  }, []);

  const setUnreadState = useCallback((next) => {
    unreadRef.current = next;
    const nextTotal = unreadTotal(next);
    if (nextTotal !== totalRef.current) {
      totalRef.current = nextTotal;
      setTotal(nextTotal);
    }
  }, []);

  const touch = useCallback((conversationId) => {
    if (!conversationId) return;
    versionsRef.current.set(conversationId, (versionsRef.current.get(conversationId) || 0) + 1);
  }, []);

  const remember = useCallback((id) => {
    seenRef.current.remember(id);
  }, []);

  const subscribe = useCallback((listener) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  /** Merge a snapshot without overwriting a conversation touched in flight. */
  const applySnapshot = useCallback((rows, versionsAtStart) => {
    const canonical = normalizeUnreadRows(rows);
    const current = unreadRef.current;
    const next = {};
    const ids = new Set([...Object.keys(current), ...Object.keys(canonical)]);

    for (const id of ids) {
      const changedInFlight = (versionsAtStart.get(id) || 0) !== (versionsRef.current.get(id) || 0);
      if (changedInFlight && current[id]) next[id] = current[id];
      else if (canonical[id]) next[id] = canonical[id];
    }

    setUnreadState(next);
    return unreadRows(next);
  }, [setUnreadState]);

  /**
   * Private, no-store reconciliation. Identical in-flight requests are shared;
   * no response is cached beyond the provider's per-session in-memory state.
   */
  const sync = useCallback(async ({ conversationId, after, afterId, summary = false, inbox = false } = {}) => {
    if (!userId) return null;
    const params = new URLSearchParams();
    if (conversationId) params.set('conversation_id', conversationId);
    if (after) params.set('after', after);
    if (afterId) params.set('after_id', afterId);
    if (summary) params.set('summary', '1');
    if (inbox) params.set('inbox', '1');
    const url = `/api/messages/sync${params.size ? `?${params}` : ''}`;
    const existing = requestsRef.current.get(url);
    if (existing) return existing;

    const versionsAtStart = new Map(versionsRef.current);
    const sessionAtStart = sessionVersionRef.current;
    const task = (async () => {
      const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (sessionVersionRef.current !== sessionAtStart) return null;
      if (response.status === 401 || response.status === 403) {
        setUnreadState({});
        emit({ type: 'sync', unread: [], inbox: null, summary: null });
        return null;
      }
      if (!response.ok) throw new Error('Message sync is temporarily unavailable.');
      const payload = await response.json();
      if (sessionVersionRef.current !== sessionAtStart) return null;
      if (!payload?.ok) throw new Error('Message sync is temporarily unavailable.');

      const effectiveUnread = applySnapshot(payload.unread, versionsAtStart);
      emit({
        type: 'sync',
        unread: effectiveUnread,
        inbox: payload.inbox || null,
        summary: payload.conversation || null,
      });
      return { ...payload, unread: effectiveUnread };
    })();

    requestsRef.current.set(url, task);
    try {
      return await task;
    } finally {
      if (requestsRef.current.get(url) === task) requestsRef.current.delete(url);
    }
  }, [applySnapshot, emit, setUnreadState, userId]);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    const queued = queueRef.current.splice(0);
    if (!queued.length) return;

    let nextUnread = unreadRef.current;
    let unreadChanged = false;
    const events = [];

    for (const event of queued) {
      const message = event.message;
      if (!message?.id || !message.conversation_id) continue;

      if (event.eventType === 'INSERT') {
        // Optimistic rows deliberately are not in this set: their canonical
        // Realtime/API row must still replace the pending presentation.
        if (seenRef.current.has(message.id)) continue;
        remember(message.id);

        const active = activeRef.current;
        const readNow = active?.conversationId === message.conversation_id && active.canRead?.() === true;
        const result = applyIncomingUnread(nextUnread, message, { currentUserId: userId, readNow });
        nextUnread = result.state;
        if (result.changed) {
          unreadChanged = true;
          touch(message.conversation_id);
        }
      }

      events.push({
        ...event,
        type: 'message',
        unreadCount: nextUnread[message.conversation_id]?.count || 0,
      });
    }

    if (unreadChanged) setUnreadState(nextUnread);
    for (const event of events) emit(event);
  }, [emit, remember, setUnreadState, touch, userId]);

  const queueMessage = useCallback((event) => {
    queueRef.current.push(event);
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(flush, EVENT_BATCH_MS);
  }, [flush]);

  const clearConversationUnread = useCallback((conversationId, readAt = null) => {
    touch(conversationId);
    const result = applyReadReceipt(unreadRef.current, conversationId, readAt);
    setUnreadState(result.state);
    emit({
      type: 'read',
      conversationId,
      read: { conversation_id: conversationId, user_id: userId, last_read_at: readAt },
      unreadCount: 0,
    });
  }, [emit, setUnreadState, touch, userId]);

  const onOwnRead = useCallback((row) => {
    touch(row.conversation_id);
    const result = applyReadReceipt(unreadRef.current, row.conversation_id, row.last_read_at);
    setUnreadState(result.state);
    emit({ type: 'read', conversationId: row.conversation_id, read: row, unreadCount: 0 });
  }, [emit, setUnreadState, touch]);

  const registerActiveConversation = useCallback((conversationId, canRead) => {
    const active = { conversationId, canRead };
    activeRef.current = active;
    return () => {
      if (activeRef.current === active) activeRef.current = null;
    };
  }, []);

  const registerInbox = useCallback(() => {
    const token = {};
    inboxRef.current = token;
    return () => {
      if (inboxRef.current === token) inboxRef.current = null;
    };
  }, []);

  const reconcile = useCallback(async () => {
    if (!userId) return null;
    lastReconcileRef.current = Date.now();
    const active = activeRef.current;
    if (active) {
      // The active sync endpoint returns the same unread snapshot together with
      // only missing messages, avoiding a second shell-wide request.
      emit({ type: 'reconcile', conversationId: active.conversationId });
      return null;
    }
    try {
      return await sync({ inbox: Boolean(inboxRef.current) });
    } catch {
      return null;
    }
  }, [emit, sync, userId]);

  const reset = useCallback(() => {
    sessionVersionRef.current += 1;
    requestsRef.current.clear();
    queueRef.current = [];
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
    seenRef.current.clear();
    activeRef.current = null;
    setUnreadState({});
  }, [setUnreadState]);

  const actions = useMemo(() => ({
    subscribe,
    registerActiveConversation,
    registerInbox,
    clearConversationUnread,
    reconcile,
    sync,
    noteCanonicalMessages(messages) {
      for (const message of messages || []) remember(message?.id);
    },
    publishOptimisticMessage(message) {
      emit({
        type: 'message',
        eventType: 'INSERT',
        message,
        optimistic: true,
        unreadCount: unreadRef.current[message.conversation_id]?.count || 0,
      });
    },
    confirmMessage(message) {
      remember(message.id);
      emit({
        type: 'message',
        eventType: 'INSERT',
        message,
        unreadCount: unreadRef.current[message.conversation_id]?.count || 0,
      });
    },
  }), [clearConversationUnread, emit, reconcile, registerActiveConversation, registerInbox, remember, subscribe, sync]);

  // Authenticate once per shell session, then maintain exactly one user channel.
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    let removeChannel = null;
    let authSubscription = null;
    let client = null;

    const onStatus = (next) => {
      const mapped = next === 'SUBSCRIBED'
        ? 'live'
        : next === 'CLOSED'
          ? 'reconnecting'
          : next === 'CHANNEL_ERROR' || next === 'TIMED_OUT'
            ? 'reconnecting'
            : 'connecting';
      statusRef.current = mapped;
      setStatus(mapped);
      if (next === 'SUBSCRIBED') void reconcile();
    };

    (async () => {
      const { getBrowserClient } = await import('@/lib/supabase/client');
      client = getBrowserClient();
      if (!client || cancelled) {
        if (!cancelled) {
          statusRef.current = 'unconfigured';
          setStatus('unconfigured');
        }
        return;
      }

      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          removeChannel?.();
          removeChannel = null;
          reset();
          statusRef.current = 'signed-out';
          setStatus('signed-out');
        } else if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session?.access_token) {
          void client.realtime.setAuth(session.access_token);
        }
      });
      authSubscription = data?.subscription;

      try {
        const authenticated = await authenticateRealtime(client);
        if (!authenticated || cancelled) {
          if (!cancelled && !authenticated) {
            reset();
            statusRef.current = 'signed-out';
            setStatus('signed-out');
          }
          return;
        }
        removeChannel = subscribeToUserMessaging(client, userId, {
          onMessage: queueMessage,
          onOwnRead,
          onStatus,
        });
      } catch {
        if (!cancelled) {
          statusRef.current = 'reconnecting';
          setStatus('reconnecting');
        }
      }
    })();

    return () => {
      cancelled = true;
      removeChannel?.();
      authSubscription?.unsubscribe();
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    };
  }, [onOwnRead, queueMessage, reconcile, reset, userId]);

  // Lightweight gap recovery only while Realtime is unavailable. There is no
  // normal-state polling loop and no full-history request on this path.
  useEffect(() => {
    if (!userId) return undefined;
    const fallback = () => {
      if (document.visibilityState !== 'visible') return;
      if (!['live', 'signed-out', 'unconfigured'].includes(statusRef.current)) void reconcile();
    };
    const interval = setInterval(fallback, FALLBACK_INTERVAL_MS);
    const focus = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastReconcileRef.current >= FOCUS_REFRESH_MS) {
        void reconcile();
      }
    };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [reconcile, userId]);

  return (
    <MessagingActionsContext.Provider value={actions}>
      <MessagingStatusContext.Provider value={status}>
        <UnreadMessagesContext.Provider value={total}>
          {children}
        </UnreadMessagesContext.Provider>
      </MessagingStatusContext.Provider>
    </MessagingActionsContext.Provider>
  );
}
