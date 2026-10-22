import Link from 'next/link';
import { BrandLockup } from '@/components/brand/Brand';
import { Icon } from '@/components/ui/icons';
import { LinkButton, Notice } from '@/components/ui';
import { legalContact } from '@/lib/config';
import { ROUTES } from '@/lib/constants';

export const metadata = {
  title: 'Legal & Institutional Independence',
  description:
    'Campus+ is an independent student-run project. It is not owned, operated, maintained, sponsored, approved or endorsed by PCCOE or PCET.',
};

/**
 * Legal Notice & Institutional Independence.
 *
 * This page is a good-faith project notice, not a legal opinion. Its job is
 * narrow and honest: state plainly that Campus+ is independent, explain how
 * institutional references are used here, describe how a rights holder can
 * raise a concern, and record the project's willingness to discuss
 * reasonable, mutually agreed solutions. It deliberately makes no claim that
 * a disclaimer, a domain registration or a logo placement guarantees any
 * particular legal outcome.
 *
 * Copy rules for future edits: do not add claims of permission, ownership,
 * trademark/domain facts, response deadlines or legal conclusions that have
 * not been verified. The contact address comes from configuration
 * (`NEXT_PUBLIC_LEGAL_CONTACT_EMAIL`); until the owner sets it, the concerns
 * section says so rather than inventing one.
 */

const LAST_UPDATED = '22 October 2026';

const TOC = [
  ['notice', 'Legal notice & project identity'],
  ['purpose', 'Purpose & intended audience'],
  ['domain', 'Domain Name & Institutional Naming'],
  ['trademarks', 'Third-Party Names, Logos & Trademarks'],
  ['sign-in', 'The sign-in disclosure'],
  ['authority', 'Independence & institutional authority'],
  ['concerns', 'Intellectual Property & Concerns'],
  ['resolution', 'Good-faith resolution & communication'],
  ['content', 'User-generated content & moderation'],
  ['privacy', 'Privacy & account information'],
  ['availability', 'Availability, external links & disclaimers'],
  ['law', 'Applicable law & legal information'],
];

function Section({ id, index, title, children }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-8">
      <h2 id={`${id}-title`} className="t-section flex items-baseline gap-2.5">
        <span className="t-eyebrow shrink-0" aria-hidden="true">
          {String(index).padStart(2, '0')}
        </span>
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3.5">{children}</div>
    </section>
  );
}

function P({ children }) {
  return <p className="max-w-[68ch] text-[0.9375rem] leading-[1.75] text-ink-soft">{children}</p>;
}

