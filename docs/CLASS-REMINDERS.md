# Personalized class reminders

A student who signs in, has a division in their Campus+ profile, and
enables **Class reminder popups** receives a subtle reminder 10 minutes
before each of their own classes. There are no division-wide broadcasts
and no anonymous timetable subscriptions: every reminder is addressed to
one authenticated profile and delivered only to that profile's own
registered devices.

## How it works

Two channels, one preference (`profile_private.class_reminder_popups`,
disabled by default):

- **In-app popup** — fires client-side while Campus+ is open and the tab
  is active, at the scheduled reminder time. It is dismissible and
  non-blocking, and never re-fires after a render or route navigation.
  The schedule comes from `GET /api/reminders/me`, which derives the
  division from `getCurrentUser().profile.division`. The client polls
  every minute and on focus, so a division or preference change made
  while the app is open updates the locally scheduled popups too.
- **Web Push** — fires when the browser/PWA is backgrounded or closed
  (subject to browser/OS support). It requires explicit browser
  notification permission, an active push subscription, and internet at
  delivery time. Permission and preference are separate gates: if system
  permission is denied, the in-app popup may still work. Web Push never
  works offline.

The division is never chosen in notification settings, taken from a URL,
submitted by the client, inferred from browser storage, or shared
between accounts on one device. Only an authenticated, active
institutional student (`account_type = 'student'`) with a valid profile
division and the opt-in enabled is eligible. Visitors, external
accounts, anonymous users, suspended accounts, and users without a
division receive nothing.

If the profile has no division, no push subscription is created. After adding a division, toggle the preference off and on to register the device for push; in-app reminders do not require this step. The
student sees an explanation with a link to Settings → Profile, and
reminders become eligible automatically once the division is added
(provided they opted in).

## Server side

- **Scheduler** (`GET /api/reminders/schedule`, daily via Vercel Cron):
  reads the current database state — active institutional accounts, their
  individual opt-in, their current `profiles.division` — and reconciles
  the next 7 days of reminders in `class_reminder_queue`. Only
  `standard` and `batch` events generate reminders, one per practical
  block (never per printed column), with
  `reminder_at = class_start_at − 10 minutes` in `Asia/Kolkata`. The
  special timetable week is resolved per date. Reconciliation is
  idempotent: duplicate runs insert nothing and cancel nothing.
- **Dispatcher** (`GET /api/reminders/dispatch`): delivers due reminders
  and re-checks account status, division, and preference immediately
  before sending — a queued row is never trusted. Delivery is claimed
  atomically (`pending → terminal`), so duplicate executions never
  double-send. Revoked/expired endpoints (404/410) are deactivated and
  cleaned up.

Both routes require `Authorization: Bearer $CRON_SECRET` (at least 32 characters),
the same pattern as `/api/storage/reconcile`.

### Scheduling precision

The scheduler runs daily (safe on every Vercel plan). Changes made after that run are reflected in push after the next run. The dispatcher
must be called **every minute** for 10-minute push precision. Vercel
Hobby crons run at most once per day, so production needs either:

- a **Vercel Pro** plan with a per-minute cron on
  `/api/reminders/dispatch`, or
- an **external scheduler** (e.g. cron-job.org, GitHub Actions) that
  `GET`s `https://<deployment>/api/reminders/dispatch` every minute with
  the `CRON_SECRET` bearer token.

The in-app popup does not depend on the dispatcher: it fires client-side
while Campus+ is open. Without a per-minute dispatcher, push reminders
arrive late or not at all, but in-app popups still work.

## Push subscriptions

`push_subscriptions` holds one row per browser endpoint, owned by
exactly one profile (`endpoint` is unique). One user may have many
devices; one endpoint belongs to one profile at a time — signing in
again (or switching Google accounts on the same browser) transfers the
endpoint to the new owner instead of duplicating it. RLS restricts reads to the owner; writes go through server-side RPCs; endpoints and keys are never publicly
readable. The server derives the account ID from the session — the
client never supplies a target profile ID.

**Logout** detaches the current device's subscription before the session
ends (`performSignOut` → `deactivateDevicePushSubscription`), and the
client unsubscribes locally even if the server call fails, so no later
account on that browser can receive the previous account's reminders.

## Live changes

- Division O → P: future O reminders are cancelled by trigger; the
  scheduler materialises P reminders; the dispatcher refuses any stale
  O row that slips through.
- Preference disabled: future reminders are cancelled and push is
  deactivated (RPC + trigger). Devices must be registered again after re-enabling.
- Suspended / division removed: same cancellation path.
- Division changed while the app is open: the popup host polls
  `/api/reminders/me` and reschedules locally.

## Environment

Generate VAPID keys once:

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Set in Vercel (Production, Preview, Development) and redeploy:

- `VAPID_PUBLIC_KEY` — served to the browser via
  `/api/push/vapid-public-key` (public by design).
- `VAPID_PRIVATE_KEY` — server-only secret. Never `NEXT_PUBLIC_*`.
- `VAPID_SUBJECT` — optional `mailto:` contact for the push service
  (defaults to `mailto:campus-plus@example.invalid`).
- `CRON_SECRET` — already required by the backup/storage crons; the
  reminder crons use the same token.

Without VAPID keys, Web Push is disabled and reminders show only as
in-app popups while Campus+ is open. `npm run check:env` warns when
they are missing.

## Database

Migration `085_class_reminders` (forward-only):

- `profile_private.class_reminder_popups boolean not null default false`
- `push_subscriptions` (RLS: owner-only; unique endpoint)
- `class_reminder_queue` (server-only; unique `(profile_id, event_key)`)
- `set_class_reminder_preference()`, `upsert_push_subscription()`,
  `deactivate_push_subscription()`, `cancel_future_class_reminders()`
- Triggers on `profiles.division` and
  `profile_private(account_status, class_reminder_popups)`

Audit: preference changes and subscription creation/deletion are
recorded via `log_audit()` (`account.class_reminder_preference_changed`,
`account.push_subscription_created`,
`account.push_subscription_removed`). Audit metadata never contains the
endpoint itself.

## Offline timetable

The existing offline timetable is unchanged: IndexedDB snapshots, the
offline shell, service-worker cache rules, the installable division PWA,
the timetable clock, and current/next-class logic all keep working —
including when reminders are disabled. A student never has to open a
division timetable to register for reminders; the profile determines the
division. The service worker additionally handles `push` and
`notificationclick` for class reminders (minimal payloads, timetable
URLs only).

## Tests

`tests/class-reminders.test.js` covers eligibility (O-only, J-only,
no-division, visitor, disabled, per-account isolation), the exact
10-minute Asia/Kolkata calculation, one-reminder-per-practical-block,
special/normal weeks, idempotent reconciliation, pre-delivery re-checks
(preference off, suspension, division change/removal, cancellation),
minimal push payloads, and popup de-duplication. Run
`npm run verify` for the full suite, database verification, and the
service-worker bundle check.
