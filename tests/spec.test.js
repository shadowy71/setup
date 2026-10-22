import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ROUTES } from '@/lib/constants';

/**
 * Architecture guards.
 *
 * Campus+ has hard, non-negotiable product rules. Rather than trusting review,
 * these tests read the source tree and fail when a rule is broken: no AI, no
 * uploads, no raw HTML, no presence, no secrets in the browser bundle.
 */

const ROOT = process.cwd();

function walk(dir, filter, out = []) {
  const absolute = path.join(ROOT, dir);
  if (!fs.existsSync(absolute)) return out;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(relative, filter, out);
    else if (filter(relative)) out.push(relative);
  }
  return out;
}

const appFiles = walk('app', (file) => /\.(js|jsx)$/.test(file));
const componentFiles = walk('components', (file) => /\.(js|jsx)$/.test(file));
const libFiles = walk('lib', (file) => /\.js$/.test(file));
const allSource = [...appFiles, ...componentFiles, ...libFiles];

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const grep = (files, pattern) =>
  files.filter((file) => pattern.test(read(file)));

describe('no artificial intelligence anywhere (spec §2)', () => {
  const providers = /openai|anthropic|claude|gemini|groq|ollama|huggingface|langchain|cohere|mistral|vertex-ai/i;

  it('does not depend on an AI or vector SDK', () => {
    const pkg = JSON.parse(read('package.json'));
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(dependencies).filter((name) => providers.test(name))).toEqual([]);
  });

  it('does not reference providers, embeddings or vector stores in executable code', () => {
    // Comments may legitimately *say* "no AI"; only code counts here.
    const codeOnly = (file) =>
      read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');
    const offenders = allSource.filter(
      (file) =>
        providers.test(codeOnly(file)) ||
        /embeddings?|vector\s*(db|store|search)|pinecone|weaviate|pgvector/i.test(codeOnly(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps ranking deterministic — no ai/score-based feed ordering', () => {
    for (const file of walk('lib/data', (f) => f.endsWith('.js'))) {
      expect(read(file)).not.toMatch(/ai_|_ai\b|spam_score|toxicity/i);
    }
  });
});

describe('text-first: no uploads, no images, no files (spec §3)', () => {
  it('renders images in exactly two places: the GIF picker and the brand asset', () => {
    const GIF_SURFACE = path.join('components', 'media', 'GifPicker.js');
    // The brand mark is the one other <img> in the product, and only when the
    // supplied logo asset is configured (LOGO_SRC); user content is never media.
    const BRAND_SURFACE = path.join('components', 'brand', 'Brand.js');
    const imageUsers = grep([...appFiles, ...componentFiles], /<img[\s>]|from 'next\/image'|from "next\/image"/);
    expect(imageUsers.sort()).toEqual([BRAND_SURFACE, GIF_SURFACE].sort());
    // That single surface must point at the validated provider hosts.
    const picker = read(GIF_SURFACE);
    expect(picker).toMatch(/giphy/i);
  });

  it('never renders a file input', () => {
    expect(grep([...appFiles, ...componentFiles], /type=["']file["']|accept=["']image/)).toEqual([]);
  });

  it('never touches a storage bucket', () => {
    expect(grep(allSource, /\.storage\.|from\(['"][^'"]*bucket|supabase\.storage/)).toEqual([]);
  });

  it('only accepts GIFs, and only from the validated provider hosts', () => {
    // The picker and the composer both go through the single GIF client.
    expect(grep(allSource, /from '@\/lib\/giphy|@\/components\/media\/GifPicker/).length).toBeGreaterThan(0);

    // Hard-coded provider hostnames live only where they are validated:
    // the schema allow-list, the provider client, and the server config.
    const allowed = [
      path.join('lib', 'validation', 'schemas.js'),
      path.join('lib', 'giphy', 'index.js'),
      path.join('lib', 'config.server.js'),
    ];
    const hosts = grep(allSource, /giphy\.com/).sort();
    expect(hosts).toEqual([...allowed].sort());
  });
});

describe('no executable user html (spec §75)', () => {
  it('never uses dangerouslySetInnerHTML', () => {
    expect(grep(allSource, /dangerouslySetInnerHTML/)).toEqual([]);
  });

  it('never builds an html string with innerHTML', () => {
    expect(grep(allSource, /\.innerHTML\s*=|document\.write/)).toEqual([]);
  });
});

describe('no presence, no typing indicators (spec §8, §22)', () => {
  it('has no presence or typing code in the chat surface', () => {
    const chatFiles = [
      ...walk('components/chat', (f) => f.endsWith('.js')),
      ...walk('app/(app)/chat', (f) => f.endsWith('.js')),
    ];
    // Channels are private broadcast only: no presence events, no typing state.
    for (const file of chatFiles) {
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');
      expect(code).not.toMatch(/typing|is_online|last_seen_at|presence_/i);
      expect(code).not.toMatch(/\.on\('presence'|track\(|untrack\(/);
    }
  });

  it('keeps the only delivery vocabulary in messages: Sent and Seen', () => {
    const thread = read('components/chat/ChatThread.js');
    expect(thread).toMatch(/Seen/);
    expect(thread).toMatch(/Sent/);
  });
});

describe('secrets never reach the browser bundle (spec §74, §93)', () => {
  it('exposes only the two public Supabase variables', () => {
    const publicVars = new Set();
    for (const file of allSource) {
      for (const match of read(file).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) publicVars.add(match[0]);
    }
    // Only public, non-secret configuration. Anything secret-looking in a
    // NEXT_PUBLIC_ variable would be shipped to the browser.
    expect([...publicVars].sort()).toEqual([
      'NEXT_PUBLIC_COLLEGE_NAME',
      'NEXT_PUBLIC_LOCAL_PREVIEW',
      'NEXT_PUBLIC_PLATFORM_NAME',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_SUPABASE_URL',
    ]);
    const secretish = [...publicVars].filter((name) => /SECRET|SERVICE|TOKEN|PASSWORD|PRIVATE_KEY/.test(name));
    expect(secretish).toEqual([]);
  });

  it('keeps secrets behind the server-only module', () => {
    const serverConfig = read('lib/config.server.js');
    expect(serverConfig).toMatch(/^import 'server-only';/m);
    expect(serverConfig).toMatch(/SUPABASE_SECRET_KEY/);
    expect(serverConfig).toMatch(/GIPHY_API_KEY/);

    for (const file of [...appFiles, ...componentFiles]) {
      const source = read(file);
      const isServerFile = !source.startsWith("'use client'");
      if (isServerFile) continue; // server code may legitimately name a secret
      expect(source).not.toMatch(/SUPABASE_SECRET_KEY|GIPHY_API_KEY|SERVICE_ROLE/);
    }
  });

  it('sends client components through the browser-safe config only', () => {
    for (const file of componentFiles) {
      const source = read(file);
      if (!source.startsWith("'use client'")) continue;
      expect(source).not.toMatch(/@\/lib\/config\.server/);
    }
  });
});

describe('route surface (spec §5, §6)', () => {
  const exists = (route) => {
    const candidates = [
      path.join(ROOT, 'app', route, 'page.js'),
      path.join(ROOT, 'app', '(app)', route, 'page.js'),
    ];
    return candidates.some((candidate) => fs.existsSync(candidate));
  };

  it('exposes every route the specification lists', () => {
    const required = [
      '/', '/setup', '/login', '/login/verify', '/onboarding', '/account-status', '/rules',
      '/home', '/explore', '/market', '/communities', '/campus', '/chat',
      '/profile', '/settings', '/notifications', '/moderator', '/admin',
      '/user/[username]', '/post/[id]', '/community/[slug]', '/market/listing/[id]',
      '/gigs', '/gigs/new', '/gigs/[id]', '/gigs/[id]/edit',
      '/clubs', '/clubs/new', '/clubs/[id]', '/clubs/[id]/edit',
      // The pre-section addresses stay routable: they redirect, so old
      // notifications and bookmarks keep working.
      '/market/gigs/[id]', '/campus/events/[id]', '/campus/clubs/[id]',
      '/campus/noticeboard/[id]', '/explore/resources/[id]', '/explore/opportunities/[id]',
      '/explore/projects/[id]', '/chat/[id]',
    ];
    const missing = required.filter((route) => !exists(route));
    expect(missing).toEqual([]);
    // `/community/<slug>` is the spec's canonical deep link and must resolve
    // (the application serves `/communities/<slug>` and aliases the short form).
    expect(
      fs.existsSync(path.join(ROOT, 'app', 'community', '[slug]', 'page.js')) ||
        fs.existsSync(path.join(ROOT, 'app', '(app)', 'community', '[slug]', 'page.js')),
    ).toBe(true);
  });

  it('never gives a Random session a public url', () => {
    expect(fs.existsSync(path.join(ROOT, 'app', '(app)', 'random', '[id]'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'app', '(app)', 'random', '[session]'))).toBe(false);
    expect(typeof ROUTES.random === 'function' && ROUTES.random.length > 0).toBe(false);
  });

  it('ships loading states for the primary surfaces', () => {
    const withLoading = ['home', 'explore', 'market', 'gigs', 'clubs', 'communities', 'campus', 'chat', 'notifications', 'settings', 'moderator', 'admin', 'profile'];
    const missing = withLoading.filter(
      (route) => !fs.existsSync(path.join(ROOT, 'app', '(app)', route, 'loading.js')),
    );
    expect(missing).toEqual([]);
  });
});

describe('design system (spec §4)', () => {
  const globals = read('app/globals.css');
  const partials = ['surfaces', 'controls', 'feedback', 'interactive', 'navigation']
    .map((name) => read(`app/styles/${name}.css`))
    .join('\n');

  it('defines the semantic token set for the one permanent dark theme', () => {
    for (const token of [
      '--c-canvas',
      '--c-surface',
      '--c-surface-2',
      '--c-ink',
      '--c-ink-soft',
      '--c-muted',
      '--c-line',
      '--c-line-strong',
      '--c-accent',
      '--c-accent-hover',
      '--c-accent-press',
      '--c-accent-deep',
      '--c-accent-soft',
      '--c-accent-tint',
      '--c-accent-pale',
      '--c-accent-highlight',
      '--c-accent-glass',
      '--c-accent-ink',
      '--c-on-accent',
      '--c-danger',
      '--c-success',
      '--c-warning',
      '--c-info',
      '--c-unread',
      '--c-glass-bg',
      '--c-glass-tint',
      '--c-glass-border',
    ]) {
      expect(globals).toContain(token);
    }
    // One mandatory dark theme — no light variant and no "follow the device".
    expect(globals).toContain("[data-theme='dark']");
    expect(globals).not.toContain("[data-theme='light']");
    expect(globals).not.toContain("[data-theme='system']");
    expect(globals).not.toContain('@media (prefers-color-scheme: dark)');
    // The tokens are exposed to Tailwind as utilities.
    expect(globals).toContain('@theme inline');
  });

  it('keeps the Teal Sand identity and the designed night palette', () => {
    expect(globals).toContain('#07151d'); // midnight-navy canvas
    expect(globals).toContain('#10242d'); // deep-ocean elevated surface, not black
    expect(globals).toContain('#f8faf7'); // soft-ivory ink on the night canvas
    expect(globals).toContain('#14b8a6'); // the teal identity
    expect(globals).toContain('#2dd4bf'); // lit teal accent text
    expect(globals).toContain('#f4e3c1'); // warm sand, the only warmth in type
    expect(globals).toContain('#f97316'); // sunset orange, energy only
    expect(globals).not.toContain('#f7f5f1'); // the retired light canvas is gone

    // No leftover identity from the previous blue/purple direction: the one
    // brand is Teal Sand, and an old accent cannot quietly reappear.
    for (const retired of ['#6f9bff', '#5b89f5', '#9abbff', '#5cd8f7', '#0b1120', '#121824', '#ef6a1c']) {
      expect(globals).not.toContain(retired);
    }
    expect(globals).not.toMatch(/--c-accent:\s*#(f|e)[0-9a-f]{2}/i);
  });

  it('never hardcodes a colour in a page or component', () => {
    // The only allowed literal is the one theme-color meta entry, which has
    // to mirror the canvas token for the browser chrome.
    const offenders = allSource.filter((file) => {
      if (file === path.join('app', 'layout.js')) return false;
      return /#[0-9a-fA-F]{3,8}\b/.test(read(file));
    });
    expect(offenders).toEqual([]);
  });

  it('keeps glass, motion and the interactive materials inside the design system', () => {
    expect(partials).toContain('.glass {');
    expect(partials).toContain('.glass-soft');
    expect(partials).toContain('.glass-strong');
    expect(partials).toMatch(/prefers-reduced-motion/);
    expect(partials).toContain('.tilt__card');
    expect(partials).toContain('.wheel__option');

    // Glass is an accent: only a small, deliberate set of floating surfaces may
    // opt into their own backdrop blur on top of the primitives.
    const blurry = allSource.filter((file) => /backdrop-blur|backdrop-filter/.test(read(file)));
    expect(blurry.length).toBeLessThanOrEqual(8);
  });
});

describe('public configuration reaches the browser bundle (spec §91, §92)', () => {
  /*
   * `NEXT_PUBLIC_*` values only reach the browser because the bundler replaces
   * the exact expression `process.env.` + the variable name at build time. A
   * computed key into `process.env` is invisible to that replacement, so the
   * browser reads `undefined` while the server reads the real value.
   *
   * That is not hypothetical: `lib/config.js` used to read the Supabase URL and
   * publishable key that way, which made `getBrowserClient()` return `null` in
   * real browsers. Sign-out then silently did nothing — the session cookie
   * survived and the proxy bounced `/login` straight back to `/home` — while
   * every lint, test and build stayed green, because server-side code was
   * unaffected. These guards fail if that pattern comes back.
   */
  const codeOnly = (file) =>
    read(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');

  it('never reads a browser env var through a computed key', () => {
    // `server-only` modules are never bundled for the browser: a computed key
    // there is read from the real environment at request time and is fine.
    const serverOnly = /import 'server-only'|from 'server-only'|require\('server-only'\)/;
    const offenders = [...allSource, 'proxy.js'].filter(
      (file) => /process\.env\s*\[/.test(codeOnly(file)) && !serverOnly.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('reads its own public Supabase configuration as literal member expressions', () => {
    const config = codeOnly(path.join('lib', 'config.js'));
    expect(config).toContain('process.env.NEXT_PUBLIC_SUPABASE_URL');
    expect(config).toContain('process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    expect(config).not.toMatch(/process\.env\s*\[/);
  });

  it('keeps secrets out of anything a client component imports', () => {
    const clientReachable = allSource.filter((file) => /^'use client'/.test(read(file)));
    const leaked = clientReachable.filter((file) =>
      /SUPABASE_SECRET_KEY|GIPHY_API_KEY|service_role/.test(codeOnly(file)),
    );
    expect(leaked).toEqual([]);
  });
});
