import '@/app/styles/sections.css';
import '@/app/styles/calendar.css';
import '@/app/styles/lumen.css';
import '@/app/styles/aurora.css';
import { PublicFrame } from '@/components/layout/PublicFrame';
import { OptionalAppFrame } from '@/components/layout/OptionalAppFrame';

/**
 * The public discovery route group.
 *
 * Route groups do not appear in URLs, so the pages here resolve to `/clubs`,
 * `/c/[slug]`, `/clubs/[id]` (legacy redirect), `/campus/events` and
 * `/campus/events/[id]` — while the authenticated group `app/(app)/` keeps
 * `/clubs/new`, `/clubs/request`, `/clubs/[id]/manage`, `/clubs/[id]/edit`,
 * `/campus/events/new` and every other protected page.
 *
 * Anonymous access is preserved. The shared shell uses an optional session;
 * protected interactions still enforce authorization independently.
 */
export default function PublicLayout({ children }) {
  return <OptionalAppFrame><PublicFrame>{children}</PublicFrame></OptionalAppFrame>;
}
