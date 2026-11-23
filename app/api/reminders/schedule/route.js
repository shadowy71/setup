import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { scheduleClassReminders } from '@/lib/reminders/scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/reminders/schedule
 *
 * Cron entry point (Bearer CRON_SECRET, same pattern as
 * /api/storage/reconcile). Materialises the next 7 days of reminders for
 * every eligible student from the current database state. Idempotent:
 * running it twice inserts nothing the second time.
 *
 * Scheduling: daily via Vercel Cron (see vercel.json). The dispatcher
 * needs per-minute precision for push — see docs/CLASS-REMINDERS.md.
 */
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret || ''}`;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (!secret || secret.length < 32 || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const admin = getAdminClient();
    if (!admin) {
      return NextResponse.json({ ok: false, error: 'admin-unconfigured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    const result = await scheduleClassReminders({ admin });
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
