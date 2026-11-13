import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listConversations } from '@/lib/data/messaging';
import { PageHeader, Notice } from '@/components/ui';
import { NewConversation } from '@/components/chat/NewConversation';
import { ConversationList } from '@/components/chat/ConversationList';

export const metadata = { title: 'Messages' };

/**
 * Messages (spec §21).
 *
 * One inbox for every conversation kind: direct messages, community chats and
 * study groups. Sellers, organizers and project creators are all reached through
 * this same DM system — there is no separate "contact" channel anywhere.
 */
export default async function ChatPage() {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const { conversations, unavailable } = await listConversations(supabase, user.profile.id);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Messages"
        description="Direct messages, community chats and study groups."
      />

      <NewConversation canMessage={can(actor, 'send_messages')} />

      {unavailable ? (
        <Notice tone="warning" icon="flag">
          Messages could not be loaded right now. Refresh to try again.
        </Notice>
      ) : null}

      {!unavailable ? (
        <ConversationList initialConversations={conversations} currentUserId={user.profile.id} />
      ) : null}
    </div>
  );
}
