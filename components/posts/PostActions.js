'use client';

import { useCallback, useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { deletePost, restorePost } from '@/lib/actions/social';
import { useLiveFeed } from '@/components/layout/LiveFeedProvider';
import { Button, DeleteButton, KeycapButton, Notice } from '@/components/ui';

/**
 * Author controls for a post: soft delete (evidence-preserving) and restore.
 * A moderator's own controls live in the moderation panel, not here.
 *
 * Destructive intent gets the tactile delete material; the confirmation itself
 * is a deliberate keycap, never a second destructive-looking button.
 *
 * Both actions change what a feed must contain, so each one announces itself to the
 * shell's live feed after the server confirms it (`reason: 'removed'` here, because
 * a delete also releases the entry a Home stream may still be holding for the
 * author). The row is soft-deleted in the database — visible to nobody but the
 * author at its permalink — and the surfaces re-read that fact rather than being
 * told to hide it, so nothing here can leave a card on screen that the next render
 * would disagree with.
 */
export function PostActions({ postId, status = 'published', canManage = false }) {
  const feed = useLiveFeed();
  const [confirming, setConfirming] = useState(false);

  // `useFormAction` calls `onSuccess` only after the action reported a real
  // `{ ok: true }`, so reaching here already means the database moved the row.
  const announce = useCallback((reason) => feed.invalidate(reason, [postId]), [feed, postId]);
  const { run, pending, error } = useFormAction(deletePost, {
    onSuccess: () => announce('removed'),
  });
  const { run: runRestore, pending: restoring, error: restoreError } = useFormAction(restorePost, {
    onSuccess: () => announce('local'),
  });

  if (!canManage) return null;

  if (status === 'deleted') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" icon="refresh" disabled={restoring} onClick={() => runRestore(form(postId))}>
          Restore
        </Button>
        {restoreError ? <span className="text-2xs text-danger">{restoreError}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span className="text-2xs font-medium text-muted">Delete this post?</span>
          <KeycapButton
            tone="accent"
            disabled={pending}
            aria-label="Confirm delete"
            onClick={() => run(form(postId))}
          >
            {pending ? '…' : 'OK'}
          </KeycapButton>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <DeleteButton size="sm" onClick={() => setConfirming(true)}>
          Delete
        </DeleteButton>
      )}
      {error ? (
        <Notice tone="danger" className="w-full">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}

function form(id) {
  const data = new FormData();
  data.set('id', id);
  return data;
}
