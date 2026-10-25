/**
 * Scheduled incremental backup worker endpoint (Vercel Cron / external timer).
 *
 * This is a BACKGROUND job. It is the only data path that calls Google Drive,
 * and it is protected by BACKUP_CRON_SECRET. Student requests never reach it.
 * All durability is in the database outbox: a missed cron run simply means the
 * next run picks up the backlog.
 */

import { NextResponse } from 'next/server';
import { createBackupRuntime, createDriveForWorker, cronAuthorized } from '@/lib/backup/runtime.js';
import { runBackupWorker } from '@/lib/backup/worker.js';
import { BACKUP_DEFAULTS } from '@/lib/backup/constants.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(request) {
  try {
    const { config, keyRing, store } = createBackupRuntime();
    if (!cronAuthorized(request, config.cronSecret)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const { drive, folderId, seal } = await createDriveForWorker({ store, config, keyRing });
    const result = await runBackupWorker({
      store,
      drive,
      seal,
      folderId,
      workerId: `cron-${Date.now()}`,
      batchSize: BACKUP_DEFAULTS.batchSize,
      leaseSeconds: BACKUP_DEFAULTS.leaseSeconds,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[backup] worker endpoint failed:', error?.message || error);
    return NextResponse.json({ status: 'failed', error: 'backup worker unavailable' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
