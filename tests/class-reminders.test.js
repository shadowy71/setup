import { describe, expect, it } from 'vitest';

import {
  CLASS_REMINDER_LEAD_MINUTES,
  addDaysToDateKey,
  buildPushPayload,
  buildRemindersForDate,
  buildRemindersForDivision,
  computeReminderAt,
  getCampusDates,
  getDueReminders,
  isEligibleForClassReminders,
  isReminderDue,
  isValidDivision,
  istDateKeyToUtc,
  looksLikeEmail,
  parsePushNotificationData,
  reconcileReminders,
  shouldDeliverReminder,
  shouldShowPopup,
} from '@/lib/reminders/reminders';
import { getDivisionTimetable } from '@/lib/timetable';

/**
 * Personalized class reminders — the pure rules.
 *
 * The division always comes from the authenticated profile; these tests pin
 * that a Division O student gets only O reminders, a Division J student
 * only J, and that visitors, no-division accounts, suspended accounts and
 * disabled preferences get none. They also pin the exact 10-minute
 * calculation in Asia/Kolkata, one-reminder-per-practical-block (never per
 * printed column), idempotent reconciliation, pre-delivery re-checks, and
 * minimal push payloads.
 */

const eligible = (overrides = {}) => ({
  accountType: 'student',
  accountStatus: 'active',
  division: 'O',
  classReminderPopups: true,
  profileCompleted: true,
  username: 'student_o',
  ...overrides,
});

// 2026-11-23 is a Monday (special week). Noon IST probe for timetable resolution.
const MONDAY_PROBE = new Date('2026-11-23T06:30:00.000Z');
const MONDAY_KEY = '2026-11-23';

function dayEvents(division, weekday, at) {
  const timetable = getDivisionTimetable(division, { at });
  return timetable.days.find((day) => day.day === weekday)?.events || [];
}

describe('eligibility — only an active institutional student with a division and opt-in', () => {
  it('admits an eligible Division O student', () => {
    expect(isEligibleForClassReminders(eligible()).eligible).toBe(true);
  });

  it('admits an eligible Division J student (pending is usable)', () => {
    expect(isEligibleForClassReminders(eligible({ division: 'J', accountStatus: 'pending' })).eligible).toBe(true);
  });

  it('refuses a visitor even with a division and opt-in', () => {
    const result = isEligibleForClassReminders(eligible({ accountType: 'visitor' }));
    expect(result).toEqual({ eligible: false, reason: 'not-institutional' });
  });

  it('refuses anonymous / unclassified accounts', () => {
    expect(isEligibleForClassReminders(eligible({ accountType: null })).reason).toBe('not-authenticated');
  });

  it('refuses suspended, banned, deactivated and deleted accounts', () => {
    for (const status of ['suspended', 'banned', 'deactivated', 'deleted']) {
      expect(isEligibleForClassReminders(eligible({ accountStatus: status })).reason).toBe('blocked-status');
    }
  });

  it('refuses a student with no division', () => {
    expect(isEligibleForClassReminders(eligible({ division: null })).reason).toBe('no-division');
    expect(isEligibleForClassReminders(eligible({ division: '' })).reason).toBe('no-division');
    expect(isEligibleForClassReminders(eligible({ division: 'Z' })).reason).toBe('no-division');
  });

  it('refuses a student whose preference is disabled (default)', () => {
    expect(isEligibleForClassReminders(eligible({ classReminderPopups: false })).reason).toBe('preference-disabled');
    expect(isEligibleForClassReminders(eligible({ classReminderPopups: undefined })).reason).toBe('preference-disabled');
  });

  it('refuses an unfinished profile', () => {
    expect(isEligibleForClassReminders(eligible({ profileCompleted: false })).reason).toBe('profile-incomplete');
    expect(isEligibleForClassReminders(eligible({ username: null })).reason).toBe('profile-incomplete');
  });

  it('one student\u2019s preference never affects another (pure per-account check)', () => {
    const a = eligible({ division: 'O', classReminderPopups: true });
    const b = eligible({ division: 'O', classReminderPopups: false, username: 'student_o2' });
    expect(isEligibleForClassReminders(a).eligible).toBe(true);
    expect(isEligibleForClassReminders(b).eligible).toBe(false);
  });

  it('validates all eighteen divisions and rejects everything else', () => {
    for (const letter of ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R']) {
      expect(isValidDivision(letter)).toBe(true);
      expect(isValidDivision(letter.toLowerCase())).toBe(true);
    }
    for (const bad of [null, '', 'Z', 'AA', '1', ' O ', 0]) {
      // ' O ' normalises to O (profile values are trimmed); the rest reject.
      if (bad === ' O ') expect(isValidDivision(bad)).toBe(true);
      else expect(isValidDivision(bad)).toBe(false);
    }
  });
});

