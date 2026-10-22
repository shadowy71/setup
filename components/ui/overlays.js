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
 * A small anchored menu. Keyboard: Escape closes, outside pointer closes, the
 * trigger reports its expanded state.
 */
export function Dropdown({ label, trigger, children, align = 'right', className = '', menuClassName = '' }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      {typeof trigger === 'function' ? (
        trigger({ open, toggle: () => setOpen((value) => !value), close })
      ) : (
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu" aria-label={label} className="icon-btn">
          {trigger}
        </button>
      )}
      {open ? (
        <div
          role="menu"
          onClick={close}
          className={cn(
            'cp-menu absolute z-40 mt-2 min-w-52 overflow-hidden rounded-[var(--radius-lg)] py-1',
            align === 'right' ? 'right-0' : 'left-0',
            menuClassName,
          )}
        >
          {children}
        </div>
      ) : null}
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
