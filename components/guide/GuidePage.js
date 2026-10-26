import Link from 'next/link';
import { Icon } from '@/components/ui/icons';
import { LinkButton } from '@/components/ui';
import { BrandLockup, CollegeCrest } from '@/components/brand/Brand';
import { ROUTES, TRENDING_FORMULA } from '@/lib/constants';
import {
  GUIDE_DIFFERENCE,
  GUIDE_EYEBROW,
  GUIDE_EXIT,
  GUIDE_FIRST_STEPS,
  GUIDE_GROUPS,
  GUIDE_HEADLINE_INK,
  GUIDE_HEADLINE_LEAD,
  GUIDE_INDEPENDENCE,
  GUIDE_OPENING,
  GUIDE_PRIVACY,
  GUIDE_REVISIT,
  GUIDE_TIME_NOTE,
} from '@/lib/guide/content';
import { GuideSeenMarker } from '@/components/guide/GuideSeenMarker';
import { InkArrow, InkCircle, InkFold, InkTick, InkUnderline } from '@/components/guide/GuideMarks';

/**
 * The first-visit guide, as one presentational component.
 *
 * `state` decides which question the page answers, because a student who has not
 * signed in and a student who has are not looking for the same thing:
 *
 *   'signedOut'  — reading a public page, deciding whether to make a profile.
 *                  Every destination stays a real link; the app's own sign-in
 *                  behaviour answers for the ones that need a session.
 *   'onboarding' — rendered inside the profile step, where the map is the thing
 *                  they will want the moment the form is submitted.
 *   'signedIn'   — revisiting: the short version of the exit, no sales pitch.
 *   'welcome'    — the half-second after the profile was created, which is the
 *                  one moment a first-visit page is genuinely wanted.
 *
 * Nothing here reads data: the component takes one prop and renders text from
 * `lib/guide/content.js`. That is what makes it safe to serve signed out, and it
 * is why there is no second "intro" to keep in sync on the onboarding page — the
 * subset below *is* the same content.
 */

const SECTIONS = [
  { id: 'map', label: 'Where everything is' },
  { id: 'first-steps', label: 'Start with three things' },
  { id: 'privacy', label: 'Who sees what' },
  { id: 'different', label: 'Why it is built this way' },
];

