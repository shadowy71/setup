/**
 * Client-safe messaging state transitions.
 *
 * The database remains canonical. These helpers only merge rows already
 * authorised by Supabase RLS, reconcile optimistic copies, and keep the shell's
 * unread counters consistent between Realtime events and lightweight syncs.
 */

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function count(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function compareMessages(a, b) {
  const byDate = timestamp(a.created_at) - timestamp(b.created_at);
  return byDate || String(a.id).localeCompare(String(b.id));
}

/** Bounded per-session id set used before an INSERT can affect unread state. */
export function createMessageDeduper(limit = 1_000) {
  const ids = new Set();
  const order = [];
  return {
    has(id) {
      return ids.has(id);
    },
    remember(id) {
      if (!id || ids.has(id)) return false;
      ids.add(id);
      order.push(id);
      if (order.length > limit) {
        for (const oldId of order.splice(0, order.length - limit)) ids.delete(oldId);
      }
      return true;
    },
    clear() {
      ids.clear();
      order.length = 0;
    },
  };
}

/**
 * Merge initial history, optimistic rows, server responses, and Realtime rows.
 * A canonical row clears the optimistic marker; untouched objects retain their
 * identity so memoised message items do not need to render again.
 */
export function mergeMessages(current = [], incoming = [], conversationId = null) {
  const byId = new Map();

  for (const message of [...current, ...incoming]) {
    if (!message?.id || (conversationId && message.conversation_id !== conversationId)) continue;
    const previous = byId.get(message.id);
    // A delayed optimistic action (most notably a retry) must never regress a
    // row already confirmed by Realtime or the Server Action back to pending.
    if (previous && !previous.optimistic && message.optimistic) continue;
    const merged = previous ? { ...previous, ...message } : { ...message };

    if (message.optimistic !== true) {
      delete merged.optimistic;
      delete merged.sendFailed;
    }

    byId.set(message.id, merged);
  }

  return [...byId.values()].sort(compareMessages);
}

/** Normalise the RLS-scoped `messaging_unread_counts` RPC projection. */
export function normalizeUnreadRows(rows = []) {
  const normalized = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = row?.conversation_id || row?.id;
    if (!id || typeof id !== 'string') continue;
    normalized[id] = {
      count: count(row.unread_count ?? row.unread),
      lastReadAt: row.last_read_at || null,
    };
  }
  return normalized;
}

export function unreadRows(state = {}) {
  return Object.entries(state).map(([conversation_id, value]) => ({
    conversation_id,
    unread_count: count(value?.count),
    last_read_at: value?.lastReadAt || null,
  }));
}

export function unreadTotal(state = {}) {
  return Object.values(state).reduce((total, value) => total + count(value?.count), 0);
}

function latestDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return timestamp(b) > timestamp(a) ? b : a;
}

/**
 * Apply one canonical INSERT to unread state. `readNow` is true only while the
 * recipient is visibly reading the latest position in that conversation.
 */
export function applyIncomingUnread(state, message, { currentUserId, readNow = false } = {}) {
  const conversationId = message?.conversation_id;
  if (!conversationId || !message?.id) return { state, count: 0, changed: false };

  const previous = state[conversationId] || { count: 0, lastReadAt: null };
  if (message.sender_id === currentUserId) {
    return { state, count: previous.count, changed: false };
  }

  if (readNow) {
    const lastReadAt = latestDate(previous.lastReadAt, message.created_at);
    if (previous.count === 0 && lastReadAt === previous.lastReadAt) {
      return { state, count: 0, changed: false };
    }
    return {
      state: { ...state, [conversationId]: { count: 0, lastReadAt } },
      count: 0,
      changed: true,
    };
  }

  // A delayed Realtime event must not resurrect something already covered by a
  // read receipt, including a receipt written on another device.
  if (previous.lastReadAt && timestamp(message.created_at) <= timestamp(previous.lastReadAt)) {
    return { state, count: previous.count, changed: false };
  }

  return {
    state: { ...state, [conversationId]: { count: previous.count + 1, lastReadAt: previous.lastReadAt } },
    count: previous.count + 1,
    changed: true,
  };
}

/** Clear exactly one conversation, leaving every other unread count intact. */
export function applyReadReceipt(state, conversationId, lastReadAt = null) {
  if (!conversationId) return { state, changed: false };
  const previous = state[conversationId] || { count: 0, lastReadAt: null };
  const nextReadAt = latestDate(previous.lastReadAt, lastReadAt);
  if (previous.count === 0 && nextReadAt === previous.lastReadAt) {
    return { state, changed: false };
  }
  return {
    state: { ...state, [conversationId]: { count: 0, lastReadAt: nextReadAt } },
    changed: true,
  };
}

export function compareConversations(a, b) {
  const aDate = a.lastMessage?.created_at || a.last_message_at || a.created_at;
  const bDate = b.lastMessage?.created_at || b.last_message_at || b.created_at;
  return timestamp(bDate) - timestamp(aDate) || String(a.id).localeCompare(String(b.id));
}

export function sortConversations(conversations = []) {
  const byId = new Map();
  for (const conversation of conversations) {
    if (!conversation?.id) continue;
    byId.set(conversation.id, { ...(byId.get(conversation.id) || {}), ...conversation });
  }
  return [...byId.values()].sort(compareConversations);
}

/**
 * Update only the affected inbox row. Older arrivals still update unread state,
 * but cannot replace a newer preview or move the row ahead of a newer thread.
 */
export function upsertConversationMessage(
  conversations,
  message,
  { eventType = 'INSERT', unreadCount = undefined } = {},
) {
  const id = message?.conversation_id;
  const index = conversations.findIndex((conversation) => conversation.id === id);
  if (index < 0) return { conversations, found: false };

  const current = conversations[index];
  const next = { ...current };
  if (Number.isFinite(unreadCount)) next.unread = count(unreadCount);

  const currentLast = current.lastMessage;
  const currentLastAt = currentLast?.created_at || current.last_message_at || current.created_at;
  const isNewest = timestamp(message.created_at) >= timestamp(currentLastAt);

  if (eventType === 'INSERT' && isNewest) {
    next.lastMessage = { ...message };
    next.last_message_at = message.created_at || current.last_message_at;
  } else if (eventType === 'UPDATE' && currentLast?.id === message.id) {
    next.lastMessage = { ...currentLast, ...message };
  }

  const output = conversations.slice();
  output[index] = next;
  return { conversations: sortConversations(output), found: true };
}

/** Merge a full, authorised summary fetched only for a previously unknown row. */
export function upsertConversationSummary(conversations, summary) {
  if (!summary?.id) return conversations;
  return sortConversations([...conversations.filter((item) => item.id !== summary.id), summary]);
}

export function messagePreview(message) {
  if (!message) return 'No messages yet';
  if (message.status === 'deleted' || message.deleted_at) return 'Message deleted';
  return message.body || (message.gif ? 'GIF' : 'Message');
}

/** Shared by the server thread header and the client inbox. */
export function conversationTitle(conversation, other, members = []) {
  if (conversation?.title) return conversation.title;
  if (other) return other.display_name || (other.username ? `@${other.username}` : 'Student');
  const names = members
    .filter(Boolean)
    .map((member) => member.display_name || (member.username ? `@${member.username}` : 'Student'));
  return names.length ? names.join(', ') : 'Conversation';
}

/** Use the final database id for the optimistic row, making reconciliation exact. */
export function createClientMessageId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (!cryptoApi?.getRandomValues) throw new Error('This browser cannot create a secure message id.');

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