function List({ items }) {
  return (
    <ul className="flex max-w-[68ch] flex-col gap-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5 text-[0.9375rem] leading-[1.7] text-ink-soft">
          <Icon name="check" size={15} className="mt-1.5 shrink-0 text-muted" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function LegalPage() {
  const contactEmail = legalContact.email;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:py-14">
      <BrandLockup href="/" size="lg" className="w-fit" />

      <header className="mt-10 max-w-3xl">
        <p className="t-label">Campus+ · Project notice</p>
        <h1 className="t-display mt-2">Legal Notice &amp; Institutional Independence</h1>
        <p className="t-secondary mt-3 max-w-[68ch] leading-relaxed">
          Who runs Campus+, what it is for, how it refers to Pimpri Chinchwad College of Engineering, and how
          to raise a concern. This page is an informational project notice, not legal advice or a legal
          opinion. Last updated: {LAST_UPDATED}.
        </p>
      </header>

      <Notice tone="accent" icon="shield" className="mt-8 max-w-3xl">
        Campus+ is an independent student-run project. It is not owned, operated, maintained, sponsored,
        approved or endorsed by Pimpri Chinchwad College of Engineering (PCCOE) or Pimpri Chinchwad Education
        Trust (PCET). Nothing on this website is intended to represent Campus+ as an official institutional
        website or service.
      </Notice>

      <div className="mt-10 grid items-start gap-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* Table of contents: a card on mobile, a sticky rail on desktop. */}
        <nav aria-label="On this page" className="card p-4 lg:sticky lg:top-8">
          <p className="t-label">On this page</p>
          <ol className="mt-3 flex flex-col gap-1">
            {TOC.map(([id, label], index) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="flex items-baseline gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-[0.8125rem] text-muted transition-colors hover:bg-surface-2 hover:text-ink hover:no-underline"
                >
                  <span className="t-eyebrow shrink-0" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="flex min-w-0 flex-col gap-12">
          <Section id="notice" index={1} title="Legal notice & project identity">
            <P>
              Campus+ is an independently developed, student-run project. It was built by students, for
              students, and it is maintained on that basis. It is not the official website, portal or digital
              service of Pimpri Chinchwad College of Engineering (PCCOE) or Pimpri Chinchwad Education Trust
              (PCET), and it does not claim institutional approval, endorsement, sponsorship, partnership or
              operational authority of any kind.
            </P>
            <P>
              Where this website refers to PCCOE — including in sign-in eligibility, descriptive text and the
              names of campus contexts — the reference identifies the institutional context and the student
              community the project is intended for. It is not, and must not be read as, evidence of official
              affiliation. Campus+ is not described anywhere on this website as a college-authorised service,
              and no such authorisation should be assumed.
            </P>
            <P>
              This page also makes no representation about the project’s formal legal structure: it does not
              invent a company, registered entity, registered address or partnership. What can be stated
              accurately is the substance — an independent student project, operated separately from the
              institution, which respects third-party intellectual property and legitimate institutional
              concerns and is run with that position stated openly from the first screen a visitor sees.
            </P>
          </Section>

          <Section id="purpose" index={2} title="Purpose & intended audience">
            <P>
              Campus+ exists to give students of one campus a shared, text-first place for everyday student
              life. The features that exist in the current implementation are:
            </P>
            <List
              items={[
                'A student feed with posts, discussions and polls.',
                'Communities and club pages that students can create, join and follow.',
                'Direct and group messaging between students.',
                'Collaboration and discovery: team-finder and study-partner posts, student projects, resources and opportunities.',
                'Campus information and utilities, including events, a student noticeboard, lost & found, housing and ride posts, and a help directory.',
                'A student marketplace with listings and gigs.',
              ]}
            />
            <P>
              Sign-in is limited to institutional Google accounts, which is how the intended audience — PCCOE
              students — is identified. That eligibility rule identifies the community; it does not mean the
              institution operates this platform, selects or reviews its content, or guarantees the accuracy
              of anything students post here. Campus+ is not presented as an official alternative to, an
              affiliated service of, or an authorised replacement for any college system, including the
              college’s own website, ERP or student portals. For official institutional information, always
              use PCCOE’s official channels.
            </P>
          </Section>

          <Section id="domain" index={3} title="Domain Name & Institutional Naming">
            <P>
              Domain-name registration and trademark rights are distinct legal matters, and this project does
              not pretend otherwise. Registering a domain name does not by itself establish ownership of every
              associated name, trademark or logo. Equally, the appearance of an institution’s acronym within a
              domain name does not, on its own, resolve every question of infringement or lawful use. Domain
              disputes turn on the applicable law, the enforceable rights involved, the actual circumstances
              of registration and use, and the relevant evidence.
            </P>
            <P>
              Two limits follow, and Campus+ accepts both. The project does not claim that registering any
              domain automatically overrides third-party rights. It also does not claim that an institution
              automatically owns every domain that contains a similar acronym. Neither shortcut is how these
              questions are decided.
            </P>
            <P>
              Nothing on this page asserts the registrant, registration status, trademark status, prior
              permissions or dispute history of any particular domain, and no statement here should be read as
              a claim that the project has purchased, owns or controls any specific domain — including any
              domain containing an institutional acronym — or that any domain is legally beyond challenge
              under all circumstances. References on this page to “the Campus+ domain” mean whichever domain
              currently serves this website. If a domain containing an institutional acronym is ever used for
              this project, everything in this notice applies to that use exactly as written: independently,
              transparently, and open to the discussion described in the sections on concerns and resolution
              below. Disputes about <code>.in</code> names may also be subject to the .IN Domain Name Dispute
              Resolution Policy (INDRP) administered by the .IN Registry; the relevant official sources are
              listed under “Applicable law &amp; legal information”. This page does not apply that policy to
              any domain or predict its outcome.
            </P>
          </Section>

          <Section id="trademarks" index={4} title="Third-Party Names, Logos & Trademarks">
            <P>
              “PCCOE”, “Pimpri Chinchwad College of Engineering”, “PCET”, “Pimpri Chinchwad Education Trust” and
              their respective logos, crests and other institutional identifiers remain subject to the rights
              of their respective owners. Campus+ does not claim ownership of any institutional intellectual
              property, and no licence or permission should be assumed from anything on this website. The
              project’s intention is only to identify the institution its student community belongs to — never
              to imply sponsorship, affiliation, endorsement or authorisation. Campus+ uses its own distinct
              name and branding (“Campus+” and its own mark) as its identity. Any question about third-party
              branding can only be assessed against the actual display and purpose, the applicable law, and
              any permissions actually obtained — not against general statements on a web page, including this
              one.
            </P>
            <P>
              <strong className="text-ink">The college crest on the sign-in screen.</strong> The current
              sign-in screen displays the college crest once, at a small size, directly beside the
              independence disclosure and clearly separate from the Campus+ wordmark. The stated intention is
              limited contextual identification: to show which institution the words “not affiliated with,
              operated by, or endorsed by PCCOE or PCET” refer to. That intention is recorded here honestly,
              with its limits stated just as plainly:
            </P>
            <List
              items={[
                'Small size alone does not guarantee lawful use, and this project does not claim otherwise.',
                'A disclaimer alone does not guarantee that confusion or infringement cannot occur.',
                'The project does not state that this placement necessarily qualifies as fair use, statutory fair dealing, nominative use or any other legal exception, and it has not been conclusively determined to be lawful.',
                'The project does not represent that it holds permission to display the crest; no verified written authorisation is relied upon for this placement.',
                'Equally, nothing here is an admission of infringement. The position is a good-faith independent project with a stated identification purpose.',
              ]}
            />
            <P>
              The placement is deliberately easy to change: the crest is rendered from a single configurable
              slot in the codebase, so it can be removed or replaced — or the institution identified in plain
              text instead — without redesigning the sign-in screen. If PCCOE, PCET or another rights holder
              has a concern about it, the project remains open to reviewing that concern and discussing
              reasonable alternatives, including removing or replacing the crest or changing its placement,
              as described in the sections on concerns and resolution below.
            </P>
          </Section>

          <Section id="sign-in" index={5} title="The sign-in disclosure">
            <P>
              Independence is disclosed where it matters most: on the sign-in screen, before authentication,
              beside the sign-in controls, in reading-size text on mobile and desktop. It reads:
              “Independent student project — not affiliated with, operated by, or endorsed by PCCOE or PCET”,
              followed by a link to this page labelled “Legal &amp; Institutional Independence”. The sign-in
              brand area additionally carries the label “Unofficial student project”.
            </P>
            <P>
              Signing in uses your institutional Google account so that eligibility can be checked. That step
              is provided through Google and the project’s authentication provider; it is not an “official
              PCCOE login”, it does not connect to college systems, and Campus+ never receives your Google
              password. The presence of an institutional email domain in the sign-in rule identifies eligible
              students only.
            </P>
          </Section>

          <Section id="authority" index={6} title="Independence & institutional authority">
            <P>Independence also means an absence of institutional authority. Campus+ does not claim the right to:</P>
            <List
              items={[
                'Speak on behalf of PCCOE or PCET, or publish anything as an authorised institutional representative.',
                'Present college announcements or information as officially verified, unless a specific authorised source and verification actually exist for that item.',
                'Use institutional credentials, logos or visual treatments to falsely imply authority.',
                'Circumvent institutional restrictions, or access private or restricted college systems without authorisation.',
              ]}
            />
            <P>
              Information on Campus+ comes in kinds that must not be confused. Most of it is student-submitted
              material, written by its authors. Some entries (for example help-directory listings) are compiled
              from publicly available information and can be out of date. Badges inside the app such as
              “Official” mean only that an item was published by a person holding a Campus+ staff role within
              this project; they never signify college approval. Student-submitted posts, clubs, listings and
              notices are not labelled as institutionally approved, because there is no factual basis for such
              a label. If something on Campus+ appears to claim institutional authority it does not have,
              please report it — impersonation and false claims of official status breach the community rules.
            </P>
          </Section>

          <Section id="concerns" index={7} title="Intellectual Property & Concerns">
            <P>
              If you believe your legitimate rights are affected by this project’s name, domain, branding,
              content or operation, the project wants to hear from you and will deal with the concern in good
              faith. <strong className="text-ink">The project is open to negotiations</strong> with PCCOE, PCET
              or another relevant rights holder.
            </P>
            {contactEmail ? (
              <P>
                Rights-holder and legal enquiries can be sent to{' '}
                <a href={`mailto:${contactEmail}`} className="font-semibold text-ink underline underline-offset-2">
                  {contactEmail}
                </a>
                . Please identify the specific material, branding, domain or feature concerned and the basis of
                the concern, so it can be assessed properly.
              </P>
            ) : (
              <P>
                {/* Owner configuration required: set NEXT_PUBLIC_LEGAL_CONTACT_EMAIL
                    (see .env.example) and this paragraph is replaced by a mailto.
                    Until then the page must not invent an address. */}
                A dedicated public contact address for rights-holder enquiries has not yet been published on
                this page, and none is implied. The project owner should publish one here; in the meantime,
                concerns about specific content can also be raised through the in-app reporting tools available
                to signed-in students, and this page records the project’s commitment to the process below so
                that the commitment itself is public and unambiguous.
              </P>
            )}
            <P>When a concern is raised, the project will:</P>
            <List
              items={[
                'Review the concern in good faith, on its own facts.',
                'Request clarification or supporting information where reasonably necessary to understand it.',
                'Assess the specific material, branding, domain or feature at issue — not the project in the abstract.',
                'Communicate constructively where contact details permit.',
                'Consider appropriate corrective steps or a mutually agreed solution.',
              ]}
            />
            <P>
              Depending on the circumstances, possible solutions may include revising wording, changing visual
              presentation, removing or replacing a logo, restricting or removing a disputed element, adding
              clearer notices, arranging a transition, or discussing an agreed domain transfer. This process
              is a genuine commitment to engage; it is not a promise of unconditional domain transfer,
              unconditional removal of all content, or acceptance of every allegation, and it must not be read
              as one. Equally, none of those qualifications is a reason to ignore a legitimate complaint or a
              formal legal deadline, and they will not be used that way.
            </P>
          </Section>

          <Section id="resolution" index={8} title="Good-faith resolution & communication">
            <P>
              Campus+ is intended to operate independently and in good faith. If PCCOE, PCET or another
              relevant rights holder raises a concern relating to the project’s name, domain, branding, content
              or operation, the project owner is open to a respectful discussion to understand the concern and
              explore reasonable, mutually agreed solutions. Depending on the circumstances, these may include
              branding changes, explanatory notices, removal or replacement of disputed material, a transition
              arrangement or a negotiated domain transfer.
            </P>
            <P>
              Two clarifications keep that commitment honest. Entering a discussion or negotiation does not by
              itself constitute an admission of wrongdoing, and it does not waive any party’s legal rights.
              And a willingness to negotiate does not prevent another party from exercising lawful remedies
              available to them; this page neither claims nor attempts any such restriction. The college is
              the institution this project’s users belong to — it is not an adversary, and concerns raised by
              it will be met calmly, respectfully and professionally.
            </P>
          </Section>

          <Section id="content" index={9} title="User-generated content & moderation">
            <P>
              Posts, comments, listings, messages and other submissions on Campus+ are the contributions of
              their individual authors. They are not statements of this project, and they are certainly not
              institutional statements or endorsements by PCCOE or PCET. Most content appears when it is
              posted and is moderated afterwards; it is not pre-reviewed, and neither its accuracy nor its
              endorsement by Campus+, PCCOE or PCET should be assumed. Certain staff-published surfaces (such
              as official notices within the app) require Campus+ staff permissions, and some submission types
              can be held for staff review where student moderators or administrators have enabled that
              setting.
            </P>
            <P>
              The moderation that exists in the current implementation is human: any student can report content
              from where they see it; reports go to a moderator queue reviewed by people holding moderator or
              administrator roles within Campus+; moderators can remove or hide content and review marketplace
              listings; administrators can change account status (including suspension) with the reason
              recorded; and moderation actions are written to an audit log. Students can also block one
              another, which hides each party from the other. Users must not impersonate institutional
              representatives, falsely claim official authority, misuse third-party intellectual property, or
              publish unlawful content; the full expectations are in the{' '}
              <Link href="/rules" className="font-semibold text-ink underline underline-offset-2">
                community rules
              </Link>
              . No moderation system catches everything, and this page does not promise that every submission
              is reviewed, accurate or verified.
            </P>
          </Section>

          <Section id="privacy" index={10} title="Privacy & account information">
            <P>
              There is no separate privacy policy published for Campus+ at the time of the last update below,
              and this summary is not a substitute for one. The project owner should publish and maintain a
              dedicated privacy notice; until then, the following implementation-specific summary is provided
              so that students are not left to guess.
            </P>
            <List
              items={[
                'Sign-in is Google OAuth only, handled by the project’s authentication provider (Supabase). The session is created on the server after Google confirms an institutional address; Campus+ never receives or stores your Google password.',
                'Your institutional email address exists in the authentication record to operate your account and enforce eligibility. It is never displayed to other students — publicly, you are your @username.',
                'Your profile (display name, bio, and branch, year and division if you add them) and the content you create are stored so the service can function. You control whether branch and year are shown, whether any student may start a conversation with you, and whom you block, all in Settings.',
                'Reports, moderation decisions and account-status changes are recorded, including in an audit log, so moderation is accountable. Essential session cookies keep you signed in.',
                'The service is operated using hosting and database providers (including Supabase for authentication, database and realtime features). If you use GIF search, your search term is sent to GIPHY through the project’s server-side proxy to return results. The current codebase embeds no advertising and no third-party analytics trackers.',
                'You can deactivate your account in Settings: deactivation hides your profile and content from everyone and keeps your username reserved. Deactivation is not deletion, and this page does not promise immediate or complete erasure of records that moderation, security or legal reasons may require handling differently.',
              ]}
            />
            <P>
              Some privacy questions cannot be answered from the code alone — including formal retention
              periods, a data export or deletion-request process, and the identity of a data-protection
              contact. Those require decisions and confirmation by the project owner and should be settled in
              the dedicated privacy notice rather than invented here. Please do not post anyone else’s personal
              information; that breaches the community rules.
            </P>
          </Section>

          <Section id="availability" index={11} title="Availability, external links & disclaimers">
            <P>
              Campus+ is an independently operated student project, provided as-is. Its availability, the
              accuracy of user-generated content, and uninterrupted operation are not guaranteed, and features
              may change or be withdrawn. Nothing in this notice excludes or limits any liability or right
              that cannot lawfully be excluded or limited, and all of it remains subject to applicable law and
              to users’ non-excludable legal rights. To the extent the project is responsible for this
              website’s own content and operation, it does not use this page to disclaim that responsibility.
            </P>
            <P>
              Links to external websites — including PCCOE’s official website and the official legal sources
              below — are provided for context. Those sites keep their own ownership, terms and policies, and
              linking to them does not imply endorsement by them of this project, or by this project of
              everything on those sites. For authoritative institutional information (admissions, fees,
              examinations, official notices), rely on the college’s official channels, not on anything posted
              here.
            </P>
          </Section>

          <Section id="law" index={12} title="Applicable law & legal information">
            <P>
              This page is an informational project notice, not a legal opinion, a contract, or a guarantee of
              immunity from litigation, domain transfer or any other remedy. It does not invent a contractual
              jurisdiction, arbitration venue or governing-law clause. The legal status of any specific domain
              name, logo display or item of content requires an assessment of the actual circumstances by a
              qualified professional, and nothing here is a substitute for review by a qualified Indian lawyer
              — a step the project owner should take before relying on any domain containing an institutional
              acronym or retaining the college crest on a public sign-in page.
            </P>
            <P>Official sources referred to above, for readers who want the primary material:</P>
            <ul className="flex max-w-[68ch] flex-col gap-2">
              {[
                [
                  '.IN Domain Name Dispute Resolution Policy (INDRP) — .IN Registry (NIXI)',
                  'https://www.registry.in/domaindisputeresolution',
                ],
                ['Trade Marks Act, 1999 — Office of the Controller General (IP India)', 'https://ipindia.gov.in/tm-act-1999'],
                [
                  'Copyright Act, 1957 (including Section 52) — official text via India Code',
                  'https://www.indiacode.nic.in/',
                ],
                [
                  'PCCOE’s published disclaimer — Pimpri Chinchwad College of Engineering (contextual reference)',
                  'https://www.pccoepune.com/disclaimer-pccoe.php',
                ],
              ].map(([label, href]) => (
                <li key={href} className="flex items-start gap-2.5 text-[0.9375rem] leading-[1.7] text-ink-soft">
                  <Icon name="arrowUpRight" size={15} className="mt-1.5 shrink-0 text-muted" aria-hidden="true" />
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-ink underline underline-offset-2 hover:text-accent"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
            <P>
              These references are provided for context only. Their inclusion does not state or imply how any
              provision applies to this project, and no part of them is reproduced here as project policy.
            </P>
          </Section>
        </article>
      </div>

      <footer className="mt-14 border-t border-line pt-6">
        <p className="max-w-[68ch] text-[0.8125rem] leading-relaxed text-muted">
          Last updated: {LAST_UPDATED}. This notice will be kept accurate as the project changes; material
          changes to it will update this date. Campus+ is an unofficial, independent student project — see the
          independence statement at the top of this page.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <LinkButton href={ROUTES.login} variant="primary" icon="chevronRight">
            Back to sign-in
          </LinkButton>
          <LinkButton href="/rules" variant="ghost" size="md">
            Community rules
          </LinkButton>
          <Link href="/" className="text-[0.8125rem] font-medium text-muted underline hover:text-ink">
            What is Campus+?
          </Link>
        </div>
      </footer>
    </div>
  );
}
