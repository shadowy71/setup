'use client';

/**
 * "Class reminder popups" preference (Settings → Notifications).
 *
 * The opt-in is stored on the authenticated profile (never in browser
 * storage) and enforced by the backend. Enabling also asks for the
 * browser's notification permission and registers this device for Web
 * Push — permission and preference are separate gates, and both must
 * allow delivery. If permission is denied, the in-app popup still works
 * while Campus+ is open.
 *
 * The division is never chosen here: it is read from the profile. When
 * the profile has no division, no push subscription is created and the
 * student is linked to Settings → Profile; reminders become eligible
 * automatically once the division is added (provided they opted in).
 */

import { useState } from 'react';
import Link from 'next/link';
import { Card, Notice, Switch } from '@/components/ui';
import { ROUTES } from '@/lib/constants';
import { setClassReminderPreference, savePushSubscription, removePushSubscription } from '@/lib/actions/reminders';
import {
  isPushSupported,
  notificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  getCurrentSubscriptionEndpoint,
} from '@/lib/push/subscribe';

export function ClassReminderSettings({
  initialEnabled = false,
  division = null,
  eligible = false,
  reason = 'preference-disabled',
  accountType = null,
}) {
  const [enabled, setEnabled] = useState(Boolean(initialEnabled));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [pushNote, setPushNote] = useState(null);

  const isStudent = accountType === 'student';
  const hasDivision = Boolean(division);

  async function handleToggle(next) {
    setPending(true);
    setError(null);
    setPushNote(null);
    try {
      const result = await setClassReminderPreference(next);
      if (!result?.ok) {
        setError(result?.error || 'Could not save your preference. Please try again.');
        return;
      }
      setEnabled(next);

      if (next) {
        if (!hasDivision) {
          setPushNote('Saved. Add your division in Settings → Profile and reminders will start automatically — no extra opt-in needed.');
          return;
        }
        if (!isPushSupported()) {
          setPushNote('Saved. This browser does not support Web Push, so reminders will show as popups while Campus+ is open.');
          return;
        }
        const permission = notificationPermission();
        if (permission === 'denied') {
          setPushNote('Saved. Browser notifications are blocked, so reminders will show as popups while Campus+ is open. Allow notifications in your browser settings to also get them when the app is closed.');
          return;
        }
        const sub = await subscribeToPush();
        if (!sub.ok) {
          if (sub.error === 'push-unconfigured') {
            setPushNote('Saved. Web Push is not configured on this deployment yet, so reminders will show as popups while Campus+ is open.');
          } else if (sub.error === 'permission-denied') {
            setPushNote('Saved. Browser notifications are blocked, so reminders will show as popups while Campus+ is open.');
          } else {
            setPushNote('Saved. Could not register this device for push, so reminders will show as popups while Campus+ is open.');
          }
          return;
        }
        const saved = await savePushSubscription(sub.subscription, navigator.userAgent || null);
        if (!saved?.ok) {
          setError(saved?.error || 'Could not register this device for push.');
          return;
        }
        setPushNote('On. You will get a subtle reminder 10 minutes before each of your classes — as a popup while Campus+ is open, and as a system notification when it is closed (requires internet).');
      } else {
        // Disable: the server already cancelled future reminders and
        // deactivated push; remove the local subscription too.
        try {
          const endpoint = await getCurrentSubscriptionEndpoint();
          if (endpoint) await removePushSubscription(endpoint);
        } catch {
          // Best-effort: the server row is already inactive.
        }
        await unsubscribeFromPush();
        setPushNote('Off. Future class reminders are cancelled and push delivery is deactivated on this account.');
      }
    } catch {
      setError('Could not save your preference. Please try again.');
    } finally {
      setPending(false);
    }
  }

  if (!isStudent) {
    return (
      <Card className="flex flex-col gap-2 p-4">
        <h2 className="text-sm font-semibold">Class reminder popups</h2>
        <p className="text-[0.8125rem] text-muted">
          Class reminders are available to institutional students only, because they are personalised to
          your profile division. Visitor accounts do not receive them.
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-2 p-4">
      <h2 className="text-sm font-semibold">Class reminder popups</h2>
      <p className="text-[0.8125rem] text-muted">
        Receive a subtle notification 10 minutes before each of your scheduled classes.
      </p>
      <Switch
        id="class-reminder-popups"
        label="Class reminder popups"
        note={hasDivision ? `Division ${division} from your profile` : 'Uses the division in your profile'}
        checked={enabled}
        disabled={pending}
        onChange={(event) => handleToggle(event.target.checked)}
      />
      {!hasDivision ? (
        <Notice tone="warning" icon="clock">
          Your profile has no division yet, so no push subscription is created. Add your division in{' '}
          <Link href={`${ROUTES.settings}?tab=profile`} className="font-medium underline">
            Settings → Profile
          </Link>{' '}
          and reminders will become eligible automatically (provided you opted in above).
        </Notice>
      ) : null}
      {eligible && hasDivision ? (
        <p className="text-2xs text-muted">
          Reminders are personalised to Division {division} from your profile — never a division-wide
          broadcast. Web Push requires internet at delivery time and works when the browser is
          backgrounded or closed, subject to browser support; it never works offline.
        </p>
      ) : null}
      {reason === 'preference-disabled' && !enabled && hasDivision ? (
        <p className="text-2xs text-muted">Off by default. Nothing is scheduled or sent until you enable it.</p>
      ) : null}
      {error ? (
        <p className="text-[0.8125rem] text-danger" role="alert">{error}</p>
      ) : null}
      {pushNote ? <p className="text-[0.8125rem] text-muted">{pushNote}</p> : null}
    </Card>
  );
}
