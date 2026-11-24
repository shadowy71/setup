# Class reminder popups

Institutional students can enable the existing **Class reminder popups**
preference in Settings → Notifications. It is off by default. The current
profile division and account eligibility come from the authenticated session;
URLs and saved public timetables are never used as identity.

The authenticated app frame mounts the existing reminder controller, which
fetches `/api/reminders/me` and schedules an individual browser timer for each
remaining academic class on the current Asia/Kolkata date. It shows a
non-blocking popup at ten minutes before the class, or “Class starts soon” if
the tab wakes late while the class has not yet started. Lunch, Empowerment and
free slots are excluded; a spanning practical is one event. On focus, pageshow,
visibility, reconnect, and periodic refresh the controller rechecks the server
and rebuilds timers. It discards a previous day's schedule at campus midnight.

Popups require Campus+ to be open in an authenticated browser tab. Browser
throttling and device sleep may delay or miss reminders. There is no guarantee
of delivery when a tab is hidden, the device sleeps, or the app is closed.
Already loaded same-day reminders may continue during a temporary connection
failure; no cold offline login or fresh timetable is promised. An offline tab
cannot immediately learn of remote changes or cancellations.

Displayed events are claimed once per profile, division, date and event using
an atomic IndexedDB transaction, expiring after two days. When IndexedDB is
unavailable, Web Locks and localStorage provide an atomic fallback. If neither
is available, reminders fail closed rather than risk duplicate popups. Settings
changes and sign-out are signalled to other tabs on a best-effort basis. The
server remains authoritative and the controller rechecks it while online.

The old class Web Push routes remain present but return 410 after cron
authentication; they do not schedule or dispatch. The old tables, RPCs,
subscriptions, service worker push handlers, and migration history remain in
place for compatibility. VAPID, notification permission, PushManager and a
server dispatcher are not used by the in-app path. Other notification features,
backup/storage crons, and timetable offline caching are unchanged. Deploying
this version removes the reminder schedule cron; external callers of the legacy
routes must also be retired operationally. Previously installed service workers
or system notifications may persist until the browser updates/clears them.
