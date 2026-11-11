'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { avatarRevision, subscribeAvatar } from '@/lib/media/avatar-revisions';

/** Same-origin image; access is revalidated by the API on every cache reuse. */
export function ProfileAvatar({ username, initial, className, style }) {
  const subscribe = useCallback((listener) => subscribeAvatar(username, listener), [username]);
  const snapshot = useCallback(() => avatarRevision(username), [username]);
  const revision = useSyncExternalStore(subscribe, snapshot, () => 0);
  const [failedRevision, setFailedRevision] = useState(null);
  const failureKey = `${username}:${revision}`;
  const failed = failedRevision === failureKey;
  const query = revision ? `?v=${revision}` : '';
  return (
    <span aria-hidden="true" className={className} style={{ ...style, overflow: 'hidden', position: 'relative' }}>
      {initial}
      {!failed && username ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/storage/profile-photo/${encodeURIComponent(username)}${query}`} alt="" onError={() => setFailedRevision(failureKey)}
          width={style?.width ? Number(style.width) || undefined : undefined} height={style?.height ? Number(style.height) || undefined : undefined} decoding="async" loading="lazy"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : null}
    </span>
  );
}
