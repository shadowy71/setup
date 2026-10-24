import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActiveUser: vi.fn(),
  getServerClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  notifyConversation: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/auth/session', () => ({ getActiveUser: mocks.getActiveUser }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: mocks.getServerClient }));
vi.mock('@/lib/ratelimit', () => ({ enforceRateLimit: mocks.enforceRateLimit }));
vi.mock('@/lib/notifications', () => ({ notifyConversation: mocks.notifyConversation }));
vi.mock('@/lib/data/messaging', () => ({ MESSAGE_COLUMNS: 'id, conversation_id, sender_id, body' }));

import { sendMessage } from '@/lib/actions/messaging';

const conversationId = '11111111-1111-4111-8111-111111111111';
const messageId = '22222222-2222-4222-8222-222222222222';
const canonical = {
  id: messageId,
  conversation_id: conversationId,
  sender_id: 'me',
  body: 'hello',
  created_at: '2026-10-24T10:00:00.000Z',
};

function form() {
  const data = new FormData();
  data.set('conversation_id', conversationId);
  data.set('message_id', messageId);
  data.set('body', 'hello');
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveUser.mockResolvedValue({ profile: { id: 'me', username: 'me', display_name: 'Me' } });
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  mocks.notifyConversation.mockResolvedValue(undefined);
});

describe('optimistic message Server Action reconciliation', () => {
  it('returns the same sender-owned canonical row on a same-UUID retry after a lost response', async () => {
    const insert = vi.fn(() => ({
      select: () => ({ single: async () => ({ data: null, error: { code: '23505' } }) }),
    }));
    const filters = [];
    const lookup = {
      eq(column, value) {
        filters.push([column, value]);
        return this;
      },
      maybeSingle: async () => ({ data: canonical, error: null }),
    };
    const from = vi.fn((table) => {
      expect(table).toBe('messages');
      return from.mock.calls.length === 1 ? { insert } : { select: () => lookup };
    });
    mocks.getServerClient.mockResolvedValue({ from });

    await expect(sendMessage(form())).resolves.toEqual({ ok: true, id: messageId, message: canonical });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      id: messageId,
      conversation_id: conversationId,
      sender_id: 'me',
    }));
    expect(filters).toEqual([
      ['id', messageId],
      ['conversation_id', conversationId],
      ['sender_id', 'me'],
    ]);
    // A recovered retry must not fan out a second notification.
    expect(mocks.notifyConversation).not.toHaveBeenCalled();
  });

  it('rejects a malformed client UUID before creating a database client', async () => {
    const data = form();
    data.set('message_id', 'not-a-uuid');
    await expect(sendMessage(data)).resolves.toMatchObject({ ok: false, code: 'validation' });
    expect(mocks.getServerClient).not.toHaveBeenCalled();
  });
});
