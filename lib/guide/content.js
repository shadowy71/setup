/**
 * Campus+ — the first-visit guide's content, in one place.
 *
 * The guide is the product's own explanation of itself, so it is data here and
 * presentation in `components/guide/`: `/guide` renders all of it, the
 * post-sign-up moment renders a subset, and the onboarding page renders the same
 * subset rather than a second, differently-worded introduction. Two copies of an
 * explanation always drift; one list cannot.
 *
 * Every `href` is a route that exists, and every note is copied in intent from
 * what that page actually says or does (each destination's own `PageHeader`
 * description, `lib/constants.js`, `app/legal/page.js` and the Settings screen
 * are the authorities). Nothing here invents a feature, a number, a sample
 * listing or a story, and `tests/guide.test.js` fails if an `href` stops
 * resolving — which is the only way a guide like this stays true.
 */

import {
  DEFAULT_ALLOWED_EMAIL_DOMAINS,
  DEFAULT_PLATFORM_SETTINGS,
  LIMITS,
  PLATFORM,
  ROUTES,
  TRENDING_FORMULA,
  TRENDING_WINDOW_HOURS,
} from '@/lib/constants';

/**
 * The headline the whole page is hung on, in two parts so a screen can put the
 * ink underline under the right words without cutting a string apart at render
 * time. `GUIDE_HEADLINE` stays the plain sentence for metadata and tests.
 */
export const GUIDE_HEADLINE_LEAD = 'Your campus,';
export const GUIDE_HEADLINE_INK = 'a little less scattered.';
export const GUIDE_HEADLINE = `${GUIDE_HEADLINE_LEAD} ${GUIDE_HEADLINE_INK}`;

export const GUIDE_EYEBROW = `A first-visit guide to ${PLATFORM.name}`;

/** Where the guide lives, for anything that has to link to it. */
export const GUIDE_HREF = ROUTES.guide;

/** Two paragraphs, then the independence line. Kept short on purpose: the goal
 *  is "under two minutes", and a student who is new does not want an essay. */
export const GUIDE_OPENING = [
  `Course notices, batch chats, who is selling a cycle, a half-finished project looking for a teammate — the useful part of campus life is usually spread across six places and already scrolling away. ${PLATFORM.name} keeps it in one searchable, text-first place: discussions, communities, opportunities, resources and the practical student boards, on the same account.`,
  'It is not a feed to catch up on. Read it once, then use it the way you would use a noticeboard: look something up, post the thing you need, go back to your day.',
];

/** The disclosure the product makes everywhere, including here. */
export const GUIDE_INDEPENDENCE = `${PLATFORM.name} is an independent student project for ${PLATFORM.collegeName}. It is not an official ${PLATFORM.collegeName} service, and the college does not review or endorse what students post.`;

/**
 * One shorter telling of the same claim, for the slot above the profile form.
 * Two lengths of one sentence, the way the Home tiles carry their pitch: only one
 * is ever on screen, so the onboarding page cannot drift into a different product
 * description than the guide.
 */
export const GUIDE_OPENING_SHORT = `${PLATFORM.name} keeps campus conversations, communities, opportunities and the practical boards in one searchable place, instead of leaving them to scroll away in a chat.`;

/**
 * The map. Three `emphasis: 'primary'` groups lead (the things a new student
 * actually arrives to do), the rest are one-line rows under them, and the
 * account row is a quiet list at the end. The order is the order of use, not a
 * ranking of importance.
 */
