/**
 * Personalized class reminders — pure logic.
 *
 * This module is the single place that decides:
 *   - who is eligible for a class reminder (authenticated, active,
 *     institutional student, valid profile division, explicit opt-in);
 *   - when a reminder fires (`class_start_at - 10 minutes`, Asia/Kolkata);
 *   - which timetable events generate reminders (`standard` + `batch` only,
 *     one reminder per practical block, never per printed column);
 *   - how scheduler reconciliation stays idempotent (duplicate runs insert
 *     nothing and cancel nothing);
 *   - what a Web Push payload may contain (minimal, no email, no private
 *     profile details);
 *   - when an in-app popup is due (only while the page is active and the
 *     reminder is in its 10-minute window, never re-fired after dismiss).
 *
 * It is deliberately dependency-free beyond the timetable clock/meta helpers
 * so it can be unit-tested directly and bundled into the service worker
 * (for push payload parsing) without pulling the semester dataset into the
 * browser. The division always comes from the authenticated profile
 * (`getCurrentUser().profile.division`) — this module never reads it from a
 * URL, browser storage, or client-supplied value.
 *
 * @see docs/CLASS-REMINDERS.md
 */

import { DIVISIONS } from '@/lib/constants';
import { getCampusTime } from '@/lib/timetable/clock';
import { normalizeDivision } from '@/lib/timetable/meta';
export { buildPushPayload, looksLikeEmail, parsePushNotificationData } from '@/lib/reminders/push-payload';

/** Fixed lead time. The spec fixes this at 10 minutes initially. */
export const CLASS_REMINDER_LEAD_MINUTES = 10;

/** How far ahead the scheduler materialises reminders (days, Asia/Kolkata). */
export const CLASS_REMINDER_HORIZON_DAYS = 7;

/** Account states that may never receive reminders (mirrors session.js). */
export const INELIGIBLE_ACCOUNT_STATUSES = ['suspended', 'banned', 'deactivated', 'deleted'];

/** True when `value` is one of the eighteen profile divisions (A–R). */
export function isValidDivision(value) {
  return normalizeDivision(value) !== null;
}

/**
 * Eligibility for personalized class reminders.
 *
 * @param {object} input
 * @param {string|null} input.accountType  `student` | `visitor` | null
 * @param {string|null} input.accountStatus  `active` | `pending` | blocked…
 * @param {string|null} input.division  `profiles.division` (authoritative)
 * @param {boolean} input.classReminderPopups  the per-account opt-in
 * @param {boolean} [input.profileCompleted]  onboarding finished
 * @param {string|null} [input.username]  claimed username (onboarding done)
 * @returns {{ eligible: boolean, reason: string }}
 *   reason is one of: eligible, not-authenticated, not-institutional,
 *   blocked-status, profile-incomplete, no-division, preference-disabled.
 */
export function isEligibleForClassReminders({
  accountType = null,
  accountStatus = null,
  division = null,
  classReminderPopups = false,
  profileCompleted = false,
  username = null,
} = {}) {
  if (!accountType) return { eligible: false, reason: 'not-authenticated' };
  if (accountType !== 'student') return { eligible: false, reason: 'not-institutional' };
  if (INELIGIBLE_ACCOUNT_STATUSES.includes(accountStatus)) {
    return { eligible: false, reason: 'blocked-status' };
  }
  // `active` and `pending` are the only usable states (is_active_profile).
  if (accountStatus !== 'active' && accountStatus !== 'pending') {
    return { eligible: false, reason: 'blocked-status' };
  }
  if (profileCompleted !== true || !username) {
    return { eligible: false, reason: 'profile-incomplete' };
  }
  const letter = normalizeDivision(division);
  if (!letter) return { eligible: false, reason: 'no-division' };
  if (classReminderPopups !== true) return { eligible: false, reason: 'preference-disabled' };
  return { eligible: true, reason: 'eligible' };
}

/** Asia/Kolkata is a fixed UTC+05:30 with no daylight saving. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * The UTC instant of `minutesOfDay` (Asia/Kolkata wall clock) on an
 * Asia/Kolkata calendar date (`YYYY-MM-DD`).
 *
 * Example: `istDateKeyToUtc('2026-11-23', 540)` is 09:00 IST, i.e. 03:30 UTC.
 */
export function istDateKeyToUtc(dateKey, minutesOfDay) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) return null;
  const minutes = Number(minutesOfDay);
  if (!Number.isFinite(minutes)) return null;
  const utcMidnight = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(utcMidnight - IST_OFFSET_MS + minutes * 60 * 1000);
}

