import 'server-only';
import { getAdminClient } from '@/lib/supabase/admin';
import { deleteFileByUploadKeyV3 } from '@/lib/storage';

function admin() { const db = getAdminClient(); if (!db) throw Error('storage_unavailable'); return db; }
export async function marketplaceFiles(listing) {
  const db = admin();
  const {data:links,error} = await db.from('marketplace_attachment_links').select('file_id,position').eq('listing_id',listing).order('position');
  if (error) throw Error('storage_unavailable');
  if (!links?.length) return [];
  const result = await db.from('storage_files').select('id,original_name,mime_type,byte_size,checksum').eq('resource_type','marketplace_image').eq('resource_id',listing).eq('status','ready').in('id',links.map((l) => l.file_id));
  if (result.error) throw Error('storage_unavailable');
  const map = new Map((result.data || []).map((file) => [file.id,file]));
  return links.map((link) => map.get(link.file_id)).filter(Boolean);
}
export async function marketplaceFile(listing,file) {
  const db=admin();
  const link=await db.from('marketplace_attachment_links').select('file_id').eq('listing_id',listing).eq('file_id',file).maybeSingle();
  if (link.error) throw Error('storage_unavailable'); if (!link.data) return null;
  const row=await db.from('storage_files').select('id,original_name,mime_type,byte_size,checksum,provider_file_id').eq('id',file).eq('resource_type','marketplace_image').eq('resource_id',listing).eq('status','ready').maybeSingle();
  if (row.error) throw Error('storage_unavailable'); return row.data;
}
export async function cleanupMarketplaceFile(file) {
  const db=admin();
  const {data,error}=await db.from('storage_files').select('id,gateway_key').eq('id',file).eq('resource_type','marketplace_image').eq('status','delete_pending').maybeSingle();
  if (error) throw Error('storage_unavailable'); if (!data) return true;
  try {
    const mark=await db.from('storage_files').update({cleanup_attempted_at:new Date().toISOString()}).eq('id',file).eq('status','delete_pending'); if (mark.error || !data.gateway_key) throw Error();
    await deleteFileByUploadKeyV3(data.gateway_key);
    const result=await db.rpc('storage_complete_marketplace_image_delete',{p_file:file}); if (result.error) throw Error(); return true;
  } catch { return false; }
}
export async function reconcileMarketplaceFiles() {
  const result=await admin().from('storage_files').select('id').eq('resource_type','marketplace_image').eq('status','delete_pending').order('cleanup_attempted_at',{ascending:true,nullsFirst:true}).order('created_at').limit(20);
  if (result.error) throw Error('storage_unavailable');
  let retryPending=(result.data?.length || 0)===20;
  for (const row of result.data || []) if (!await cleanupMarketplaceFile(row.id)) retryPending=true;
  return {processed:result.data?.length || 0,retryPending};
}
