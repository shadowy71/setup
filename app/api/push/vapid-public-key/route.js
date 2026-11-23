import { NextResponse } from 'next/server';
import { getVapidPublicKey } from '@/lib/reminders/push';

export const dynamic = 'force-dynamic';

const PUBLIC_HEADERS = {
  'Cache-Control': 'public, max-age=3600',
};

/**
 * GET /api/push/vapid-public-key
 *
 * The VAPID public key is public by design (the browser needs it to
 * subscribe). The private key never leaves the server. When push is not
 * configured, returns 503 so the client degrades to in-app popups only.
 */
export async function GET() {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return NextResponse.json({ ok: false, error: 'push-unconfigured' }, { status: 503, headers: PUBLIC_HEADERS });
  }
  return NextResponse.json({ ok: true, publicKey }, { headers: PUBLIC_HEADERS });
}
