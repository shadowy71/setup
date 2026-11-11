import { reconcileProjectFiles } from '@/lib/storage/project-attachments';
import { reconcileTeamFiles } from '@/lib/storage/team-attachments';
import { reconcileRideFiles } from '@/lib/storage/ride-attachments';
import { reconcileHousingFiles } from '@/lib/storage/housing-attachments';
import { reconcileReportImages } from '@/lib/storage/lost-found-images';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { reconcileProfilePhotos } from '@/lib/storage/profile-photo';
import { reconcileMarketplaceFiles } from '@/lib/storage/marketplace-attachments';
import { reconcilePostAttachments } from '@/lib/storage/post-attachments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret || ''}`;
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  if (!secret || secret.length < 32 || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const result = await reconcileProfilePhotos();
    const attachments = await reconcilePostAttachments();
    const marketplace = await reconcileMarketplaceFiles();
    const lostFound = await reconcileReportImages();
    const housing = await reconcileHousingFiles();
    const ride = await reconcileRideFiles();
    const team = await reconcileTeamFiles();
    const project = await reconcileProjectFiles();
    return NextResponse.json({ ok: true, ...result, attachments, marketplace, lostFound, housing, ride, team, project }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
