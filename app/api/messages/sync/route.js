import { NextResponse } from 'next/server';
import { BLOCKED_STATUSES, getCurrentUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import {
  getConversationSummary,
  getUnreadMessageState,
  listInboxRealtimeRows,
  listMessages,
  listMessagesAfter,
} from '@/lib/data/messaging';
import { PAGE_SIZE, UUID_REGEX } from '@/lib/constants';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
};
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

/**
 * GET /api/messages/sync
 *
 * Authenticated, RLS-scoped gap recovery. It returns an exact unread snapshot
 * and, only when requested, newer messages after a cursor or one missing inbox
 * summary. It never returns another user's data and is never publicly cached.
 */
export async function GET(request) {
  try {
    const user = await getCurrentUser();
    if (!user?.profile) return json({ ok: false }, 401);
    if (user.needsProfileSetup || BLOCKED_STATUSES.includes(user.accountStatus)) {
      return json({ ok: false }, 403);
    }

    const supabase = await getServerClient();
    if (!supabase) return json({ ok: false }, 503);

    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversation_id');
    const after = url.searchParams.get('after');
    const rawAfterId = url.searchParams.get('after_id');
    const summary = url.searchParams.get('summary') === '1';
    const inbox = url.searchParams.get('inbox') === '1';

    if (conversationId && !UUID_REGEX.test(conversationId)) return json({ ok: false }, 400);
    if (after && !Number.isFinite(Date.parse(after))) return json({ ok: false }, 400);
    if (rawAfterId && !UUID_REGEX.test(rawAfterId)) return json({ ok: false }, 400);
    const afterId = rawAfterId || ZERO_UUID;
    const normalizedAfter = after ? new Date(after).toISOString() : null;

    let allowed = true;
    if (conversationId) {
      const { data, error } = await supabase.rpc('can_access_conversation', { p_conversation: conversationId });
      if (error) return json({ ok: false }, 503);
      allowed = data === true;
      if (!allowed) return json({ ok: false }, 404);
    }

    const unreadTask = getUnreadMessageState(supabase);
    const inboxTask = inbox ? listInboxRealtimeRows(supabase) : Promise.resolve(null);
    const summaryTask = conversationId && summary
      ? getConversationSummary(supabase, conversationId, { profileId: user.profile.id })
      : Promise.resolve(null);
    const messagesTask = conversationId && !summary
      ? normalizedAfter
        ? listMessagesAfter(supabase, conversationId, { after: normalizedAfter, afterId, limit: 100 })
        : listMessages(supabase, conversationId, { limit: PAGE_SIZE.messages }).then((messages) => ({
            messages,
            hasMore: false,
            unavailable: false,
          }))
      : Promise.resolve(null);
    const readsTask = conversationId && !summary
      ? supabase
          .from('message_reads')
          .select('user_id, last_read_at, last_message_id')
          .eq('conversation_id', conversationId)
      : Promise.resolve(null);

    const [unread, inboxResult, conversation, messageResult, readResult] = await Promise.all([
      unreadTask,
      inboxTask,
      summaryTask,
      messagesTask,
      readsTask,
    ]);

    if (unread.unavailable || inboxResult?.unavailable || messageResult?.unavailable) {
      return json({ ok: false }, 503);
    }
    if (summary && conversationId && !conversation) return json({ ok: false }, 404);

    return json({
      ok: true,
      unread: unread.rows,
      inbox: inboxResult?.rows,
      conversation,
      messages: messageResult?.messages,
      hasMore: messageResult?.hasMore,
      reads: readResult?.data || (conversationId && !summary ? [] : undefined),
    });
  } catch {
    return json({ ok: false }, 503);
  }
}
