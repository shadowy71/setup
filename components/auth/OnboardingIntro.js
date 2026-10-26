import Link from 'next/link';

import { ROUTES } from '@/lib/constants';
import {
  GUIDE_GROUPS,
  GUIDE_HEADLINE_INK,
  GUIDE_HEADLINE_LEAD,
  GUIDE_OPENING_SHORT,
} from '@/lib/guide/content';
import styles from './OnboardingIntro.module.css';

/**
 * The onboarding page's slice of the first-visit guide.
 *
 * This used to be a second, separately-written explanation of the same product —
 * three notes and six destinations with their own one-liners, none of which could
 * be checked against the real `/guide`. It is now a *subset*: the headline, the
 * short form of the opening, the three groups a new student actually needs, and a
 * link to the whole thing. One source (`lib/guide/content.js`), two lengths, and
 * no way for the two screens to start disagreeing about what Campus+ is.
 *
 * The prose stays in the UI font. The field-note details (the wavy underline, the
 * rotated number, the uneven corners) live in `OnboardingIntro.module.css`, which
 * is the sheet `/guide` borrows its idiom from — not the other way round.
 */

// The primary groups, in the guide's order, with the guide's own reasons.
const START = GUIDE_GROUPS.filter((group) => group.emphasis === 'primary');
// …and one name each from the rest, as *text*. Deliberately not links: this block
// sits under the profile form, and every app route bounces a student without a
// profile back here — so a link before the form is finished is a dead end with a
// tab stop on it. The one link is the guide, which works signed out and mid-setup
// alike, and the names are enough to know what is waiting.
const REST = GUIDE_GROUPS.filter((group) => group.emphasis !== 'primary').flatMap((group) =>
  group.links.slice(0, 1),
);

/** Static, mounted only behind the onboarding page's own auth guards. */
export function OnboardingIntro() {
  return (
    <section className={styles.intro} aria-labelledby="onboarding-heading">
      <p className={styles.eyebrow}>A note for campus life</p>
      <h2 id="onboarding-heading" className={styles.heading}>
        {GUIDE_HEADLINE_LEAD}{' '}
        <span className={styles.underline}>{GUIDE_HEADLINE_INK}</span>
      </h2>
      <p className={styles.opening}>{GUIDE_OPENING_SHORT}</p>

      <section className={styles.guide} aria-labelledby="onboarding-guide-heading">
        <h3 id="onboarding-guide-heading">Where do I go first?</h3>
        <dl className={styles.destinations}>
          {START.map((group) => (
            <div key={group.id}>
              <dt>{group.label}</dt>
              <dd>{group.why}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.rest}>
          <span className={styles.restLabel}>And after that:</span>
          {REST.map((link) => (
            <span key={`${link.href}-${link.label}`}>{link.label}</span>
          ))}
        </p>
        <p className={styles.firstStep}>
          <span aria-hidden="true" className={styles.arrow}>
            ↳
          </span>
          When your profile is saved you will land on Home.{' '}
          <Link href={ROUTES.guide} className={styles.guideLink}>
            Read the two-minute guide
          </Link>{' '}
          for what is where.
        </p>
      </section>
    </section>
  );
}
