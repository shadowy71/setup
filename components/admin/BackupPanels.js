'use client';

/**
 * Admin-only backup controls.
 *
 * "Run incremental now" and "Run full snapshot now" call a permission-checked
 * SERVER ACTION that drains eligible queued work in bounded batches. They do
 * NOT enqueue another job, so repeated clicks cannot pile up duplicates. All
 * Drive/OAuth/service-role material stays on the server; only a redacted run
 * summary comes back to this component.
 */

import { useState } from 'react';
import { Badge, Button, Notice } from '@/components/ui';
import { useFormAction } from '@/lib/forms';
import {
  disconnectDriveBackup,
  processBackupNow,
  retryBackupBatch,
} from '@/lib/actions/backup.js';

const RESULT_TONE = {
  verified: 'success',
  drained: 'success',
  idle: 'neutral',
  busy: 'warning',
  failed: 'danger',
  not_configured: 'warning',
};

const RESULT_LABEL = {
  verified: 'verified',
  drained: 'drained',
  idle: 'nothing to do',
  busy: 'already processing',
  failed: 'failed',
  not_configured: 'not configured',
};

export function BackupActionButtons({ connected, admin = null }) {
  const [runResult, setRunResult] = useState(null);
  const [runningKind, setRunningKind] = useState(null);
  const process = useFormAction(processBackupNow, { onSuccess: setRunResult });
  const disconnect = useFormAction(disconnectDriveBackup);

  const activeKinds = new Set(
    (admin?.leases || []).filter((lease) => lease.active).map((lease) => lease.kind),
  );
  const busyElsewhere = Boolean(admin?.active) && !process.pending;
  const disabled = !connected || process.pending || disconnect.pending || busyElsewhere;

  const run = (kind) => {
    setRunResult(null);
    setRunningKind(kind);
    const formData = new FormData();
    formData.set('kind', kind);
    process.run(formData);
  };

  const errors = [process.error, disconnect.error].filter(Boolean);
  const resultTone = runResult ? (RESULT_TONE[runResult.status] || 'neutral') : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {/*
          Native <a>, intentionally NOT LinkButton/next/link: the App Router
          prefetches Link targets with ?_rsc=… and then tries to follow this
          route's 307 to accounts.google.com as a client-side (RSC) fetch,
          which fails CORS. A plain anchor performs a top-level document GET
          so the browser itself follows the server redirect to Google.
        */}
        <Button as="a" href="/api/backup/drive/connect" size="sm" variant="secondary">
          {connected ? 'Reconnect Google Drive' : 'Connect Google Drive'}
        </Button>
        <Button type="button" size="sm" disabled={disabled} onClick={() => run('incremental')}>
          {process.pending && runningKind === 'incremental' ? 'Processing…' : 'Run incremental now'}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => run('snapshot')}>
          {process.pending && runningKind === 'snapshot' ? 'Processing…' : 'Run full snapshot now'}
        </Button>
        {connected ? (
          <Button type="button" size="sm" variant="danger" disabled={process.pending || disconnect.pending} onClick={() => disconnect.run(new FormData())}>
            {disconnect.pending ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        ) : null}
      </div>

      {!connected ? (
        <Notice tone="warning" icon="flag">Connect Google Drive before running a backup.</Notice>
      ) : null}
      {busyElsewhere ? (
        <Notice tone="warning" icon="clock">
          A {[...activeKinds].join(' or ') || 'backup'} run is already in progress in another session. No new job was queued.
        </Notice>
      ) : null}

      {runResult ? (
        <div className="flex flex-col gap-1.5" aria-live="polite">
          <Notice tone={resultTone} icon={runResult.status === 'verified' ? 'checkCircle' : 'flag'}>
            <span className="font-medium">{RESULT_LABEL[runResult.status] || runResult.status}</span>
            {' · '}{runResult.message}
          </Notice>
          {runResult.diagnostics?.length ? (
            <ul className="flex flex-col gap-1 pl-1 text-2xs text-muted">
              {runResult.diagnostics.map((entry, index) => (
                <li key={`${entry.code}-${index}`}>[{entry.code}] {entry.message}</li>
              ))}
            </ul>
          ) : null}
          {runResult.objects?.length ? (
            <ul className="flex flex-col gap-1 pl-1 text-2xs text-muted">
              {runResult.objects.map((object) => (
                <li key={object.fileId || object.sha256}>
                  <Badge tone="success">verified</Badge>{' '}
                  <span className="font-mono">{object.fileId}</span>
                  {object.eventCount ? ` · ${object.eventCount} change(s)` : ''}
                  {object.rowCount ? ` · ${object.rowCount} row(s)` : ''}
                  {object.sha256 ? ` · sha256 ${String(object.sha256).slice(0, 16)}…` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {runResult.retryDelaySeconds ? (
            <p className="text-2xs text-muted">
              Automatic retry is available in about {runResult.retryDelaySeconds}s, or use an authorized retry below.
            </p>
          ) : null}
        </div>
      ) : null}

      {errors.map((error) => <Notice key={error} tone="danger" icon="flag">{error}</Notice>)}
      {disconnect.success ? <Notice tone="success" icon="checkCircle">Drive disconnected.</Notice> : null}
    </div>
  );
}

export function RetryBackupButton({ batchId }) {
  const retry = useFormAction(retryBackupBatch);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={retry.pending}
        onClick={() => {
          const formData = new FormData();
          formData.set('batch_id', batchId);
          retry.run(formData);
        }}
      >
        {retry.pending ? 'Retrying…' : 'Authorize retry'}
      </Button>
      {retry.error ? <Notice tone="danger">{retry.error}</Notice> : null}
      {retry.success ? <Notice tone="success">Retry authorized. Click Run incremental now to process it.</Notice> : null}
    </span>
  );
}
