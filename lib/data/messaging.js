import 'server-only';

/**
 * Read helpers for the single messaging system (spec §21).
 *
 * Conversations are either `direct` (exactly two students, canonical pair key)
 * or `group` (community chat, study group). Everything here runs as the signed-in
 * student, so RLS decides which conversations and messages exist for them —
 * including the rule that a blocked pair cannot read each other's threads.
 */

import { PAGE_SIZE } from '@/lib/constants';

export { conversationTitle } from '@/lib/messaging/state';

export const MESSAGE_COLUMNS = 'id, conversation_id, sender_id, body, gif, status, edited_at, deleted_at, created_at';
export const CONVERSATION_COLUMNS = 'id, kind, title, community_id, status, last_message_at, created_at';

/** Active memberships of the signed-in student. */
export async function getMemberships(supabase, profileId) {
  if (!profileId) return [];
  const { data } = await supabase
    .from('conversation_members')
    .select('conversation_id, role, status, is_muted, last_read_at, last_read_message_id')
    .eq('user_id', profileId)
    .eq('status', 'active');
  return data || [];
}

/**
 * Conversation list with the newest message and an unread marker.
 *
 * `conversation_inbox()` (migrations 020 and 026) is the read model: one
 * RLS-scoped row per visible conversation with the newest message and exact
 * unread count. It replaces fetching full message pages per conversation — the
 * thread view still reads `messages` directly.
 */
export async function listConversations(supabase, profileId, { limit = 30 } = {}) {
  const memberships = await getMemberships(supabase, profileId);
  if (!memberships.length) return { conversations: [], unavailable: false };

  const membershipByConversation = new Map(memberships.map((m) => [m.conversation_id, m]));

  const [inboxResult, memberResult] = await Promise.all([
    supabase.rpc('conversation_inbox', { p_limit: limit }),
    supabase
      .from('conversation_members')
      .select('conversation_id, user_id, role, last_read_at')
      .in('conversation_id', [...membershipByConversation.keys()])
      .eq('status', 'active'),
  ]);

  const { data: rows, error } = inboxResult;
  if (error) return { conversations: [], unavailable: true };

  const conversations = rows || [];
  if (!conversations.length) return { conversations: [], unavailable: false };

  const members = memberResult.data || [];
  const personIds = [...new Set(members.map((member) => member.user_id))];
  const { data: people } = personIds.length
    ? await supabase.from('public_profiles').select('id, username, display_name, is_staff').in('id', personIds)
    : { data: [] };
  const personById = new Map((people || []).map((person) => [person.id, person]));

  const membersByConversation = new Map();
  for (const member of members) {
    if (!membersByConversation.has(member.conversation_id)) membersByConversation.set(member.conversation_id, []);
    membersByConversation.get(member.conversation_id).push({
      ...member,
      username: personById.get(member.user_id)?.username || null,
      display_name: personById.get(member.user_id)?.display_name || null,
      is_staff: personById.get(member.user_id)?.is_staff === true,
    });
  }

  return {
    conversations: conversations.map((conversation) => {
      const membership = membershipByConversation.get(conversation.id) || {};
      const membersOfConversation = membersByConversation.get(conversation.id) || [];
      const others = membersOfConversation.filter((member) => member.user_id !== profileId);
      const unread = conversation.unread || 0;
      const lastMessage = conversation.last_message_created_at
        ? {
            id: conversation.last_message_id,
            conversation_id: conversation.id,
            sender_id: conversation.last_message_sender_id,
            body: conversation.last_message_body,
            gif: conversation.last_message_gif,
            created_at: conversation.last_message_created_at,
          }
        : null;

      return {
        id: conversation.id,
        kind: conversation.kind,
        title: conversation.title,
        community_id: conversation.community_id,
        status: conversation.status,
        last_message_at: conversation.last_message_at,
        created_at: conversation.created_at,
        is_muted: membership.is_muted === true || conversation.is_muted === true,
        members: membersOfConversation,
        other: conversation.kind === 'direct' ? others[0] || null : null,
        lastMessage,
        unread,
      };
    }),
    unavailable: false,
  };
}

/** Body-free, exact unread snapshot for the navigation badge and reconnects. */
export async function getUnreadMessageState(supabase) {
  const { data, error } = await supabase.rpc('messaging_unread_counts');
  return { rows: data || [], unavailable: Boolean(error) };
}

/** Total unread direct/group messages for callers that need only the scalar. */
export async function getUnreadMessageTotal(supabase) {
  const { rows } = await getUnreadMessageState(supabase);
  return rows.reduce((total, row) => total + (row.unread_count || 0), 0);
}

/** Lightweight previews used only to reconcile an inbox after a connection gap. */
export async function listInboxRealtimeRows(supabase, { limit = 50 } = {}) {
  const { data, error } = await supabase.rpc('conversation_inbox', { p_limit: limit });
  return { rows: data || [], unavailable: Boolean(error) };
}

