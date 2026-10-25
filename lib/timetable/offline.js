/**
 * The offline timetable snapshot — the contract between the server, the
 * browser store and the offline shell.
 *
 * A snapshot is a plain JSON-serialisable view model for exactly one batch:
 * every printed day, its events with their verbatim source lines, the free
 * slots, the legend and the flagged entries. It carries what the interface
 * renders (including the already-formatted 12-hour labels) so the browser side
 * never needs `lib/timetable/master-timetable-2026-27-sem1.js`, and it carries
 * its own `schemaVersion` and `checksum` so a stored copy can be recognised,
 * validated, compared and — when it cannot be understood — discarded instead
 * of half-trusted.
 *
 * Validation is strict and structural rather than permissive: `getDayStatus`
 * would happily compute nonsense from a snapshot with missing times, and an
 * offline student would rather see their last known-good copy than a timetable
 * with classes in the wrong place.
 *
 * Pure and dependency-free: shared by the API route, the store and the tests.
 */

import { TIMETABLE_SOURCE, normalizeDivision } from '@/lib/timetable/meta';

/**
 * Bump when the *shape* below changes in a way an older browser copy cannot be
 * read with. A stored snapshot with a different version is dropped on sight;
 * the shell then shows its honest "open it once online" state instead of
 * rendering a misshapen week.
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** How many batches a single device may keep. 18 is every division A–R. */
export const MAX_SNAPSHOT_BATCHES = 18;

/** A day's events are small; this only exists to reject a corrupted record. */
export const MAX_EVENTS_PER_DAY = 40;

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const KINDS = new Set(['standard', 'batch', 'lunch', 'special']);
const MAX_LINES = 8;
const MAX_LINE_LENGTH = 240;

/** Canonical JSON: keys in a fixed order, so a checksum is reproducible. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * FNV-1a (32-bit) over the canonical payload, as 8 hex characters.
 *
 * This is a *change detector*, not a security control: it answers "did the
 * timetable data actually move?" so re-saving the same week is a no-op and a
 * real departmental update is not. A hash function with no dependency is the
 * right size for that job.
 */
export function snapshotChecksum(payload) {
  const text = canonical(payload);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The days a timetable can have. A weekend day in a payload is corruption. */
const TEACHING_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function toEvent(input) {
  const lines = Array.isArray(input.lines)
    ? input.lines.slice(0, MAX_LINES).map((line) => String(line).slice(0, MAX_LINE_LENGTH))
    : [];
  const from = String(input.time?.from ?? '');
  const to = String(input.time?.to ?? '');
  return {
    id: String(input.id ?? `${input.start}-${input.end}-${lines[0] ?? ''}`),
    start: Number(input.start),
    end: Number(input.end),
    span: Number(input.span ?? Math.max(1, Number(input.end) - Number(input.start) + 1)),
    lines,
    kind: KINDS.has(input.kind) ? input.kind : 'standard',
    needsVerification: Boolean(input.needsVerification),
    accent: String(input.accent ?? 'neutral'),
    subject: input.subject ? String(input.subject) : null,
    time: {
      from,
      to,
      fromLabel: String(input.time?.fromLabel ?? ''),
      toLabel: String(input.time?.toLabel ?? ''),
      label12: String(input.time?.label12 ?? ''),
    },
    startMinutes: Number(input.startMinutes ?? minutesOf(from)),
    endMinutes: Number(input.endMinutes ?? minutesOf(to)),
  };
}

/** '09:10' → 550. Defensive: an unparsable time is 0, never NaN. */
export function minutesOf(label) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(label ?? ''));
  if (!match) return 0;
  return (Number(match[1]) % 24) * 60 + Number(match[2]);
}

function toFreeRange(range) {
  return {
    startIndex: Number(range.startIndex),
    endIndex: Number(range.endIndex),
    from: String(range.from ?? ''),
    to: String(range.to ?? ''),
    fromLabel: String(range.fromLabel ?? ''),
    toLabel: String(range.toLabel ?? ''),
    label12: String(range.label12 ?? ''),
    startMinutes: Number(range.startMinutes ?? minutesOf(range.from)),
    endMinutes: Number(range.endMinutes ?? minutesOf(range.to)),
  };
}

/**
 * The one payload that both the API response and the stored record are built
 * from. Keeping it in a function is what makes the checksum of a snapshot
 * comparable with the checksum of a live fetch.
 */
