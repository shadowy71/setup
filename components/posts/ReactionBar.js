'use client';

import { useCallback, useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { toggleReaction } from '@/lib/actions/social';
import { cn, compactNumber } from '@/lib/utils';
import { Icon } from '@/components/ui/icons';
import { useLiveFeed } from '@/components/layout/LiveFeedProvider';

/**
 * One reaction control. Optimistic count, then the database's trigger
 * recomputes the stored counter — the number shown is never client-invented.
 *
 * A confirmed post like/unlike is also an engagement change: the shell's live
 * feed is invalidated once (its queue batches bursts) so Home re-reads the
 * server-ranked rail. Comments and projects do not move a post's trending
 * score, so they deliberately do not announce anything.
 */
export function ReactionBar({ targetType, targetId, count = 0, reactedByMe = false, canReact = true, className = '' }) {
  const [state, setState] = useState({ count, reacted: reactedByMe });
  const feed = useLiveFeed();
  const announce = useCallback(
    () => { if (targetType === 'post') feed.invalidate('engagement', [targetId]); },
    [feed, targetType, targetId],
  );
  const { run, pending } = useFormAction(toggleReaction, { onSuccess: announce });

  return (
    <button
      type="button"
      disabled={!canReact || pending}
      aria-pressed={state.reacted}
      aria-label={state.reacted ? 'Remove reaction' : 'React to this'}
      className={cn('chip chip-toggle reaction-control', !canReact ? 'cursor-default' : null, className)}
      onClick={() => {
        const next = { count: state.count + (state.reacted ? -1 : 1), reacted: !state.reacted };
        setState(next);
        const data = new FormData();
        data.set('target_type', targetType);
        data.set('target_id', targetId);
        run(data);
      }}
    >
      <Icon name="heart" size={13} className="reaction-icon" />
      {state.count > 0 ? compactNumber(state.count) : 'Like'}
    </button>
  );
}
