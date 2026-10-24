#!/usr/bin/env bash
set -euo pipefail

OVERLAY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${1:-.}" && pwd)"

if [[ ! -f "$REPO_ROOT/package.json" || ! -f "$REPO_ROOT/app/(app)/home/page.js" ]]; then
  echo "ERROR: pass the root of the sitemango/setup checkout as the first argument." >&2
  exit 1
fi
if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: target directory is not a Git checkout." >&2
  exit 1
fi

TARGETS=(
  "app/(app)/layout.js"
  "app/(app)/home/page.js"
  "components/layout/AppShell.js"
  "components/layout/Sidebar.js"
  "components/layout/ShellHeader.js"
  "lib/data/feed.js"
  "components/posts/PostComposer.js"
)
if ! git -C "$REPO_ROOT" diff --quiet -- "${TARGETS[@]}" || ! git -C "$REPO_ROOT" diff --cached --quiet -- "${TARGETS[@]}"; then
  echo "ERROR: one of the files this patch changes already has local edits." >&2
  echo "Commit or stash those edits, then run this script again." >&2
  exit 1
fi

# Strict preflight: abort before writing if the checkout differs from the
# inspected source. All source edits below are deterministic, single replacements.
python3 - "$REPO_ROOT" <<'PY_INNER'
from pathlib import Path
import sys
root = Path(sys.argv[1])
checks = {
    "app/(app)/layout.js": [
        "import { getServerClient } from '@/lib/supabase/server';",
        "  // Unread badge: the count is the recipient's own rows, so RLS does the",
        "      unreadNotifications={unread}",
    ],
    "app/(app)/home/page.js": ["getCampusFeed, hydratePosts", "export default async function HomePage()"],
    "components/layout/AppShell.js": [
        "import { isStaffRoles } from '@/lib/identity/shell-user';",
        '    <div className="min-h-dvh">',
        "      <CommandPaletteHost actions={paletteActions} />",
    ],
    "components/layout/Sidebar.js": [
        "import { handleOf } from '@/lib/identity/shell-user';",
        "export function Sidebar({ user = null, unreadNotifications = 0, isStaff = false, canModerate = false, canAdmin = false, createItems = [] }) {",
    ],
    "components/layout/ShellHeader.js": [
        "import { formatUnread } from '@/lib/notifications/format';",
        "export function ShellHeader({ user = null, unreadNotifications = 0, isStaff = false, canModerate = false, canAdmin = false, createItems = [] }) {",
    ],
    "lib/data/feed.js": [
        "export async function getCampusFeed(supabase, { limit = PAGE_SIZE.feed, offset = 0, sort = 'newest' } = {}) {",
        "  const posts = await getPostsByIds(supabase, postIds, {\n    currentProfileId: null,\n  });",
    ],
    "components/posts/PostComposer.js": [
        "export function PostComposer({ communityId = null, defaultKind = 'post', compact = false, authorName = null }) {",
        "    onSuccess: () => {",
        "      formRef.current?.reset();\n    },",
    ],
}
for name, tokens in checks.items():
    source = (root / name).read_text()
    for token in tokens:
        if source.count(token) != 1:
            raise SystemExit(f"ERROR: expected one source marker in {name}: {token!r}")
PY_INNER

# Install the Home client boundary, per-user FIFO cache, and private API routes.
for path in \
  "app/(app)/home/page.js" \
  "app/api/home/feed/route.js" \
  "app/api/notifications/unread-count/route.js" \
  "components/home/HomeFeedClient.js" \
  "components/home/homeFeedCache.js" \
  "components/layout/UnreadNotificationsProvider.js" \
  "tests/home-feed-cache.test.js"; do
  mkdir -p "$REPO_ROOT/$(dirname "$path")"
  cp "$OVERLAY_DIR/$path" "$REPO_ROOT/$path"
done

python3 - "$REPO_ROOT" <<'PY_INNER'
from pathlib import Path
import sys
root = Path(sys.argv[1])

def replace_once(path, old, new, label):
    source = path.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"ERROR: expected {label} exactly once; found {count}")
    path.write_text(source.replace(old, new, 1))

# The feed query hydrates once with the viewer ID, avoiding the previous second
# hydration pass and its duplicate author/reaction/poll reads.
feed_path = root / "lib/data/feed.js"
replace_once(
    feed_path,
    "export async function getCampusFeed(supabase, { limit = PAGE_SIZE.feed, offset = 0, sort = 'newest' } = {}) {",
    "export async function getCampusFeed(supabase, { limit = PAGE_SIZE.feed, offset = 0, sort = 'newest', currentProfileId = null } = {}) {",
    "getCampusFeed signature",
)
replace_once(
    feed_path,
    "  const posts = await getPostsByIds(supabase, postIds, {\n    currentProfileId: null,\n  });",
    "  const posts = await getPostsByIds(supabase, postIds, { currentProfileId });",
    "Home feed hydration block",
)