describe('exact reminder calculation — Asia/Kolkata, 10 minutes before', () => {
  it('fixes the lead time at 10 minutes', () => {
    expect(CLASS_REMINDER_LEAD_MINUTES).toBe(10);
  });

  it('converts an IST wall-clock time to the correct UTC instant', () => {
    // 09:00 IST = 03:30 UTC.
    expect(istDateKeyToUtc(MONDAY_KEY, 540).toISOString()).toBe('2026-11-23T03:30:00.000Z');
    // 14:10 IST = 08:40 UTC.
    expect(istDateKeyToUtc(MONDAY_KEY, 850).toISOString()).toBe('2026-11-23T08:40:00.000Z');
  });

  it('computes reminder_at as class_start_at minus 10 minutes', () => {
    const start = istDateKeyToUtc(MONDAY_KEY, 540);
    expect(computeReminderAt(start).toISOString()).toBe('2026-11-23T03:20:00.000Z');
  });

  it('generates only standard and batch events (never lunch or Empowerment Hour)', () => {
    const events = dayEvents('O', 'Monday', MONDAY_PROBE);
    const reminders = buildRemindersForDate({
      division: 'O', dateKey: MONDAY_KEY, weekday: 'Monday', events,
      now: new Date('2026-11-22T00:00:00.000Z'),
    });
    expect(reminders.length).toBeGreaterThan(0);
    for (const reminder of reminders) {
      expect(['standard', 'batch']).toContain(reminder.kind);
      expect(reminder.subject).not.toBe('Lunch');
      expect(reminder.subject).not.toBe('Empowerment');
    }
    // Every academic event that day has exactly one reminder.
    const academic = events.filter((event) => event.kind === 'standard' || event.kind === 'batch');
    expect(reminders).toHaveLength(academic.length);
  });

  it('includes an already-due class for the in-app popup until it starts', () => {
    const events = dayEvents('O', 'Monday', MONDAY_PROBE);
    const before = buildRemindersForDate({ division: 'O', dateKey: MONDAY_KEY, weekday: 'Monday', events, now: new Date('2026-11-22T00:00:00Z') });
    const first = before[0];
    const now = new Date(Date.parse(first.reminder_at) + 1000);
    const during = buildRemindersForDivision({ division: 'O', dates: [{ dateKey: MONDAY_KEY, weekday: 'Monday', events }], now, includeDue: true });
    expect(during.some((item) => item.event_key === first.event_key)).toBe(true);
    expect(getDueReminders(during, now).some((item) => item.event_key === first.event_key)).toBe(true);
    const after = buildRemindersForDate({ division: 'O', dateKey: MONDAY_KEY, weekday: 'Monday', events, now: new Date(first.class_start_at), includeDue: true });
    expect(after.some((item) => item.event_key === first.event_key)).toBe(false);
  });

  it('never generates separate notifications for columns of the same practical block', () => {
    const events = dayEvents('O', 'Monday', MONDAY_PROBE);
    const block = events.find((event) => event.span > 1 && event.kind === 'batch');
    expect(block, 'Division O Monday should have a spanning batch block').toBeTruthy();
    const reminders = buildRemindersForDate({
      division: 'O', dateKey: MONDAY_KEY, weekday: 'Monday', events,
      now: new Date('2026-11-22T00:00:00.000Z'),
    });
    const forBlock = reminders.filter((reminder) => reminder.event_key.endsWith(block.id));
    expect(forBlock).toHaveLength(1);
  });

  it('never materialises a reminder whose time has already passed', () => {
    const events = dayEvents('O', 'Monday', MONDAY_PROBE);
    const reminders = buildRemindersForDate({
      division: 'O', dateKey: MONDAY_KEY, weekday: 'Monday', events,
      now: new Date('2026-11-23T04:00:00.000Z'), // 09:30 IST — first class already started
    });
    for (const reminder of reminders) {
      expect(Date.parse(reminder.reminder_at)).toBeGreaterThan(Date.parse('2026-11-23T04:00:00.000Z'));
    }
  });

  it('a Division O student receives only O reminders; Division J only J', () => {
    const now = new Date('2026-11-22T00:00:00.000Z');
    const o = buildRemindersForDivision({
      division: 'O',
      dates: [{ dateKey: MONDAY_KEY, weekday: 'Monday', events: dayEvents('O', 'Monday', MONDAY_PROBE) }],
      now,
    });
    const j = buildRemindersForDivision({
      division: 'J',
      dates: [{ dateKey: MONDAY_KEY, weekday: 'Monday', events: dayEvents('J', 'Monday', MONDAY_PROBE) }],
      now,
    });
    expect(o.length).toBeGreaterThan(0);
    expect(j.length).toBeGreaterThan(0);
    expect(o.every((reminder) => reminder.division === 'O')).toBe(true);
    expect(j.every((reminder) => reminder.division === 'J')).toBe(true);
    // The two sets are built from different timetables: at least one class
    // differs (subject or time), so O never receives J's exact schedule.
    const oKeys = new Set(o.map((reminder) => `${reminder.subject}|${reminder.class_start_at}`));
    const jKeys = new Set(j.map((reminder) => `${reminder.subject}|${reminder.class_start_at}`));
    expect([...oKeys].some((key) => !jKeys.has(key))).toBe(true);
  });

  it('supports special-week and normal-week dates through the same builder', () => {
    // Special week: 2026-11-23 (Monday) resolves to the special sheet.
    const special = buildRemindersForDate({
      division: 'O', dateKey: MONDAY_KEY, weekday: 'Monday',
      events: dayEvents('O', 'Monday', MONDAY_PROBE),
      now: new Date('2026-11-22T00:00:00.000Z'),
    });
    // Normal week: 2026-12-07 (Monday) resolves to the master.
    const normalProbe = new Date('2026-12-07T06:30:00.000Z');
    const normal = buildRemindersForDate({
      division: 'O', dateKey: '2026-12-07', weekday: 'Monday',
      events: dayEvents('O', 'Monday', normalProbe),
      now: new Date('2026-12-06T00:00:00.000Z'),
    });
    expect(special.length).toBeGreaterThan(0);
    expect(normal.length).toBeGreaterThan(0);
  });

  it('campus dates are consecutive Asia/Kolkata dates with weekday names', () => {
    const dates = getCampusDates(new Date('2026-11-22T00:00:00.000Z'), 7);
    expect(dates).toHaveLength(7);
    expect(dates[0].dateKey).toBe('2026-11-22');
    expect(addDaysToDateKey('2026-11-22', 1)).toBe('2026-11-23');
    expect(addDaysToDateKey('2026-11-30', 1)).toBe('2026-12-01');
  });
});

