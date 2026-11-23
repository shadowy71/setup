/**
 * Web Push delivery (server-only).
 *
 * Configures `web-push` from the VAPID environment and sends one minimal
 * payload to a profile's own active subscriptions. A 404/410 from the push
 * service means the endpoint is gone (revoked, expired, or unsubscribed
 * locally) — the caller marks that subscription inactive so it is cleaned
 * up instead of retried forever. Other failures are counted but never
 * block delivery to the account's other devices.
 *
 * When VAPID is not configured, push is disabled and the in-app popup
 * (client-side, same preference) is the only channel. Nothing here throws
 * for a missing key: the dispatcher reports `push-configured: false` and
 * skips sending, rather than failing the whole run.
 */

import 'server-only';
import * as webPush from 'web-push';
import { serverConfig } from '@/lib/config.server';

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  const publicKey = serverConfig.vapidPublicKey;
  const privateKey = serverConfig.vapidPrivateKey;
  const subject = serverConfig.vapidSubject;
  if (!publicKey || !privateKey || !subject) return false;
  try {
    webPush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
    return true;
  } catch {
    return false;
  }
}

/** True when VAPID keys are present and web-push is ready to send. */
export function isPushConfigured() {
  return ensureConfigured();
}

/** The public key for the browser (safe to expose via the API route). */
export function getVapidPublicKey() {
  return serverConfig.vapidPublicKey || null;
}

/**
 * Send one payload to every active subscription of one profile.
 *
 * @param {Array<{id: string, endpoint: string, p256dh: string, auth: string}>} subscriptions
 * @param {{title: string, body: string, url: string, tag: string}} payload
 * @returns {Promise<{sent: number, gone: string[], failed: number}>}
 *   `gone` holds subscription ids whose endpoint returned 404/410.
 */
export function isAllowedPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com'
        || host === 'web.push.apple.com' || host.endsWith('.push.apple.com')
        || host === 'notify.windows.com' || host.endsWith('.notify.windows.com'));
  } catch { return false; }
}

export async function sendPushToSubscriptions(subscriptions = [], payload = {}) {
  const result = { sent: 0, gone: [], failed: 0 };
  if (!ensureConfigured()) return result;
  const body = JSON.stringify(payload);
  for (const subscription of subscriptions) {
    if (!isAllowedPushEndpoint(subscription?.endpoint) || !subscription?.p256dh || !subscription?.auth) {
      result.failed += 1;
      continue;
    }
    try {
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        body,
        { TTL: 60 * 10, urgency: 'normal' },
      );
      result.sent += 1;
    } catch (error) {
      const status = Number(error?.statusCode || 0);
      if (status === 404 || status === 410) {
        result.gone.push(subscription.id);
      } else {
        result.failed += 1;
      }
    }
  }
  return result;
}