# A successful post tells the Home client to refresh the newest ten entries.
composer_path = root / "components/posts/PostComposer.js"
replace_once(
    composer_path,
    "export function PostComposer({ communityId = null, defaultKind = 'post', compact = false, authorName = null }) {",
    "export function PostComposer({ communityId = null, defaultKind = 'post', compact = false, authorName = null, onCreated = null }) {",
    "PostComposer signature",
)
replace_once(
    composer_path,
    "    onSuccess: () => {\n      setBody('');\n      setGif(null);\n      setOptions(['', '']);\n      setKind(defaultKind);\n      formRef.current?.reset();\n    },",
    "    onSuccess: (result) => {\n      setBody('');\n      setGif(null);\n      setOptions(['', '']);\n      setKind(defaultKind);\n      formRef.current?.reset();\n      onCreated?.(result);\n    },",
    "PostComposer success callback",
)

# Remove the unread-count DB request from the server-render critical path.
layout = root / "app/(app)/layout.js"
replace_once(layout, "import { getServerClient } from '@/lib/supabase/server';\n", "", "server Supabase import")
unread_block = (
    "  // Unread badge: the count is the recipient's own rows, so RLS does the\n"
    "  // filtering for us.\n"
    "  let unread = 0;\n"
    "  const supabase = await getServerClient();\n"
    "  if (supabase) {\n"
    "    const { count } = await supabase\n"
    "      .from('notifications')\n"
    "      .select('id', { count: 'exact', head: true })\n"
    "      .is('read_at', null);\n"
    "    unread = count || 0;\n"
    "  }\n\n"
)
replace_once(layout, unread_block, "", "blocking unread-count query")
replace_once(layout, "      unreadNotifications={unread}\n", "", "server unread-count prop")

# Fetch the count after hydration, shared by the chrome surfaces, rate-limited
# to one request per 20s and private/no-store at the HTTP layer.
app_shell = root / "components/layout/AppShell.js"
replace_once(
    app_shell,
    "import { isStaffRoles } from '@/lib/identity/shell-user';\n",
    "import { isStaffRoles } from '@/lib/identity/shell-user';\nimport { UnreadNotificationsProvider } from '@/components/layout/UnreadNotificationsProvider';\n",
    "AppShell provider import",
)
replace_once(
    app_shell,
    "  return (\n    <div className=\"min-h-dvh\">",
    "  return (\n    <UnreadNotificationsProvider key={user?.username || 'signed-out'} cacheKey={user?.username} initialCount={unreadNotifications}>\n      <div className=\"min-h-dvh\">",
    "AppShell provider wrapper",
)
replace_once(
    app_shell,
    "      <CommandPaletteHost actions={paletteActions} />\n    </div>\n  );",
    "      <CommandPaletteHost actions={paletteActions} />\n      </div>\n    </UnreadNotificationsProvider>\n  );",
    "AppShell provider close",
)
replace_once(app_shell, "\n        unreadNotifications={unreadNotifications}\n", "\n", "Sidebar unread-count prop")
replace_once(app_shell, "\n          unreadNotifications={unreadNotifications}\n", "\n", "ShellHeader unread-count prop")

sidebar = root / "components/layout/Sidebar.js"
replace_once(
    sidebar,
    "import { handleOf } from '@/lib/identity/shell-user';\n",
    "import { handleOf } from '@/lib/identity/shell-user';\nimport { useUnreadNotifications } from '@/components/layout/UnreadNotificationsProvider';\n",
    "Sidebar provider import",
)
replace_once(
    sidebar,
    "export function Sidebar({ user = null, unreadNotifications = 0, isStaff = false, canModerate = false, canAdmin = false, createItems = [] }) {\n  const pathname = usePathname();\n\n  const unread = formatUnread(unreadNotifications);",
    "export function Sidebar({ user = null, isStaff = false, canModerate = false, canAdmin = false, createItems = [] }) {\n  const pathname = usePathname();\n  const unreadNotifications = useUnreadNotifications();\n\n  const unread = formatUnread(unreadNotifications);",
    "Sidebar notification context",
)

header = root / "components/layout/ShellHeader.js"
replace_once(
    header,
    "import { formatUnread } from '@/lib/notifications/format';\n",
    "import { formatUnread } from '@/lib/notifications/format';\nimport { useUnreadNotifications } from '@/components/layout/UnreadNotificationsProvider';\n",
    "ShellHeader provider import",
)
replace_once(
    header,
    "export function ShellHeader({ user = null, unreadNotifications = 0, isStaff = false, canModerate = false, canAdmin = false, createItems = [] }) {\n  return (",
    "export function ShellHeader({ user = null, isStaff = false, canModerate = false, canAdmin = false, createItems = [] }) {\n  const unreadNotifications = useUnreadNotifications();\n\n  return (",
    "ShellHeader notification context",
)
PY_INNER

bash -n "$OVERLAY_DIR/apply.sh"
echo "Campus+ Home performance changes applied to: $REPO_ROOT"
echo "Next run: npm run lint && npm test && npm run build"
