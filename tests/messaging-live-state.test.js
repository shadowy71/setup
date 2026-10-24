import { describe, expect, it } from 'vitest';
import {
  applyIncomingUnread,
  applyReadReceipt,
  createClientMessageId,
  createMessageDeduper,
  mergeMessages,
  normalizeUnreadRows,
  unreadTotal,
  upsertConversationMessage,
  upsertConversationSummary,
} from '@/lib/messaging/state';

const at = (seconds) => new Date(seconds * 1_000).toISOString();
const message = (id, overrides = {}) => ({
  id,
  conversation_id: 'c1',
  sender_id: 'other',
  body: `body-${id}`,
  gif: null,
  status: 'published',
  created_at: at(10),
  ...overrides,
});

describe('canonical message merging', () => {
  it('collapses an optimistic row, its Realtime event, and the server response into one message', () => {
    const optimistic = message('m1', { sender_id: 'me', body: 'hello', optimistic: true });
    const canonical = message('m1', { sender_id: 'me', body: 'hello', edited_at: null });

    let rows = mergeMessages([], [optimistic]);
    rows = mergeMessages(rows, [canonical]);
    rows = mergeMessages(rows, [{ ...canonical }]);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('m1');
    expect(rows[0].optimistic).toBeUndefined();
    expect(rows[0].sendFailed).toBeUndefined();
  });

  it('never lets a delayed optimistic retry regress a canonical row', () => {
    const canonical = message('m1', { sender_id: 'me', body: 'stored', created_at: at(12) });
    const retry = message('m1', {
      sender_id: 'me',
      body: 'draft',
      created_at: at(11),
      optimistic: true,
      sendFailed: true,
    });

    const rows = mergeMessages([canonical], [retry]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(canonical);
    expect(rows[0].optimistic).toBeUndefined();
  });

  it('sorts chronologically with a deterministic id tie-breaker and drops stale-conversation rows', () => {
    const rows = mergeMessages(
      [message('b', { created_at: at(10) }), message('old-c2', { conversation_id: 'c2' })],
      [message('a', { created_at: at(10) }), message('later', { created_at: at(11) })],
      'c1',
    );
    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'later']);
  });

  it('creates standards-shaped ids suitable for optimistic/database reconciliation', () => {
    const id = createClientMessageId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(createClientMessageId()).not.toBe(id);
  });
});

describe('unread calculations and read-state transitions', () => {
  it('sums exact per-conversation counts and hides no count behind the display cap', () => {
    const state = normalizeUnreadRows([
      { conversation_id: 'c1', unread_count: 105, last_read_at: null },
      { conversation_id: 'c2', unread_count: 2, last_read_at: null },
    ]);
    expect(unreadTotal(state)).toBe(107);
  });

  it('does not count messages sent by the current user', () => {
    const initial = normalizeUnreadRows([{ conversation_id: 'c1', unread_count: 2 }]);
    const result = applyIncomingUnread(initial, message('mine', { sender_id: 'me' }), { currentUserId: 'me' });
    expect(result.changed).toBe(false);
    expect(unreadTotal(result.state)).toBe(2);
  });

  it('increments another conversation without disturbing the active one', () => {
    const initial = normalizeUnreadRows([
      { conversation_id: 'c1', unread_count: 0 },
      { conversation_id: 'c2', unread_count: 3 },
    ]);
    const result = applyIncomingUnread(initial, message('new-c2', { conversation_id: 'c2' }), {
      currentUserId: 'me',
      readNow: false,
    });
    expect(result.state.c1.count).toBe(0);
    expect(result.state.c2.count).toBe(4);
    expect(unreadTotal(result.state)).toBe(4);
  });

  it('clears only the opened conversation and ignores delayed events covered by its receipt', () => {
    const initial = normalizeUnreadRows([
      { conversation_id: 'c1', unread_count: 4 },
      { conversation_id: 'c2', unread_count: 2 },
    ]);
    const read = applyReadReceipt(initial, 'c1', at(20));
    expect(read.state.c1.count).toBe(0);
    expect(read.state.c2.count).toBe(2);
    expect(unreadTotal(read.state)).toBe(2);

    const delayed = applyIncomingUnread(read.state, message('old', { created_at: at(19) }), { currentUserId: 'me' });
    expect(delayed.changed).toBe(false);
    expect(unreadTotal(delayed.state)).toBe(2);
  });

  it('does not add unread while the recipient is visibly reading the latest position', () => {
    const result = applyIncomingUnread({}, message('live'), { currentUserId: 'me', readNow: true });
    expect(result.count).toBe(0);
    expect(unreadTotal(result.state)).toBe(0);
  });

  it('deduplicates message ids before they can affect unread state', () => {
    const deduper = createMessageDeduper(2);
    expect(deduper.remember('m1')).toBe(true);
    expect(deduper.remember('m1')).toBe(false);
    expect(deduper.has('m1')).toBe(true);
    deduper.remember('m2');
    deduper.remember('m3');
    expect(deduper.has('m1')).toBe(false); // bounded memory
    expect(deduper.has('m3')).toBe(true);
  });

  it('stays correct for a rapid burst of distinct incoming messages', () => {
    let state = {};
    let rows = [];
    for (let index = 0; index < 500; index += 1) {
      const incoming = message(`m${index}`, { created_at: at(100 + index) });
      state = applyIncomingUnread(state, incoming, { currentUserId: 'me' }).state;
      rows = mergeMessages(rows, [incoming]);
    }
    expect(unreadTotal(state)).toBe(500);
    expect(rows).toHaveLength(500);
    expect(rows.at(-1).id).toBe('m499');
  });
});

describe('conversation preview updates', () => {
  const conversations = [
    { id: 'c1', created_at: at(1), last_message_at: at(2), lastMessage: message('old', { created_at: at(2) }), unread: 0 },
    { id: 'c2', created_at: at(1), last_message_at: at(3), lastMessage: message('other', { conversation_id: 'c2', created_at: at(3) }), unread: 1 },
  ];

  it('updates the preview, unread count, and most-recent-first position without duplicate rows', () => {
    const incoming = message('new', { conversation_id: 'c1', created_at: at(4), body: 'latest' });
    const first = upsertConversationMessage(conversations, incoming, { unreadCount: 2 });
    const second = upsertConversationMessage(first.conversations, incoming, { unreadCount: 2 });

    expect(first.conversations[0].id).toBe('c1');
    expect(first.conversations[0].lastMessage.body).toBe('latest');
    expect(first.conversations[0].unread).toBe(2);
    expect(second.conversations).toHaveLength(2);
  });

  it('does not let an older arrival replace a newer preview', () => {
    const result = upsertConversationMessage(conversations, message('ancient', {
      conversation_id: 'c1',
      created_at: at(1),
      body: 'older',
    }), { unreadCount: 1 });
    expect(result.conversations.find((row) => row.id === 'c1').lastMessage.id).toBe('old');
  });

  it('merges a newly discovered summary by id', () => {
    const summary = { id: 'c3', created_at: at(5), lastMessage: null, unread: 1 };
    const once = upsertConversationSummary(conversations, summary);
    const twice = upsertConversationSummary(once, { ...summary, unread: 0 });
    expect(twice.filter((row) => row.id === 'c3')).toHaveLength(1);
    expect(twice[0].id).toBe('c3');
    expect(twice[0].unread).toBe(0);
  });
});