/** Add `days` calendar days to a `YYYY-MM-DD` key (pure calendar math). */
export function addDaysToDateKey(dateKey, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days)));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The next `count` Asia/Kolkata calendar dates starting today.
 *
 * Each entry carries the weekday name in Asia/Kolkata so the caller can pick
 * that day's events from the resolved week. Weekends are included (they
 * simply have no teaching day and produce no reminders).
 */
export function getCampusDates(now = new Date(), count = CLASS_REMINDER_HORIZON_DAYS) {
  const todayKey = getCampusTime(now).dateKey;
  const dates = [];
  for (let offset = 0; offset < count; offset += 1) {
    const dateKey = addDaysToDateKey(todayKey, offset);
    if (!dateKey) continue;
    // Noon IST (06:30 UTC) is safely inside the same IST date for weekday
    // resolution, away from any midnight edge.
    const [year, month, day] = dateKey.split('-').map(Number);
    const probe = new Date(Date.UTC(year, month - 1, day, 6, 30));
    dates.push({ dateKey, weekday: getCampusTime(probe).weekday });
  }
  return dates;
}

/** `reminder_at = class_start_at - 10 minutes`. */
export function computeReminderAt(classStartAt, leadMinutes = CLASS_REMINDER_LEAD_MINUTES) {
  const start = classStartAt instanceof Date ? classStartAt : new Date(classStartAt);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() - Number(leadMinutes) * 60 * 1000);
}

/** Stable identity for one class on one date. Never per-column. */
export function classReminderEventKey({ dateKey, weekday, eventId }) {
  return `${dateKey}|${weekday}|${eventId}`;
}

/**
 * Reminders for one division on one date, from that day's events.
 *
 * Only academic events (`standard`, `batch`) generate reminders. A batch
 * practical spanning two printed columns is one event and therefore one
 * reminder — never one per column. Lunch and the Empowerment Hour never
 * generate reminders. Only future reminders are returned (a reminder whose
 * time has already passed is never materialised).
 *
 * @param {object} input
 * @param {string} input.division  canonical letter (A–R)
 * @param {string} input.dateKey  Asia/Kolkata `YYYY-MM-DD`
 * @param {string} input.weekday  e.g. `Monday`
 * @param {Array} input.events  the day's view-model events
 * @param {Date} [input.now]  scheduling instant (defaults to now)
 * @returns {Array} reminders with ISO instants, sorted by start time
 */
export function buildRemindersForDate({ division, dateKey, weekday, events = [], now = new Date(), includeDue = false } = {}) {
  const letter = normalizeDivision(division);
  if (!letter || !dateKey || !weekday) return [];
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();

  const reminders = [];
  for (const event of events) {
    if (!event || (event.kind !== 'standard' && event.kind !== 'batch')) continue;
    const startMinutes = Number(event.startMinutes);
    if (!Number.isFinite(startMinutes)) continue;
    const classStartAt = istDateKeyToUtc(dateKey, startMinutes);
    if (!classStartAt) continue;
    const reminderAt = computeReminderAt(classStartAt);
    if (!reminderAt) continue;
    // Never materialise a reminder whose time has already passed.
    if ((includeDue ? classStartAt : reminderAt).getTime() <= nowMs) continue;

    const subject = event.subject || (Array.isArray(event.lines) ? String(event.lines[0] || '').slice(0, 40) : '');
    const timeLabel = event.time?.label12 || '';
    reminders.push({
      event_key: classReminderEventKey({ dateKey, weekday, eventId: event.id }),
      event_day: weekday,
      event_date: dateKey,
      division: letter,
      kind: event.kind,
      subject: String(subject || '').slice(0, 80),
      time_label: String(timeLabel || '').slice(0, 40),
      class_start_at: classStartAt.toISOString(),
      reminder_at: reminderAt.toISOString(),
    });
  }
  reminders.sort((a, b) => Date.parse(a.class_start_at) - Date.parse(b.class_start_at));
  return reminders;
}

/**
 * Reminders for one division across several dates.
 *
 * @param {object} input
 * @param {string} input.division
 * @param {Array<{dateKey: string, weekday: string, events: Array}>} input.dates
 * @param {Date} [input.now]
 */
export function buildRemindersForDivision({ division, dates = [], now = new Date(), includeDue = false } = {}) {
  const letter = normalizeDivision(division);
  if (!letter) return [];
  const all = [];
  for (const entry of dates) {
    all.push(...buildRemindersForDate({
      division: letter,
      dateKey: entry.dateKey,
      weekday: entry.weekday,
      events: entry.events || [],
      now,
      includeDue,
    }));
  }
  all.sort((a, b) => Date.parse(a.class_start_at) - Date.parse(b.class_start_at));
  return all;
}

