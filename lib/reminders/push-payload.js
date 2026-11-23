/**
 * Minimal Web Push payloads — dependency-free.
 *
 * Shared by the server dispatcher (`buildPushPayload`) and the service
 * worker (`parsePushNotificationData`). Kept free of timetable, constants
 * and clock imports so the worker bundle stays tiny and lint-clean: the
 * worker must never pull the semester dataset or the constants catalogue
 * into its bundle.
 */

/** True when a string looks like an email address (payload hygiene check). */
export function looksLikeEmail(value) {
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(String(value || ''));
}

/**
 * Minimal Web Push payload for one reminder.
 *
 * Only timetable data (subject, time label, division timetable URL) is
 * included — never an email address, username, or other private profile
 * detail. The payload is what the service worker shows; it must be safe
 * to display on a lock screen.
 *
 * @param {object} reminder  `{ subject, time_label, division, event_key }`
 *   `division` must already be a canonical letter (A–R); anything else
 *   falls back to the timetable selector.
 */
export function buildPushPayload(reminder = {}) {
  const subject = String(reminder.subject || 'Class').slice(0, 60);
  const timeLabel = String(reminder.time_label || '').slice(0, 40);
  const division = /^[A-R]$/i.test(String(reminder.division || '').trim())
    ? String(reminder.division).trim().toUpperCase()
    : null;
  const url = division ? `/timetable/${division.toLowerCase()}` : '/timetable';
  return {
    title: 'Class in 10 minutes',
    body: timeLabel ? `${subject} · ${timeLabel}` : subject,
    url,
    tag: String(reminder.event_key || '').slice(0, 120),
  };
}

/**
 * Parse a Web Push event payload in the service worker.
 *
 * Returns a sanitised `{ title, body, url, tag }` or a generic reminder
 * when there is nothing to show. The URL is restricted to the timetable
 * (no open redirect), lengths are capped.
 */
export function parsePushNotificationData(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
  }
  if (!data || typeof data !== 'object') {
    return { title: 'Class in 10 minutes', body: 'Your next class is starting soon.', url: '/timetable', tag: '' };
  }
  const title = String(data.title || 'Class in 10 minutes').slice(0, 60);
  const body = String(data.body || 'Your next class is starting soon.').slice(0, 120);
  const rawUrl = String(data.url || '/timetable');
  const url = /^\/timetable(\/[a-r])?$/i.test(rawUrl) ? rawUrl : '/timetable';
  const tag = String(data.tag || '').slice(0, 120);
  return { title, body, url, tag };
}