describe('scheduler reconciliation — duplicate runs never duplicate', () => {
  const desired = [
    { event_key: '2026-11-23|Monday|a', reminder_at: '2026-11-23T03:20:00.000Z' },
    { event_key: '2026-11-23|Monday|b', reminder_at: '2026-11-23T04:20:00.000Z' },
  ];
  const existing = [
    { id: '1', event_key: '2026-11-23|Monday|a', reminder_at: '2026-11-23T03:20:00.000Z', status: 'pending' },
    { id: '2', event_key: '2026-11-23|Monday|b', reminder_at: '2026-11-23T04:20:00.000Z', status: 'pending' },
  ];
  const now = new Date('2026-11-22T00:00:00.000Z');

  it('a second identical run inserts nothing and cancels nothing', () => {
    const { toInsert, toCancelIds } = reconcileReminders(desired, existing, now);
    expect(toInsert).toEqual([]);
    expect(toCancelIds).toEqual([]);
  });

  it('a division change (O → P) cancels obsolete rows and inserts the new set', () => {
    const next = [{ event_key: '2026-11-23|Monday|c', reminder_at: '2026-11-23T03:20:00.000Z' }];
    const { toInsert, toCancelIds } = reconcileReminders(next, existing, now);
    expect(toInsert).toHaveLength(1);
    expect(toCancelIds.sort()).toEqual(['1', '2']);
  });

  it('a cancelled session cancels only that row', () => {
    const { toInsert, toCancelIds } = reconcileReminders([desired[0]], existing, now);
    expect(toInsert).toEqual([]);
    expect(toCancelIds).toEqual(['2']);
  });

  it('already-delivered rows are never resurrected', () => {
    const withDelivered = [...existing, { id: '3', event_key: '2026-11-23|Monday|a', reminder_at: '2026-11-23T03:20:00.000Z', status: 'delivered' }];
    const { toInsert } = reconcileReminders(desired, withDelivered, now);
    expect(toInsert).toEqual([]);
  });
});

