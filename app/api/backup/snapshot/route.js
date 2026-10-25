/**
 * Scheduled full-snapshot endpoint.
 *
 * Requires BACKUP_DATABASE_URL (a direct Postgres session for the
 * repeatable-read table image) and a valid cron bearer token — Vercel Cron
 * sends `Authorization: Bearer <CRON_SECRET>`, and BACKUP_CRON_SECRET is
 * accepted as a legacy alias. Neither is ever logged. Never runs during a
 * student request. See `lib/backup/endpoints.js` for the shared
 * authorization → configuration → processing order.
 */

import { NextResponse } from 'next/server';
import { scheduledBackupResponse } from '@/lib/backup/endpoints.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// 60s is accepted on every Vercel plan (older Hobby projects without Fluid
// Compute reject higher values at deploy time). Larger databases should be
// snapshotted from Admin → Backups across runs or from a trusted host.
export const maxDuration = 60;

async function handle(request) {
  const { status, body } = await scheduledBackupResponse({ request, kind: 'snapshot' });
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const GET = handle;
export const POST = handle;
