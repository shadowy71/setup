# Campus+ UI and Home-feed performance patch

This change targets perceived loading time without putting personalized student data in a shared cache.

## What changes

- **Home shell first:** the personalized Home page can render its greeting, composer, feature navigation, and feed skeleton without waiting for feed, events, and notice queries to finish.
- **Ten-entry feed cache:** the browser keeps at most the newest ten unified Home-feed entries in memory, keyed by the signed-in student's profile ID. There is no `localStorage`, `sessionStorage`, or shared server cache.
- **FIFO behavior:** each successful fresh response is newest-first and capped at ten. A new post moves to the head of the list, and older entries fall off the tail.
- **Stale-while-refresh:** a cached feed paints immediately on a return visit; stale data remains visible while the feed request refreshes in the background.
- **Post-create refresh:** after a successful post, the composer asks Home to fetch the latest data so the new entry appears and the cache rotates.
- **Less duplicate Supabase work:** `getCampusFeed()` hydrates post authors, reactions, and poll state once with the current viewer ID. The old Home page rehydrated those same post rows again.
- **Faster app-wide shell:** the unread notification count is removed from the server layout's critical path. It loads after hydration into a shared client provider and refreshes at most once per 20 seconds on navigation/focus.
- **Private responses:** both API endpoints use `Cache-Control: private, no-store`; authentication and RLS still apply. The client cache is best-effort, per-tab memory only.
- No new dependencies, schema changes, or migrations.

## Trade-off and limits

A first visit has no cached feed yet, so it shows a skeleton until the authenticated API response arrives. The cache improves repeat visits and avoids waiting to paint the Home shell; it does **not** make the first Supabase request itself faster. The in-memory cache is per browser tab and runtime. UI code is not persisted as HTML in storage, and sensitive feed data is not placed in a shared server cache.

## Apply

From your local `sitemango/setup` checkout, unzip this bundle anywhere, then run:

```bash
bash /path/to/campus-home-new/apply.sh /path/to/setup
```

The script checks the expected source version and refuses to overwrite local modifications to the files it changes. After it applies:

```bash
npm run lint
npm test
npm run build
```

This patch was syntax-checked and its cache/apply behavior was smoke-tested against a fixture, but it has **not** been run against a full local checkout in this environment. Review the diff and run those project checks before deploying.