/** Conversation header data plus a page of messages, oldest → newest. */
export async function getConversation(
  supabase,
  conversationId,
  { profileId, limit = PAGE_SIZE.messages, before = null } = {},
) {
  const { data: conversation } = await supabase
    .from('conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('id', conversationId)
    .maybeSingle();
  if (!conversation) return null;

  const messageQuery = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) messageQuery.lt('created_at', before);

  const [{ data: memberRows }, { data: messageRows }, { data: readRows }] = await Promise.all([
    supabase
      .from('conversation_members')
      .select('conversation_id, user_id, role, status, is_muted, last_read_at')
      .eq('conversation_id', conversationId),
    messageQuery,
    supabase
      .from('message_reads')
      .select('user_id, last_read_at, last_message_id')
      .eq('conversation_id', conversationId),
  ]);

  const memberList = (memberRows || []).filter((member) => member.status === 'active');
  const personIds = [...new Set(memberList.map((member) => member.user_id))];
  const { data: people } = personIds.length
    ? await supabase.from('public_profiles').select('id, username, display_name, is_staff').in('id', personIds)
    : { data: [] };
  const personById = new Map((people || []).map((person) => [person.id, person]));

  // Enrich once; `other` must be derived from these profile-joined rows, not
  // the raw `memberList` (which only carries conversation_members columns —
  // no username/display_name at all). Deriving `other` from the raw list was
  // the root cause of the conversation header rendering "@undefined": the
  // display-name fallback `other.display_name || `@${other.username}`` had
  // both properties literally absent (JS `undefined`, not `null`) on the raw
  // row, so the template literal stringified `undefined` itself.
  const enrichedMembers = memberList.map((member) => ({
    ...member,
    username: personById.get(member.user_id)?.username || null,
    display_name: personById.get(member.user_id)?.display_name || null,
    is_staff: personById.get(member.user_id)?.is_staff === true,
  }));

  const messages = (messageRows || []).slice().reverse();
  return {
    conversation,
    members: enrichedMembers,
    reads: readRows || [],
    messages,
    hasMore: Boolean(messageRows && messageRows.length === limit),
    myMembership: memberList.find((member) => member.user_id === profileId) || null,
    other: conversation.kind === 'direct' ? enrichedMembers.find((member) => member.user_id !== profileId) || null : null,
  };
}

/**
 * One inbox summary, fetched only when Realtime introduces a conversation that
 * is not already rendered. No message history is loaded on this path.
 */
export async function getConversationSummary(supabase, conversationId, { profileId } = {}) {
  const { data: conversation } = await supabase
    .from('conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('id', conversationId)
    .maybeSingle();
  if (!conversation) return null;

  const [{ data: memberRows }, { data: latestRows }] = await Promise.all([
    supabase
      .from('conversation_members')
      .select('conversation_id, user_id, role, status, is_muted, last_read_at')
      .eq('conversation_id', conversationId)
      .eq('status', 'active'),
    supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  const members = memberRows || [];
  const personIds = [...new Set(members.map((member) => member.user_id))];
  const { data: people } = personIds.length
    ? await supabase.from('public_profiles').select('id, username, display_name, is_staff').in('id', personIds)
    : { data: [] };
  const personById = new Map((people || []).map((person) => [person.id, person]));
  const enriched = members.map((member) => ({
    ...member,
    username: personById.get(member.user_id)?.username || null,
    display_name: personById.get(member.user_id)?.display_name || null,
    is_staff: personById.get(member.user_id)?.is_staff === true,
  }));
  const others = enriched.filter((member) => member.user_id !== profileId);
  const myMembership = enriched.find((member) => member.user_id === profileId) || null;

  return {
    ...conversation,
    is_muted: myMembership?.is_muted === true,
    members: enriched,
    other: conversation.kind === 'direct' ? others[0] || null : null,
    lastMessage: latestRows?.[0] || null,
    unread: 0,
  };
}

/**
 * Missing rows after a (created_at, id) cursor. The id tie-breaker prevents a
 * burst within one timestamp from being skipped during reconnect recovery.
 */
export async function listMessagesAfter(
  supabase,
  conversationId,
  { after, afterId, limit = 100 } = {},
) {
  let query = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit + 1);

  if (after) {
    query = query.or(`created_at.gt.${after},and(created_at.eq.${after},id.gt.${afterId})`);
  }

  const { data, error } = await query;
  const rows = data || [];
  return {
    messages: rows.slice(0, limit),
    hasMore: rows.length > limit,
    unavailable: Boolean(error),
  };
}

/** Older page of a thread (used by "Load earlier messages"). */
export async function listMessages(supabase, conversationId, { limit = PAGE_SIZE.messages, before } = {}) {
  const query = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query.lt('created_at', before);
  const { data } = await query;
  return (data || []).slice().reverse();
}
