'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/overlays';
import { ROUTES } from '@/lib/constants';
import {
  buildNavigationTourSteps,
  markNavigationTour,
  NAVIGATION_TOUR_EVENT,
  NAVIGATION_TOUR_KEY,
  navigationTourStorage,
  readNavigationTour,
  requestNavigationTour,
  shouldOfferNavigationTour,
} from '@/lib/guide/navigation-tour';

const noopSubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

function subscribe(onChange) {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event) => {
    if (!event || event.key === null || event.key === NAVIGATION_TOUR_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

const readSnapshot = () => readNavigationTour(navigationTourStorage());
const readServerSnapshot = () => 'dismissed';

/**
 * An optional first-visit offer and, only after Start, a five-step dialog.
 * Reopening is available through the account and mobile menus at any time.
 */
export function NavigationTour({ canModerate = false, canAdmin = false, canCreate = false, isStaff = false }) {
  const pathname = usePathname();
  const mounted = useMounted();
  const status = useSyncExternalStore(subscribe, readSnapshot, readServerSnapshot);
  const [offerHidden, setOfferHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const steps = useMemo(
    () => buildNavigationTourSteps({ canModerate, canAdmin, canCreate, isStaff }),
    [canModerate, canAdmin, canCreate, isStaff],
  );

  const start = useCallback(() => {
    setIndex(0);
    setOfferHidden(true);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onRequest = () => start();
    window.addEventListener(NAVIGATION_TOUR_EVENT, onRequest);
    return () => window.removeEventListener(NAVIGATION_TOUR_EVENT, onRequest);
  }, [start]);

  const dismiss = useCallback(() => {
    markNavigationTour(navigationTourStorage(), 'dismissed');
    setOfferHidden(true);
    setOpen(false);
  }, []);

  const finish = useCallback(() => {
    markNavigationTour(navigationTourStorage(), 'completed');
    setOfferHidden(true);
    setOpen(false);
  }, []);

  const current = steps[index] || steps[0];
  const offer = shouldOfferNavigationTour({ status, onHome: pathname === ROUTES.home, hidden: offerHidden || open });

  return (
    <>
      {mounted && offer
        ? createPortal(
            <aside className="navigation-tour-offer" aria-labelledby="navigation-tour-offer-title" data-storage={status === null ? 'unavailable' : 'local'}>
              <span className="navigation-tour-offer__icon" aria-hidden="true"><Icon name="mapPin" size={18} /></span>
              <div className="min-w-0 flex-1">
                <p id="navigation-tour-offer-title" className="text-sm font-semibold text-ink">A quick look around?</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">Five optional steps through navigation, search, clubs and your available tools.</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" className="btn btn-primary btn-sm" onClick={start}>Start quick tour</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>{status === null ? 'Dismiss for now' : 'Not now'}</button>
                </div>
              </div>
            </aside>,
            document.body,
          )
        : null}

      <Modal
        open={open}
        onClose={dismiss}
        title="Quick navigation tour"
        description={`Step ${index + 1} of ${steps.length} · optional`}
        closeLabel="Dismiss quick tour"
        size="sm"
        className="navigation-tour-dialog"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>Skip tour</button>
            <div className="flex items-center gap-2">
              {index > 0 ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIndex((value) => Math.max(0, value - 1))}>Back</button> : null}
              {index < steps.length - 1 ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setIndex((value) => Math.min(steps.length - 1, value + 1))}>Next</button>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" onClick={finish}>Finish</button>
              )}
            </div>
          </div>
        }
      >
        <div className="mt-4 flex gap-1.5" aria-hidden="true">
          {steps.map((step, stepIndex) => <span key={step.id} className={`navigation-tour-progress${stepIndex <= index ? ' is-active' : ''}`} />)}
        </div>
        <section className="navigation-tour-step" aria-labelledby="navigation-tour-step-title">
          <span className="navigation-tour-step__icon" aria-hidden="true"><Icon name={current.icon} size={22} /></span>
          <p className="sr-only" aria-live="polite">Step {index + 1}: {current.title}</p>
          <h3 id="navigation-tour-step-title" className="mt-4 text-lg font-semibold text-ink">{current.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">{current.body}</p>
        </section>
        <p className="mt-5 text-xs text-muted-soft">You can reopen this tour from the account menu or mobile menu.</p>
      </Modal>
    </>
  );
}

export { requestNavigationTour };
