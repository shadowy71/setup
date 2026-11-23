/**
 * Browser Web Push subscription helpers (client-safe, no React).
 *
 * The division and the opt-in are never stored here — they live on the
 * server (`profiles.division`, `profile_private.class_reminder_popups`) and
 * are read from the session. This module only manages the *device*
 * subscription: registering the timetable service worker, subscribing to
 * push with the VAPID public key, and unsubscribing on logout so one
 * account's notifications never leak to the next account on the same
 * browser.
 *
 * Browser permission and the Campus+ preference are separate: permission
 * is the browser's gate, the preference is the account's gate. Both must
 * allow delivery. If permission is denied, the in-app popup may still work
 * while Campus+ is open.
 */

import { TIMETABLE_SCOPE } from '@/lib/timetable/batch';
import { registerTimetableWorker } from '@/lib/timetable/offline-install';

/** True when this browser can receive Web Push at all. */
export function isPushSupported(navigatorLike = typeof navigator !== 'undefined' ? navigator : null, windowLike = typeof window !== 'undefined' ? window : null) {
  return Boolean(
    navigatorLike
    && 'serviceWorker' in navigatorLike
    && 'PushManager' in (windowLike || {})
    && 'Notification' in (windowLike || {}),
  );
}

/** Current Notification permission: 'granted' | 'denied' | 'default' | 'unsupported'. */
export function notificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission || 'default';
}

/** Convert a base64url VAPID public key to the Uint8Array the API expects. */
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

/**
 * Register (or reuse) the timetable service worker.
 *
 * The worker lives at `/timetable/sw.js` with `Service-Worker-Allowed: /`,
 * so it can be registered from any page — including Settings — without the
 * student first opening a division timetable. The scope is `/timetable/`
 * by default; the worker also handles push for the whole app.
 */
export async function ensureServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration(TIMETABLE_SCOPE);
    if (existing) return existing;
    const result = await registerTimetableWorker(navigator);
    return result.registration || null;
  } catch {
    return null;
  }
}

/** Fetch the VAPID public key from the server (null when push is unconfigured). */
export async function fetchVapidPublicKey() {
  try {
    const response = await fetch('/api/push/vapid-public-key', { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.publicKey || null;
  } catch {
    return null;
  }
}

/**
 * Subscribe this browser to push and return the subscription JSON.
 *
 * Returns `{ ok: true, subscription }` or `{ ok: false, error }` with a
 * user-safe error code. Never throws for a missing permission or an
 * unsupported browser.
 */
export async function subscribeToPush() {
  if (!isPushSupported()) return { ok: false, error: 'push-unsupported' };
  if (notificationPermission() === 'denied') return { ok: false, error: 'permission-denied' };
  if (notificationPermission() === 'default') {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return { ok: false, error: 'permission-denied' };
    } catch {
      return { ok: false, error: 'permission-denied' };
    }
  }
  const publicKey = await fetchVapidPublicKey();
  if (!publicKey) return { ok: false, error: 'push-unconfigured' };
  const registration = await ensureServiceWorker();
  if (!registration?.pushManager) return { ok: false, error: 'push-unsupported' };
  try {
    const existing = await registration.pushManager.getSubscription();
    if (existing) return { ok: true, subscription: existing.toJSON() };
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    return { ok: true, subscription: subscription.toJSON() };
  } catch {
    return { ok: false, error: 'subscribe-failed' };
  }
}

/** The current local subscription endpoint, or null. */
export async function getCurrentSubscriptionEndpoint() {
  try {
    const registration = await navigator.serviceWorker.getRegistration(TIMETABLE_SCOPE);
    const subscription = await registration?.pushManager?.getSubscription();
    return subscription?.endpoint || null;
  } catch {
    return null;
  }
}

/**
 * Unsubscribe this browser locally (best-effort, never throws).
 * The server row is deactivated separately via the server action so the
 * dispatcher stops sending even if the local unsubscribe races a delivery.
 */
export async function unsubscribeFromPush() {
  try {
    const registration = await navigator.serviceWorker.getRegistration(TIMETABLE_SCOPE);
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription) await subscription.unsubscribe();
    return true;
  } catch {
    return false;
  }
}

/**
 * Detach this device's subscription for the current account (logout).
 *
 * Calls the server action to deactivate the server row first (while the
 * session still exists), then unsubscribes locally so no further pushes
 * can arrive on this browser even if the server call failed (e.g. offline).
 * Never throws — sign-out must never be blocked by push cleanup.
 *
 * @param {object} input
 * @param {Function} input.serverAction  `removePushSubscription(endpoint)` server action
 */
export async function deactivateDevicePushSubscription({ serverAction = null } = {}) {
  let endpoint = null;
  try {
    endpoint = await getCurrentSubscriptionEndpoint();
  } catch {
    endpoint = null;
  }
  if (endpoint && serverAction) {
    try {
      await serverAction(endpoint);
    } catch {
      // Best-effort: the local unsubscribe below still stops delivery.
    }
  }
  await unsubscribeFromPush();
  return Boolean(endpoint);
}
