import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { PAGE_SIZE } from '@/lib/constants';
import { PageHeader, LinkButton } from '@/components/ui';
import { NotificationList, NotificationError } from '@/components/notifications/NotificationList';

export const metadata = { title: 'Notifications' };

/**
 * Notifications (spec §47).
 *
 * One list, newest first, with unread state and deep links. RLS guarantees a
 * student only ever reads their own rows; `notify_user()` is the only writer.
 */
export default async function NotificationsPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const params = await searchParams;
  const offset = Math.max(0, Number.parseInt(params?.offset || '0', 10) || 0);
  const limit = PAGE_SIZE.notifications;

  const { data, error, count } = await supabase
    .from('notifications')
    .select('id, type, title, body, url, reference_type, reference_id, actor_id, read_at, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  // Only ordinary person-to-person activity gets an actor avatar. Moderation,
  // system and official notifications never disclose a staff actor here.
  const personTypes = new Set(['dm_new', 'mention', 'comment', 'reply', 'reaction', 'marketplace_message', 'marketplace_rating', 'community_activity', 'club_activity']);
  const actorIds = [...new Set((data || []).filter((row) => personTypes.has(row.type) && row.actor_id).map((row) => row.actor_id))];
  const { data: actors } = actorIds.length ? await supabase.from('public_profiles').select('id,username,display_name,is_active').in('id', actorIds).eq('is_active', true) : { data: [] };
  const byId = new Map((actors || []).map((actor) => [actor.id, actor]));
  const items = (data || []).map(({ actor_id, ...row }) => ({ ...row, actor: personTypes.has(row.type) ? byId.get(actor_id) || null : null }));
  const hasMore = typeof count === 'number' ? offset + items.length < count : items.length === limit;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Notifications"
        description="Replies, mentions, messages and official updates addressed to you."
      />

      {error ? (
        <NotificationError />
      ) : (
        <>
          <NotificationList items={items} />

          {hasMore ? (
            <div className="flex justify-center">
              <LinkButton href={`/notifications?offset=${offset + limit}`} size="sm" variant="secondary">
                Older notifications
              </LinkButton>
            </div>
          ) : null}
          {offset > 0 ? (
            <p className="text-center">
              <LinkButton href="/notifications" size="sm" variant="ghost">
                Back to the newest
              </LinkButton>
            </p>
          ) : null}
        </>
      )}

      <p className="pb-2 text-center text-2xs text-muted">
        Signed in as @{user.profile.username} · notification prefs live in Settings.
      </p>
    </div>
  );
}