export const GUIDE_GROUPS = [
  {
    id: 'information',
    number: '01',
    label: 'Find information',
    emphasis: 'primary',
    why: 'One search, and the boards it indexes. This is the part that keeps working after a chat has moved on.',
    links: [
      {
        href: ROUTES.explore,
        label: 'Explore',
        note: 'Search across discussions, people, events, marketplace and study requests in one field, plus a trending list scored from reactions, comments and participants.',
      },
      {
        href: '/explore/resources',
        label: 'Resources',
        note: 'Notes, previous papers and reference material shared by students and staff.',
      },
      {
        href: '/explore/projects',
        label: 'Projects',
        note: 'What students are building, with a link to the code or a demo.',
      },
      {
        href: '/explore/opportunities',
        label: 'Opportunity board',
        note: 'Internships, programmes, hackathons and scholarships. Official and community-submitted entries are labelled differently — a student submission is not a college announcement.',
      },
    ],
  },
  {
    id: 'people',
    number: '02',
    label: 'Find your people',
    emphasis: 'primary',
    why: 'Groups that keep their own discussions, and the one place clubs are listed.',
    links: [
      {
        href: ROUTES.communities,
        label: 'Communities',
        note: 'Subject groups, batch groups and study groups, each with its own board. A student can start one.',
      },
      {
        href: ROUTES.clubs,
        label: 'Clubs',
        note: 'Technical, cultural, sports, arts, entrepreneurship and social clubs — their own section, not a kind of community.',
      },
      {
        href: ROUTES.study,
        label: 'Study partner finder',
        note: 'Ask for peers on a subject or an exam. Nothing about you is listed until you publish the request.',
      },
    ],
  },
  {
    id: 'involved',
    number: '03',
    label: 'Get involved',
    emphasis: 'primary',
    why: 'Work, teams and things to build.',
    links: [
      {
        href: ROUTES.gigs,
        label: 'Gigs',
        note: 'Short paid and unpaid work offered by students: tutoring, repairs, design, coding help. Each listing carries its own compensation line, so unpaid is stated rather than hidden.',
      },
      {
        href: ROUTES.teams,
        label: 'Team finder',
        note: 'Post what you are building and who you still need — for a project, a hackathon or a competition.',
      },
    ],
  },
  {
    id: 'everyday',
    number: '04',
    label: 'Everyday campus needs',
    emphasis: 'list',
    why: 'The practical boards, all under one Campus section.',
    links: [
      { href: '/campus/noticeboard', label: 'Noticeboard', note: 'Official notices and announcements.' },
      { href: '/campus/events', label: 'Events', note: 'The campus calendar, with RSVP. Student-submitted events go through review before they are published.' },
      { href: '/campus/lost-found', label: 'Lost & found', note: 'Lost something, or found something that is not yours.' },
      { href: '/campus/housing', label: 'Housing', note: 'Rooms, flats, PGs and roommate searches near campus.' },
      { href: '/campus/rides', label: 'Rides', note: 'Share a cab, find a seat, split a trip home or to the station.' },
      { href: '/campus/utilities', label: 'Campus utilities', note: 'Directory, services, cafeteria, transport, calendar, forms and help — published by staff, and blank where nothing has been published.' },
    ],
  },
  {
    id: 'market',
    number: '05',
    label: 'Buy, sell or give things away',
    emphasis: 'list',
    why: 'Listings, free items and campus deals, text first.',
    links: [
      {
        href: ROUTES.market,
        label: 'Market',
        note: 'Buy, sell, give away and hire — put the price and the pickup in the post, and meet on campus.',
      },
    ],
  },
  {
    id: 'talk',
    number: '06',
    label: 'Talk to people',
    emphasis: 'list',
    why: 'Direct messages, and conversations that stay findable.',
    links: [
      {
        href: ROUTES.chat,
        label: 'Messages',
        note: 'Direct conversations with other students. Who may start one with you is a setting, not a surprise.',
      },
      {
        href: ROUTES.communities,
        label: 'Community boards',
        note: 'Slower and more useful than a chat: a question asked in the right community can be found again by the next person.',
      },
    ],
  },
  {
    id: 'schedule',
    number: '07',
    label: 'Check your schedule',
    emphasis: 'list',
    why: 'Public, and it works without an account.',
    links: [
      {
        href: ROUTES.timetable,
        label: 'Timetable',
        note: 'Pick a division and see the week: which class is on right now, what is next, which day is today. Saved on the device for offline use where the browser supports it, including an optional home-screen shortcut.',
      },
    ],
  },
  {
    id: 'account',
    number: '08',
    label: 'Your account',
    emphasis: 'quiet',
    why: null,
    links: [
      { href: ROUTES.profile, label: 'Profile', note: 'Username, display name, bio and what you show.' },
      { href: ROUTES.settings, label: 'Settings', note: 'Notifications, muting, blocking, username change, deactivation.' },
      { href: ROUTES.notifications, label: 'Notifications', note: 'Replies, mentions, moderation outcomes, marketplace activity.' },
      { href: ROUTES.rules, label: 'Community rules', note: 'Six lines, and the same reasons the report dialog offers.' },
      { href: ROUTES.legal, label: 'Legal & independence', note: 'What is stored, who can see it, and how moderation works.' },
    ],
  },
];

