'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { setFollowing } from '@/lib/actions/follows';
import { clearHomeFeedCache } from '@/components/home/homeFeedCache';

/** One toggle works on profile and post surfaces; failures roll back locally. */
export function FollowButton({ profileId, username, currentUserId, initialFollowing = false, unavailable = false, onChange = null }) {
  const [following, setCurrentFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const listener = (event) => { if (event.detail?.profileId === profileId) setCurrentFollowing(Boolean(event.detail.following)); };
    window.addEventListener('campus:follow-change', listener);
    return () => window.removeEventListener('campus:follow-change', listener);
  }, [profileId]);

  async function toggle() {
    if (pending || unavailable) return;
    const next = !following;
    setCurrentFollowing(next);
    setPending(true);
    setError('');
    try {
      const result = await setFollowing(profileId, next);
      if (!result?.ok) throw new Error(result?.error || 'Could not update this follow. Please try again.');
      clearHomeFeedCache(currentUserId);
      window.dispatchEvent(new CustomEvent('campus:follow-change', { detail: { profileId, following: next } }));
      onChange?.(next);
    } catch (err) {
      setCurrentFollowing(!next);
      setError(err?.message || 'Could not update this follow. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" variant="secondary" size="sm" disabled={pending || unavailable} onClick={toggle}
        aria-label={unavailable ? `Follow unavailable for @${username}` : `${following ? 'Unfollow' : 'Follow'} @${username}`}
        aria-pressed={following}>
        {unavailable ? 'Follow unavailable' : pending ? 'Updating…' : following ? 'Following' : 'Follow'}
      </Button>
      {error ? <span role="alert" className="text-2xs text-danger-strong">{error}</span> : null}
    </span>
  );
}
