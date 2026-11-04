import { eventStartMs } from './public';
import { absoluteUrl } from '@/lib/canonical';
import { UUID_REGEX } from '@/lib/constants';

function escapeText(value) {
  return String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}
function utc(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }
// RFC 5545 folds at 75 octets, not 75 JavaScript characters.
function fold(line) {
  const lines = []; let current = ''; let bytes = 0;
  for (const char of line) {
    const n = Buffer.byteLength(char);
    if (bytes + n > 75) { lines.push(current); current = ' '; bytes = 1; }
    current += char; bytes += n;
  }
  lines.push(current); return lines.join('\r\n');
}
export function eventCalendar(event, now = new Date()) {
  if (!UUID_REGEX.test(event?.id || '') || !event.title || event.status !== 'published') return null;
  const start = eventStartMs(event);
  if (start === null) return null; // no invented time or duration
  if (event.ends_on && (eventStartMs({ ...event, starts_on: event.ends_on, start_time: '00:00' }) === null || event.ends_on < event.starts_on)) return null;
  let end = null;
  if (event.end_time) {
    end = eventStartMs({ ...event, starts_on: event.ends_on || event.starts_on, start_time: event.end_time });
    if (end === null || end <= start) return null;
  }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Campus+//Public Events//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${event.id}@pccoe.in`, `DTSTAMP:${utc(now.getTime())}`, `DTSTART:${utc(start)}`];
  if (end !== null) lines.push(`DTEND:${utc(end)}`);
  lines.push(`SUMMARY:${escapeText(event.title)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  lines.push(`URL:${absoluteUrl(`/campus/events/${event.id}`)}`, 'END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
