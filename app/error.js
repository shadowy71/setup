'use client';

import { useEffect } from 'react';
import RetroErrorPage from '@/components/feedback/RetroErrorPage';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('[campus+] render error', error?.digest || error?.message);
  }, [error]);

  return <RetroErrorPage runtime reset={reset} />;
}
