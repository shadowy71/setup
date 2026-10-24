import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getServerClient: vi.fn(),
  getUnreadMessageState: vi.fn(),
  listInboxRealtimeRows: vi.fn(),
  getConversationSummary: vi.fn(),
  listMessages: vi.fn(),
  listMessagesAfter: vi.fn(),
  rpc: vi.fn(),
  reads: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  BLOCKED_STATUSES: ['suspended', 'banned', 'deleted'],
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: mocks.getServerClient }));
vi.mock('@/lib/data/messaging', () => ({
  getConversationSummary: mocks.getConversationSummary,
  getUnreadMessageState: mocks.getUnreadMessageState,
  listInboxRealtimeRows: mocks.listInboxRealtimeRows,
  listMessages: mocks.listMessages,
  listMessagesAfter: mocks.listMessagesAfter,
}));

import { GET } from '@/app/api/messages/sync/route';

const conversationId = '11111111-1111-4111-8111-111111111111';
const afterId = '22222222-2222-4222-8222-222222222222';
const request = (query = '') => new Request(`http://campus.test/api/messages/sync${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({
    profile: { id: 'me' },
    needsProfileSetup: false,
    accountStatus: 'active',
  });
  mocks.getServerClient.mockResolvedValue({
    rpc: mocks.rpc,
    from: mocks.reads,
  });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.getUnreadMessageState.mockResolvedValue({
    rows: [{ conversation_id: conversationId, unread_count: 2, last_read_at: null }],
    unavailable: false,
  });
  mocks.listInboxRealtimeRows.mockResolvedValue({ rows: [], unavailable: false });
  mocks.getConversationSummary.mockResolvedValue({ id: conversationId });
  mocks.listMessages.mockResolvedValue([]);
  mocks.listMessagesAfter.mockResolvedValue({ messages: [], hasMore: false, unavailable: false });
  mocks.reads.mockReturnValue({
    select: () => ({ eq: async () => ({ data: [{ user_id: 'other', last_read_at: null }] }) }),
  });
});

describe('private message recovery route', () => {
  it('fails closed before creating a client or reading data when signed out', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.getServerClient).not.toHaveBeenCalled();
    expect(mocks.getUnreadMessageState).not.toHaveBeenCalled();
  });

  it('checks conversation authorization before any conversation data query', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const response = await GET(request(`?conversation_id=${conversationId}`));
    expect(response.status).toBe(404);
    expect(mocks.rpc).toHaveBeenCalledWith('can_access_conversation', { p_conversation: conversationId });
    expect(mocks.getUnreadMessageState).not.toHaveBeenCalled();
    expect(mocks.listMessages).not.toHaveBeenCalled();
    expect(mocks.listMessagesAfter).not.toHaveBeenCalled();
  });

  it('uses the keyset cursor and returns only a private, no-store recovery payload', async () => {
    const response = await GET(request(
      `?conversation_id=${conversationId}&after=2026-10-24T10%3A00%3A00.000Z&after_id=${afterId}`,
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(mocks.listMessagesAfter).toHaveBeenCalledWith(
      expect.anything(),
      conversationId,
      { after: '2026-10-24T10:00:00.000Z', afterId, limit: 100 },
    );
    expect(mocks.listMessages).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      unread: [{ conversation_id: conversationId, unread_count: 2 }],
      messages: [],
      hasMore: false,
    });
  });

  it('keeps the existing bounded initial history page instead of fetching a full thread', async () => {
    const response = await GET(request(`?conversation_id=${conversationId}`));
    expect(response.status).toBe(200);
    expect(mocks.listMessages).toHaveBeenCalledWith(
      expect.anything(),
      conversationId,
      { limit: expect.any(Number) },
    );
    expect(mocks.listMessagesAfter).not.toHaveBeenCalled();
  });

  it('loads only the requested summary and never message history on a summary sync', async () => {
    const response = await GET(request(`?conversation_id=${conversationId}&summary=1`));
    expect(response.status).toBe(200);
    expect(mocks.getConversationSummary).toHaveBeenCalledWith(expect.anything(), conversationId, { profileId: 'me' });
    expect(mocks.listMessages).not.toHaveBeenCalled();
    expect(mocks.listMessagesAfter).not.toHaveBeenCalled();
  });
});
