import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getConversation, conversationTitle } from '@/lib/data/messaging';
import { ROUTES, UUID_REGEX, PAGE_SIZE } from '@/lib/constants';
import { PageHeader, Notice, LinkButton, Badge, StaffDot } from '@/components/ui';
import { ChatThread } from '@/components/chat/ChatThread';
import { ConversationActions } from '@/components/chat/ConversationActions';

/**
 * One conversation (spec §21, §22).
 *
 * "Seen" is the only receipt. Message history is always the source of truth —
 * realtime only appends what the database already recorded, so a dropped
 * connection never invents or loses a message.
 */
export async function generateMetadata() {
  return { title: 'Conversation' };
}

export default async function ConversationPage({ params, searchParams }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);

  const query = await searchParams;
  const before = typeof query?.before === 'string' && query.before ? query.before : null;

  const data = await getConversation(supabase, id, {
    profileId: user.profile.id,
    limit: PAGE_SIZE.messages,
    before,
  });

  // No membership (or a blocked/hidden thread) reads as "not found": a private
  // conversation must not disclose that it exists.
  if (!data) notFound();

  const { conversation, members, messages, reads, other, hasMore } = data;
  const isDirect = conversation.kind === 'direct';
  const title = conversationTitle(conversation, other, members);

  let community = null;
  if (conversation.community_id) {
    const { data: row } = await supabase
      .from('communities')
      .select('id, slug, name, kind')
      .eq('id', conversation.community_id)
      .maybeSingle();
    community = row || null;
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={title}
        back={{ href: ROUTES.chat, label: 'Messages' }}
        action={
          // Rendered for every conversation kind, not only direct ones: a
          // group/community chat has no header affordance otherwise, and
          // "report this conversation" is the one entry point the thread
          // relies on (block and the per-other-student report only make
          // sense — and only render — once there is a single other person).
          <ConversationActions
            conversationId={conversation.id}
            otherProfileId={isDirect ? other?.user_id || null : null}
            canReport={can(actor, 'report_content')}
            canBlock={isDirect && can(actor, 'block_users')}
          />
        }
      />

      {isDirect && other ? (
        <p className="flex flex-wrap items-center gap-2 text-2xs text-muted">
          <span>
            Direct message with{' '}
            <Link href={ROUTES.user(other.username)} className="text-ink underline">
              {other.display_name || (other.username ? `@${other.username}` : 'Student')}
            </Link>
          </span>
          {other.is_staff ? <StaffDot label="Campus+ staff" /> : null}
          {members.length > 2 ? <Badge>{members.length} members</Badge> : null}
        </p>
      ) : null}

      {community ? (
        <p className="text-2xs text-muted">
          Community chat for{' '}
          <Link href={ROUTES.community(community.slug)} className="text-ink underline">
            {community.name}
          </Link>
        </p>
      ) : null}

      {conversation.status !== 'published' ? (
        <Notice tone="warning" icon="flag">
          This conversation is {conversation.status}. Only moderators can read it while it is under review.
        </Notice>
      ) : null}

      {before ? (
        <div className="flex items-center justify-between text-2xs text-muted">
          <span>Showing earlier messages</span>
          <LinkButton href={ROUTES.conversation(conversation.id)} size="sm" variant="ghost">
            Jump to latest
          </LinkButton>
        </div>
      ) : hasMore ? (
        <div className="flex justify-center">
          <LinkButton
            href={`${ROUTES.conversation(conversation.id)}?before=${encodeURIComponent(messages[0]?.created_at || '')}`}
            size="sm"
            variant="secondary"
          >
            Load earlier messages
          </LinkButton>
        </div>
      ) : null}

      <ChatThread
        key={conversation.id}
        conversationId={conversation.id}
        currentUserId={user.profile.id}
        initialMessages={messages}
        members={members}
        reads={reads}
        canPost={can(actor, 'send_messages')}
      />

      <p className="pb-2 text-center text-2xs text-muted">
        Messages are text and GIFs only. No presence indicators — just Sent and Seen.
      </p>
    </div>
  );
}
