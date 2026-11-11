import 'server-only';
import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { UUID_REGEX } from '@/lib/constants';
import { can, toActor } from '@/lib/permissions/authorization';
export async function visibleMarketplaceListing(id) {
  const user=await getActiveUser(); if (!user?.profile?.id || user.needsProfileSetup) return {status:401};
  if (!UUID_REGEX.test(id || '')) return {status:404};
  const db=await getServerClient(); if (!db) return {status:503};
  const row=await db.from('marketplace_listings').select('id,seller_id,status').eq('id',id).maybeSingle();
  if (row.error || !row.data) return {status:404};
  const visible=await db.rpc('can_view_marketplace_images',{p_listing:id}); if (visible.error || visible.data!==true) return {status:404};
  const actor=toActor(user); const canEdit=row.data.seller_id===user.profile.id || can(actor,'moderate_marketplace') || can(actor,'moderate_all');
  return {user,db,listing:row.data,canEdit};
}
