'use client';

import { useState } from 'react';
import { PostComposer } from '@/components/posts/PostComposer';
import { Notice } from '@/components/ui';

/** Keep the existing composer intact, opening it on demand. */
export function HomeComposer({ canPost = true, authorName, authorUsername, onCreated }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="home-composer">
      <p className="home-composer__label">New on campus <span aria-hidden="true">·</span> <span className="text-muted-soft">Posts, discussions and polls</span></p>
      {!canPost ? <Notice tone="neutral" icon="lock">Your account cannot publish posts right now.</Notice> : open ? (
        <PostComposer authorName={authorName} authorUsername={authorUsername} onCreated={onCreated} />
      ) : (
        <button type="button" className="home-composer__open" onClick={() => setOpen(true)}>
          What&apos;s happening on campus?
        </button>
      )}
    </div>
  );
}
