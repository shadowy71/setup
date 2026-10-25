/**
 * Scheduled incremental backup endpoint (Vercel Cron / external timer).
 *
 * Background job only — student requests never reach it. Protected by the cron
 * bearer token; see `lib/backup/endpoints.js` for the exact order of
 * authorization → configuration → bounded processing. The durable outbox in
 * Supabase is the source of truth, so a missed tick just means the next run
 * picks up the backlog.
 */

import { NextResponse } from 'next/server';
import { scheduledBackupResponse } from '@/lib/backup/endpoints.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(request) {
  const { status, body } = await scheduledBackupResponse({ request, kind: 'incremental' });
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const GET = handle;
export const POST = handle;
