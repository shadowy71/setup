'use server';

/**
 * Direct and group messaging (spec §19, §20).
 *
 * Direct conversations are created by `get_or_create_direct_conversation()`,
 * which owns the canonical `direct_key` and the block check. Messages are plain
 * inserts (RLS proves membership); Seen receipts are written by
 * `mark_conversation_read()`. `messages_update_sender` allows edits for fifteen
 * minutes and every edit keeps its history in `message_edits`.
 */

import { revalidatePath } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';
import { enforceRateLimit } from '@/lib/ratelimit';
import { notifyConversation } from '@/lib/notifications';
import { ROUTES, UUID_REGEX } from '@/lib/constants';
import { MESSAGE_COLUMNS } from '@/lib/data/messaging';
import { validate, messageSchema, gifRefValidator } from '@/lib/validation/schemas';

/** Start (or reopen) the single direct conversation with another student. */
export async function startConversation(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const other = String(formData.get('profile_id') || '');
    if (!other) throw errors.validation('Choose someone to message.');
    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('get_or_create_direct_conversation', { p_other: other });
    if (error) throw fromPostgresError(error, { rls: 'You cannot message this student.' });
    return { ok: true, conversationId: data, href: ROUTES.conversation(data) };
  } catch (error) {
    return toActionError(error, 'That conversation could not be started.');
  }
}

export async function sendMessage(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const conversationId = String(formData.get('conversation_id') || '');
    const messageId = String(formData.get('message_id') || '');
    // The browser may choose the row's UUID so its optimistic copy and the
    // canonical Realtime row have the same key. This is not an authorization
    // input: membership and sender identity are still enforced below by RLS.
    if (messageId && !UUID_REGEX.test(messageId)) throw errors.validation('That message id is not valid.');
    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'message_send', user.profile.id);

    const checked = validate(
      { body: formData.get('body') || '', gif: formData.get('gif') || null },
      { ...messageSchema, gif: gifRefValidator },
    );
    if (!checked.ok) throw errors.validation('Write a message first.', checked.errors);
    const values = checked.data;
    if (!values.body?.trim() && !values.gif) throw errors.validation('Write a message or pick a GIF.');

    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        ...(messageId ? { id: messageId } : {}),
        conversation_id: conversationId,
        sender_id: user.profile.id,
        body: values.body || '',
        gif: values.gif || null,
        status: 'published',
      })
      .select(MESSAGE_COLUMNS)
      .single();
    if (error) {
      // If the first response was lost after commit, retrying the same final
      // UUID is an idempotent read of this user's own row — not a second send
      // and not a way to adopt anybody else's message.
      if (messageId && error.code === '23505') {
        const { data: existing, error: lookupError } = await supabase
          .from('messages')
          .select(MESSAGE_COLUMNS)
          .eq('id', messageId)
          .eq('conversation_id', conversationId)
          .eq('sender_id', user.profile.id)
          .maybeSingle();
        if (!lookupError && existing) {
          revalidatePath(ROUTES.conversation(conversationId));
          revalidatePath(ROUTES.chat);
          return { ok: true, id: existing.id, message: existing };
        }
      }
      throw fromPostgresError(error, { rls: 'You cannot post in this conversation.' });
    }

    const { data: members } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId);

    await notifyConversation(supabase, {
      memberIds: (members || []).map((row) => row.user_id),
      senderId: user.profile.id,
      senderName: user.profile.display_name || `@${user.profile.username}`,
      conversationId,
      preview: values.body,
    });

    if (values.gif && !values.body?.trim()) {
      // A GIF-only message still says something; keep the action honest.
    }

    revalidatePath(ROUTES.conversation(conversationId));
    revalidatePath(ROUTES.chat);
    return { ok: true, id: message.id, message };
  } catch (error) {
    return toActionError(error, 'That message was not sent.');
  }
}

export async function editMessage(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const conversationId = String(formData.get('conversation_id') || '');
    const body = String(formData.get('body') || '').trim();
    if (!body) throw errors.validation('A message cannot be empty.');
    if (body.length > 2000) throw errors.validation('That message is too long.');
    const supabase = await getServerClient();
    const { error } = await supabase.from('messages').update({ body }).eq('id', id);
    if (error) throw fromPostgresError(error, { rls: 'That message can no longer be edited.' });
    revalidatePath(ROUTES.conversation(conversationId));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteMessage(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const conversationId = String(formData.get('conversation_id') || '');
    const supabase = await getServerClient();
    // Soft delete: `soften_deleted_message` keeps the row and its moderation
    // value intact (spec §21).
    const { error } = await supabase.rpc('delete_own_content', { p_target_type: 'message', p_target_id: id });
    if (error) throw fromPostgresError(error);
    revalidatePath(ROUTES.conversation(conversationId));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function markConversationRead(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const conversationId = String(formData.get('conversation_id') || '');
    const supabase = await getServerClient();
    const { data: readAt, error } = await supabase.rpc('mark_conversation_read', { p_conversation: conversationId });
    if (error) throw fromPostgresError(error);
    return { ok: true, readAt };
  } catch (error) {
    return toActionError(error);
  }
}

export async function toggleMuteConversation(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const conversationId = String(formData.get('conversation_id') || '');
    const muted = String(formData.get('muted') || 'false') === 'true';
    const supabase = await getServerClient();
    const { error } = await supabase
      .from('conversation_members')
      .update({ is_muted: !muted })
      .eq('conversation_id', conversationId)
      .eq('user_id', user.profile.id);
    if (error) throw fromPostgresError(error);
    revalidatePath(ROUTES.conversation(conversationId));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
