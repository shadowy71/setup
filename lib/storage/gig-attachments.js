import 'server-only';
import { getAdminClient } from '@/lib/supabase/admin';
import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { UUID_REGEX } from '@/lib/constants';
import { deleteFileByUploadKeyV3 } from '@/lib/storage';

function admin() { const db=getAdminClient(); if (!db) throw Error('storage_unavailable'); return db; }
export async function visibleGig(id) {
  const user=await getActiveUser(); if (!user?.profile?.id || user.needsProfileSetup) return {status:401};
  if (!UUID_REGEX.test(id || '')) return {status:404};
  const db=await getServerClient(); if (!db) return {status:503};
  const {data,error}=await db.from('gigs').select('id,creator_id,status').eq('id',id).maybeSingle();
  if (error || !data || (data.status !== 'published' && data.creator_id !== user.profile.id)) return {status:404};
  // Do not expose attachments for blocked or inactive creators even to a
  // privileged RLS viewer. The creator can still manage their own images.
  if (data.creator_id !== user.profile.id) {
    const profile=await db.from('public_profiles').select('id').eq('id',data.creator_id).maybeSingle();
    if (profile.error || !profile.data) return {status:404};
  }
  return {user,db,post:data};
}
export async function gigFiles(post) {
  const db=admin(); const links=await db.from('gig_attachment_links').select('file_id,position').eq('post_id',post).order('position');
  if (links.error) throw Error('storage_unavailable'); if (!links.data?.length) return [];
  const rows=await db.from('storage_files').select('id,original_name,mime_type,byte_size,checksum').eq('resource_type','gig_attachment').eq('resource_id',post).eq('status','ready').in('id',links.data.map(l=>l.file_id));
  if (rows.error) throw Error('storage_unavailable'); const map=new Map((rows.data || []).map(f=>[f.id,f])); return links.data.map(l=>map.get(l.file_id)).filter(Boolean);
}
export async function gigFile(post,file) {
  const db=admin(); const link=await db.from('gig_attachment_links').select('file_id').eq('post_id',post).eq('file_id',file).maybeSingle();
  if (link.error) throw Error('storage_unavailable'); if (!link.data) return null;
  const row=await db.from('storage_files').select('id,original_name,mime_type,byte_size,checksum,provider_file_id').eq('id',file).eq('resource_type','gig_attachment').eq('resource_id',post).eq('status','ready').maybeSingle();
  if (row.error) throw Error('storage_unavailable'); return row.data;
}
export async function cleanGigFile(file) {
  const db=admin(); const {data,error}=await db.from('storage_files').select('id,gateway_key').eq('id',file).eq('resource_type','gig_attachment').eq('status','delete_pending').maybeSingle();
  if(error) throw Error('storage_unavailable'); if(!data) return true;
  try { const marked=await db.from('storage_files').update({cleanup_attempted_at:new Date().toISOString()}).eq('id',file).eq('status','delete_pending'); if(marked.error || !data.gateway_key) throw Error(); await deleteFileByUploadKeyV3(data.gateway_key); const done=await db.rpc('storage_complete_gig_attachment_delete',{p_file:file}); if(done.error) throw Error(); return true; } catch { return false; }
}
export async function reconcileGigFiles() {
  const {data,error}=await admin().from('storage_files').select('id').eq('resource_type','gig_attachment').eq('status','delete_pending').order('cleanup_attempted_at',{ascending:true,nullsFirst:true}).order('created_at').limit(20);
  if(error) throw Error('storage_unavailable'); let retryPending=(data?.length || 0)===20;
  for(const row of data || []) if(!await cleanGigFile(row.id)) retryPending=true;
  return {processed:data?.length || 0,retryPending};
}
