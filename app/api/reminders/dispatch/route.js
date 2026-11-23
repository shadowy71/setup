import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { dispatchDueReminders } from '@/lib/reminders/scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/reminders/dispatch
 *
 * Cron entry point (Bearer CRON_SECRET). Delivers every reminder that is
 * due now, re-checking the current profile and timetable immediately
 * before sending. Idempotent via atomic claim (`pending → terminal`), so
 * duplicate executions never double-send.
 *
 * Precision: this route must be called every minute for 10-minute push
 * reminders. Vercel Hobby crons run at most once per day, so production
 * needs Vercel Pro (per-minute cron) or an external scheduler hitting
 * this URL with the CRON_SECRET bearer token — see
 * docs/CLASS-REMINDERS.md. The in-app popup does not depend on this
 * route: it fires client-side while Campus+ is open.
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
    const result = await dispatchDueReminders({ admin });
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