/**
 * Reconcile desired reminders against already-queued pending rows.
 *
 * This is what makes duplicate scheduler executions harmless: a second run
 * with the same desired set produces no inserts and no cancels. A division
 * change (O → P), a timetable edit, or a cancellation shows up as
 * desired-vs-existing drift and is repaired by cancelling obsolete rows and
 * inserting the new ones.
 *
 * @param {Array} desired  reminders from `buildRemindersForDivision`
 * @param {Array} existing  queued rows `{ id, event_key, reminder_at, status }`
 * @param {Date} [now]  only future pending rows are considered
 * @returns {{ toInsert: Array, toCancelIds: Array<string> }}
 */
export function reconcileReminders(desired = [], existing = [], now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const desiredKeys = new Set(desired.map((row) => row.event_key));
  const pending = existing.filter(
    (row) => row && row.status === 'pending' && Date.parse(row.reminder_at) > nowMs,
  );
  const existingKeys = new Set(pending.map((row) => row.event_key));
  const toInsert = desired.filter((row) => !existingKeys.has(row.event_key));
  const toCancelIds = pending.filter((row) => !desiredKeys.has(row.event_key)).map((row) => row.id);
  return { toInsert, toCancelIds };
}

/**
 * Whether a queued reminder may be delivered right now.
 *
 * This is the pre-delivery re-check: the scheduler payload is never trusted.
 * The current profile (status, division, preference) and the current
 * timetable are read fresh, and delivery happens only when all of them still
 * agree. A division change, a disabled preference, a suspension, a removed
 * division, or a cancelled session all refuse delivery here.
 *
 * @param {object} input
 * @param {object} input.queueRow  `{ division, event_key, event_date, event_day, class_start_at, reminder_at }`
 * @param {object} input.currentProfile  same shape as `isEligibleForClassReminders`
 * @param {Array} [input.currentEvents]  the day's current events (for cancellation checks)
 * @param {Date} [input.now]
 * @returns {{ deliver: boolean, reason: string }}
 */
export function shouldDeliverReminder({ queueRow, currentProfile, currentEvents = null, now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const eligibility = isEligibleForClassReminders(currentProfile || {});
  if (!eligibility.eligible) return { deliver: false, reason: eligibility.reason };

  const currentDivision = normalizeDivision(currentProfile?.division);
  const queuedDivision = normalizeDivision(queueRow?.division);
  if (!currentDivision || currentDivision !== queuedDivision) {
    return { deliver: false, reason: 'division-changed' };
  }

  const classStartMs = Date.parse(queueRow?.class_start_at);
  const reminderMs = Date.parse(queueRow?.reminder_at);
  if (!Number.isFinite(classStartMs) || !Number.isFinite(reminderMs)) {
    return { deliver: false, reason: 'invalid-times' };
  }
  if (nowMs < reminderMs) return { deliver: false, reason: 'not-yet-due' };
  // A reminder that arrives after the class has started is useless noise.
  if (nowMs >= classStartMs) return { deliver: false, reason: 'class-started' };

  // Cancelled / rescheduled: the event must still exist at the same start.
  if (Array.isArray(currentEvents)) {
    const eventId = String(queueRow?.event_key || '').split('|').at(-1);
    const stillThere = currentEvents.some((event) => {
      if (!event || (event.kind !== 'standard' && event.kind !== 'batch')) return false;
      if (eventId && event.id !== eventId) return false;
      const start = istDateKeyToUtc(queueRow.event_date, Number(event.startMinutes));
      return start && start.getTime() === classStartMs;
    });
    if (!stillThere) return { deliver: false, reason: 'session-cancelled' };
  }

  return { deliver: true, reason: 'eligible' };
}

/** True when a reminder is inside its delivery window right now. */
export function isReminderDue(reminder = {}, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const reminderMs = Date.parse(reminder.reminder_at);
  const classStartMs = Date.parse(reminder.class_start_at);
  if (!Number.isFinite(reminderMs) || !Number.isFinite(classStartMs)) return false;
  return reminderMs <= nowMs && nowMs < classStartMs;
}

/**
 * Due reminders for the in-app popup, earliest first.
 *
 * The popup only fires while the page is active and the reminder is in its
 * 10-minute window. Callers pass a `shownKeys` set (in-memory only — never
 * persisted) so a dismissed reminder never re-appears on re-render or
 * route navigation.
 */
export function getDueReminders(reminders = [], now = new Date(), shownKeys = new Set()) {
  return reminders
    .filter((reminder) => isReminderDue(reminder, now) && !shownKeys.has(reminder.event_key))
    .sort((a, b) => Date.parse(a.reminder_at) - Date.parse(b.reminder_at));
}

/** Whether this reminder should be shown now (due and not yet shown). */
export function shouldShowPopup(reminder = {}, now = new Date(), shownKeys = new Set()) {
  return isReminderDue(reminder, now) && !shownKeys.has(reminder.event_key);
}

export { DIVISIONS };
