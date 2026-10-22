'use client';

/**
 * Overlays: dialogs, mobile sheets, dropdown menus and toasts.
 *
 * They render through a portal on `document.body` because several of their
 * triggers live inside glass surfaces (a `backdrop-filter` ancestor would
 * otherwise become the containing block for `position: fixed`).
 *
 * Accessibility: Escape closes, the backdrop closes, focus moves into the
 * surface on open and returns to the trigger on close, and the page behind is
 * scroll-locked. On phones the same dialog becomes a bottom sheet.
 */

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icons';

/** Portal targets only exist on the client — no state, no cascading render. */
const noopSubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function Modal({
  open,
  onClose,
  title,
  description = null,
  children = null,
  footer = null,
  size = 'md',
  closeLabel = 'Close',
  className = '',
}) {
  const mounted = useMounted();
  const ref = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const timer = window.setTimeout(() => {
      const focusable = ref.current?.querySelector('input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])');
      (focusable || ref.current)?.focus?.();
    }, 20);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' };

  return createPortal(
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="dialog-centred" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={cn('dialog', widths[size] || widths.md, className)}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {title ? (
                <h2 id={titleId} className="dialog-title">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p id={descriptionId} className="dialog-body">
                  {description}
                </p>
              ) : null}
            </div>
            <button type="button" onClick={onClose} className="icon-btn -mr-1 -mt-1 shrink-0" aria-label={closeLabel}>
              <Icon name="close" size={16} />
            </button>
          </div>
          {children}
          {footer ? <div className="dialog-actions">{footer}</div> : null}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** Alias used where the surface is conceptually a sheet (mobile-first flows). */
export function Sheet(props) {
  return <Modal {...props} />;
}

/**
 * A small anchored menu, rendered through the same body portal as the dialogs
 * above — and for the same reason, only sharper. An anchored (absolutely
 * positioned) menu inherits its trigger's stacking context and scroll
 * container: inside the desktop sidebar every direct child is its own
 * `z-index: 1` stacking context (see `.side-panel > *` in navigation.css),
 * so the Create menu painted *behind* the nav rows that follow it in the
 * DOM — its own `z-index` could never escape — and the panel's
 * `overflow: hidden auto` clipped and scrolled it. The menu looked
 * transparent because the content behind it was, in fact, in front of it.
 *
 * Portalling to `document.body` with trigger-anchored fixed coordinates
 * removes both failure modes at once: no ancestor stacking context, no
 * clipping scrollport, no nested backdrop-filter. Position is recomputed on
 * resize and on any scroll (capture phase, so the sidebar's own scrolling
 * counts), clamped to the viewport, flipped above the trigger when the
 * space below runs out, and height-capped with internal scrolling.
 *
 * Keyboard: Escape closes and returns focus to the trigger; ArrowDown /
 * ArrowUp on the trigger open the menu onto its first / last item; arrows,
 * Home and End move between items; Tab closes. Opening with the pointer
 * never steals focus. Outside pointer closes, as before, and the trigger
 * reports its expanded state.
 */
export function Dropdown({ label, trigger, children, align = 'right', className = '', menuClassName = '', matchTriggerWidth = false }) {
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  /* 'first' | 'last' when the pending open came from the keyboard, so focus
     lands in the menu; null for pointer opens, which never steal focus. */
  const [pendingFocus, setPendingFocus] = useState(null);
  const containerRef = useRef(null);
  const menuRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  const focusTrigger = useCallback(() => {
    containerRef.current?.querySelector('button')?.focus();
  }, []);

  /* Placement is imperative DOM sync, not state: the menu is measured and
     positioned in place, so scrolling never triggers a render and the panel
     is never painted at stale coordinates between state updates. */
  const place = useCallback(() => {
    const anchor = containerRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const rect = anchor.getBoundingClientRect();
    const gap = 8;
    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuWidth = matchTriggerWidth ? rect.width : menu.offsetWidth || 208;

    const desiredLeft = align === 'left' ? rect.left : rect.right - menuWidth;
    const left = Math.round(Math.min(Math.max(desiredLeft, margin), Math.max(margin, viewportWidth - menuWidth - margin)));

    const spaceBelow = viewportHeight - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    const flipUp = spaceBelow < 176 && spaceAbove > spaceBelow;

    menu.style.width = matchTriggerWidth ? `${Math.round(rect.width)}px` : '';
    menu.style.left = `${left}px`;
    menu.style.top = flipUp ? '' : `${Math.round(rect.bottom + gap)}px`;
    menu.style.bottom = flipUp ? `${Math.round(viewportHeight - rect.top + gap)}px` : '';
    menu.style.maxHeight = `${Math.max(120, Math.floor(flipUp ? spaceAbove : spaceBelow))}px`;
    menu.style.visibility = 'visible';
  }, [align, matchTriggerWidth]);

  /* First placement runs with the menu mounted but hidden, so its real width
     can be measured before anything paints in the wrong place. */
  useEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    let frame = 0;
    const reposition = (event) => {
      /* The menu's own internal scrolling must not re-anchor it. */
      if (event && event.target === menuRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        focusTrigger();
      }
    };
    const onPointer = (event) => {
      if (containerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, place, focusTrigger]);

  const menuItems = useCallback(
    () => [...(menuRef.current?.querySelectorAll('[role="menuitem"]:not(:disabled):not([aria-disabled="true"])') || [])],
    [],
  );

  /* Land keyboard focus in the menu once it is open. */
  useEffect(() => {
    if (!open || !pendingFocus) return;
    const items = menuItems();
    const target = pendingFocus === 'last' ? items[items.length - 1] : items[0];
    target?.focus();
  }, [open, pendingFocus, menuItems]);

  const toggle = useCallback((event) => {
    /* A click with `detail: 0` was synthesised by keyboard activation
       (Enter/Space on the trigger) — a real pointer press reports >= 1. */
    setPendingFocus(event && typeof event.detail === 'number' && event.detail === 0 ? 'first' : null);
    setOpen((value) => !value);
  }, []);

  const onTriggerKeyDown = (event) => {
    if (open || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    if (!(event.target instanceof HTMLElement) || !event.target.closest('button')) return;
    event.preventDefault();
    setPendingFocus(event.key === 'ArrowUp' ? 'last' : 'first');
    setOpen(true);
  };

  const onMenuKeyDown = (event) => {
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = menuItems();
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    const next =
      event.key === 'Home'
        ? items[0]
        : event.key === 'End'
          ? items[items.length - 1]
          : event.key === 'ArrowDown'
            ? items[(current + 1 + items.length) % items.length]
            : items[(current - 1 + items.length) % items.length];
    next?.focus();
  };

  return (
    <div className={cn('relative', className)} ref={containerRef} onKeyDown={onTriggerKeyDown}>
      {typeof trigger === 'function' ? (
        trigger({ open, toggle, close })
      ) : (
        <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu" aria-label={label} className="icon-btn">
          {trigger}
        </button>
      )}
      {mounted && open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={label}
              onClick={close}
              onKeyDown={onMenuKeyDown}
              className={cn('cp-menu fixed z-[80] min-w-52 overflow-y-auto rounded-[var(--radius-lg)] py-1', menuClassName)}
              style={{ visibility: 'hidden' }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function MenuItem({ icon = null, children, className = '', ...props }) {
  return (
    <button type="button" role="menuitem" className={cn('cp-menu-item flex w-full items-center gap-2.5 px-3 py-2 text-left text-[0.8125rem]', className)} {...props}>
      {icon ? <Icon name={icon} size={16} className="cp-menu-item__icon" /> : null}
      {children}
    </button>
  );
}

export function MenuLink({ href, icon = null, children, className = '', ...props }) {
  return (
    <Link
      href={href}
      role="menuitem"
      className={cn('cp-menu-item flex w-full items-center gap-2.5 px-3 py-2 text-[0.8125rem] hover:no-underline', className)}
      {...props}
    >
      {icon ? <Icon name={icon} size={16} className="cp-menu-item__icon" /> : null}
      {children}
    </Link>
  );
}

/** Fixed toast pill, used for confirmations that should not move the layout. */
export function Toast({ tone = 'neutral', icon = null, children, className = '' }) {
  const mounted = useMounted();
  if (!mounted || !children) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[70] flex justify-center px-4 lg:bottom-6">
      <div role="status" className={cn('toast', tone === 'success' ? 'toast-success' : null, tone === 'danger' ? 'toast-danger' : null, className)}>
        {icon ? <Icon name={icon} size={15} /> : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}
