import { describe, expect, it, vi } from 'vitest';
import {
  authenticateRealtime,
  subscribeToConversationReads,
  subscribeToUserMessaging,
} from '@/lib/messaging/realtime';

function fakeClient() {
  const subscribed = [];
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'session-token' } }, error: null })),
    },
    realtime: { setAuth: vi.fn(async () => {}) },
    removeChannel: vi.fn(async () => {}),
    channel(topic, options) {
      const channel = {
        topic,
        options,
        bindings: [],
        statusCallback: null,
        on(type, filter, callback) {
          this.bindings.push({ type, filter, callback });
          return this;
        },
        subscribe(callback) {
          this.statusCallback = callback;
          subscribed.push(this);
          return this;
        },
      };
      return channel;
    },
  };
  return { client, subscribed };
}

describe('Realtime authentication and user-channel wiring', () => {
  it('hands the authenticated session token to Realtime before subscribing', async () => {
    const { client } = fakeClient();
    await expect(authenticateRealtime(client)).resolves.toBe(true);
    expect(client.realtime.setAuth).toHaveBeenCalledWith('session-token');
  });

  it('fails closed when there is no browser session', async () => {
    const { client } = fakeClient();
    client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(authenticateRealtime(client)).resolves.toBe(false);
    expect(client.realtime.setAuth).not.toHaveBeenCalled();
  });

  it('uses the private per-user topic and existing message/read tables', () => {
    const { client, subscribed } = fakeClient();
    subscribeToUserMessaging(client, 'profile-a', {});
    expect(subscribed).toHaveLength(1);
    expect(subscribed[0].topic).toBe('user:profile-a');
    expect(subscribed[0].options).toEqual({ config: { private: true } });
    expect(subscribed[0].bindings.map((binding) => [binding.filter.table, binding.filter.event])).toEqual([
      ['messages', 'INSERT'],
      ['messages', 'UPDATE'],
      ['message_reads', '*'],
    ]);
    expect(subscribed[0].bindings[2].filter.filter).toBe('user_id=eq.profile-a');
  });

  it('forwards canonical rows and stops every handler after cleanup', () => {
    const { client, subscribed } = fakeClient();
    const onMessage = vi.fn();
    const onOwnRead = vi.fn();
    const onStatus = vi.fn();
    const cleanup = subscribeToUserMessaging(client, 'profile-a', { onMessage, onOwnRead, onStatus });
    const channel = subscribed[0];

    channel.bindings[0].callback({ new: { id: 'm1', conversation_id: 'c1' } });
    channel.bindings[2].callback({ new: { conversation_id: 'c1', user_id: 'profile-a' } });
    channel.statusCallback('SUBSCRIBED');
    expect(onMessage).toHaveBeenCalledWith({ eventType: 'INSERT', message: { id: 'm1', conversation_id: 'c1' } });
    expect(onOwnRead).toHaveBeenCalledTimes(1);
    expect(onStatus.mock.calls[0][0]).toBe('SUBSCRIBED');

    cleanup();
    cleanup();
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
    channel.bindings[0].callback({ new: { id: 'm2', conversation_id: 'c1' } });
    channel.statusCallback('CLOSED');
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledTimes(1);
  });

  it('stops a rejected user channel without retrying or duplicate cleanup', () => {
    const { client, subscribed } = fakeClient();
    const onStatus = vi.fn();
    const cleanup = subscribeToUserMessaging(client, 'profile-a', { onStatus });

    subscribed[0].statusCallback('CHANNEL_ERROR', new Error('Unauthorized'));
    subscribed[0].statusCallback('CHANNEL_ERROR', new Error('Unauthorized'));
    cleanup();

    expect(client.removeChannel).toHaveBeenCalledTimes(1);
    expect(client.removeChannel).toHaveBeenCalledWith(subscribed[0]);
    expect(onStatus).toHaveBeenCalledTimes(1);
  });

  it('does not tear down the user channel for a transient timeout', () => {
    const { client, subscribed } = fakeClient();
    const cleanup = subscribeToUserMessaging(client, 'profile-a', {});

    subscribed[0].statusCallback('TIMED_OUT');
    expect(client.removeChannel).not.toHaveBeenCalled();
    cleanup();
  });
});

describe('active conversation receipt subscriptions', () => {
  it('switching conversations removes the old channel and leaves no stale handler', () => {
    const { client, subscribed } = fakeClient();
    const firstRead = vi.fn();
    const secondRead = vi.fn();

    const cleanupFirst = subscribeToConversationReads(client, 'c1', { onRead: firstRead });
    const first = subscribed[0];
    cleanupFirst();
    subscribeToConversationReads(client, 'c2', { onRead: secondRead });
    const second = subscribed[1];

    expect(first.topic).toBe('conversation:c1');
    expect(second.topic).toBe('conversation:c2');
    expect(first.bindings[0].filter.filter).toBe('conversation_id=eq.c1');
    expect(second.bindings[0].filter.filter).toBe('conversation_id=eq.c2');

    first.bindings[0].callback({ new: { user_id: 'other', conversation_id: 'c1' } });
    second.bindings[0].callback({ new: { user_id: 'other', conversation_id: 'c2' } });
    expect(firstRead).not.toHaveBeenCalled();
    expect(secondRead).toHaveBeenCalledTimes(1);
    expect(client.removeChannel).toHaveBeenCalledWith(first);
  });

  it('applies the same permanent-authorization teardown to receipt channels', () => {
    const { client, subscribed } = fakeClient();
    const cleanup = subscribeToConversationReads(client, 'c1', {});

    subscribed[0].statusCallback('CHANNEL_ERROR', new Error('42501 permission denied'));
    cleanup();

    expect(client.removeChannel).toHaveBeenCalledTimes(1);
    expect(client.removeChannel).toHaveBeenCalledWith(subscribed[0]);
  });
});