describe('pre-delivery re-check — queued rows are never trusted', () => {
  const events = dayEvents('O', 'Monday', MONDAY_PROBE);
  const first = events.find((event) => event.kind === 'standard' || event.kind === 'batch');
  const [reminder] = buildRemindersForDate({
    division: 'O', dateKey: MONDAY_KEY, weekday: 'Monday', events,
    now: new Date('2026-11-22T00:00:00.000Z'),
  });
  const dueAt = new Date(Date.parse(reminder.reminder_at) + 60 * 1000); // 1 min after reminder time
  const queueRow = { ...reminder, event_date: MONDAY_KEY, event_day: 'Monday' };

  it('delivers when the current profile still agrees', () => {
    expect(shouldDeliverReminder({ queueRow, currentProfile: eligible(), currentEvents: events, now: dueAt }).deliver).toBe(true);
  });

  it('refuses when the preference was disabled after queueing', () => {
    const decision = shouldDeliverReminder({
      queueRow, currentProfile: eligible({ classReminderPopups: false }), currentEvents: events, now: dueAt,
    });
    expect(decision).toEqual({ deliver: false, reason: 'preference-disabled' });
  });

  it('refuses when the account was suspended after queueing', () => {
    const decision = shouldDeliverReminder({
      queueRow, currentProfile: eligible({ accountStatus: 'suspended' }), currentEvents: events, now: dueAt,
    });
    expect(decision.reason).toBe('blocked-status');
  });

  it('refuses when the division changed (O → P) after queueing', () => {
    const decision = shouldDeliverReminder({
      queueRow, currentProfile: eligible({ division: 'P' }), currentEvents: events, now: dueAt,
    });
    expect(decision).toEqual({ deliver: false, reason: 'division-changed' });
  });

  it('refuses when the division was removed after queueing', () => {
    const decision = shouldDeliverReminder({
      queueRow, currentProfile: eligible({ division: null }), currentEvents: events, now: dueAt,
    });
    expect(decision.deliver).toBe(false);
  });

  it('refuses before the reminder time and after the class starts', () => {
    expect(shouldDeliverReminder({
      queueRow, currentProfile: eligible(), currentEvents: events,
      now: new Date(Date.parse(reminder.reminder_at) - 60 * 1000),
    }).reason).toBe('not-yet-due');
    expect(shouldDeliverReminder({
      queueRow, currentProfile: eligible(), currentEvents: events,
      now: new Date(Date.parse(reminder.class_start_at) + 60 * 1000),
    }).reason).toBe('class-started');
  });

  it('refuses a cancelled session (event no longer in the timetable)', () => {
    const withoutFirst = events.filter((event) => event.id !== first.id);
    const decision = shouldDeliverReminder({
      queueRow, currentProfile: eligible(), currentEvents: withoutFirst, now: dueAt,
    });
    expect(decision).toEqual({ deliver: false, reason: 'session-cancelled' });
  });
});

