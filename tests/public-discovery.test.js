import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * Public discovery — routing, authorization boundary, SEO and caching contract.
 *
 * This is the JavaScript half of the regression suite. `database/tests/
 * 21_public_discovery_rls.sql` is the other half: it proves the same rules
 * against real PostgreSQL `anon` / `authenticated` roles, because a hidden
 * button is not a security boundary.
 */

const ROOT = process.cwd();
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(ROOT, file));
/** Strip comments: documentation may legitimately *say* `requireUser` or `cookies`. */
const codeOnly = (file) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

vi.mock('next/server', () => ({ NextResponse: {} }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({}) }));

const { ROUTES, CLUB_SLUG_REGEX, UUID_REGEX } = await import('@/lib/constants');
const { isPublicPath } = await import('../proxy.js');
const { isActivePath, resolveActiveHref } = await import('@/lib/navigation/active');
const { returnToHref, readIntent, GUEST_INTENTS } = await import('@/lib/auth/return-to');
const { publicMetadata, noindexMetadata, absoluteUrl, SITE_URL, publicDescription } = await import('@/lib/seo');

describe('canonical slug-based club URLs', () => {
  it('uses /c/<slug> and never a UUID for a public club link', () => {
    expect(ROUTES.club('coding-club')).toBe('/c/coding-club');
    expect(ROUTES.club('gdsc-campus')).toBe('/c/gdsc-campus');
    expect(ROUTES.clubs).toBe('/clubs');
    expect(ROUTES.clubLegacy('15fe0000-0000-4000-a000-000000000001'))
      .toBe('/clubs/15fe0000-0000-4000-a000-000000000001');
    expect(ROUTES.club('coding-club')).not.toMatch(UUID_REGEX);
  });

  it('keeps management, edit and event URLs UUID-based', () => {
    const id = '15fe0000-0000-4000-a000-000000000001';
    expect(ROUTES.clubManage(id)).toBe(`/clubs/${id}/manage`);
    expect(ROUTES.clubEdit(id)).toBe(`/clubs/${id}/edit`);
    expect(ROUTES.event(id)).toBe(`/campus/events/${id}`);
    expect(ROUTES.eventNew()).toBe('/campus/events/new');
    expect(ROUTES.community('some-community')).toBe('/communities/some-community');
  });

  it('reuses the exact database slug constraint', () => {
    for (const valid of ['coding-club', 'abc', 'a'.repeat(60), 'team-123']) {
      expect(CLUB_SLUG_REGEX.test(valid)).toBe(true);
    }
    for (const invalid of ['AB', 'Coding Club', '/c/evil', 'ab', 'a'.repeat(61), 'uuid_like_', '']) {
      expect(CLUB_SLUG_REGEX.test(invalid)).toBe(false);
    }
  });

  it('routes every ROUTES.club() call site through a slug, not an id', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (/\.(js|jsx)$/.test(entry.name)) {
          const source = read(rel);
          for (const match of source.matchAll(/ROUTES\.club\(([^)]*)\)/g)) {
            if (/club\.id|community_id|\bdata\.id\b|\bclubId\b|\bid\b\)/.test(match[1])) {
              offenders.push(`${rel}: ROUTES.club(${match[1]})`);
            }
          }
        }
      }
    };
    for (const dir of ['app', 'components', 'lib']) walk(dir);
    expect(offenders).toEqual([]);
  });
});

