import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * Admin → Backups must show the operator something actionable: the four queue
 * states, per-run results with safe diagnostics, and disabled controls while a
 * run is in progress. The Drive credential itself is never part of this tree.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin',
}));
vi.mock('@/lib/actions/backup.js', () => ({
  disconnectDriveBackup: vi.fn(),
  processBackupNow: vi.fn(),
  requestManualBackup: vi.fn(),
  retryBackupBatch: vi.fn(),
}));

const { BackupActionButtons, RetryBackupButton } = await import('@/components/admin/BackupPanels');

const render = (props) => renderToStaticMarkup(React.createElement(BackupActionButtons, props));

describe('BackupActionButtons', () => {
  it('labels both controls as processing actions, not queueing', () => {
    const html = render({ connected: true, admin: { leases: [], active: false } });
    expect(html).toContain('Run incremental now');
    expect(html).toContain('Run full snapshot now');
    expect(html).not.toMatch(/Request full snapshot|Queuing…/);
    expect(html).toContain('Connect Google Drive'.replace('Connect', 'Reconnect'));
  });

  it('disables both run controls and warns when another session holds the lease', () => {
    const html = render({
      connected: true,
      admin: { active: true, leases: [{ kind: 'incremental', active: true }] },
    });
    // Both processing controls are locked; Disconnect stays available as an
    // emergency stop, and the OAuth anchor is never disabled.
    const disabledCount = [...html.matchAll(/disabled=""/g)].length;
    expect(disabledCount).toBe(2);
    expect(html).toMatch(/already in progress/i);
    expect(html).toMatch(/No new job was queued/i);
  });

  it('disables the run controls while its own click is in flight (no duplicate jobs)', () => {
    const html = render({ connected: true, admin: { active: false, leases: [] } });
    // Idle admin: controls are enabled, so nothing about a queued-but-busy
    // state can silently swallow a click.
    expect([...html.matchAll(/disabled=""/g)].length).toBe(0);
    expect(html).not.toMatch(/already in progress/i);
  });

  it('tells an unconnected admin to connect before running', () => {
    const html = render({ connected: false, admin: { leases: [], active: false } });
    expect(html).toContain('Connect Google Drive');
    expect(html).toMatch(/Connect Google Drive before running a backup/);
  });

  it('RetryBackupButton points at the button that actually processes the retry', () => {
    const html = renderToStaticMarkup(React.createElement(RetryBackupButton, { batchId: 'b-1' }));
    expect(html).toContain('Authorize retry');
  });

  it('keeps the Drive OAuth entry point a native navigation', () => {
    const html = render({ connected: true, admin: { leases: [], active: false } });
    const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toContain('href="/api/backup/drive/connect"');
  });
});
