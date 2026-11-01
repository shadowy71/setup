'use client';

import { useEffect, useState } from 'react';

/**
 * The greeting's drawn hand. The button makes the requested click interaction
 * keyboard-operable too; only the small artwork remounts, so the same CSS
 * gesture plays once on arrival and again on demand without timers or a loop.
 */
export function HandWave() {
  const [wave, setWave] = useState(0);

  useEffect(() => {
    // On a true first visit the restored landing intro can outlast the initial
    // CSS gesture. Replay once at its existing completion/skip point so the
    // arrival wave is visible; ordinary mounts still need only their CSS rule.
    const replay = () => setWave((value) => value + 1);
    window.addEventListener('campus:home-intro-complete', replay);
    return () => window.removeEventListener('campus:home-intro-complete', replay);
  }, []);

  return (
    <button
      type="button"
      className="home-pulse__wave"
      aria-label="Wave hello"
      onClick={() => setWave((value) => value + 1)}
    >
      <span className="home-pulse__wave-art" key={wave} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" focusable="false">
          <path
            d="M7.2 11.3V5.4a1.6 1.6 0 0 1 3.2 0v5.1m0-.6V3.8a1.6 1.6 0 0 1 3.2 0v6.4m0-.5V4.9a1.6 1.6 0 0 1 3.2 0v6.2m0-.3V7.4a1.5 1.5 0 0 1 3 0v7.1c0 3.9-2.6 6.6-6.5 6.6-3.1 0-5-1.5-6.4-4.3l-2.5-5a1.6 1.6 0 0 1 2.8-1.5l1.9 3.2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}
