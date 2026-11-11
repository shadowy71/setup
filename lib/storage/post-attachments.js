import 'server-only';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { getAdminClient } from '@/lib/supabase/admin';
import { uploadFileV3, downloadFile, deleteFileByUploadKeyV3 } from '@/lib/storage';
import { validateFile } from '@/lib/storage/validation';

function admin() { const client = getAdminClient(); if (!client) throw Error('storage_unavailable'); return client; }
async function rpc(client, name, args) { const { data, error } = await client.rpc(name, args); if (error) throw Error('storage_unavailable'); return data; }
export async function listPostAttachments(post) {
  const db = admin();
  const { data: links, error: linkError } = await db.from('post_attachment_links').select('file_id,position').eq('post_id', post).order('position');
  if (linkError) throw Error('storage_unavailable');
  if (!links?.length) return [];
  const { data, error } = await db.from('storage_files').select('id,original_name,mime_type,byte_size,checksum').eq('resource_type', 'post_attachment').eq('resource_id', post).eq('status', 'ready').in('id', links.map((link) => link.file_id));
  if (error) throw Error('storage_unavailable');
  const byId = new Map((data || []).map((file) => [file.id, file]));
  return links.map((link) => byId.get(link.file_id)).filter(Boolean);
}
export async function reorderPostAttachments(owner, post, files) {
  await rpc(admin(), 'storage_reorder_post_attachments', { p_owner: owner, p_post: post, p_files: files });
}
export async function getPostAttachment(post, file) {
  const db = admin();
  const link = await db.from('post_attachment_links').select('file_id').eq('post_id', post).eq('file_id', file).maybeSingle();
  if (link.error) throw Error('storage_unavailable');
  if (!link.data) return null;
  const { data, error } = await db.from('storage_files').select('id,original_name,mime_type,byte_size,checksum,provider_file_id').eq('id', file).eq('resource_type', 'post_attachment').eq('resource_id', post).eq('status', 'ready').maybeSingle();
  if (error) throw Error('storage_unavailable');
  return data;
}
export async function savePostAttachment({ owner, post, draft = null, requestId, name, mime, bytes }) {
  if (!validateFile({ name, mime, bytes }).ok) throw Error('invalid_file');
  if (mime !== 'application/pdf') {
    try { const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 16000000, animated: false }); const m = await image.metadata();
      if (m.format !== ({ 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' })[mime] || !m.width || !m.height || (m.pages || 1) !== 1) throw Error();
      await image.resize(1, 1).raw().toBuffer();
    } catch { throw Error('invalid_file'); }
  }
  const db = admin();
  const { data: rate, error: rateError } = await db.rpc('consume_rate_limit', { p_bucket: 'post_attachment_upload', p_key: owner, p_limit: 30, p_window_seconds: 3600 });
  if (rateError || typeof rate?.allowed !== 'boolean') throw Error('storage_unavailable');
  if (!rate.allowed) throw Error('rate_limited');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const { data: id, error } = draft
    ? await db.rpc('storage_reserve_draft_attachment', { p_owner: owner, p_draft: draft, p_request_id: requestId, p_name: name, p_mime: mime, p_size: bytes.length, p_checksum: checksum })
    : await db.rpc('storage_reserve_post_attachment', { p_owner: owner, p_post: post, p_request_id: requestId, p_original_name: name, p_mime_type: mime, p_byte_size: bytes.length, p_checksum: checksum });
  if (error || !id) throw Error(error?.code === '42501' ? 'permission_denied' : error?.code === '22023' ? 'quota_or_limit' : error?.code === '23505' ? 'upload_conflict' : 'storage_unavailable');
  const { data: row, error: readError } = await db.from('storage_files').select('id,status,gateway_key').eq('id', id).eq('owner_id', owner).maybeSingle();
  if (readError || !row?.gateway_key || !['ready', 'reserved'].includes(row.status)) throw Error('storage_unavailable');
  if (row.status === 'reserved') {
    const result = await uploadFileV3({ key: row.gateway_key, name, mime, bytes });
    if (draft) await rpc(db, 'storage_finalize_draft_attachment', { p_owner: owner, p_file: id, p_provider: result.id, p_checksum: result.checksum, p_size: result.size, p_mime: result.mime });
    else await rpc(db, 'storage_finalize_post_attachment', { p_owner: owner, p_file: id, p_provider_id: result.id, p_checksum: result.checksum, p_size: result.size, p_mime: result.mime });
  }
  return id;
}
export async function createPostDraft(owner, draft) {
  const db = admin();
  const { data: rate, error } = await db.rpc('consume_rate_limit', { p_bucket: 'post_attachment_draft', p_key: owner, p_limit: 20, p_window_seconds: 3600 });
  if (error || typeof rate?.allowed !== 'boolean') throw Error('storage_unavailable');
  if (!rate.allowed) throw Error('rate_limited');
  return rpc(db, 'storage_create_post_draft', { p_owner: owner, p_draft: draft });
}
export async function abandonPostDraft(owner, draft) {
  return rpc(admin(), 'storage_abandon_post_draft', { p_owner: owner, p_draft: draft });
}
export async function removePostAttachment(owner, file) {
  const db = admin(); await rpc(db, 'storage_retire_post_attachment', { p_owner: owner, p_file: file });
  return cleanPostAttachment(file);
}
export async function cleanPostAttachment(file) {
  const db = admin();
  const { data, error } = await db.from('storage_files').select('id,gateway_key').eq('id', file).eq('resource_type', 'post_attachment').eq('status', 'delete_pending').maybeSingle();
  if (error) throw Error('storage_unavailable');
  if (!data) return true;
  try { const marked = await db.from('storage_files').update({ cleanup_attempted_at: new Date().toISOString() }).eq('id', file).eq('status', 'delete_pending'); if (marked.error) throw Error('storage_unavailable'); if (!data.gateway_key) throw Error('storage_unavailable'); await deleteFileByUploadKeyV3(data.gateway_key); await rpc(db, 'storage_complete_post_attachment_delete', { p_file: data.id }); return true; } catch { return false; }
}
export async function reconcilePostAttachments() {
  const db = admin(); const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: expired, error: draftError } = await db.from('post_upload_drafts').select('id,owner_id').eq('state', 'open').lt('expires_at', new Date().toISOString()).order('expires_at').limit(20);
  if (draftError) throw Error('storage_unavailable');
  let draftRetry = (expired?.length || 0) === 20;
  for (const draft of expired || []) { try { await abandonPostDraft(draft.owner_id, draft.id); } catch { draftRetry = true; } }
  const { data, error } = await db.from('storage_files').select('id,owner_id,status').eq('resource_type', 'post_attachment').or(`status.eq.delete_pending,and(status.eq.reserved,created_at.lt.${cutoff})`).order('cleanup_attempted_at', { ascending: true, nullsFirst: true }).order('created_at').limit(20);
  if (error) throw Error('storage_unavailable');
  let retryPending = draftRetry || (data?.length || 0) === 20;
  for (const row of data || []) { try { if (row.status === 'reserved') await rpc(db, 'storage_retire_post_attachment', { p_owner: row.owner_id, p_file: row.id }); if (!await cleanPostAttachment(row.id)) retryPending = true; } catch { retryPending = true; } }
  return { processed: data?.length || 0, retryPending };
}
const pending = new Map();
export async function downloadPostAttachment(file) {
  const key = JSON.stringify([file.provider_file_id, file.mime_type, file.checksum]);
  let task = pending.get(key);
  if (!task) { task = downloadFile(file.provider_file_id, { mime: file.mime_type, checksum: file.checksum }); pending.set(key, task); task.finally(() => { if (pending.get(key) === task) pending.delete(key); }).catch(() => {}); }
  return task;
}

const pendingThumbnails = new Map();
/** Deterministic browser-cacheable variant, never persisted publicly. */
export async function thumbnailPostAttachment(file) {
  const key = JSON.stringify([file.provider_file_id, file.mime_type, file.checksum, 'thumb-v1']);
  let task = pendingThumbnails.get(key);
  if (!task) {
    task = (async () => sharp(await downloadPostAttachment(file), { limitInputPixels: 16000000, animated: false }).rotate().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer())();
    pendingThumbnails.set(key, task);
    task.finally(() => { if (pendingThumbnails.get(key) === task) pendingThumbnails.delete(key); }).catch(() => {});
  }
  return task;
}