function corePayload(batch, days, extra) {
  return {
    division: batch.division,
    label: batch.label,
    friendly: batch.friendly,
    days,
    subjects: extra.subjects,
    flagged: extra.flagged,
    source: TIMETABLE_SOURCE,
  };
}

/**
 * Build a snapshot from a division view model (`getDivisionTimetable`).
 *
 * `savedAt` is set by the client when the record is written; the server's
 * `generatedAt` is when this payload was assembled, which is what the
 * "updated on" line is allowed to claim.
 */
export function buildSnapshot(value, { savedAt = null } = {}) {
  const division = normalizeDivision(value?.division);
  if (!division) return null;
  const batch = { division, label: value.label ?? division, friendly: value.friendly ?? null };

  const days = (Array.isArray(value.days) ? value.days : [])
    .filter((day) => DAY_NAMES.includes(day?.day))
    .map((day) => ({
      day: day.day,
      branch: day.branch ? String(day.branch) : batch.label,
      events: (day.events ?? []).slice(0, MAX_EVENTS_PER_DAY).map(toEvent),
      freeRanges: (day.freeRanges ?? []).map(toFreeRange),
    }));

  const extra = {
    subjects: (value.subjects ?? []).map(({ code, accent }) => ({
      code: String(code),
      accent: String(accent ?? 'neutral'),
    })),
    flagged: (value.flagged ?? []).map((event) => ({
      day: String(event.day),
      start: Number(event.start),
      lines: (event.lines ?? []).map((line) => String(line)),
      label12: String(event.time?.label12 ?? ''),
    })),
  };

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    ...corePayload(batch, days, extra),
    checksum: snapshotChecksum(corePayload(batch, days, extra)),
    eventCount: days.reduce((total, day) => total + day.events.length, 0),
    // Never `new Date(x).toISOString()` straight off an input: a timestamp that
    // does not parse would throw a RangeError inside the save. An unparseable
    // upstream stamp degrades to "just now" for the build, and to nothing for
    // the device-side save time, which the store fills in anyway.
    generatedAt: isoOrNull(value.generatedAt) ?? new Date().toISOString(),
    savedAt: isoOrNull(savedAt),
  };
}

/* --------------------------------------------------------------------------
   Validation
   -------------------------------------------------------------------------- */

function fail(error) {
  return { ok: false, error };
}

/**
 * Is this object a snapshot we are willing to render? Returns
 * `{ ok, snapshot }` or `{ ok: false, error }` with a code, never throws.
 *
 * It repairs nothing: a record missing a day, an event without times, a
 * division mismatch or an unknown schema version is rejected whole, so a
 * partially-written cache entry can never become a partially-wrong timetable.
 */
