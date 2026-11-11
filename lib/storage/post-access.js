import 'server-only';
import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { UUID_REGEX } from '@/lib/constants';

// RLS applies community membership, blocks, mutes and moderation visibility.
export async function visiblePost(id) {
  const user = await getActiveUser();
  if (!user?.profile?.id || user.needsProfileSetup) return { status: 401 };
  if (!UUID_REGEX.test(id || '')) return { status: 404 };
  const db = await getServerClient();
  if (!db) return { status: 503 };
  const { data, error } = await db.from('posts').select('id,author_id,status,deleted_at').eq('id', id).maybeSingle();
  if (error || !data || data.status !== 'published' || data.deleted_at) return { status: 404 };
  const visibility = await db.rpc('can_view_post_attachment', { p_post: id });
  if (visibility.error || visibility.data !== true) return { status: 404 };
  return { user, post: data };
}
export function sameOrigin(request) { try { return new URL(request.headers.get('origin')).origin === new URL(request.url).origin; } catch { return false; } }
