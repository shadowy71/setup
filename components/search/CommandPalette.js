'use client';

/**
 * Campus Quick Actions — the command palette.
 *
 * Opens with ⌘K / Ctrl+K or the visible trigger button, and dispatches through
 * the same routes (and the same server-side authorization) as every other
 * navigation surface. The action list is built on the server from `can()` so
 * the browser never decides what is available — and every destination enforces
 * its own permissions regardless.
 *
 * The `/` search shortcut is untouched: this palette is a separate surface.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/overlays';
import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

export const COMMAND_PALETTE_EVENT = 'campus:command-palette:open';

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT));
}

/** Visible entry point for the palette (header button, menu row). */
export function CommandPaletteTrigger({ className = '', label = 'Quick actions', kbd = true, onOpen = null }) {
  return (
    <button
      type="button"
      onClick={() => {
        onOpen?.();
        openCommandPalette();
      }}
      className={cn('icon-btn gap-1.5', className)}
      aria-label={`${label} (Command K)`}
      title="Quick actions (⌘K)"
    >
      <Icon name="grid" size={19} />
      {kbd ? (
        <kbd className="hidden rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[0.625rem] font-semibold text-muted xl:inline" aria-hidden="true">
          ⌘K
        </kbd>
      ) : null}
    </button>
  );
}

function isTypingTarget(target) {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
  );
}

function matches(action, term) {
  const haystack = `${action.label} ${action.keywords || ''}`.toLowerCase();
  return term.split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

export function CommandPaletteHost({ actions = [] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, '');

  const close = useCallback(() => {
    setOpen(false);
    setTerm('');
    setActive(0);
  }, []);

  // ⌘K / Ctrl+K from anywhere except while typing. The `/` search shortcut
  // keeps working exactly as before — this listener only claims ⌘/Ctrl+K.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key.toLowerCase() !== 'k' || (!event.metaKey && !event.ctrlKey)) return;
      if (event.shiftKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setOpen((was) => !was);
    };
    const onCustom = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener(COMMAND_PALETTE_EVENT, onCustom);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener(COMMAND_PALETTE_EVENT, onCustom);
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const list = needle ? actions.filter((action) => matches(action, needle)) : actions;
    return list.slice(0, 30);
  }, [actions, term]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`#${baseId}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, baseId, open]);

  const run = useCallback(
    (action) => {
      if (!action) return;
      close();
      if (action.href === '/timetable' || action.href.startsWith('/timetable/')) {
        window.location.assign(action.href);
      } else {
        router.push(action.href);
      }
    },
    [close, router],
  );

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (filtered.length ? (index + 1) % filtered.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (filtered.length ? (index - 1 + filtered.length) % filtered.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(filtered[active]);
    } else if (event.key === 'Escape') {
      close();
    }
  };

  return (
    <Modal open={open} onClose={close} title="Quick actions" description="Jump anywhere, or start something new." size="md" className="command-palette">
      <div className="mt-3 flex flex-col gap-2" onKeyDown={onKeyDown}>
        <input
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${baseId}-list`}
          aria-activedescendant={filtered.length ? `${baseId}-option-${active}` : undefined}
          aria-label="Filter actions"
          placeholder="Type to filter…"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setActive(0);
          }}
          className="control control-input"
          autoComplete="off"
          enterKeyHint="go"
        />
        <div ref={listRef} role="listbox" id={`${baseId}-list`} aria-label="Actions" className="command-list">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-[0.8125rem] text-muted">
              No matching actions. Try “events”, “study” or “create”.
            </p>
          ) : (
            <ul className="flex flex-col">
              {filtered.map((action, index) => {
                const header = index === 0 || filtered[index - 1].section !== action.section ? action.section : null;
                return (
                  <li key={`${action.section}-${action.href}-${action.label}`}>
                    {header ? (
                      <p className="command-section" aria-hidden="true">{header}</p>
                    ) : null}
                    <button
                      type="button"
                      role="option"
                      id={`${baseId}-option-${index}`}
                      aria-selected={index === active}
                      data-active={index === active}
                      onClick={() => run(action)}
                      onMouseMove={() => setActive(index)}
                      className="command-option"
                    >
                      <Icon name={action.icon || 'chevronRight'} size={16} className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate text-left">{action.label}</span>
                      {action.hint ? <span className="shrink-0 text-2xs text-muted-soft">{action.hint}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="flex items-center gap-2 px-1 text-2xs text-muted-soft" aria-hidden="true">
          <span><kbd className="command-kbd">↑↓</kbd> to move</span>
          <span><kbd className="command-kbd">↵</kbd> to open</span>
          <span><kbd className="command-kbd">esc</kbd> to close</span>
        </p>
      </div>
    </Modal>
  );
}