export function validateSnapshot(raw, { expectDivision = null } = {}) {
  if (!raw || typeof raw !== 'object') return fail('empty');
  if (Number(raw.schemaVersion) !== SNAPSHOT_SCHEMA_VERSION) return fail('schema');

  const division = normalizeDivision(raw.division);
  if (!division) return fail('division');
  if (expectDivision) {
    const wanted = normalizeDivision(expectDivision);
    if (wanted && wanted !== division) return fail('division-mismatch');
  }
  if (!Array.isArray(raw.days) || raw.days.length !== DAY_NAMES.length) return fail('days');

  // Resolved before the day loop: a day that lost its branch label falls back to
  // the batch's own short label (`IT`), never to the bare division letter, which
  // would print `O` where a student expects `IT`.
  const label = raw.label ? String(raw.label) : division;

  const seen = new Set();
  const days = [];
  for (const day of raw.days) {
    if (!day || !DAY_NAMES.includes(day.day)) return fail('day-name');
    // Only five weekdays exist in a timetable; a Saturday in the payload means
    // the response was assembled by something other than the page.
    if (!TEACHING_DAYS.includes(day.day)) return fail('day-out-of-week');
    if (seen.has(day.day)) return fail('day-duplicate');
    seen.add(day.day);
    if (!Array.isArray(day.events)) return fail('events');
    if (day.events.length > MAX_EVENTS_PER_DAY) return fail('event-count');

    const events = [];
    for (const event of day.events) {
      if (!event || typeof event !== 'object') return fail('event');
      const lines = Array.isArray(event.lines) ? event.lines.map((line) => String(line)) : null;
      if (!lines || !lines.length) return fail('event-lines');
      if (lines.some((line) => !line.trim())) return fail('event-line-blank');
      if (!Number.isFinite(Number(event.startMinutes)) || !Number.isFinite(Number(event.endMinutes))) {
        return fail('event-time');
      }
      if (Number(event.endMinutes) < Number(event.startMinutes)) return fail('event-order');
      if (!event.time || typeof event.time !== 'object' || !event.time.fromLabel) return fail('event-label');
      events.push(toEvent(event));
    }

    const freeRanges = Array.isArray(day.freeRanges) ? day.freeRanges.map(toFreeRange) : [];
    days.push({
      day: day.day,
      branch: day.branch ? String(day.branch) : label,
      events,
      freeRanges,
    });
  }

  const body = {
    division,
    label,
    friendly: raw.friendly ? String(raw.friendly) : null,
    days,
    subjects: Array.isArray(raw.subjects)
      ? raw.subjects.map(({ code, accent }) => ({ code: String(code), accent: String(accent ?? 'neutral') }))
      : [],
    flagged: Array.isArray(raw.flagged)
      ? raw.flagged.map((entry) => ({
          day: String(entry.day),
          start: Number(entry.start),
          lines: (entry.lines ?? []).map((line) => String(line)),
          label12: String(entry.label12 ?? ''),
        }))
      : [],
    source: raw.source && typeof raw.source === 'object' ? raw.source : TIMETABLE_SOURCE,
  };

  // A stored copy whose checksum no longer matches the payload it carries was
  // written by a different build or damaged after the fact: re-fetch rather
  // than render it as if it were current.
  const checksum = snapshotChecksum(body);
  const trusted = Boolean(raw.checksum) && raw.checksum === checksum;

  return {
    ok: true,
    snapshot: {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      ...body,
      checksum,
      eventCount: days.reduce((total, day) => total + day.events.length, 0),
      generatedAt: isoOrNull(raw.generatedAt) ?? new Date(0).toISOString(),
      savedAt: isoOrNull(raw.savedAt),
    },
    stale: !trusted,
  };
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* --------------------------------------------------------------------------
   Freshness
   -------------------------------------------------------------------------- */

/** A snapshot is "fresh" for a day, "aging" for a week, then it is stale. */
export const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
export const AGING_WINDOW_MS = 7 * FRESH_WINDOW_MS;

/**
 * `state` drives the dot on the offline chip; `label` is what a student reads.
 * `unknown` is a deliberate state: a record with no timestamp (a hand-edited
 * or very old entry) says so instead of lying about being fresh.
 */
export function snapshotFreshness(snapshot, now = Date.now()) {
  const at = Date.parse(snapshot?.savedAt || snapshot?.generatedAt || '');
  if (!Number.isFinite(at)) return { state: 'unknown', label: 'Saved copy', ageMs: null };
  const ageMs = Math.max(0, now - at);
  if (ageMs > AGING_WINDOW_MS) return { state: 'stale', label: 'Saved copy · may be out of date', ageMs };
  if (ageMs > FRESH_WINDOW_MS) return { state: 'aging', label: 'Saved copy', ageMs };
  return { state: 'fresh', label: 'Up to date', ageMs };
}

/**
 * `Today 9:12 AM` / `Yesterday` / `3 days ago` / `12 Oct` — the short form for
 * the chip. Takes the instant and the "now" explicitly so it is testable and
 * never depends on a locale that changes between server and client renders.
 */
export function formatSavedAgo(iso, now = new Date(), timeZone = 'Asia/Kolkata') {
  const at = Date.parse(iso || '');
  if (!Number.isFinite(at)) return 'not saved yet';
  const saved = new Date(at);
  const dayKey = (date) => dayKeyIn(date, timeZone);
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const time = hourMinute12(saved, timeZone);

  if (dayKey(saved) === today) return `today ${time}`;
  if (dayKey(saved) === yesterday) return `yesterday ${time}`;
  const days = Math.floor((now.getTime() - at) / (24 * 60 * 60 * 1000));
  if (days < 7) return `${days} days ago`;
  return shortDate(saved, timeZone);
}

/** The calendar day name in a timezone, as `YYYY-MM-DD`, without Date tricks. */
function dayKeyIn(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function hourMinute12(date, timeZone) {
  // Read the 24-hour clock and convert here. Asking Intl for `h12` and then
  // deciding AM/PM from that hour is the classic off-by-twelve: the formatter
  // hands back 9 for 21:00, and 9 looks like morning.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0) % 24;
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function shortDate(date, timeZone) {
  // `en-IN`, like the rest of the timetable: `1 Sep`, not the `en-GB` `1 Sept`.
  return new Intl.DateTimeFormat('en-IN', { timeZone, day: 'numeric', month: 'short' }).format(date);
}

export { TIMETABLE_SOURCE };
