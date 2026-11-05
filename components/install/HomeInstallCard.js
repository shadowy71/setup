'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BrandMark } from '@/components/brand/Brand';
import { Button, Modal } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { ACCEPT_KEY, DISMISS_KEY, INSTALLED_KEY, INSTALL_EVENT, isIosSafari, isStandalone, offerMode, readPreference, writePreference } from '@/lib/install/home-install';
import styles from './HomeInstallCard.module.css';

// The script is mounted in the root layout; its state is shared with this Home
// card so an event received before hydration is not lost. No worker is registered.
function storage() {
  try { return window.localStorage; } catch { return null; }
}

export function HomeInstallCard() {
  const [mode, setMode] = useState(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const hiddenForView = useRef(false);
  const prompting = useRef(false);
  const updateRef = useRef(() => {});
  const closeGuide = useCallback(() => setGuideOpen(false), []);

  useEffect(() => {
    const update = () => {
      const capture = window.__campusHomeInstall;
      if (capture?.installed) writePreference(storage(), INSTALLED_KEY, '1');
      const installed = capture?.installed || readPreference(storage(), INSTALLED_KEY) === '1';
      setMode(hiddenForView.current ? null : offerMode({
        standalone: isStandalone(window, navigator), installed,
        dismissedAt: readPreference(storage(), DISMISS_KEY),
        acceptedAt: readPreference(storage(), ACCEPT_KEY),
        hasPrompt: Boolean(capture?.prompt?.prompt), iosSafari: isIosSafari(navigator),
      }));
    };
    updateRef.current = update;
    window.addEventListener(INSTALL_EVENT, update);
    window.addEventListener('storage', update);
    const displays = ['standalone', 'minimal-ui', 'fullscreen'].map((name) => window.matchMedia?.(`(display-mode: ${name})`)).filter(Boolean);
    displays.forEach((display) => display.addEventListener?.('change', update));
    update();
    return () => {
      window.removeEventListener(INSTALL_EVENT, update);
      window.removeEventListener('storage', update);
      displays.forEach((display) => display.removeEventListener?.('change', update));
      updateRef.current = () => {};
    };
  }, []);

  const dismiss = () => {
    hiddenForView.current = true;
    writePreference(storage(), DISMISS_KEY, Date.now());
    setMode(null);
    setGuideOpen(false);
  };

  const install = async () => {
    if (mode === 'ios') { setGuideOpen(true); return; }
    if (prompting.current) return;
    const capture = window.__campusHomeInstall;
    const prompt = capture?.prompt;
    if (!prompt?.prompt) { setMode(null); return; }
    prompting.current = true;
    capture.prompt = null; // The browser event is single-use, even on failure.
    setBusy(true);
    try {
      // Called directly in the click handler, before awaiting anything.
      const shown = prompt.prompt();
      const choice = await (prompt.userChoice || shown);
      if (choice?.outcome === 'accepted') {
        writePreference(storage(), ACCEPT_KEY, Date.now());
        hiddenForView.current = true;
      } else if (choice?.outcome === 'dismissed') {
        writePreference(storage(), DISMISS_KEY, Date.now());
        hiddenForView.current = true;
      }
    } catch {
      // A consumed or rejected prompt cannot be presented again.
    } finally {
      prompting.current = false;
      setBusy(false);
      updateRef.current();
    }
  };

  if (!mode) return null;
  return (
    <>
      <section className={styles.card} aria-labelledby="home-install-title">
        <BrandMark size="lg" />
        <div className={styles.content}>
          <h2 id="home-install-title" className={styles.title}>Make Campus+ yours.</h2>
          <p className={styles.description}>Add Campus+ to your home screen for quicker access to everything happening on campus.</p>
        </div>
        <div className={styles.actions}>
          <Button onClick={install} size="sm" tone="accent" disabled={busy}>Install Campus+</Button>
          <Button onClick={dismiss} size="sm" variant="ghost" disabled={busy}>Not now</Button>
        </div>
      </section>
      <Modal open={guideOpen} onClose={closeGuide} title="Add Campus+ to your Home Screen" description="In Safari on your iPhone or iPad:" size="sm" footer={<Button onClick={closeGuide} size="sm">Got it</Button>}>
        <ol className={styles.steps}>
          <li><Icon name="shareIos" size={16} /><span>Tap the <strong>Share</strong> button in Safari.</span></li>
          <li><Icon name="plus" size={16} /><span>Choose <strong>Add to Home Screen</strong> from the share menu. You may need to scroll.</span></li>
          <li><Icon name="check" size={16} /><span>Tap <strong>Add</strong> to finish.</span></li>
        </ol>
      </Modal>
    </>
  );
}

