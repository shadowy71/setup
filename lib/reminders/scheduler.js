/**
 * Class-reminder scheduler and dispatcher (server-only).
 *
 * The scheduler materialises upcoming reminders from the *current* database
 * state — active institutional accounts, their individual opt-in, their
 * current `profiles.division`, and the timetable in effect for each date
 * (special week included). It never sends anything; it only reconciles the
 * queue so that duplicate runs are harmless and profile/timetable changes
 * are repaired on the next run.
 *
 * The dispatcher delivers due reminders. It never trusts the queued row:
 * immediately before sending it re-reads the profile (status, division,
 * preference) and the current timetable, and skips anything that no longer
 * agrees. Delivery is claimed atomically (`pending → delivered/skipped`)
 * so two concurrent dispatcher runs cannot double-send.
 *
 * Both use the service-role client (trusted server credentials) because
 * they must read across profiles. Clients never touch the queue directly.
 */

import 'server-only';
import { getDivisionTimetable } from '@/lib/timetable';
import {
  CLASS_REMINDER_HORIZON_DAYS,
  buildRemindersForDivision,
  buildPushPayload,
  getCampusDates,
  isEligibleForClassReminders,
  reconcileReminders,
  shouldDeliverReminder,
} from '@/lib/reminders/reminders';
import { sendPushToSubscriptions, isPushConfigured } from '@/lib/reminders/push';

/** Eligible recipients, read fresh from the database on every run. */
async function findEligibleProfiles(admin) {
  const { data, error } = await admin
    .from('profile_private')
    .select('profile_id, account_type, account_status, class_reminder_popups, profile_completed, profiles(id, username, division)')
    .eq('account_type', 'student')
    .eq('class_reminder_popups', true)
    .in('account_status', ['active', 'pending']);
  if (error) throw new Error(`scheduler: eligible query failed: ${error.message}`);
  return (data || []).filter((row) => {
    const profile = row.profiles || {};
    return isEligibleForClassReminders({
      accountType: row.account_type,
      accountStatus: row.account_status,
      division: profile.division,
      classReminderPopups: row.class_reminder_popups,
      profileCompleted: row.profile_completed,
      username: profile.username,
    }).eligible;
  }).map((row) => ({
    profileId: row.profile_id,
    division: row.profiles.division,
    accountType: row.account_type,
    accountStatus: row.account_status,
    classReminderPopups: row.class_reminder_popups,
    profileCompleted: row.profile_completed,
    username: row.profiles.username,
  }));
}

/**
 * Materialise the next `horizonDays` of reminders for every eligible
 * student. Idempotent: running it twice inserts nothing the second time.
 *
 * @param {object} input
 * @param {import('@supabase/supabase-js').SupabaseClient} input.admin  service-role client
 * @param {Date} [input.now]
 * @param {number} [input.horizonDays]
 * @returns {Promise<{profiles: number, inserted: number, cancelled: number}>}
 */
export async function scheduleClassReminders({ admin, now = new Date(), horizonDays = CLASS_REMINDER_HORIZON_DAYS } = {}) {
  if (!admin) throw new Error('scheduleClassReminders requires the admin client');
  const eligible = await findEligibleProfiles(admin);
  const dates = getCampusDates(now, horizonDays);
  let inserted = 0;
  let cancelled = 0;

  for (const person of eligible) {
    // Resolve the week per date: the special sheet applies only inside its
    // window, so each date asks for the timetable in effect on that date.
    const datedEvents = dates.map(({ dateKey, weekday }) => {
      const probe = new Date(`${dateKey}T06:30:00.000Z`); // noon IST
      const timetable = getDivisionTimetable(person.division, { at: probe });
      const day = timetable?.days?.find((entry) => entry.day === weekday);
      return { dateKey, weekday, events: day?.events || [] };
    });
    const desired = buildRemindersForDivision({ division: person.division, dates: datedEvents, now });

    const { data: existing, error: existingError } = await admin
      .from('class_reminder_queue')
      .select('id, event_key, reminder_at, status')
      .eq('profile_id', person.profileId)
      .eq('status', 'pending');
    if (existingError) throw new Error(`scheduler: queue query failed: ${existingError.message}`);
    const { toInsert, toCancelIds } = reconcileReminders(desired, existing || [], now);

    if (toCancelIds.length) {
      const { error } = await admin
        .from('class_reminder_queue')
        .update({ status: 'cancelled', skipped_reason: 'timetable-changed' })
        .in('id', toCancelIds);
      if (error) throw new Error(`scheduler: cancellation failed: ${error.message}`);
      cancelled += toCancelIds.length;
    }
    for (const row of toInsert) {
      const { error } = await admin.from('class_reminder_queue').insert({
        profile_id: person.profileId,
        division: row.division,
        event_key: row.event_key,
        event_day: row.event_day,
        event_date: row.event_date,
        class_start_at: row.class_start_at,
        reminder_at: row.reminder_at,
        subject: row.subject,
        time_label: row.time_label,
        kind: row.kind,
        status: 'pending',
      });
      // The unique (profile_id, event_key) constraint is the idempotency
      // backstop: a concurrent run that inserted the same row first makes
      // this insert a no-op rather than a duplicate.
      if (!error) inserted += 1;
      else if (error.code === '23505') {
        // A previously cancelled class can become eligible again. Never
        // resurrect delivered, skipped, or failed reminders.
        const { data: restored, error: restoreError } = await admin
          .from('class_reminder_queue')
          .update({ ...row, status: 'pending', skipped_reason: null })
          .eq('profile_id', person.profileId)
          .eq('event_key', row.event_key)
          .eq('status', 'cancelled')
          .select('id');
        if (restoreError) throw new Error(`scheduler: restore failed: ${restoreError.message}`);
        inserted += restored?.length || 0;
      } else throw new Error(`scheduler: insert failed: ${error.message}`);
    }
  }


  return { profiles: eligible.length, inserted, cancelled };
}

