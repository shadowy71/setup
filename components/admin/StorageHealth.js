'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';

// This is a connectivity check, not an upload or a backup operation.
export function StorageHealth() {
  const [state, setState] = useState('idle');
  async function check() {
    setState('checking');
    try {
      const response = await fetch('/api/storage/health', { cache: 'no-store' });
      const result = await response.json();
      setState(response.ok && result.ok === true ? 'ok' : 'failed');
    } catch {
      setState('failed');
    }
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" size="sm" onClick={check} disabled={state === 'checking'}>
        {state === 'checking' ? 'Checking…' : 'Check upload storage connectivity'}
      </Button>
      <p role="status" className="text-sm text-muted">
        {state === 'ok' ? 'Gateway responded. This does not verify file operations or enable uploads.' :
          state === 'failed' ? 'Storage connectivity is unavailable or access was denied.' :
            'Checks the upload gateway only. Backups use a separate connection.'}
      </p>
    </div>
  );
}
