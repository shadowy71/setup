import { NextResponse } from 'next/server';
import { getActiveUser } from '@/lib/auth/session';
import { can, isAdmin, toActor } from '@/lib/permissions/authorization';
import { getStorageHealth } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };

/** Connectivity only. This does not enable or authorize student file uploads. */
export async function GET() {
  const user = await getActiveUser();
  if (!user?.profile || user.needsProfileSetup) return NextResponse.json({ ok: false }, { status: 401, headers });
  const actor = toActor(user);
  if (!isAdmin(actor) || !can(actor, 'manage_backups')) return NextResponse.json({ ok: false }, { status: 403, headers });
  try {
    await getStorageHealth();
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: 'Storage connectivity unavailable.' }, { status: 503, headers });
  }
}
