'use client';

import { useEffect, useState } from 'react';

export default function Countdown({ startsAt }) {
  const [now, setNow] = useState(null);
  useEffect(() => {
    let timer;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= startsAt && timer) window.clearInterval(timer);
    };
    tick();
    if (Date.now() < startsAt) timer = window.setInterval(tick, 60000);
    return () => window.clearInterval(timer);
  }, [startsAt]);
  if (now === null || startsAt <= now) return null;
  const minutes = Math.ceil((startsAt - now) / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return <p className="text-2xs font-semibold text-accent">Starts in {days ? `${days}d ` : ''}{hours ? `${hours}h ` : ''}{minutes % 60}m</p>;
}
