import '@/app/styles/sections.css';
import '@/app/styles/calendar.css';
import '@/app/styles/lumen.css';
import '@/app/styles/aurora.css';
import { PublicFrame } from '@/components/layout/PublicFrame';

/**
 * The public discovery route group.
 *
 * Route groups do not appear in URLs, so the pages here resolve to `/clubs`,
 * `/c/[slug]`, `/clubs/[id]` (legacy redirect), `/campus/events` and
 * `/campus/events/[id]` — while the authenticated group `app/(app)/` keeps
 * `/clubs/new`, `/clubs/request`, `/clubs/[id]/manage`, `/clubs/[id]/edit`,
 * `/campus/events/new` and every other protected page.
 *
 * No `requireUser()` here, and no `AppShell`: the frame below is read-only and
 * session-free. Each page decides for itself whether an optional signed-in
 * viewer should see member-only extras; participation actions always go through
 * server actions/RPCs that re-check authentication and permissions.
 */
export default function PublicLayout({ children }) {
  return <PublicFrame>{children}</PublicFrame>;
}
