'use client';

/**
 * Admin-only backup controls. Each button calls a server action that ONLY
 * enqueues durable work or revokes local connection state — no button here
 * uploads to Drive. The worker picks the job up on its next scheduled run.
 */

import { Button, LinkButton, Notice } from '@/components/ui';
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
        <LinkButton href="/api/backup/drive/connect" size="sm" variant="secondary">
          {connected ? 'Reconnect Google Drive' : 'Connect Google Drive'}
        </LinkButton>
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
