import { NextResponse } from 'next/server';
import { BLOCKED_STATUSES, getCurrentUser } from '@/lib/auth/session';
import { getDivisionTimetable } from '@/lib/timetable';
import { normalizeDivision } from '@/lib/timetable/meta';
import {
  buildRemindersForDivision,
  getCampusDates,
  isEligibleForClassReminders,
} from '@/lib/reminders/reminders';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
};

/**
 * GET /api/reminders/me
 *
 * The signed-in student's own class-reminder state: eligibility, division
 * (from the authenticated profile — never from a query parameter), the
 * opt-in, and the upcoming reminders for that division. The in-app popup
 * polls this (and re-reads on focus) so a division or preference change
 * made while the app is open updates the locally scheduled popups too.
 *
 * Ineligible accounts (visitors, suspended, no division, preference off)
 * receive an empty reminder list — never another student's classes.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user?.profile) {
      return NextResponse.json({ ok: false }, { status: 401, headers: PRIVATE_HEADERS });
    }
    if (user.needsProfileSetup || BLOCKED_STATUSES.includes(user.accountStatus)) {
      return NextResponse.json({ ok: false }, { status: 403, headers: PRIVATE_HEADERS });
    }

    const profile = user.profile;
    const eligibility = isEligibleForClassReminders({
      accountType: user.accountType,
      accountStatus: user.accountStatus,
      division: profile.division,
      classReminderPopups: profile.class_reminder_popups === true,
      profileCompleted: profile.profile_completed === true,
      username: profile.username || null,
    });

    const now = new Date();
    let reminders = [];
    if (eligibility.eligible) {
      const dates = getCampusDates(now, 1).map(({ dateKey, weekday }) => {
        const probe = new Date(`${dateKey}T06:30:00.000Z`); // noon IST
        const timetable = getDivisionTimetable(profile.division, { at: probe });
        const day = timetable?.days?.find((entry) => entry.day === weekday);
        return { dateKey, weekday, events: day?.events || [] };
      });
      reminders = buildRemindersForDivision({ division: profile.division, dates, now, includeDue: true });
      const events = new Map(dates.flatMap(({ dateKey, weekday, events }) =>
        events.map((event) => [`${dateKey}|${weekday}|${event.id}`, event])));
      reminders = reminders.map((reminder) => {
        const event = events.get(reminder.event_key);
        return {
          ...reminder,
          start_label: event?.time?.fromLabel || '',
          // The printed third line carries room allocations, potentially one per batch.
          location: event?.lines?.length >= 3 ? String(event.lines[2]).slice(0, 100) : '',
        };
      });
    }

    return NextResponse.json(
      {
        ok: true,
        profileId: profile.id,
        dateKey: getCampusDates(now, 1)[0].dateKey,
        eligible: eligibility.eligible,
        reason: eligibility.reason,
        division: normalizeDivision(profile.division),
        classReminderPopups: profile.class_reminder_popups === true,
        reminders,
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
