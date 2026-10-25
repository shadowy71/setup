'use server';

/**
 * Admin-only backup actions.
 *
 * These actions ONLY enqueue durable work or change connection state through
 * permission-checked SECURITY DEFINER RPCs. They never call Google Drive, never
 * upload data and never run on a student request path. The background worker
 * (cron route / CLI) performs the actual upload.
 */

import { revalidatePath } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { errors, toActionError } from '@/lib/errors';
import { vUuid } from '@/lib/validation/primitives';

const BACKUP_KINDS = new Set(['incremental', 'snapshot']);

async function requireBackupAdmin() {
  const user = await getActiveUser();
  if (!user) throw errors.unauthenticated();
  if (!can(toActor(user), 'manage_backups')) {
    throw errors.forbidden('You do not have permission to manage backups.');
  }
  return user;
}

/** Enqueue a manual incremental export or a full snapshot. */
export async function requestManualBackup(formData) {
  try {
    await requireBackupAdmin();
    const kind = String(formData.get('kind') || '').trim();
    if (!BACKUP_KINDS.has(kind)) throw errors.validation('Choose an incremental or full backup.');

    const supabase = await getServerClient();
    const { error } = await supabase.rpc('backup_request_job', { p_kind: kind, p_note: 'manual' });
    if (error) throw error;
    revalidatePath('/admin');
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'We could not queue that backup. Please try again.');
  }
}

/** Authorize one retry of a failed batch (the worker still does the work). */
export async function retryBackupBatch(formData) {
  try {
    await requireBackupAdmin();
    const checked = vUuid(formData.get('batch_id'), { label: 'Batch' });
    if (!checked.ok) throw errors.validation('That batch is not valid.', { batch_id: checked.error });

    const supabase = await getServerClient();
    const { error } = await supabase.rpc('backup_retry_failed', { p_batch_id: checked.value });
    if (error) throw error;
    revalidatePath('/admin');
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'We could not retry that batch. Please try again.');
  }
}

/**
 * Revoke the connection locally (encrypted refresh credential is deleted).
 * Google-side token revocation is an operator CLI step:
 * `npm run backup:disconnect` — it is intentionally not part of a web request.
 */
export async function disconnectDriveBackup() {
  try {
    await requireBackupAdmin();
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('backup_disconnect');
    if (error) throw error;
    revalidatePath('/admin');
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'We could not disconnect Drive. Please try again.');
  }
}