describe('public pages live outside the authenticated route group', () => {
  const publicPages = [
    'app/(shell)/(public)/layout.js',
    'app/(shell)/(public)/clubs/page.js',
    'app/(shell)/(public)/clubs/[id]/page.js',
    'app/(shell)/(public)/c/[slug]/page.js',
    'app/(shell)/(public)/campus/events/page.js',
    'app/(shell)/(public)/campus/events/[id]/page.js',
  ];
  const protectedPages = [
    'app/(shell)/(app)/clubs/new/page.js',
    'app/(shell)/(app)/clubs/request/page.js',
    'app/(shell)/(app)/clubs/[id]/manage/page.js',
    'app/(shell)/(app)/clubs/[id]/edit/page.js',
    'app/(shell)/(app)/campus/events/new/page.js',
    'app/(shell)/(app)/admin/page.js',
  ];

  it('ships exactly one page per public path', () => {
    for (const file of publicPages) expect(exists(file), file).toBe(true);
    // No duplicate Next.js pages resolving to the same address.
    for (const duplicate of [
      'app/clubs/page.js',
      'app/c/[slug]/page.js',
      'app/campus/events/page.js',
      'app/(shell)/(app)/clubs/page.js',
      'app/(shell)/(app)/clubs/[id]/page.js',
      'app/(shell)/(app)/campus/events/page.js',
      'app/(shell)/(app)/campus/events/[id]/page.js',
      'app/(shell)/(public)/clubs/new/page.js',
      'app/(shell)/(public)/campus/events/new/page.js',
    ]) {
      expect(exists(duplicate), `duplicate route ${duplicate}`).toBe(false);
    }
  });

  it('keeps every creation and management page in the protected group', () => {
    for (const file of protectedPages) expect(exists(file), file).toBe(true);
    expect(read('app/(shell)/(app)/layout.js')).toContain('requireUser()');
  });

  it('never calls requireUser() on a public page, and resolves the viewer optionally', () => {
    for (const file of publicPages) {
      expect(codeOnly(file), `${file} must not require a session`).not.toMatch(/requireUser\(/);
    }
    for (const file of [
      'app/(shell)/(public)/clubs/page.js',
      'app/(shell)/(public)/c/[slug]/page.js',
      'app/(shell)/(public)/campus/events/page.js',
      'app/(shell)/(public)/campus/events/[id]/page.js',
    ]) {
      expect(read(file), `${file} must be viewer-aware`).toContain('getCurrentUser()');
      expect(read(file)).not.toContain('getAdminClient');
    }
  });

  it('uses the shared optional shell while keeping public content and disclaimer', () => {
    const layout = read('app/(shell)/(public)/layout.js');
    const frame = read('components/layout/PublicFrame.js');
    const optional = read('components/layout/OptionalAppFrame.js');
    expect(read('app/(shell)/layout.js')).toContain('OptionalAppFrame');
    expect(layout).toContain('PublicFrame');
    expect(optional).toContain('getCurrentUser()');
    expect(optional).toContain('<AppShell>');
    expect(optional).toContain('<AppLayout>');
    expect(frame).toContain('CollegeCrest');
    for (const sheet of ['sections.css', 'calendar.css', 'lumen.css']) expect(layout).toContain(sheet);
    expect(exists('app/(shell)/(app)/clubs/layout.js')).toBe(true);
  });
});

describe('proxy matching is explicit, not prefix-based', () => {
  const publicPaths = [
    '/clubs', '/clubs/', '/c/coding-club', '/c/gdsc-campus',
    '/clubs/15fe0000-0000-4000-a000-000000000001',
    '/campus/events', '/campus/events/15fe0000-0000-4000-a000-000000000001',
    '/campus/clubs', '/campus/clubs/15fe0000-0000-4000-a000-000000000001',
    '/sitemap.xml', '/login', '/legal', '/guide', '/timetable/a',
  ];
  const protectedPaths = [
    '/clubs/new', '/clubs/request',
    '/clubs/15fe0000-0000-4000-a000-000000000001/manage',
    '/clubs/15fe0000-0000-4000-a000-000000000001/edit',
    '/campus/events/new',
    '/campus/events/15fe0000-0000-4000-a000-000000000001/manage',
    '/campus', '/home', '/chat', '/admin', '/moderator', '/explore',
    '/c/coding-club/manage', '/c', '/clubswing', '/clubsx',
  ];

  it('lets a guest reach every public discovery address', () => {
    for (const pathname of publicPaths) expect(isPublicPath(pathname), pathname).toBe(true);
  });

  it('sends a guest to sign-in for every protected subroute and lookalike', () => {
    for (const pathname of protectedPaths) expect(isPublicPath(pathname), pathname).toBe(false);
  });

  it('does not use a broad prefix for /clubs or /campus/events', () => {
    const proxy = read('proxy.js');
    expect(proxy).toContain('PUBLIC_EXACT_PATHS');
    expect(proxy).toContain('PROTECTED_CLUB_SEGMENTS');
    expect(proxy).toContain('PROTECTED_EVENT_SEGMENTS');
    expect(proxy).toMatch(/PUBLIC_PATHS = \['\/login'/);
    expect(proxy).not.toMatch(/PUBLIC_PATHS = \[[^\]]*'\/clubs'/);
  });

  it('is not the authorization layer: protected actions re-check the session', () => {
    expect(read('proxy.js')).toMatch(/authorization layer/);
    for (const file of [
      'lib/actions/communities.js', 'lib/actions/campus.js',
      'lib/actions/club-requests.js', 'lib/actions/social.js',
      'lib/actions/moderation.js',
    ]) {
      expect(read(file), `${file} must authenticate writes`).toContain('getActiveUser()');
    }
    for (const file of [
      'app/(shell)/(app)/clubs/new/page.js', 'app/(shell)/(app)/clubs/request/page.js',
      'app/(shell)/(app)/clubs/[id]/manage/page.js', 'app/(shell)/(app)/campus/events/new/page.js',
    ]) {
      expect(read(file), `${file} must enforce its own auth`).toMatch(/requireUser\(|getActiveUser\(/);
    }
  });
});

describe('legacy UUID addresses redirect to the canonical slug', () => {
  for (const file of ['app/(shell)/(public)/clubs/[id]/page.js', 'app/(shell)/(public)/campus/clubs/[id]/page.js']) {
    it(`${file} resolves the stored slug and issues a permanent redirect`, () => {
      const source = read(file);
      expect(source).toContain('UUID_REGEX.test(id)');
      expect(source).toContain('notFound()');
      expect(source).toContain('permanentRedirect(ROUTES.club(club.slug))');
      expect(source).toMatch(/kind !== 'club'/);
      expect(source).toContain('noindexMetadata');
      // A UUID is only a lookup key here; no club content is rendered.
      expect(source).not.toContain('slugify(');
      expect(source).not.toContain('<ClubCard');
    });
  }

  it('keeps /clubs/<id>/manage UUID-addressed and protected', () => {
    expect(isPublicPath('/clubs/15fe0000-0000-4000-a000-000000000001/manage')).toBe(false);
    const page = read('app/(shell)/(app)/clubs/[id]/manage/page.js');
    expect(page).toContain('requireUser()');
    expect(page).toContain('UUID_REGEX');
  });
});

describe('guest sign-in prompts preserve the destination and intended action', () => {
  it('builds a validated return-to link for clubs and events', () => {
    expect(returnToHref('/c/coding-club', 'join')).toBe(
      `/login?next=${encodeURIComponent('/c/coding-club?intent=join')}`
    );
    expect(returnToHref('/campus/events/15fe0000-0000-4000-a000-000000000001', 'rsvp')).toBe(
      `/login?next=${encodeURIComponent('/campus/events/15fe0000-0000-4000-a000-000000000001?intent=rsvp')}`
    );
    expect(returnToHref('/clubs?q=robotics&state=recruiting')).toBe(
      `/login?next=${encodeURIComponent('/clubs?q=robotics&state=recruiting')}`
    );
  });

  it('rejects open redirects and malformed destinations', () => {
    expect(returnToHref('https://evil.example/phish', 'join')).toBe('/login');
    expect(returnToHref('//evil.example', 'join')).toBe('/login');
    expect(returnToHref('/c/../clubs\\evil', 'join')).toBe('/login');
    expect(returnToHref(null)).toBe('/login');
    expect(returnToHref('')).toBe('/login');
  });

  it('recognises only known intents, ignoring injected values', () => {
    expect(Object.values(GUEST_INTENTS)).toEqual(['join', 'rsvp', 'submit_event', 'request_club']);
    expect(readIntent({ intent: 'rsvp' })).toBe('rsvp');
    expect(readIntent({ intent: 'join' })).toBe('join');
    expect(readIntent({ intent: 'delete_everything' })).toBeNull();
    expect(readIntent(null)).toBeNull();
  });

  it('renders a prompt, not a dead server action, for a guest', () => {
    const prompt = read('components/auth/GuestActionPrompt.js');
    expect(prompt).toContain('returnToHref');
    expect(prompt).not.toMatch(/action=\{/);
    expect(prompt).toContain('data-testid="guest-action-prompt"');
    for (const file of [
      'app/(shell)/(public)/clubs/page.js',
      'app/(shell)/(public)/c/[slug]/page.js',
      'app/(shell)/(public)/campus/events/page.js',
      'app/(shell)/(public)/campus/events/[id]/page.js',
    ]) {
      expect(read(file), `${file} needs a guest prompt`).toContain('<GuestActionPrompt');
    }
    const signInLink = read('components/auth/SignInLink.js');
    expect(signInLink).toContain('safeNextPath');
    expect(signInLink).toContain('usePathname');
  });

  it('completes the intended action after return with a small confirmation', () => {
    for (const file of ['app/(shell)/(public)/c/[slug]/page.js', 'app/(shell)/(public)/campus/events/[id]/page.js']) {
      expect(read(file)).toContain('readIntent(');
      expect(read(file)).toMatch(/intent && viewer/);
      expect(read(file)).toContain('<IntentNotice');
    }
  });
});

describe('SEO and sharing metadata', () => {
  it('pins the deployment origin and builds absolute canonical URLs', () => {
    expect(SITE_URL).toBe('https://pccoe.in');
    expect(absoluteUrl('/c/coding-club')).toBe('https://pccoe.in/c/coding-club');
    expect(absoluteUrl('/campus/events/abc')).toBe('https://pccoe.in/campus/events/abc');
    expect(read('app/layout.js')).toContain('metadataBase: new URL(SITE_URL)');
    expect(read('lib/seo.js')).toContain("import 'server-only'");
    expect(read('.env.example')).not.toContain('NEXT_PUBLIC_SITE_URL');
  });

  it('emits indexable OG/Twitter metadata for public pages only', () => {
    const meta = publicMetadata({ title: 'Coding Club', description: 'A student club.', canonical: '/c/coding-club' });
    expect(meta.alternates.canonical).toBe('/c/coding-club');
    expect(meta.robots.index).toBe(true);
    expect(meta.robots.follow).toBe(true);
    expect(meta.openGraph.url).toBe('https://pccoe.in/c/coding-club');
    expect(meta.openGraph.siteName).toBeTruthy();
    expect(meta.twitter.card).toBe('summary_large_image');
    expect(noindexMetadata('Draft').robots.index).toBe(false);
    expect(publicDescription('  a   long   description  ')).toBe('a long description');
    expect(publicDescription('')).toMatch(/public club and event directory/);
    expect(publicDescription('x'.repeat(200)).length).toBeLessThanOrEqual(155);
  });

  it('derives metadata for club/event pages from the anonymous projection only', () => {
    const club = read('app/(shell)/(public)/c/[slug]/page.js');
    const clubMeta = club.slice(
      club.indexOf('export async function generateMetadata'),
      club.indexOf('export default async function ClubPage'),
    );
    expect(clubMeta).toContain('getPublicClubBySlug(slug)');
    expect(clubMeta).toContain('noindexMetadata');
    expect(clubMeta).not.toMatch(/getServerClient|getCurrentUser|getCommunityBySlug/);

    const event = read('app/(shell)/(public)/campus/events/[id]/page.js');
    const eventMeta = event.slice(
      event.indexOf('export async function generateMetadata'),
      event.indexOf('export default async function EventPage'),
    );
    expect(eventMeta).toContain('getPublicEventById(id)');
    expect(eventMeta).toContain("item.status !== 'published'");
    expect(eventMeta).toContain('noindexMetadata');
    expect(eventMeta).not.toMatch(/getServerClient|getCurrentUser|getEvent\(/);
  });

  it('ships a sitemap of published public records and a robots.txt', () => {
    expect(exists('app/sitemap.js')).toBe(true);
    expect(exists('app/robots.js')).toBe(true);
    const sitemap = read('app/sitemap.js');
    expect(sitemap).toContain('listPublicClubs');
    expect(sitemap).toContain('listPublishedEvents');
    expect(sitemap).toContain("status === 'published'");
    expect(sitemap).toContain("visibility === 'public'");
    expect(sitemap).toContain('ROUTES.club(club.slug)');
    expect(sitemap).not.toMatch(/getAdminClient|requireUser|community_members|event_registrations/);
    const robots = read('app/robots.js');
    expect(robots).toContain('/sitemap.xml');
    expect(robots).toContain("'/c/'");
    expect(robots).toContain("'/clubs/*/manage'");
    expect(robots).toContain("'/campus/events/new'");
  });

  it('shares the canonical relative path, never a UUID or off-site URL', () => {
    for (const file of [
      'app/(shell)/(public)/clubs/page.js',
      'app/(shell)/(public)/c/[slug]/page.js',
      'app/(shell)/(public)/campus/events/[id]/page.js',
    ]) {
      expect(read(file)).toContain('<ShareButton');
    }
    expect(read('app/(shell)/(public)/clubs/page.js')).toContain('path={ROUTES.club(club.slug)}');
    expect(read('app/(shell)/(public)/c/[slug]/page.js')).toContain('path={canonicalPath}');
    expect(read('components/social/ShareButton.js')).toContain('absoluteUrl(path)');
    expect(read('components/social/ShareButton.js')).not.toContain('process.env');
  });
});

describe('navigation still highlights the Clubs section on /c/<slug>', () => {
  it('treats a canonical club profile as a child of /clubs', () => {
    expect(isActivePath('/c/coding-club', '/clubs')).toBe(true);
    expect(resolveActiveHref('/c/coding-club', ['/clubs', '/communities', '/campus'])).toBe('/clubs');
    expect(isActivePath('/clubs/abc/edit', '/clubs')).toBe(true);
    expect(isActivePath('/clubswing', '/clubs')).toBe(false);
  });
});

describe('public cache and invalidation contract', () => {
  it('keeps public readers viewer-independent and private reads out of the cache', () => {
    const cache = read('lib/data/public-cache.js');
    expect(cache).toContain('getPublicClient()');
    expect(cache).toContain('PUBLIC_EVENT_COLUMNS');
    expect(read('lib/supabase/public.js')).toContain('persistSession: false');
    expect(codeOnly('lib/supabase/public.js')).not.toContain('cookies()');
    expect(read('lib/supabase/public.js')).not.toContain('SUPABASE_SECRET_KEY');
    expect(read('lib/data/public.js')).toContain('getPublicClient()');
    expect(read('lib/data/public.js')).not.toContain('getAdminClient');
    expect(read('lib/data/public.js')).not.toMatch(/\.select\('\*'/);
  });

  it('drops the club cache when club records, posts or visibility change', () => {
    const tags = read('lib/data/public-tags.js');
    expect(tags).toContain("clubs: 'public:clubs'");
    for (const file of [
      'lib/actions/communities.js', 'lib/actions/club-requests.js',
      'lib/actions/campus.js', 'lib/actions/social.js', 'lib/actions/moderation.js',
    ]) {
      expect(read(file), `${file} must invalidate the public club cache`).toContain('PUBLIC_TAGS.clubs');
    }
    for (const file of ['lib/actions/social.js', 'lib/actions/moderation.js', 'lib/actions/communities.js']) {
      expect(read(file)).toContain("'/c/[slug]'");
      expect(read(file)).not.toContain("'/clubs/[id]'");
    }
  });

  it('never revalidates a club profile by UUID path', () => {
    const files = ['lib/actions/campus.js', 'lib/actions/club-requests.js', 'lib/actions/communities.js'];
    for (const file of files) {
      const args = [...read(file).matchAll(/revalidatePath\(ROUTES\.club\(([^)]*)\)/g)].map((m) => m[1]);
      // The only exact-path invalidation uses a stored slug; all other club
      // revalidation goes through the dynamic `/c/[slug]` pattern.
      expect(args.every((arg) => /slug/.test(arg)), `${file} must revalidate by slug`).toBe(true);
      // The legacy UUID redirect page may be invalidated by UUID; that is the
      // only UUID-addressed path left, and it renders no club content.
    }
  });
});

describe('the database migration is narrow and documented', () => {
  const migration = 'supabase/migrations/20261103000001_041_public_discovery.sql';
  const sql = read(migration);

  it('documents the visibility decision and the affected 35 catalogue rows', () => {
    expect(sql).toMatch(/35/);
    expect(sql).toContain('catalogue_key in (');
    expect(sql).toContain("visibility = 'public'");
    expect(sql).toContain("visibility = 'campus'");
    expect(sql).toMatch(/NOT what this migration does/);
    expect(read('docs/PUBLIC-DISCOVERY.md')).toContain('35');
  });

  it('creates exactly three scoped anon SELECT policies and no anon writes', () => {
    const policies = [...sql.matchAll(/create policy (\w+) on public\.(\w+)\s+for (\w+) to anon/g)];
    expect(policies.map((m) => m[1])).toEqual([
      'communities_select_public_club',
      'events_select_public_published',
      'posts_select_public_club_announcement',
    ]);
    expect(policies.every((m) => m[3] === 'select')).toBe(true);
    expect(sql).not.toMatch(/for (insert|update|delete|all) to anon/i);
    expect(sql).toContain("using (status = 'published')");
    expect(sql).toContain("and visibility = 'public'");
    expect(sql).toContain('deleted_at is null');
  });

  it('grants only named columns, and never a whole table', () => {
    expect(sql).toMatch(/grant select \(\s*id, kind, name, slug/);
    expect(sql).not.toMatch(/grant\s+(select|all)\s+on\s+(table\s+)?public\.\w+\s+to anon/i);
    expect(sql).toContain('created_by');
    expect(sql).toContain('No created_by / updated_by');
    expect(sql).toContain('information_schema.column_privileges');
    expect(sql).toContain('raise exception');
  });

  it('re-points global_search at the canonical slug URL without granting anon RPCs', () => {
    expect(sql).toContain("'/c/' || c.slug");
    expect(sql).toContain('revoke all on function public.global_search');
    expect(sql).not.toMatch(/grant execute on function[^\n]*to anon/i);
  });

  it('is included in the tracked SQL bundle', () => {
    expect(read('supabase/bundle/campus-plus-schema.sql')).toContain('communities_select_public_club');
    expect(read('supabase/bundle/campus-plus-schema.sql')).toContain('041_public_discovery.sql');
  });

  it('ships a real-role RLS suite for anon and authenticated', () => {
    const suite = read('database/tests/21_public_discovery_rls.sql');
    expect(suite).toContain('set role anon');
    expect(suite).toContain('set role authenticated');
    expect(suite).toContain('test_assert_denied');
    for (const action of [
      'insert into public.community_members',
      'insert into public.community_join_requests',
      'insert into public.event_registrations',
      'insert into public.events',
      'insert into public.posts',
      'select created_by, approved_by, catalogue_key',
      'select * from public.event_registrations',
    ]) {
      expect(suite, `missing anon denial for ${action}`).toContain(action);
    }
    expect(suite).toContain('global_search returns the canonical slug URL');
  });

  it('teaches the DB audit about the intentional anon projection', () => {
    const audit = read('scripts/dev/audit.mjs');
    expect(audit).toContain('ANON_POLICY_ALLOW_LIST');
    expect(audit).toContain('ANON_COLUMN_ALLOW_LIST');
    expect(audit).toContain('information_schema.column_privileges');
    expect(audit).toContain('communities_select_public_club');
  });

  it('adds 041-aware probes to the live deployment security script', () => {
    const probe = read('scripts/verify-security.mjs');
    expect(probe).toContain('Public discovery (migration 041)');
    expect(probe).toContain('anon can read the published public club catalogue');
    expect(probe).toContain("anon cannot select('*') from");
    expect(probe).toContain("['communities', 'created_by']");
    expect(probe).toContain('anon cannot read ${table}.${column}');
    expect(probe).toContain('anon cannot RSVP');
    expect(probe).toContain('anon cannot call the authenticated-only global_search()');
  });
});