/**
 * Deliver every reminder that is due now, re-checking eligibility first.
 *
 * @param {object} input
 * @param {import('@supabase/supabase-js').SupabaseClient} input.admin  service-role client
 * @param {Date} [input.now]
 * @param {Function} [input.sendPush]  injected for tests; defaults to web-push
 * @returns {Promise<{due: number, delivered: number, skipped: number, pushConfigured: boolean}>}
 */
export async function dispatchDueReminders({ admin, now = new Date(), sendPush = null } = {}) {
  if (!admin) throw new Error('dispatchDueReminders requires the admin client');
  const pushConfigured = isPushConfigured();
  const sender = sendPush || sendPushToSubscriptions;

  const { data: due, error: dueError } = await admin
    .from('class_reminder_queue')
    .select('id, profile_id, division, event_key, event_day, event_date, class_start_at, reminder_at, subject, time_label, kind, status')
    .eq('status', 'pending')
    .lte('reminder_at', now.toISOString())
    .gt('class_start_at', now.toISOString())
    .order('reminder_at', { ascending: true })
    .limit(500);

  if (dueError) throw new Error(`dispatcher: due query failed: ${dueError.message}`);
  let delivered = 0;
  let skipped = 0;

  for (const row of due || []) {
    // Claim the row atomically: only the run that flips pending → a
    // terminal state may deliver. A concurrent run sees zero rows updated
    // and moves on, so duplicate executions never double-send.
    const { data: claimed } = await admin
      .from('class_reminder_queue')
      .update({ status: 'skipped', skipped_reason: 'claimed' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id');
    if (!claimed?.length) continue;

    // Re-check the *current* profile and timetable — never trust the
    // queued payload. Division, status, and preference are read fresh.
    const { data: privateRow } = await admin
      .from('profile_private')
      .select('account_type, account_status, class_reminder_popups, profile_completed')
      .eq('profile_id', row.profile_id)
      .maybeSingle();
    const { data: profileRow } = await admin
      .from('profiles')
      .select('username, division')
      .eq('id', row.profile_id)
      .maybeSingle();
    const currentProfile = {
      accountType: privateRow?.account_type || null,
      accountStatus: privateRow?.account_status || null,
      division: profileRow?.division || null,
      classReminderPopups: privateRow?.class_reminder_popups === true,
      profileCompleted: privateRow?.profile_completed === true,
      username: profileRow?.username || null,
    };

    let currentEvents = null;
    if (row.event_date && row.event_day) {
      const probe = new Date(`${row.event_date}T06:30:00.000Z`);
      const timetable = getDivisionTimetable(row.division, { at: probe });
      currentEvents = timetable?.days?.find((entry) => entry.day === row.event_day)?.events || [];
    }

    const decision = shouldDeliverReminder({ queueRow: row, currentProfile, currentEvents, now });
    if (!decision.deliver) {
      await admin
        .from('class_reminder_queue')
        .update({ status: 'skipped', skipped_reason: decision.reason })
        .eq('id', row.id);
      skipped += 1;
      continue;
    }

    if (!pushConfigured) {
      // In-app popups (client-side, same preference) still work; there is
      // simply no push channel to send on. Record the skip honestly.
      await admin
        .from('class_reminder_queue')
        .update({ status: 'skipped', skipped_reason: 'push-not-configured' })
        .eq('id', row.id);
      skipped += 1;
      continue;
    }

    const { data: subscriptions } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('profile_id', row.profile_id)
      .eq('is_active', true);

    const payload = buildPushPayload(row);
    const result = await sender(subscriptions || [], payload);

    // Clean up revoked/expired endpoints (404/410) so they are never
    // retried; count successes on the survivors.
    if (result.gone?.length) {
      await admin
        .from('push_subscriptions')
        .update({ is_active: false, failure_count: 99, last_failure_at: now.toISOString(), last_error: 'push endpoint gone (404/410)' })
        .in('id', result.gone);
    }
    if (result.sent > 0) {
      await admin
        .from('class_reminder_queue')
        .update({ status: 'delivered', delivered_at: now.toISOString(), skipped_reason: null })
        .eq('id', row.id);
      delivered += 1;
    } else if (result.failed > 0) {
      await admin
        .from('class_reminder_queue')
        .update({ status: 'failed', skipped_reason: 'push-failed' })
        .eq('id', row.id);
      skipped += 1;
    } else {
      // No active devices: nothing to deliver to. The in-app popup remains
      // the channel while the app is open.
      await admin
        .from('class_reminder_queue')
        .update({ status: 'skipped', skipped_reason: 'no-active-devices' })
        .eq('id', row.id);
      skipped += 1;
    }
  }

  return { due: (due || []).length, delivered, skipped, pushConfigured };
}
