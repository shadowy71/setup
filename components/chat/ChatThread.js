'use client';

/**
 * Direct/group thread (spec §21, §22).
 *
 * Canonical message rows arrive on the shell's private user channel. This
 * component retains only the active conversation's receipt channel and local
 * presentation state; it never reloads or remounts the thread for an arrival.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, DeleteButton, GlassSurface, Notice, OrbLoader, Textarea } from '@/components/ui';
import { GifAttachment, GifPicker } from '@/components/media/GifPicker';
import { useFormAction } from '@/lib/forms';
import { getBrowserClient, isBrowserConfigured } from '@/lib/supabase/client';
import { sendMessage, editMessage, deleteMessage, markConversationRead } from '@/lib/actions/messaging';
import { authenticateRealtime, subscribeToConversationReads } from '@/lib/messaging/realtime';
import { createClientMessageId, mergeMessages } from '@/lib/messaging/state';
import { useMessagingActions, useMessagingStatus } from '@/components/layout/MessagingProvider';
import { cn, relativeTime } from '@/lib/utils';
import { LIMITS } from '@/lib/constants';
import { LinkifiedText } from '@/components/content/LinkifiedText';

function mergeReadRows(current, incoming) {
  const byUser = new Map(current.map((row) => [row.user_id, row]));
  for (const row of incoming) {
    if (row?.user_id) byUser.set(row.user_id, { ...(byUser.get(row.user_id) || {}), ...row });
  }
  return [...byUser.values()];
}

const MessageItem = memo(function MessageItem({
  message,
  mine,
  author,
  conversationId,
  editing,
  editPending,
  removePending,
  onStartEdit,
  onCancelEdit,
  onEdit,
  onDelete,
}) {
  const deleted = message.status === 'deleted' || message.deleted_at;
  const isEditing = editing === message.id;

  return (
    <article className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      <div className="flex items-center gap-2 text-2xs text-muted">
        <span className="font-medium text-ink">
          {mine ? 'You' : author?.display_name || (author?.username ? `@${author.username}` : 'Student')}
        </span>
        <time dateTime={message.created_at}>{relativeTime(message.created_at)}</time>
        {message.edited_at && !deleted ? <span>· edited</span> : null}
        {message.optimistic ? <span>· {message.sendFailed ? 'not sent' : 'sending'}</span> : null}
      </div>

      {isEditing ? (
        <form
          className="w-full max-w-md"
          action={(formData) => onEdit(message, formData)}
        >
          <Textarea name="body" rows={2} defaultValue={message.body} maxLength={LIMITS.message.max} required />
          <div className="mt-2 flex items-center gap-2">
            <Button type="submit" size="sm" disabled={editPending}>
              {editPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCancelEdit}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div
          className={cn(
            'cp-chat-bubble max-w-[85%] rounded-lg border px-3 py-2',
            mine ? 'cp-chat-bubble--mine' : null,
            message.sendFailed ? 'border-danger/60' : null,
          )}
        >
          {deleted ? (
            <p className="text-[0.8125rem] italic text-muted">This message was deleted.</p>
          ) : (
            <>
              {message.body ? (
                <p className="user-text text-[0.9375rem] leading-relaxed">
                  <LinkifiedText text={message.body} mentions />
                </p>
              ) : null}
              {message.gif?.url ? <GifAttachment gif={message.gif} className="mt-2 max-w-[14rem]" /> : null}
            </>
          )}
        </div>
      )}

      {!deleted && !isEditing && mine && !message.optimistic ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="ghost" icon="file" onClick={() => onStartEdit(message)}>
            Edit
          </Button>
          <DeleteButton
            size="sm"
            disabled={removePending}
            aria-label="Delete message"
            onClick={() => onDelete(message, conversationId)}
          >
            {removePending ? 'Deleting…' : 'Delete'}
          </DeleteButton>
        </div>
      ) : null}
    </article>
  );
});

export function ChatThread({
  conversationId,
  currentUserId,
  initialMessages = [],
  members = [],
  reads: initialReads = [],
  canPost = true,
}) {
  const [live, setLive] = useState([]);
  const [reads, setReads] = useState(initialReads);
  const [body, setBody] = useState('');
  const [gif, setGif] = useState(null);
  const [pinned, setPinned] = useState(true);
  const [receiptStatus, setReceiptStatus] = useState(() =>
    isBrowserConfigured() ? 'connecting' : 'unconfigured',
  );
  const [editing, setEditing] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [failedDraft, setFailedDraft] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const listRef = useRef(null);
  const formRef = useRef(null);
  const liveRef = useRef(live);
  const pinnedRef = useRef(true);
  const latestCursorRef = useRef(null);
  const syncInFlightRef = useRef(null);
  const syncAgainRef = useRef(false);
  const mountedRef = useRef(true);
  const readTimerRef = useRef(null);
  const readInFlightRef = useRef(false);
  const readQueuedRef = useRef(null);
  const lastReadRequestRef = useRef(null);
  const sendingRef = useRef(false);
  const actions = useMessagingActions();
  const globalStatus = useMessagingStatus();

  const updateLive = useCallback((updater) => {
    setLive((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      liveRef.current = next;
      return next;
    });
  }, []);

  const messages = useMemo(
    () => mergeMessages(initialMessages, live, conversationId),
    [conversationId, initialMessages, live],
  );

  const scrollToBottom = useCallback((behavior = 'auto') => {
    const element = listRef.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (pinned) scrollToBottom();
  }, [messages.length, pinned, scrollToBottom]);

  useEffect(() => {
    pinnedRef.current = pinned;
  }, [pinned]);

  // Track a canonical cursor and suppress a late duplicate of any row already
  // rendered from history or recovered through the sync endpoint.
  useEffect(() => {
    const canonical = messages.filter((message) => !message.optimistic);
    actions.noteCanonicalMessages(canonical);
    const latest = canonical.at(-1);
    if (latest) latestCursorRef.current = { created_at: latest.created_at, id: latest.id };
  }, [actions, messages]);

  /** Fetch only rows after the current cursor (plus current Seen receipts). */
  const reconcileMessages = useCallback(() => {
    if (syncInFlightRef.current) {
      syncAgainRef.current = true;
      return syncInFlightRef.current;
    }

    const task = (async () => {
      try {
        do {
          syncAgainRef.current = false;
          const cursor = latestCursorRef.current;
          const payload = await actions.sync({
            conversationId,
            after: cursor?.created_at,
            afterId: cursor?.id,
          });
          if (!payload || !mountedRef.current) break;

          const incoming = payload.messages || [];
          if (incoming.length) {
            updateLive((current) => mergeMessages(current, incoming, conversationId));
            actions.noteCanonicalMessages(incoming);
            const latest = incoming.at(-1);
            latestCursorRef.current = { created_at: latest.created_at, id: latest.id };
          }
          if (payload.reads) setReads((current) => mergeReadRows(current, payload.reads));
          if (payload.hasMore) syncAgainRef.current = true;
          setSyncError(null);
        } while (syncAgainRef.current && mountedRef.current);
      } catch {
        if (mountedRef.current) setSyncError('Could not check for missed messages.');
      } finally {
        syncInFlightRef.current = null;
        syncAgainRef.current = false;
      }
    })();

    syncInFlightRef.current = task;
    return task;
  }, [actions, conversationId, updateLive]);

  // One listener for shell events relevant to this thread. Other conversations
  // update their inbox/badge state without rendering this component's rows.
  useEffect(() => actions.subscribe((event) => {
    if (event.type === 'reconcile' && event.conversationId === conversationId) {
      void reconcileMessages();
      return;
    }
    if (event.conversationId !== conversationId && event.message?.conversation_id !== conversationId) return;

    if (event.type === 'message') {
      updateLive((current) => mergeMessages(current, [event.message], conversationId));
    } else if (event.type === 'read' && event.read) {
      setReads((current) => mergeReadRows(current, [event.read]));
    }
  }), [actions, conversationId, reconcileMessages, updateLive]);

  useEffect(() => actions.registerActiveConversation(
    conversationId,
    () => pinnedRef.current && document.visibilityState === 'visible',
  ), [actions, conversationId]);

  useEffect(() => {
    void reconcileMessages();
  }, [reconcileMessages]);

  // The existing private conversation topic now carries only Seen receipts;
  // message rows have exactly one subscription, on the shell's user channel.
  useEffect(() => {
    let cancelled = false;
    let removeChannel = null;
    const client = getBrowserClient();
    if (!client) return undefined;

    (async () => {
      try {
        if (!(await authenticateRealtime(client)) || cancelled) return;
        removeChannel = subscribeToConversationReads(client, conversationId, {
          onRead(row) {
            setReads((current) => mergeReadRows(current, [row]));
          },
          onStatus(status) {
            setReceiptStatus(status === 'SUBSCRIBED' ? 'live' : status === 'CLOSED' ? 'reconnecting' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'reconnecting' : 'connecting');
            if (status === 'SUBSCRIBED') void reconcileMessages();
          },
        });
      } catch {
        if (!cancelled) setReceiptStatus('reconnecting');
      }
    })();

    return () => {
      cancelled = true;
      removeChannel?.();
    };
  }, [conversationId, reconcileMessages]);

  /** Write the existing per-conversation read marker, debounced for bursts. */
  const markRead = useCallback(async (latestId) => {
    if (!latestId || document.visibilityState === 'hidden') return;
    if (readInFlightRef.current) {
      readQueuedRef.current = latestId;
      return;
    }
    if (lastReadRequestRef.current === latestId) return;

    readInFlightRef.current = true;
    let nextId = latestId;
    try {
      while (nextId) {
        if (lastReadRequestRef.current !== nextId) {
          lastReadRequestRef.current = nextId;
          const data = new FormData();
          data.set('conversation_id', conversationId);
          try {
            const result = await markConversationRead(data);
            if (!result?.ok) throw new Error(result?.error || 'Read state was not saved.');
            actions.clearConversationUnread(conversationId, result.readAt || null);
            if (mountedRef.current && result.readAt) {
              setReads((current) => mergeReadRows(current, [{
                conversation_id: conversationId,
                user_id: currentUserId,
                last_read_at: result.readAt,
              }]));
            }
          } catch {
            lastReadRequestRef.current = null;
            // Restore an authoritative badge if the optimistic read could not
            // be saved. This is an error path, not a query per message.
            await actions.sync({}).catch(() => null);
          }
        }

        const queued = readQueuedRef.current;
        readQueuedRef.current = null;
        nextId = queued && queued !== nextId ? queued : null;
      }
    } finally {
      readInFlightRef.current = false;
    }
  }, [actions, conversationId, currentUserId]);

  const scheduleRead = useCallback((latestId) => {
    if (!latestId || !pinnedRef.current || document.visibilityState === 'hidden') return;
    // The badge clears immediately; the server RPC remains the authority and
    // broadcasts the receipt to this user's other clients.
    actions.clearConversationUnread(conversationId);
    if (readTimerRef.current) clearTimeout(readTimerRef.current);
    readTimerRef.current = setTimeout(() => void markRead(latestId), 120);
  }, [actions, conversationId, markRead]);

  const latestMessageId = messages.at(-1)?.id || null;
  useEffect(() => {
    if (pinned) scheduleRead(latestMessageId);
    return () => {
      if (readTimerRef.current) clearTimeout(readTimerRef.current);
      readTimerRef.current = null;
    };
  }, [latestMessageId, pinned, scheduleRead]);

  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === 'visible') scheduleRead(latestMessageId);
    };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [latestMessageId, scheduleRead]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (readTimerRef.current) clearTimeout(readTimerRef.current);
    };
  }, []);

  const edit = useFormAction(editMessage, {
    onSuccess: () => setEditing(null),
  });
  const remove = useFormAction(deleteMessage);
  const runEdit = edit.run;
  const runRemove = remove.run;

  const onStartEdit = useCallback((message) => setEditing(message), []);
  const onCancelEdit = useCallback(() => setEditing(null), []);
  const onEdit = useCallback((message, formData) => {
    formData.set('id', message.id);
    formData.set('conversation_id', conversationId);
    runEdit(formData);
  }, [conversationId, runEdit]);
  const onDelete = useCallback((message, id) => {
    const data = new FormData();
    data.set('id', message.id);
    data.set('conversation_id', id);
    runRemove(data);
  }, [runRemove]);

  const memberById = useMemo(() => new Map(members.map((member) => [member.user_id, member])), [members]);
  const otherReadAt = useMemo(() => {
    const otherReads = reads.filter((read) => read.user_id !== currentUserId);
    if (!otherReads.length) return null;
    return otherReads.reduce(
      (latest, read) => (!latest || new Date(read.last_read_at) > new Date(latest) ? read.last_read_at : latest),
      null,
    );
  }, [reads, currentUserId]);

  const myLastMessage = [...messages].reverse().find(
    (message) => message.sender_id === currentUserId && message.status !== 'deleted' && !message.optimistic,
  );
  const seen = Boolean(
    myLastMessage && otherReadAt && new Date(otherReadAt).getTime() >= new Date(myLastMessage.created_at).getTime(),
  );

  const onScroll = () => {
    const element = listRef.current;
    if (!element) return;
    const nextPinned = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    pinnedRef.current = nextPinned;
    setPinned(nextPinned);
  };

  /** Send through the existing Server Action, with a UUID-stable optimistic row. */
  const deliver = useCallback(async (draft) => {
    if (sendingRef.current) return;
    // A retry can be clicked after Realtime has already confirmed the row but
    // before the original action response arrives. Never send that UUID again.
    if (liveRef.current.some((message) => message.id === draft.id && !message.optimistic)) {
      setFailedDraft(null);
      setSendError(null);
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    updateLive((current) => mergeMessages(current, [{ ...draft, optimistic: true, sendFailed: false }], conversationId));

    const data = new FormData();
    data.set('conversation_id', conversationId);
    data.set('message_id', draft.id);
    data.set('body', draft.body);
    if (draft.gif) data.set('gif', JSON.stringify(draft.gif));

    try {
      const result = await sendMessage(data);
      if (!result?.ok || !result.message) {
        const canonical = liveRef.current.find((message) => message.id === draft.id && !message.optimistic);
        setFailedDraft(null);
        if (canonical) {
          // Inserting can succeed even when a later notification step or the
          // response fails. The canonical row is authoritative in that case.
          setSendError(null);
          return;
        }
        updateLive((current) => current.filter((message) => message.id !== draft.id));
        setBody((current) => current || draft.body);
        setGif((current) => current || draft.gif);
        setSendError(result?.error || 'That message was not sent.');
        return;
      }

      updateLive((current) => mergeMessages(current, [result.message], conversationId));
      actions.confirmMessage(result.message);
      setFailedDraft(null);
    } catch {
      // A network failure is ambiguous: keep a retryable optimistic row with
      // the same id rather than risking a second, duplicate database message.
      const canonical = liveRef.current.some((message) => message.id === draft.id && !message.optimistic);
      if (canonical) {
        setFailedDraft(null);
        setSendError(null);
      } else {
        updateLive((current) => current.map((message) => (
          message.id === draft.id && message.optimistic ? { ...message, sendFailed: true } : message
        )));
        setFailedDraft(draft);
        setSendError('The connection dropped while sending. Check live updates or retry the same message.');
      }
    } finally {
      sendingRef.current = false;
      if (mountedRef.current) setSending(false);
    }
  }, [actions, conversationId, updateLive]);

  const submit = (formData) => {
    if (sendingRef.current) return;
    const draft = {
      id: createClientMessageId(),
      conversation_id: conversationId,
      sender_id: currentUserId,
      body: String(formData.get('body') || ''),
      gif,
      status: 'published',
      edited_at: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
    };
    setBody('');
    setGif(null);
    formRef.current?.reset();
    setFailedDraft(null);
    pinnedRef.current = true;
    setPinned(true);
    scrollToBottom('smooth');
    updateLive((current) => mergeMessages(current, [{ ...draft, optimistic: true }], conversationId));
    actions.publishOptimisticMessage({ ...draft, optimistic: true });
    void deliver(draft);
  };

  const connectionStatus = globalStatus === 'unconfigured' || receiptStatus === 'unconfigured'
    ? 'unconfigured'
    : globalStatus === 'live' && receiptStatus === 'live'
      ? 'live'
      : 'reconnecting';

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={listRef}
        onScroll={onScroll}
        className="card flex max-h-[62vh] min-h-[18rem] flex-col gap-3 overflow-y-auto p-4"
        aria-label="Messages"
      >
        {messages.length === 0 ? (
          <p className="m-auto text-center text-[0.8125rem] text-muted">
            No messages yet. Say hello — text and GIFs only.
          </p>
        ) : null}

        {messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            mine={message.sender_id === currentUserId}
            author={memberById.get(message.sender_id)}
            conversationId={conversationId}
            editing={editing?.id || null}
            editPending={edit.pending}
            removePending={remove.pending}
            onStartEdit={onStartEdit}
            onCancelEdit={onCancelEdit}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}

        <div aria-hidden="true" />
      </div>

      {!pinned ? (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              pinnedRef.current = true;
              setPinned(true);
              scrollToBottom('smooth');
            }}
          >
            New messages ↓
          </Button>
        </div>
      ) : null}

      <p className="text-2xs text-muted" role="status">
        {seen ? 'Seen' : myLastMessage ? 'Sent' : ''}
        {connectionStatus === 'reconnecting' ? ' · reconnecting for live updates…' : ''}
        {connectionStatus === 'unconfigured' ? ' · live updates unavailable' : ''}
      </p>
      {syncError ? (
        <p className="text-2xs text-muted" role="alert">
          {syncError}{' '}
          <button type="button" className="underline" onClick={() => void reconcileMessages()}>Retry</button>
        </p>
      ) : null}

      {canPost ? (
        <form ref={formRef} className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 lg:bottom-4" action={submit}>
          <GlassSurface tone="strong" className="flex flex-col gap-2 p-3 shadow-[var(--shadow-float)]">
            <Textarea
              name="body"
              rows={2}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter starts a new line. IME composition
                // is never interrupted.
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) {
                  event.preventDefault();
                  if ((body.trim() || gif) && !sendingRef.current) event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Write a message…  (Enter to send, Shift+Enter for a new line)"
              maxLength={LIMITS.message.max}
              aria-label="Message"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <GifPicker value={gif} onPick={setGif} onRemove={() => setGif(null)} />
              <div className="flex items-center gap-2">
                {sending ? <OrbLoader size="sm" label="Sending message" /> : null}
                <Button type="submit" size="sm" tone="accent" icon="send" disabled={sending || (!body.trim() && !gif)}>
                  Send
                </Button>
              </div>
            </div>
            {sendError ? (
              <Notice tone="danger">
                <span>{sendError}</span>
                {failedDraft ? (
                  <Button type="button" size="sm" variant="ghost" disabled={sending} onClick={() => void deliver(failedDraft)}>
                    Retry
                  </Button>
                ) : null}
              </Notice>
            ) : null}
          </GlassSurface>
        </form>
      ) : (
        <Notice tone="warning" icon="lock">
          You cannot send messages in this conversation.
        </Notice>
      )}

      <span className="sr-only" aria-live="polite">
        {messages.length} messages
      </span>
    </div>
  );
}
