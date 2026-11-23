'use server';

/**
 * Personalized class reminders — server actions (spec §1–§9).
 *
 * The division is always derived from the authenticated session
 * (`getCurrentUser().profile.division`); no action accepts a division, a
 * target profile ID, or a subscription owner from the client. The opt-in
 * lives on `profile_private` and is changed only through the audited
 * `set_class_reminder_preference()` RPC, which cancels future reminders
 * and deactivates push when disabled.
 */

import { revalidatePath } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';
import { ROUTES } from '@/lib/constants';

/**
 * Enable or disable "Class reminder popups" for the signed-in student.
 * Accepts a boolean (client toggle) or FormData with a
 * `class_reminder_popups` checkbox (ActionForm).
 */
export async function setClassReminderPreference(input) {
  try {
    const user = await getActiveUser();
    if (!user?.profile) throw errors.unauthenticated();
    if (user.accountType !== 'student') {
      throw errors.validation('Class reminders are available to institutional students only.');
    }
    const enabled = input instanceof FormData
      ? input.get('class_reminder_popups') !== null
      : Boolean(input);

    const supabase = await getServerClient();
    const { error } = await supabase.rpc('set_class_reminder_preference', { p_enabled: enabled });
    if (error) throw fromPostgresError(error);

    revalidatePath(ROUTES.settings);
    revalidatePath('/', 'layout');
    return { ok: true, enabled };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Register (or transfer) this browser's push subscription for the signed-in
 * profile. The profile is derived from the session inside the RPC; the
 * client only supplies the browser's own subscription JSON.
 */
export async function savePushSubscription(subscription, userAgent = null) {
  try {
    const user = await getActiveUser();
    if (!user?.profile) throw errors.unauthenticated();
    const endpoint = String(subscription?.endpoint || '');
    const p256dh = String(subscription?.keys?.p256dh || '');
    const auth = String(subscription?.keys?.auth || '');
    if (!endpoint.startsWith('https://') || !p256dh || !auth) {
      throw errors.validation('This browser did not return a valid push subscription.');
    }
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('upsert_push_subscription', {
      p_endpoint: endpoint.slice(0, 2000),
      p_p256dh: p256dh.slice(0, 500),
      p_auth: auth.slice(0, 500),
      p_user_agent: userAgent ? String(userAgent).slice(0, 500) : null,
    });
    if (error) throw fromPostgresError(error);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Deactivate one device subscription for the signed-in profile (logout /
 * preference off). The RPC checks ownership, so another account's endpoint
 * can never be deactivated through this action.
 */
export async function removePushSubscription(endpoint) {
  try {
    const user = await getActiveUser();
    if (!user?.profile) throw errors.unauthenticated();
    const value = String(endpoint || '');
    if (!value) return { ok: true };
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('deactivate_push_subscription', { p_endpoint: value.slice(0, 2000) });
    if (error) throw fromPostgresError(error);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
