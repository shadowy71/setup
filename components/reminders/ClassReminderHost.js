import { getCurrentUser, BLOCKED_STATUSES } from '@/lib/auth/session';
import { getDivisionTimetable } from '@/lib/timetable';
import {
  CLASS_REMINDER_HORIZON_DAYS,
  buildRemindersForDivision,
  getCampusDates,
  isEligibleForClassReminders,
} from '@/lib/reminders/reminders';
import { ClassReminderPopup } from '@/components/reminders/ClassReminderPopup';

/**
 * Server host for the in-app class-reminder popup.
 *
 * Rendered inside the authenticated layout so the popup is available on
 * every signed-in page. Eligibility and the division come from the
 * authenticated profile; ineligible accounts (visitors, suspended, no
 * division, preference off) render nothing. The client component polls
 * `/api/reminders/me` so profile changes made while the app is open are
 * picked up without a reload.
 */
export async function ClassReminderHost() {
  const user = await getCurrentUser();
  if (!user?.profile) return null;
  if (user.needsProfileSetup || BLOCKED_STATUSES.includes(user.accountStatus)) return null;

  const profile = user.profile;
  const eligibility = isEligibleForClassReminders({
    accountType: user.accountType,
    accountStatus: user.accountStatus,
    division: profile.division,
    classReminderPopups: profile.class_reminder_popups === true,
    profileCompleted: profile.profile_completed === true,
    username: profile.username || null,
  });
  if (!eligibility.eligible) return null;

  const now = new Date();
  const dates = getCampusDates(now, CLASS_REMINDER_HORIZON_DAYS).map(({ dateKey, weekday }) => {
    const probe = new Date(`${dateKey}T06:30:00.000Z`); // noon IST
    const timetable = getDivisionTimetable(profile.division, { at: probe });
    const day = timetable?.days?.find((entry) => entry.day === weekday);
    return { dateKey, weekday, events: day?.events || [] };
  });
  const reminders = buildRemindersForDivision({ division: profile.division, dates, now, includeDue: true });

  return <ClassReminderPopup initialReminders={reminders} />;
}
