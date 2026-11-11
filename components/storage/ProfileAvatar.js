'use client';

import { useEffect, useState } from 'react';

/** Same-origin image with a text fallback; image access is checked by the API. */
export function ProfileAvatar({ username, initial, className, style }) {
  const [version, setVersion] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    function refresh(event) {
      if (event.detail === username) { setFailed(false); setVersion((value) => value + 1); }
    }
    window.addEventListener('campus-avatar-changed', refresh);
    return () => window.removeEventListener('campus-avatar-changed', refresh);
  }, [username]);
  return (
    <span aria-hidden="true" className={className} style={{ ...style, overflow: 'hidden', position: 'relative' }}>
      {initial}
      {!failed && username ? (
        // This is always a same-origin authenticated endpoint, not a Drive URL.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/storage/profile-photo/${encodeURIComponent(username)}?v=${version}`} alt="" onError={() => setFailed(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : null}
    </span>
  );
}
