import { getCurrentUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/config';
import { GUIDE_EYEBROW, GUIDE_HEADLINE } from '@/lib/guide/content';
import { GuidePage } from '@/components/guide/GuidePage';

export const metadata = {
  title: 'First-visit guide',
  description: `${GUIDE_EYEBROW}. ${GUIDE_HEADLINE} Where everything is, the three things to do first, who can see what, and why it is built this way — under two minutes.`,
};

/**
 * The one place Campus+ explains itself.
 *
 * Deliberately *not* guarded: like `/legal` and `/rules`, this page is public
 * content, and a student deciding whether to make a profile is exactly the reader
 * who does not have one yet. It reads the session for one reason — to decide
 * which question to answer first (create a profile, finish one, or get back to
 * the app) — and nothing else. There is no query here, no data import, and no
 * component on this page that can reach a table, so there is no private content
 * to expose; `tests/guide.test.js` fails if that stops being true.
 *
 * `?welcome=1` is the post-sign-up arrival (see `OnboardingForm`'s redirect). It
 * is a presentation flag, not state: it changes the closing line, and it is the
 * reason the flow needed no database column to remember anything.
 */
export const dynamic = 'force-dynamic';

export default async function GuideEntry({ searchParams }) {
  const params = await searchParams;
  const welcome = params?.welcome === '1';

  let state = 'signedOut';
  // An unconfigured deployment must still answer: the guide is static text, and
  // the setup screen stays reachable through the sign-in link like everywhere else.
  if (isSupabaseConfigured()) {
    const user = await getCurrentUser();
    if (user) state = user.needsProfileSetup ? 'onboarding' : welcome ? 'welcome' : 'signedIn';
  }

  return <GuidePage state={state} />;
}
