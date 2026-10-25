import { readFile } from 'node:fs/promises';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { PRODUCTION_DRIVE_REDIRECT_URI } from '../lib/backup/constants.js';

// The panel uses useFormAction(), which calls useRouter(). SSR needs a router
// stub; the server actions themselves are never invoked by these assertions.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/admin',
}));
vi.mock('@/lib/actions/backup.js', () => ({
  disconnectDriveBackup: vi.fn(),
  requestManualBackup: vi.fn(),
  retryBackupBatch: vi.fn(),
}));

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

const CONNECT_PATH = '/api/backup/drive/connect';
// Explanatory comments legitimately mention LinkButton/next/link; only code
// (not prose) must be free of client-side navigation.
const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Drive Connect uses a native top-level navigation', () => {
  it('renders a real <a href> and never a Next.js Link / RSC fetch', async () => {
    const source = codeOnly(await read('components/admin/BackupPanels.js'));

    // Regression: LinkButton (next/link) prefetches the route with ?_rsc=… and
    // then follows the 307 to accounts.google.com via a client-side RSC fetch,
    // which fails CORS. Only a plain anchor does a document-level GET.
    expect(source).not.toContain('LinkButton');
    expect(source).not.toMatch(/next\/link|<Link\b/);
    expect(source).toMatch(/as="a"/);
    expect(source).toContain(`href="${CONNECT_PATH}"`);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/useRouter|router\.push|next\/navigation|window\.location|redirect\(/);

    const { BackupActionButtons } = await import('../components/admin/BackupPanels.js');
    const html = renderToStaticMarkup(React.createElement(BackupActionButtons, { connected: false }));

    expect(html).toMatch(new RegExp(`<a [^>]*href="${CONNECT_PATH.replace(/\//g, '\\/')}"`));
    expect(html).toContain('Connect Google Drive');
    // Exactly one anchor: every other control stays a real <button>.
    expect([...html.matchAll(/<a\b/g)].length).toBe(1);
    expect(html).not.toContain('_rsc');
  });

  it('preserves the secondary/small styling and the connected label', async () => {
    const { BackupActionButtons } = await import('../components/admin/BackupPanels.js');
    const disconnected = renderToStaticMarkup(React.createElement(BackupActionButtons, { connected: false }));
    const connected = renderToStaticMarkup(React.createElement(BackupActionButtons, { connected: true }));

    for (const html of [disconnected, connected]) {
      // Same classes LinkButton produced: btn + size + variant.
      expect(html).toMatch(/class="[^"]*btn[^"]*btn-sm[^"]*btn-secondary/);
      expect(html).toContain(`href="${CONNECT_PATH}"`);
    }
    expect(disconnected).toContain('Connect Google Drive');
    expect(connected).toContain('Reconnect Google Drive');
    // Keyboard/screen-reader access comes from the real anchor + href, with no
    // artificial role/tabindex needed.
    expect(connected).not.toMatch(/role="button"/);
  });
});

describe('the connect route keeps its server-side guards', () => {
  it('still authenticates, checks manage_backups, persists PKCE state and redirects', async () => {
    const route = await read('app/api/backup/drive/connect/route.js');

    expect(route).toContain('getActiveUser');
    expect(route).toContain("can(toActor(user), 'manage_backups')");
    expect(route).toContain('assertOAuthClientConfig(backupEnv())');
    expect(route).toContain('generatePkce()');
    expect(route).toContain('generateState()');
    expect(route).toContain('stateHash(state)');
    expect(route).toContain('sealSecret(');
    expect(route).toContain('PURPOSE_VERIFIER');
    expect(route).toContain("supabase.rpc('backup_start_oauth_flow'");
    expect(route).toContain('p_state_hash');
    expect(route).toContain('p_ciphertext');
    expect(route).toContain('p_expires_at');
    expect(route).toContain('buildAuthorizationUrl(');
    expect(route).toContain('NextResponse.redirect(url)');
  });

  it('adds no CORS workaround or secret to the redirect flow', async () => {
    const route = await read('app/api/backup/drive/connect/route.js');
    expect(route).not.toMatch(/Access-Control-Allow-Origin|access-control-allow/i);
    expect(route).not.toContain('client_secret');
    expect(route).not.toMatch(/\bfetch\s*\(/);
    // The registered production callback is unchanged by this fix.
    expect(PRODUCTION_DRIVE_REDIRECT_URI).toBe('https://pccoe.in/api/backup/drive/callback');
  });
});
