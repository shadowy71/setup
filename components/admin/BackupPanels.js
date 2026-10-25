'use client';

/**
 * Admin-only backup controls. The action buttons call server actions that ONLY
 * enqueue durable work or revoke local connection state; the Connect link is a
 * native anchor to the OAuth start route. Nothing here uploads to Drive — the
 * worker picks queued jobs up on its next scheduled run.
 */

import { Button, Notice } from '@/components/ui';
import { useFormAction } from '@/lib/forms';
import {
  disconnectDriveBackup,
  requestManualBackup,
  retryBackupBatch,
} from '@/lib/actions/backup.js';

export function BackupActionButtons({ connected }) {
  const incremental = useFormAction(requestManualBackup);
  const snapshot = useFormAction(requestManualBackup);
  const disconnect = useFormAction(disconnectDriveBackup);

  const enqueue = (kind, run) => {
    const formData = new FormData();
    formData.set('kind', kind);
    run(formData);
  };

  const errors = [incremental.error, snapshot.error, disconnect.error].filter(Boolean);
  const notices = [];
  if (incremental.success) notices.push('Incremental export queued.');
  if (snapshot.success) notices.push('Full snapshot queued.');
  if (disconnect.success) notices.push('Drive disconnected.');

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
        <Button type="button" size="sm" disabled={!connected || incremental.pending} onClick={() => enqueue('incremental', incremental.run)}>
          {incremental.pending ? 'Queuing…' : 'Run incremental now'}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={!connected || snapshot.pending} onClick={() => enqueue('snapshot', snapshot.run)}>
          {snapshot.pending ? 'Queuing…' : 'Request full snapshot'}
        </Button>
        {connected ? (
          <Button type="button" size="sm" variant="danger" disabled={disconnect.pending} onClick={() => disconnect.run(new FormData())}>
            {disconnect.pending ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        ) : null}
      </div>
      {errors.map((error) => <Notice key={error} tone="danger" icon="flag">{error}</Notice>)}
      {notices.map((notice) => <Notice key={notice} tone="success" icon="checkCircle">{notice}</Notice>)}
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
      {retry.success ? <Notice tone="success">Retry queued.</Notice> : null}
    </span>
  );
}
