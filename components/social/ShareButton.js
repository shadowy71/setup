'use client';

/**
 * Share / copy-link.
 *
 * Uses the device share sheet when the browser has one (phones), otherwise
 * copies the canonical URL. The toast reports what actually happened — a
 * cancelled share sheet stays silent rather than claiming a copy.
 *
 * `path` is always a relative Campus+ path supplied by the server page, so the
 * button can never be pointed at an off-site URL by stored data.
 */

import { useRef, useState } from 'react';
import { absoluteUrl } from '@/lib/canonical';
import { Button, Toast } from '@/components/ui';

export function ShareButton({
  path,
  label = 'Share',
  variant = 'ghost',
  size = 'sm',
  icon = 'link',
  className = '',
  title = 'Campus+',
}) {
  const [message, setMessage] = useState(null);
  const [tone, setTone] = useState('success');
  const timer = useRef(null);

  const announce = (text, nextTone = 'success') => {
    window.clearTimeout(timer.current);
    setTone(nextTone);
    setMessage(text);
    timer.current = window.setTimeout(() => setMessage(null), 2600);
  };

  const share = async () => {
    const url = absoluteUrl(path);
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      announce('Link copied to the clipboard');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      announce('Could not copy the link — copy it from the address bar', 'danger');
    }
  };

  return (
    <>
      <Button type="button" variant={variant} size={size} icon={icon} className={className} onClick={share} aria-label={`${label} this page`}>
        {label}
      </Button>
      <Toast tone={tone} icon={tone === 'success' ? 'checkCircle' : 'alert'}>
        {message}
      </Toast>
    </>
  );
}
