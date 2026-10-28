'use client';

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/icons';
import { navigationHelpFor } from '@/lib/navigation/help';

const noopSubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * Contextual help beside an existing navigation link.
 *
 * The button is a sibling of the link, never its child. Fine-pointer hover and
 * keyboard focus open it; touch/click toggles it. The portalled non-modal
 * popover cannot be clipped by the glass sidebar, and Escape/outside pointer
 * dismissal works on every form factor.
 */
export function NavigationHelp({ topic, label }) {
  const content = navigationHelpFor(topic);
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const closeTimer = useRef(null);
  const suppressFocusOpen = useRef(false);
  const id = useId();

  const cancelScheduledClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
  }, []);

  const close = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    setOpen(false);
  }, []);

  const restoreTriggerFocus = useCallback(() => {
    // Escape and the close button return keyboard focus to the trigger. That
    // programmatic focus must not count as a new focus-open gesture, or the
    // popover immediately reopens and Escape appears to do nothing.
    suppressFocusOpen.current = true;
    triggerRef.current?.focus({ preventScroll: true });
    suppressFocusOpen.current = false;
  }, []);

  const scheduleClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      const active = document.activeElement;
      if (rootRef.current?.contains(active) || panelRef.current?.contains(active)) return;
      setOpen(false);
    }, 140);
  }, []);

  const openForHover = useCallback((event) => {
    if (event.pointerType !== 'mouse') return;
    if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  }, []);

  const place = useCallback(() => {
    const anchor = triggerRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const gap = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = panel.offsetWidth || Math.min(288, viewportWidth - margin * 2);
    const height = panel.offsetHeight || 120;
    const desiredLeft = rect.left + rect.width / 2 - width / 2;
    const left = Math.round(Math.min(Math.max(margin, desiredLeft), Math.max(margin, viewportWidth - width - margin)));
    const below = viewportHeight - rect.bottom - gap - margin;
    const above = rect.top - gap - margin;
    const flipUp = below < height && above > below;

    panel.style.left = `${left}px`;
    panel.style.top = flipUp ? '' : `${Math.round(rect.bottom + gap)}px`;
    panel.style.bottom = flipUp ? `${Math.round(viewportHeight - rect.top + gap)}px` : '';
    panel.style.maxHeight = `${Math.max(96, Math.floor(flipUp ? above : below))}px`;
    panel.style.visibility = 'visible';
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    place();
    let frame = 0;
    const reposition = (event) => {
      if (event?.target === panelRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      // This non-modal layer can sit above the mobile navigation sheet. Handle
      // Escape in the capture phase so only the topmost help layer dismisses;
      // the sheet's own document-level Escape listener must not also fire.
      event.stopImmediatePropagation();
      close();
      restoreTriggerFocus();
    };
    const onPointer = (event) => {
      if (rootRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, place, close, restoreTriggerFocus]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  if (!content) return null;

  return (
    <span
      ref={rootRef}
      className="nav-help"
      onPointerEnter={openForHover}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') scheduleClose();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="nav-help__trigger"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-describedby={open ? id : undefined}
        aria-haspopup="dialog"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          cancelScheduledClose();
          setOpen((value) => !value);
        }}
        onFocus={(event) => {
          cancelScheduledClose();
          if (suppressFocusOpen.current) return;
          // A pointer click focuses before it clicks. Opening on that focus and
          // then toggling in onClick would immediately close the popover again.
          // `:focus-visible` preserves keyboard/screen-reader focus help while
          // leaving pointer activation to the button's normal toggle.
          if (event.currentTarget.matches(':focus-visible')) setOpen(true);
        }}
        onBlur={scheduleClose}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
        }}
      >
        <Icon name="info" size={14} />
      </button>

      {mounted && open
        ? createPortal(
            <div
              ref={panelRef}
              id={id}
              role="dialog"
              aria-label={`${label} help`}
              className="nav-help__popover cp-menu fixed z-[90] overflow-y-auto p-3"
              style={{ visibility: 'hidden' }}
              onPointerEnter={(event) => {
                if (event.pointerType === 'mouse') cancelScheduledClose();
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === 'mouse') scheduleClose();
              }}
            >
              <div className="flex items-start gap-2.5">
                <span className="nav-help__icon" aria-hidden="true"><Icon name="info" size={15} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.8125rem] font-semibold text-ink">{label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{content}</p>
                </div>
                <button
                  type="button"
                  className="nav-help__close"
                  aria-label={`Close ${label} help`}
                  onClick={() => {
                    close();
                    restoreTriggerFocus();
                  }}
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
