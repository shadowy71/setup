/**
 * Supabase Realtime wiring for the existing messaging tables.
 *
 * Channel topics match migration 014. Postgres Changes still enforce each
 * table's SELECT RLS policy; private-channel authorization is an additional
 * boundary, never a replacement for messaging RLS.
 */

/** Explicitly hand the current session to Realtime before creating a channel. */
export async function authenticateRealtime(client) {
  if (!client) return false;
  const { data, error } = await client.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) return false;
  await client.realtime.setAuth(token);
  return true;
}

/** One shell-scoped channel for all conversations visible to this user by RLS. */
export function subscribeToUserMessaging(client, userId, { onMessage, onOwnRead, onStatus }) {
  let disposed = false;
  const status = (value, error) => {
    if (!disposed) onStatus?.(value, error);
  };
  const channel = client
    .channel(`user:${userId}`, { config: { private: true } })
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        if (!disposed && payload.new?.conversation_id) onMessage?.({ eventType: 'INSERT', message: payload.new });
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages' },
      (payload) => {
        if (!disposed && payload.new?.conversation_id) onMessage?.({ eventType: 'UPDATE', message: payload.new });
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'message_reads', filter: `user_id=eq.${userId}` },
      (payload) => {
        if (!disposed && payload.new?.conversation_id) onOwnRead?.(payload.new);
      },
    )
    .subscribe(status);

  return () => {
    if (disposed) return;
    disposed = true;
    void client.removeChannel(channel);
  };
}

/** Active-thread Seen receipts; message rows arrive on the user channel above. */
export function subscribeToConversationReads(client, conversationId, { onRead, onStatus }) {
  let disposed = false;
  const channel = client
    .channel(`conversation:${conversationId}`, { config: { private: true } })
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'message_reads', filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        if (!disposed && payload.new?.user_id) onRead?.(payload.new);
      },
    )
    .subscribe((status, error) => {
      if (!disposed) onStatus?.(status, error);
    });

  return () => {
    if (disposed) return;
    disposed = true;
    void client.removeChannel(channel);
  };
}