export function GuidePage({ state = 'signedOut' }) {
  const variant = state === 'welcome' || state === 'signedIn' ? 'signedIn' : state;
  const exit = GUIDE_EXIT[state] ?? GUIDE_EXIT.signedOut;

  return (
    <div className="guide">
      <div className="guide__frame">
        <header className="guide-chrome">
          <BrandLockup href="/" size="sm" className="w-fit" />
          <div className="guide-chrome__actions">
            {variant === 'signedIn' ? (
              <LinkButton href={ROUTES.home} size="sm" variant="secondary" icon="home">
                Open Home
              </LinkButton>
            ) : state === 'onboarding' ? (
              /* A student who is signed in and mid-profile must not be told to sign
                 in — the honest action here is the step they are already on. */
              <LinkButton href={ROUTES.onboarding} size="sm" variant="secondary" icon="user">
                Continue setup
              </LinkButton>
            ) : (
              <LinkButton href={ROUTES.login} size="sm" variant="secondary" icon="user">
                Sign in
              </LinkButton>
            )}
          </div>
        </header>

        {state === 'welcome' ? (
          <p className="guide-welcome">
            <Icon name="checkCircle" size={16} />
            <span>
              Profile done. This guide is the rest of the first visit — read it now or come back from the account
              menu.
            </span>
          </p>
        ) : null}

        <section className="guide-hero">
          <span className="guide-hero__fold" aria-hidden="true">
            <InkFold />
          </span>
          <p className="t-eyebrow guide-hero__eyebrow">{GUIDE_EYEBROW}</p>
          <h1 className="guide-hero__title">
            {GUIDE_HEADLINE_LEAD}{' '}
            <span className="guide-hero__ink">
              {GUIDE_HEADLINE_INK}
              <InkUnderline className="guide-hero__underline" aria-hidden="true" />
            </span>
          </h1>
          <div className="guide-hero__opening">
            {GUIDE_OPENING.map((paragraph) => (
              <p key={paragraph.slice(0, 24)}>{paragraph}</p>
            ))}
          </div>
          <p className="guide-hero__time">
            <InkArrow aria-hidden="true" />
            {GUIDE_TIME_NOTE}
          </p>
          <aside className="guide-tape">
            <p>{GUIDE_INDEPENDENCE}</p>
          </aside>
          <nav className="guide-jump" aria-label="Jump to a part of this guide">
            <ul>
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.label}</a>
                </li>
              ))}
            </ul>
          </nav>
        </section>

        {/* --- 1. the map ---------------------------------------------------- */}
        <section className="guide-section" id="map" aria-labelledby="map-heading">
          <header className="guide-section__head">
            <h2 id="map-heading">Where everything is</h2>
            <p>Eight groups, in the order people actually need them. Each name is the real page.</p>
          </header>

          <div className="guide-map">
            {GUIDE_GROUPS.filter((group) => group.emphasis === 'primary').map((group) => (
              <article className="guide-card" key={group.id}>
                <p className="guide-card__number" aria-hidden="true">
                  {group.number}
                </p>
                <h3 className="guide-card__title">{group.label}</h3>
                {group.why ? <p className="guide-card__why">{group.why}</p> : null}
                <ul className="guide-links">
                  {group.links.map((link) => (
                    <li key={`${group.id}-${link.href}-${link.label}`}>
                      <Link href={link.href} className="guide-link">
                        <span className="guide-link__label">{link.label}</span>
                        <span className="guide-link__note">{link.note}</span>
                        <Icon name="arrowUpRight" size={14} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className="guide-boards">
            {GUIDE_GROUPS.filter((group) => group.emphasis === 'list').map((group) => (
              <section className="guide-board" key={group.id} aria-labelledby={`${group.id}-heading`}>
                <header>
                  <span className="guide-board__number" aria-hidden="true">
                    {group.number}
                  </span>
                  <h3 id={`${group.id}-heading`}>{group.label}</h3>
                  {group.why ? <p className="guide-board__why">{group.why}</p> : null}
                </header>
                <ul className="guide-rows">
                  {group.links.map((link) => (
                    <li key={`${group.id}-${link.href}-${link.label}`}>
                      <Link href={link.href} className="guide-row">
                        <span className="guide-row__label">{link.label}</span>
                        <span className="guide-row__note">{link.note}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {GUIDE_GROUPS.filter((group) => group.emphasis === 'quiet').map((group) => (
            <section className="guide-quiet" key={group.id} aria-labelledby={`${group.id}-heading`}>
              <h3 id={`${group.id}-heading`}>
                <span className="guide-board__number" aria-hidden="true">
                  {group.number}
                </span>
                {group.label}
              </h3>
              <ul>
                {group.links.map((link) => (
                  <li key={`${group.id}-${link.href}`}>
                    <Link href={link.href}>{link.label}</Link>
                    <span>{link.note}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>

        {/* --- 2. the three things ------------------------------------------ */}
        <section className="guide-section" id="first-steps" aria-labelledby="first-steps-heading">
          <header className="guide-section__head">
            <h2 id="first-steps-heading">
              Three things, then you know the place
            </h2>
            <p>Nobody has to understand every section before using one of them.</p>
          </header>
          <ol className="guide-steps">
            {GUIDE_FIRST_STEPS.map((step, index) => (
              <li className="guide-step" key={step.id}>
                <span className="guide-step__number" aria-hidden="true">
                  <InkCircle />
                  <span>{index + 1}</span>
                </span>
                <div className="guide-step__body">
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <LinkButton href={step.hrefs[variant]} size="sm" variant={index === 0 ? 'primary' : 'secondary'}>
                    {step.cta[variant]}
                  </LinkButton>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* --- 3. privacy ---------------------------------------------------- */}
        <section className="guide-section" id="privacy" aria-labelledby="privacy-heading">
          <header className="guide-section__head">
            <h2 id="privacy-heading">Who sees what</h2>
            <p>
              The short version, kept honest by the screens that enforce it.{' '}
              <Link href={ROUTES.legal} className="guide-inline-link">
                The long version is in Legal &amp; independence
              </Link>
              .
            </p>
          </header>
          <ul className="guide-notes">
            {GUIDE_PRIVACY.map((note) => (
              <li key={note.title}>
                <InkTick aria-hidden="true" />
                <div>
                  <h3>{note.title}</h3>
                  <p>{note.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="guide-footnote">
            <Icon name="shield" size={14} />
            Reporting opens a human queue, and{' '}
            <Link href={ROUTES.rules} className="guide-inline-link">
              the community rules
            </Link>{' '}
            are the same reasons the report dialog offers.
          </p>
        </section>

        {/* --- 4. why it is built this way ----------------------------------- */}
        <section className="guide-section" id="different" aria-labelledby="different-heading">
          <header className="guide-section__head">
            <h2 id="different-heading">Why it is built this way</h2>
            <p>Four choices that change what the product is like to use, and one formula.</p>
          </header>
          <dl className="guide-diff">
            {GUIDE_DIFFERENCE.map((item) => (
              <div key={item.title}>
                <dt>{item.title}</dt>
                <dd>{item.body}</dd>
              </div>
            ))}
          </dl>
          <p className="guide-formula">
            <span className="t-label">Trending, in full</span>
            {/* The real constant, from the file the ranking SQL mirrors — not a
                paraphrase that can quietly go stale. */}
            <code>{TRENDING_FORMULA}</code>
          </p>
        </section>

        {/* --- 5. the way out ------------------------------------------------ */}
        <section className="guide-exit" aria-labelledby="exit-heading">
          <div className="guide-exit__copy">
            <h2 id="exit-heading">{exit.heading}</h2>
            <p>{exit.body}</p>
            <ul className="guide-revisit" aria-label="How to find this guide again">
              {GUIDE_REVISIT.map((item) => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <em>{item.note}</em>
                </li>
              ))}
            </ul>
          </div>
          <div className="guide-exit__actions">
            <LinkButton href={exit.href} variant="primary" size="md" icon="arrowUpRight">
              {exit.cta}
            </LinkButton>
            {exit.secondary ? (
              <Link href={exit.secondary.href} className="guide-exit__secondary">
                {exit.secondary.label}
              </Link>
            ) : null}
          </div>
        </section>

        <footer className="guide-footer">
          <CollegeCrest size={40} />
          <p>{GUIDE_INDEPENDENCE}</p>
          <p className="guide-footer__links">
            <Link href={ROUTES.rules}>Community rules</Link>
            <span aria-hidden="true">·</span>
            <Link href={ROUTES.legal}>Legal</Link>
            <span aria-hidden="true">·</span>
            <Link href={ROUTES.timetable}>Timetable</Link>
            <span aria-hidden="true">·</span>
            <Link href={ROUTES.login}>Sign in</Link>
          </p>
        </footer>
      </div>

      {/* Opening this page is the answer to "has this student seen the guide?".
          Written on the device only — see lib/guide/first-visit.js. */}
      <GuideSeenMarker />
    </div>
  );
}