describe('push payloads — minimal, no private details', () => {
  it('contains only subject, time label and timetable URL', () => {
    const payload = buildPushPayload({
      subject: 'WDL', time_label: '9:00–11:00 AM', division: 'O', event_key: '2026-11-23|Monday|a',
    });
    expect(payload.title).toBe('Class in 10 minutes');
    expect(payload.body).toBe('WDL · 9:00–11:00 AM');
    expect(payload.url).toBe('/timetable/o');
    expect(payload.tag).toBe('2026-11-23|Monday|a');
    expect(looksLikeEmail(payload.title)).toBe(false);
    expect(looksLikeEmail(payload.body)).toBe(false);
    expect(JSON.stringify(payload)).not.toMatch(/@gmail|@pccoepune|student_o/);
  });

  it('service-worker parsing sanitises the URL (no open redirect)', () => {
    expect(parsePushNotificationData(JSON.stringify({ title: 't', body: 'b', url: '/timetable/o', tag: 'x' })).url).toBe('/timetable/o');
    expect(parsePushNotificationData(JSON.stringify({ url: 'https://evil.example/phish' })).url).toBe('/timetable');
    expect(parsePushNotificationData(JSON.stringify({ url: '/admin' })).url).toBe('/timetable');
    expect(parsePushNotificationData(null).title).toBe('Class in 10 minutes');
    expect(parsePushNotificationData('not json').url).toBe('/timetable');
  });
});

describe('in-app popup — due only in the 10-minute window, never re-fired', () => {
  const reminder = {
    event_key: '2026-11-23|Monday|a',
    reminder_at: '2026-11-23T03:20:00.000Z',
    class_start_at: '2026-11-23T03:30:00.000Z',
  };

  it('is due only between reminder time and class start', () => {
    expect(isReminderDue(reminder, new Date('2026-11-23T03:19:00.000Z'))).toBe(false);
    expect(isReminderDue(reminder, new Date('2026-11-23T03:20:00.000Z'))).toBe(true);
    expect(isReminderDue(reminder, new Date('2026-11-23T03:29:00.000Z'))).toBe(true);
    expect(isReminderDue(reminder, new Date('2026-11-23T03:30:00.000Z'))).toBe(false);
  });

  it('a dismissed reminder never re-appears (in-memory shown set)', () => {
    const shown = new Set([reminder.event_key]);
    expect(shouldShowPopup(reminder, new Date('2026-11-23T03:25:00.000Z'), shown)).toBe(false);
    expect(getDueReminders([reminder], new Date('2026-11-23T03:25:00.000Z'), shown)).toEqual([]);
    expect(shouldShowPopup(reminder, new Date('2026-11-23T03:25:00.000Z'), new Set())).toBe(true);
  });

  it('an ineligible account has no reminders to show', () => {
    // The API returns an empty list for ineligible accounts; the popup
    // therefore has nothing to schedule. This pins the contract.
    expect(getDueReminders([], new Date('2026-11-23T03:25:00.000Z'), new Set())).toEqual([]);
  });
});
