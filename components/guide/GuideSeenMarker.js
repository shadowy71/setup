'use client';

import { useEffect } from 'react';
import { deviceStorage, markGuideSeen } from '@/lib/guide/first-visit';

/**
 * Records that this device has seen the guide, and renders nothing.
 *
 * Opening `/guide` *is* the signal that the first-visit offer worked, so the
 * page marks itself read rather than asking the student to press a button to
 * stop a nag. The write is device-local and best-effort: `markGuideSeen` returns
 * false when storage is unavailable, and nothing here surfaces that as an error,
 * because there is nothing the reader can do about it.
 */
export function GuideSeenMarker() {
  useEffect(() => {
    markGuideSeen(deviceStorage());
  }, []);

  return null;
}
