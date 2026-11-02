'use client';

import { useRef, useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { createComment } from '@/lib/actions/social';
import { LIMITS } from '@/lib/constants';
import { Button, Notice, Textarea } from '@/components/ui';
import { GifPicker } from '@/components/media/GifPicker';
import { useLiveFeed } from '@/components/layout/LiveFeedProvider';

/**
 * Comment composer, used for both top-level comments and replies.
 * Same validation and same mention handling as posts — one code path.
 *
 * A published comment contributes to its post's recent engagement, so a
 * confirmed write announces one engagement change through the shell's existing
 * live-feed queue (batched, never a request per keystroke or per comment).
 */
export function CommentComposer({ postId, parentId = null, compact = false, label = 'Comment' }) {
  const [open, setOpen] = useState(!compact);
  const [gif, setGif] = useState(null);
  const [body, setBody] = useState('');
  const formRef = useRef(null);
  const feed = useLiveFeed();
  const { run, pending, error } = useFormAction(createComment, {
    onSuccess: () => {
      setBody('');
      setGif(null);
      formRef.current?.reset();
      if (compact) setOpen(false);
      feed.invalidate('engagement', [postId]);
    },
  });

  if (compact && !open) {
    return (
      <Button variant="ghost" size="sm" icon="comment" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  return (
    <form
      ref={formRef}
      action={run}
      className={compact ? 'comment-composer comment-composer--compact flex flex-col gap-2' : 'comment-composer card flex flex-col gap-2.5 p-3'}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        data.set('post_id', postId);
        if (parentId) data.set('parent_id', parentId);
        if (gif) data.set('gif', JSON.stringify(gif));
        run(data);
      }}
    >
      <Textarea
        name="body"
        rows={compact ? 2 : 3}
        maxLength={LIMITS.comment.max}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={parentId ? 'Write a reply. Use @username to mention someone.' : 'Add a comment. Use @username to mention someone.'}
        aria-label={parentId ? 'Reply' : 'Comment'}
        autoFocus={compact}
      />
      <div className="flex items-center justify-between gap-2">
        <GifPicker value={gif} onPick={setGif} onRemove={() => setGif(null)} label="GIF" />
        <div className="flex items-center gap-2">
          {compact ? (
            <Button variant="ghost" size="sm" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" size="sm" tone="accent" icon="send" disabled={pending || !body.trim()}>
            {pending ? 'Sending…' : parentId ? 'Reply' : 'Comment'}
          </Button>
        </div>
      </div>
      {error ? (
        <Notice tone="danger" icon="flag">
          {error}
        </Notice>
      ) : null}
    </form>
  );
}
