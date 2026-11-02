'use client';

import { useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { deleteComment } from '@/lib/actions/social';
import { Button, DeleteButton, KeycapButton } from '@/components/ui';
import { useLiveFeed } from '@/components/layout/LiveFeedProvider';

/** Delete your own comment (soft delete — moderation evidence is preserved). */
export function CommentActions({ commentId, postId }) {
  const feed = useLiveFeed();
  const { run, pending, error } = useFormAction(deleteComment, {
    onSuccess: () => feed.invalidate('engagement', [postId]),
  });
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <DeleteButton size="sm" aria-label="Delete comment" onClick={() => setConfirming(true)}>
        Delete
      </DeleteButton>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-2xs font-medium text-muted">Delete?</span>
      <KeycapButton
        tone="accent"
        disabled={pending}
        aria-label="Confirm delete comment"
        onClick={() => {
          const data = new FormData();
          data.set('id', commentId);
          data.set('post_id', postId);
          run(data);
        }}
      >
        {pending ? '…' : 'OK'}
      </KeycapButton>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        No
      </Button>
      {error ? <span className="text-2xs text-danger">{error}</span> : null}
    </span>
  );
}
