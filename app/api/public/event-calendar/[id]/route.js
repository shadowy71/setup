import { UUID_REGEX } from '@/lib/constants';
import { getPublicEventById } from '@/lib/data/public';
import { eventCalendar } from '@/lib/discovery/calendar';

export async function GET(_request, { params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return new Response(null, { status: 404 });
  const { item, unavailable } = await getPublicEventById(id);
  if (unavailable) return new Response(null, { status: 503 });
  const calendar = item && eventCalendar(item);
  if (!calendar) return new Response(null, { status: 404 });
  return new Response(calendar, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="campus-event.ics"', 'Cache-Control': 'private, no-store' } });
}
