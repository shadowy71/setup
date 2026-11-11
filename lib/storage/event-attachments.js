import 'server-only';
import { getAdminClient } from '@/lib/supabase/admin';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getActiveUser } from '@/lib/auth/session';
import { UUID_REGEX } from '@/lib/constants';
import { deleteFileByUploadKeyV3 } from '@/lib/storage';

function admin() { const db=getAdminClient(); if (!db) throw Error('storage_unavailable'); return db; }
export async function visibleEvent(id) {
  const user=await getActiveUser(); if (!user?.profile?.id || user.needsProfileSetup) return {status:401};
  if (!UUID_REGEX.test(id || '')) return {status:404};
  const db=await getServerClient(); if (!db) return {status:503};
  // The session query is authoritative, including expiry and staff draft visibility.
  const {data,error}=await db.from('events').select('id,status,created_by,is_official,club_id').eq('id',id).maybeSingle();
  if (error || !data) return {status:404};
  const staff=can(toActor(user),'manage_events') || can(toActor(user),'moderate_all');
  let clubManager=false;
  if (data.status === 'draft' && data.club_id) {
    const result=await db.rpc('can_manage_club',{p_club:data.club_id});
    clubManager=!result.error && result.data === true;
  }
  const canManage=staff || (data.status === 'draft' && ((!data.is_official && data.created_by === user.profile.id) || clubManager));
  return {user,db,post:data,canManage};
}
export async function eventFiles(post) {
  const db=admin(); const links=await db.from('event_attachment_links').select('file_id,position').eq('post_id',post).order('position');
  if (links.error) throw Error('storage_unavailable'); if (!links.data?.length) return [];
  const rows=await db.from('storage_files').select('id,original_name,mime_type,byte_size,checksum').eq('resource_type','event_attachment').eq('resource_id',post).eq('status','ready').in('id',links.data.map(l=>l.file_id));
  if (rows.error) throw Error('storage_unavailable'); const map=new Map((rows.data || []).map(f=>[f.id,f])); return links.data.map(l=>map.get(l.file_id)).filter(Boolean);
}
export async function eventFile(post,file) {
  const db=admin(); const link=await db.from('event_attachment_links').select('file_id').eq('post_id',post).eq('file_id',file).maybeSingle();
  if (link.error) throw Error('storage_unavailable'); if (!link.data) return null;
  const row=await db.from('storage_files').select('id,original_name,mime_type,byte_size,checksum,provider_file_id').eq('id',file).eq('resource_type','event_attachment').eq('resource_id',post).eq('status','ready').maybeSingle();
  if (row.error) throw Error('storage_unavailable'); return row.data;
}
export async function cleanEventFile(file) {
  const db=admin(); const {data,error}=await db.from('storage_files').select('id,gateway_key').eq('id',file).eq('resource_type','event_attachment').eq('status','delete_pending').maybeSingle();
  if(error) throw Error('storage_unavailable'); if(!data) return true;
  try { const marked=await db.from('storage_files').update({cleanup_attempted_at:new Date().toISOString()}).eq('id',file).eq('status','delete_pending'); if(marked.error || !data.gateway_key) throw Error(); await deleteFileByUploadKeyV3(data.gateway_key); const done=await db.rpc('storage_complete_event_attachment_delete',{p_file:file}); if(done.error) throw Error(); return true; } catch { return false; }
}
export async function reconcileEventFiles() {
  const {data,error}=await admin().from('storage_files').select('id').eq('resource_type','event_attachment').eq('status','delete_pending').order('cleanup_attempted_at',{ascending:true,nullsFirst:true}).order('created_at').limit(20);
  if(error) throw Error('storage_unavailable'); let retryPending=(data?.length || 0)===20;
  for(const row of data || []) if(!await cleanEventFile(row.id)) retryPending=true;
  return {processed:data?.length || 0,retryPending};
}