/**
 * The path through the product. Deliberately three, deliberately concrete, and
 * each one a real destination — the point is to leave the guide with something
 * done, not with a mental model.
 */
export const GUIDE_FIRST_STEPS = [
  {
    id: 'username',
    title: 'Pick a username you will keep',
    body: `It is the name other students see and the name you are mentioned by — ${LIMITS.username.min} to ${LIMITS.username.max} characters of lowercase letters, numbers and underscores. You can change it later in Settings, at most once every ${DEFAULT_PLATFORM_SETTINGS.username_change_cooldown_days} days.`,
    // Where this sends a student depends on where they are: signed out there is
    // no profile to edit yet, mid-onboarding they are doing this very step, and
    // past that they are only reviewing it.
    hrefs: { signedOut: ROUTES.login, onboarding: ROUTES.onboarding, signedIn: ROUTES.profile },
    cta: { signedOut: 'Create your profile', onboarding: 'You are doing this now', signedIn: 'Check your profile' },
  },
  {
    id: 'feed',
    title: 'Read Home once, then ask one thing',
    body: 'Home is the campus feed: discussions, questions and announcements from across batches. Open one, and if your question is not there, post it. Searching before asking is the habit this place is built around.',
    hrefs: { signedOut: ROUTES.login, onboarding: ROUTES.home, signedIn: ROUTES.home },
    cta: { signedOut: 'Sign in to read Home', onboarding: 'Go to Home', signedIn: 'Open Home' },
  },
  {
    id: 'need',
    title: 'Go to the board that matches the actual need',
    body: 'A cycle to sell is Market, a teammate is Team finder, a lost charger is Lost & found, next week is the timetable. The map above is the whole list, and none of it has to be read in order.',
    hrefs: { signedOut: ROUTES.explore, onboarding: ROUTES.explore, signedIn: ROUTES.explore },
    cta: { signedOut: 'Look around Explore', onboarding: 'Search campus', signedIn: 'Search campus' },
  },
];

/**
 * Privacy, in the product's own words. Every line is a claim the code keeps:
 * the public projection is `PUBLIC_PROFILE_COLUMNS`, the toggles live in
 * Settings → Profile, and the moderation flow is a queue of people.
 */
export const GUIDE_PRIVACY = [
  {
    title: 'Your @username is you, to other students',
    body: 'It is how you are mentioned and who your posts are attributed to. That is the opposite of anonymous, and this page will not pretend otherwise. Nobody sees your email address, your PRN, your account status or your sessions.',
  },
  {
    title: 'Branch and year are yours to switch off',
    body: 'They are on by default so classmates can recognise you, and the toggle is on your profile. Your bio is visible to signed-in students. Your division is not part of your public profile at all — it only decides which division the Timetable shortcut opens.',
  },
  {
    title: 'Posts are moderated after they appear, not before',
    body: 'What a student publishes goes up and is reviewed if someone reports it. Reports open a queue read by people holding a moderator or admin role inside Campus+ — not by an automated system, and not by college staff. Moderation decisions are logged so they can be audited. No moderation catches everything.',
  },
  {
    title: 'Blocking is quiet, and deactivation is not deletion',
    body: 'Blocking hides you from each other across the feed, search, marketplace and messages, and the other person is not told. Deactivating in Settings hides your profile and content and keeps your username reserved; records that moderation, security or legal reasons require are handled differently, and this product does not promise instant erasure.',
  },
  {
    title: 'It is a student project, not a college system',
    body: `Campus+ is built and run by students, independently of ${PLATFORM.collegeName}. The crest and the name appear to say who it is for, not to claim approval. Where a board marks a notice official, that is a person publishing it — and the college's own channels stay the authority.`,
  },
  {
    title: 'An empty board is an empty board',
    body: 'Some sections have nothing in them yet. Those pages say so instead of showing made-up content, so an empty list means nobody has posted, not that the feature is broken.',
  },
];

