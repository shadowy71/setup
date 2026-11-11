import 'server-only';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { getAdminClient } from '@/lib/supabase/admin';
import { uploadFile, downloadFile, deleteFileByUploadKey } from '@/lib/storage';
import { validateFile } from '@/lib/storage/validation';

function adminClient() {
  const client = getAdminClient();
  if (!client) throw new Error('storage_unavailable');
  return client;
}
async function rpc(client, name, params) {
  const { data, error } = await client.rpc(name, params);
  if (error) throw new Error('storage_unavailable');
  return data;
}

/** Retry previously retired operations; quota is released only after the
 * gateway durably rejects delayed uploads and confirms deletion. */
export async function cleanProfilePhotos(owner, { stale = false } = {}) {
  const admin = adminClient();
  if (stale) await rpc(admin, 'storage_retire_profile_pictures', { p_owner: owner, p_stale_only: true });
  const { data, error } = await admin.from('storage_files').select('id').eq('owner_id', owner)
    .eq('resource_type', 'profile_picture').eq('status', 'delete_pending').order('created_at', { ascending: true }).limit(21);
  if (error) throw new Error('storage_unavailable');
  let failed = (data?.length || 0) > 20;
  for (const file of (data || []).slice(0, 20)) {
    try {
      const marked = await admin.from('storage_files').update({ cleanup_attempted_at: new Date().toISOString() }).eq('id', file.id).eq('owner_id', owner).eq('status', 'delete_pending');
      if (marked.error) throw new Error('storage_unavailable');
      await deleteFileByUploadKey(file.id);
      await rpc(admin, 'storage_complete_profile_delete', { p_owner: owner, p_file: file.id });
    } catch { failed = true; }
  }
  return !failed;
}

export async function uploadProfilePhoto({ owner, requestId, name, mime, bytes }) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || !validateFile({ name, mime, bytes }).ok) throw new Error('invalid_file');
  // Decode as well as checking magic bytes: a matching header alone is not a
  // valid image. The pixel cap prevents decompression bombs.
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 16000000, animated: false });
    const metadata = await image.metadata();
    if (metadata.format !== ({ 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' })[mime] || !metadata.width || !metadata.height || (metadata.pages || 1) !== 1) throw new Error();
    await image.resize(1, 1).raw().toBuffer();
  } catch { throw new Error('invalid_file'); }
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const admin = adminClient();
  // Fail closed rather than allowing repeated file operations when rate limit
  // storage is unavailable. The owner key is derived from the verified session.
  const { data: rate, error: rateError } = await admin.rpc('consume_rate_limit', {
    p_bucket: 'profile_photo_upload', p_key: owner, p_limit: 20, p_window_seconds: 3600,
  });
  if (rateError || typeof rate?.allowed !== 'boolean') throw new Error('storage_unavailable');
  if (!rate.allowed) throw new Error('rate_limited');
  const { data: id, error } = await admin.rpc('storage_reserve_profile_picture', {
    p_owner: owner, p_request_id: requestId, p_original_name: name, p_mime_type: mime, p_byte_size: bytes.length, p_checksum: checksum,
  });
  if (error || !id) {
    if (error?.code === '42501') throw new Error('permission_denied');
    if (error?.code === '22023') throw new Error('quota_or_invalid');
    throw new Error('storage_unavailable');
  }
  const { data: current, error: readError } = await admin.from('storage_files').select('id,status')
    .eq('id', id).eq('owner_id', owner).maybeSingle();
  if (readError || !current || !['reserved', 'ready'].includes(current.status)) throw new Error('storage_unavailable');
  if (current.status === 'reserved') {
    const stored = await uploadFile({ key: id, name, mime, bytes });
    await rpc(admin, 'storage_finalize_profile_picture', {
      p_owner: owner, p_file: id, p_provider_id: stored.id, p_checksum: stored.checksum, p_size: stored.size, p_mime: stored.mime,
    });
  }
  // The photo is committed even if cleanup fails; retry it on future operations.
  try { await cleanProfilePhotos(owner); } catch { /* quota remains charged */ }
  return id;
}

export async function removeProfilePhoto(owner) {
  const admin = adminClient();
  await rpc(admin, 'storage_retire_profile_pictures', { p_owner: owner, p_stale_only: false });
  return cleanProfilePhotos(owner);
}

/** Call only after the session-scoped public_profiles visibility check. */
export async function readProfilePhoto(owner) {
  const admin = adminClient();
  const { data, error } = await admin.from('storage_files').select('provider_file_id,mime_type,checksum')
    .eq('owner_id', owner).eq('resource_type', 'profile_picture').eq('status', 'ready').maybeSingle();
  if (error) throw new Error('storage_unavailable');
  if (!data) return null;
  const bytes = await downloadFile(data.provider_file_id, { mime: data.mime_type, checksum: data.checksum });
  return { bytes, mime: data.mime_type };
}

/** Bounded cron pass. Failed operations stay pending for a future retry. */
export async function reconcileProfilePhotos() {
  const admin = adminClient();
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.from('storage_files').select('owner_id')
    .eq('resource_type', 'profile_picture')
    .or(`status.eq.delete_pending,and(status.eq.reserved,created_at.lt.${cutoff})`)
    .order('cleanup_attempted_at', { ascending: true, nullsFirst: true }).order('created_at', { ascending: true }).limit(20);
  if (error) throw new Error('storage_unavailable');
  let failed = false;
  const owners = [...new Set((data || []).map((row) => row.owner_id))];
  for (const owner of owners) {
    try { if (!await cleanProfilePhotos(owner, { stale: true })) failed = true; }
    catch { failed = true; }
  }
  return { processedOwners: owners.length, retryPending: failed || (data?.length || 0) === 20 };
}
