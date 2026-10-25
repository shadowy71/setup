/**
 * Scheduled full-snapshot endpoint. Requires BACKUP_DATABASE_URL (a direct
 * Postgres session for the repeatable-read table image) and the same cron
 * bearer token as the incremental worker. Never runs in a student request.
 */

import { NextResponse } from 'next/server';
import { createBackupRuntime, createDriveForWorker, cronAuthorized } from '@/lib/backup/runtime.js';
import { createSnapshot } from '@/lib/backup/snapshot.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// 60s is accepted on every Vercel plan (older Hobby projects without Fluid
// Compute reject higher values at deploy time). Large snapshots should be run
// via `npm run backup:snapshot` from a trusted host, which has no such cap.
export const maxDuration = 60;

async function handle(request) {
  try {
    const { config, keyRing, store } = createBackupRuntime();
    if (!cronAuthorized(request, config.cronSecret)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    if (!config.databaseUrl) {
      return NextResponse.json({ status: 'failed', error: 'BACKUP_DATABASE_URL is not configured' }, { status: 503 });
    }
    const { drive, folderId, seal } = await createDriveForWorker({ store, config, keyRing });
    const result = await createSnapshot({ store, drive, seal, folderId, workerId: `snapshot-${Date.now()}` });
    return NextResponse.json(result, { status: result.status === 'verified' ? 200 : 500, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[backup] snapshot endpoint failed:', error?.message || error);
    return NextResponse.json({ status: 'failed', error: 'snapshot unavailable' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