/** The "what makes it different" panel, each line tied to something checkable. */
export const GUIDE_DIFFERENCE = [
  {
    title: 'Text-first, on purpose',
    body: `No uploads and no image feed, so a page reads instead of performing and nothing has to load on a bad network. The only media in the product is a GIF picked from GIPHY, where the app offers one. A post is at most ${LIMITS.post.max} characters and a comment ${LIMITS.comment.max}.`,
  },
  {
    title: 'No recommendations, no advertising',
    body: `Nothing is ranked by a model and nothing is sponsored. Trending is a published formula — ${TRENDING_FORMULA} over the last ${TRENDING_WINDOW_HOURS} hours — in the same file the tests read. So there is ordering, and it is arithmetic you can check rather than a feed that learns you.`,
  },
  {
    title: 'Built to be found again',
    body: 'A chat is gone in a day. Here one search covers discussions, resources, events, marketplace and study requests, and every board keeps its own page. If an answer exists, it is in an archive, not a scrollback.',
  },
  {
    title: 'One account, the college issues it',
    body: `Sign-in is Google with a ${DEFAULT_ALLOWED_EMAIL_DOMAINS.join(' or ')} address. That is an eligibility check rather than another password to remember, and the profile you build on top of it is what students see.`,
  },
];

/** Where the guide sends a reader at the end, per state. */
export const GUIDE_EXIT = {
  signedOut: {
    heading: 'Start with your profile',
    body: 'Sign in with your college Google account, choose a username, and you are in. This guide stays available afterwards.',
    cta: 'Sign in with Google',
    href: ROUTES.login,
  },
  signedIn: {
    heading: 'Back to campus',
    body: 'The guide is a page, not a gate. Reach it again from the account menu, the mobile menu or the ⌘K actions list — it will not reopen itself.',
    cta: 'Open Home',
    href: ROUTES.home,
  },
  onboarding: {
    heading: 'Two fields and you are in',
    body: 'The step you are on is the profile: a username and a display name. Everything in the map above opens up the moment it is saved.',
    cta: 'Back to your profile',
    href: ROUTES.onboarding,
  },
  welcome: {
    heading: 'Your profile exists. Now use the place.',
    body: 'Home is the feed, Explore is the search, and the map above is everything else. Nothing here has to be finished today.',
    cta: 'Open Home',
    href: ROUTES.home,
    secondary: { label: 'Search something you need', href: ROUTES.explore },
  },
};

/** What the page promises about its own length. */
export const GUIDE_TIME_NOTE = 'Under two minutes. Everything below is a link, not a lesson.';

/** How to come back — the guide says it once, in the exit note and here. */
export const GUIDE_REVISIT = [
  { label: 'Account menu', note: 'the top-right mark, on every screen size' },
  { label: 'Mobile menu', note: 'the ⋯ sheet, beside Settings' },
  { label: '⌘K', note: 'the actions list, under Navigation' },
];

/** Every route the guide can point at — for the reachability test and the
 *  first-visit strip. Derived, so it cannot drift from the content above. */
export function guideLinks() {
  const seen = new Set();
  const links = [];
  const push = (href, label, group) => {
    if (typeof href !== 'string' || seen.has(href)) return;
    seen.add(href);
    links.push({ href, label, group });
  };
  for (const group of GUIDE_GROUPS) {
    for (const link of group.links) push(link.href, link.label, group.label);
  }
  for (const step of GUIDE_FIRST_STEPS) {
    for (const href of Object.values(step.hrefs)) push(href, step.title, 'first step');
  }
  for (const exit of Object.values(GUIDE_EXIT)) {
    push(exit.href, exit.cta, 'exit');
    if (exit.secondary) push(exit.secondary.href, exit.secondary.label, 'exit');
  }
  return links;
}
