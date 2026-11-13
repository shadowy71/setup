/* eslint-disable @next/next/no-img-element */
'use client';

/** The post composer's attachment popup. Other forms retain their existing picker. */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, Modal } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

export const ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
export const ATTACHMENT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ATTACHMENT_FILE_TYPES = [...ATTACHMENT_IMAGE_TYPES, 'application/pdf'];

const acceptedTypes = (imagesOnly) => (imagesOnly ? ATTACHMENT_IMAGE_TYPES : ATTACHMENT_FILE_TYPES);
const noun = (imagesOnly) => (imagesOnly ? 'photo' : 'file');

/**
 * Sort a drop or picker selection into what can be added and what cannot.
 * Pure, so the dropzone, the picker and the tests share one rule set: the
 * supported formats, the 3 MB ceiling and the remaining slots, in that order.
 */
export function validateAttachmentSelection(files, { imagesOnly = false, remaining = 8 } = {}) {
  const types = acceptedTypes(imagesOnly);
  const accepted = [];
  const rejected = [];
  for (const file of Array.from(files || [])) {
    if (!types.includes(file.type)) rejected.push({ name: file.name, reason: 'type' });
    else if (!file.size) rejected.push({ name: file.name, reason: 'empty' });
    else if (file.size > ATTACHMENT_MAX_BYTES) rejected.push({ name: file.name, reason: 'size' });
    else if (accepted.length >= remaining) rejected.push({ name: file.name, reason: 'limit' });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

/**
 * Name the refused files and why. A valid subset is still added, so the
 * message explains the remainder instead of discarding the whole selection.
 */
export function attachmentRejectionMessage(rejected, { imagesOnly = false, maxItems = 8, remaining = maxItems } = {}) {
  if (!rejected.length) return '';
  const label = noun(imagesOnly);
  const notes = new Set();
  for (const { name, reason } of rejected) {
    if (reason === 'type') {
      notes.add(
        imagesOnly
          ? `${name} is not a JPEG, PNG or WebP image.`
          : `${name} is not an image or PDF.`,
      );
    } else if (reason === 'empty') {
      notes.add(`${name} is empty. Choose a file with image data.`);
    } else if (reason === 'size') {
      notes.add(`${name} is larger than 3 MB.`);
    } else if (reason === 'limit') {
      notes.add(
        remaining > 0
          ? `Only ${remaining} more ${label}${remaining === 1 ? '' : 's'} could be added.`
          : `Up to ${maxItems} ${label}s can be added. Remove one to add another.`,
      );
    }
  }
  return [...notes].slice(0, 3).join(' ');
}

/**
 * The dropzone. It is a `<label>` around a visually hidden file input, so the
 * whole surface is one click target and one tab stop, the keyboard keeps the
 * native picker, and a drag from the desktop lands on the same handler.
 */
export function AttachmentDropzone({
  imagesOnly = false,
  maxItems = 8,
  remaining = maxItems,
  disabled = false,
  compact = false,
  focusOnOpen = false,
  onFiles,
  className = '',
}) {
  const inputId = useId();
  const inputRef = useRef(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const types = acceptedTypes(imagesOnly);
  const full = remaining <= 0;
  const label = noun(imagesOnly);

  /* The dialog's own autofocus lands on its close control; this puts the
     keyboard where the work is. The input is the dropzone's single tab stop,
     so its focus ring is drawn around the whole surface. */
  useEffect(() => {
    if (!focusOnOpen) return undefined;
    const timer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 40);
    return () => window.clearTimeout(timer);
  }, [focusOnOpen]);

  function takeFiles(list) {
    if (disabled || full) return;
    const files = Array.from(list || []);
    if (files.length) onFiles?.(files);
  }

  const drag = {
    onDragEnter(event) {
      event.preventDefault();
      if (disabled || full) return;
      depth.current += 1;
      setDragging(true);
    },
    onDragOver(event) {
      event.preventDefault();
      if (disabled || full) return;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave() {
      if (disabled || full) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop(event) {
      event.preventDefault();
      if (disabled || full) return;
      depth.current = 0;
      setDragging(false);
      takeFiles(event.dataTransfer?.files);
    },
  };

  if (full) {
    return (
      <p className="attach-limit" role="status" onDragOver={(event) => event.preventDefault()} onDrop={(event) => event.preventDefault()}>
        <Icon name="checkCircle" size={14} />
        <span>{`${maxItems} ${label}s added. Remove one to add another.`}</span>
      </p>
    );
  }

  return (
    <label
      htmlFor={inputId}
      className={cn('attach-drop', compact ? 'attach-drop--compact' : null, disabled ? 'is-disabled' : null, className)}
      data-dragging={dragging ? 'true' : undefined}
      {...drag}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={types.join(',')}
        disabled={disabled}
        onChange={(event) => {
          /* Read the list before touching the input: clearing its value is what
             lets the same file be chosen twice, but the FileList is live. */
          const files = Array.from(event.target.files || []);
          event.target.value = '';
          takeFiles(files);
        }}
        aria-label={imagesOnly ? 'Choose photos from your device' : 'Choose images or PDFs from your device'}
        aria-describedby={compact ? undefined : hintId}
        className="sr-only"
      />
      {compact ? (
        <>
          <span className="attach-drop__compact-icon" aria-hidden="true">
            <Icon name="plus" size={14} />
          </span>
          <span className="attach-drop__compact-title">{`Add more ${label}s`}</span>
          <span className="attach-drop__compact-hint">or drag and drop here</span>
        </>
      ) : (
        <>
          <span className="attach-drop__badge" aria-hidden="true">
            <Icon name="image" size={20} />
          </span>
          <span className="attach-drop__title">Drag and drop your photos here</span>
          <span className="attach-drop__sub">Share your moments with your campus community.</span>
          <span className="attach-drop__cta">Choose from device</span>
          <span id={hintId} className="attach-drop__hint">
            {imagesOnly
              ? `JPEG, PNG or WebP · Maximum 3 MB per image · Up to ${maxItems} images.`
              : `JPEG, PNG, WebP or PDF · Maximum 3 MB per file · Up to ${maxItems} files.`}
          </span>
        </>
      )}
    </label>
  );
}

/**
 * The chosen media, as a proportional preview grid. Images keep their own
 * aspect ratio inside a well (nothing is cropped to fill a tile); `data-count`
 * lets a single selection take the full width instead of a lonely small tile.
 * Ordering controls stay available here because the first image is the cover.
 */
export function AttachmentPreview({
  items,
  imagesOnly = false,
  maxItems = 8,
  disabled = false,
  busy = false,
  postId = null,
  onRemove,
  onMove,
}) {
  if (!items.length) return null;
  const label = noun(imagesOnly);
  /* The cover is the first *image*: scopes that accept images can claim it, a
     PDF-only selection has no cover to move, and a published post is fixed. */
  const coverable = imagesOnly && !postId && Boolean(onMove);

  return (
    <div className="attach-preview">
      <p className="attach-count" role="status">
        <span>
          <strong>{items.length}</strong>
          {` of ${maxItems} ${label}s selected`}
        </span>
      </p>
      <ul className="attach-grid" data-count={items.length}>
        {items.map((item, index) => (
          <li key={item.id} className="attach-tile">
            <span className="attach-tile__frame">
              {item.preview ? (
                <img src={item.preview} alt={item.file.name} loading="lazy" decoding="async" className="attach-tile__img" />
              ) : (
                <span className="attach-tile__doc">
                  <Icon name="file" size={18} />
                  <span className="attach-tile__doc-name">{item.file.name}</span>
                </span>
              )}
              {coverable && index === 0 ? <span className="attach-tile__cover">Cover</span> : null}
              {coverable && index > 0 ? (
                <button
                  type="button"
                  className="attach-tile__cover-set"
                  aria-label={`Make ${item.file.name} the cover photo`}
                  disabled={disabled || busy}
                  onClick={() => onMove?.(index)}
                >
                  Make cover
                </button>
              ) : null}
              {!postId && onRemove ? (
                <span className="attach-tile__actions">
                  <button
                    type="button"
                    className="attach-tile__action attach-tile__action--remove"
                    aria-label={`Remove ${item.file.name}`}
                    title="Remove"
                    disabled={disabled || busy}
                    onClick={() => onRemove(item)}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ) : null}
              {item.progress ? (
                <span className="attach-tile__progress" aria-hidden="true">
                  <span style={{ '--attach-progress': `${Math.min(100, Math.max(0, item.progress))}%` }} />
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DraftAttachments({ items, setItems, disabled, postId, busy, children, submit, scope = 'post', imagesOnly = false, maxItems = 8 }) {
  const [enabled, setEnabled] = useState(false); const [availability, setAvailability] = useState('checking'); const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const urls = useRef(new Set());
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/storage/post-upload-availability${['space', 'event', 'notice', 'achievement', 'gig', 'ride', 'team', 'project', 'marketplace', 'lost_found', 'housing'].includes(scope) ? `?scope=${scope}` : ''}`, { signal: controller.signal, cache: 'no-store' })
      .then((response) => response.json()).then((data) => { setEnabled(data?.enabled === true); setAvailability(data?.reason || (data?.enabled ? 'enabled' : 'unavailable')); })
      .catch(() => { if (!controller.signal.aborted) setAvailability('unavailable'); });
    return () => controller.abort();
  }, [scope]);
  useEffect(() => { const active = new Set(items.map((item) => item.preview).filter(Boolean)); for (const url of urls.current) if (!active.has(url)) { URL.revokeObjectURL(url); urls.current.delete(url); } for (const url of active) urls.current.add(url); }, [items]);
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); }, []);
  function choose(event) {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (items.length + files.length > maxItems) { setError(`Choose at most ${maxItems} files for the remaining slots.`); return; }
    const types = imagesOnly ? ['image/jpeg','image/png','image/webp'] : ['image/jpeg','image/png','image/webp','application/pdf'];
    if (files.some((file) => !types.includes(file.type) || file.size < 1 || file.size > 3 * 1024 * 1024)) { setError(imagesOnly ? 'Choose JPEG, PNG or WebP images up to 3 MiB each.' : 'Choose JPEG, PNG, WebP or PDF files up to 3 MiB each.'); return; }
    const next = files.map((file) => { const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null; if (preview) urls.current.add(preview); return { file, preview, id: crypto.randomUUID(), progress: 0 }; });
    setItems((old) => [...old, ...next]); setError(''); setOpen(false);
  }
  function remove(item) { if (item.preview) { URL.revokeObjectURL(item.preview); urls.current.delete(item.preview); } setItems((old) => old.filter((entry) => entry.id !== item.id)); }
  function move(index, delta) { setItems((old) => { const next = [...old]; const target = index + delta; if (target < 0 || target >= next.length) return old; [next[index], next[target]] = [next[target], next[index]]; return next; }); }
  function addFiles(files) {
    const remaining = Math.max(0, maxItems - items.length);
    const { accepted, rejected } = validateAttachmentSelection(files, { imagesOnly, remaining });
    if (accepted.length) {
      const next = accepted.map((file) => { const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null; if (preview) urls.current.add(preview); return { file, preview, id: crypto.randomUUID(), progress: 0 }; });
      setItems((old) => [...old, ...next]);
    }
    setError(rejected.length ? attachmentRejectionMessage(rejected, { imagesOnly, maxItems, remaining }) : '');
  }
  const messages = { checking: 'Checking attachment availability…', disabled: 'Attachments are disabled on this deployment.', permission: 'Attachments require upload permission from an administrator.', sign_in: 'Sign in to attach files.', unavailable: 'Attachment availability could not be checked. Try again later.' };
  const label = noun(imagesOnly);
  const photoPopup = scope === 'post';
  return <>
    {items.length ? <div className="mt-3 text-xs">{items.map((item, index) => <div key={item.id} className="mt-2 flex flex-wrap items-center gap-2">
      {item.preview ? <img src={item.preview} alt="" className="max-h-14 max-w-20 rounded object-contain" /> : null}
      <span className="max-w-40 truncate">{item.file.name} · {(item.file.size / 1024).toFixed(0)} KiB</span>
      {imagesOnly && index === 0 ? <span>Cover</span> : null}
      {imagesOnly && index > 0 && !postId ? <button type="button" disabled={disabled || busy} className="underline" onClick={() => setItems((old) => { const next = [...old]; const [cover] = next.splice(index, 1); return [cover, ...next]; })}>Make cover</button> : null}
      {item.progress ? <span>{item.progress}%</span> : null}
      {!postId ? <><button type="button" disabled={disabled || busy || index === 0} onClick={() => move(index,-1)} className="underline">Earlier</button><button type="button" disabled={disabled || busy || index === items.length - 1} onClick={() => move(index,1)} className="underline">Later</button></> : null}
      {!postId ? <button type="button" disabled={disabled || busy} onClick={() => remove(item)} className="underline">Remove</button> : null}
    </div>)}</div> : null}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <Button type="button" variant="ghost" size="sm" icon="paperclip" aria-expanded={open} onClick={() => { setError(''); setOpen(true); }} disabled={disabled || busy || Boolean(postId)}>Add files</Button>
      </div>
      {submit}
    </div>
    {photoPopup ? <Modal
      open={open}
      onClose={close}
      title={imagesOnly ? 'Add photos' : 'Add files'}
      description={imagesOnly ? 'The first photo becomes the cover.' : 'Photos and documents for your post.'}
      className="dialog-attachment"
      footer={<>
        <Button type="button" variant="ghost" className="attach-cancel" onClick={close}>Cancel</Button>
        {enabled ? <Button type="button" icon="check" onClick={close} disabled={!items.length || disabled || busy || Boolean(postId)}>Continue</Button> : null}
      </>}
    >
      <div className="attach-body">
        {enabled ? <>
          {items.length ? <AttachmentPreview items={items} imagesOnly={imagesOnly} maxItems={maxItems} disabled={disabled} busy={busy} postId={postId} onRemove={remove} onMove={(index) => setItems((old) => { const next = [...old]; const [cover] = next.splice(index, 1); return [cover, ...next]; })} /> : null}
          <AttachmentDropzone
            compact={items.length > 0}
            focusOnOpen
            imagesOnly={imagesOnly}
            maxItems={maxItems}
            remaining={maxItems - items.length}
            disabled={disabled || busy}
            onFiles={addFiles}
          />
          {error ? <p className="attach-error" role="alert"><Icon name="alert" size={14} /><span>{error}</span></p> : null}
          {items.length ? <p className="attach-note">{`On submit, these ${label}s are uploaded from this browser and kept here until published or discarded.`}</p> : null}
        </> : <p role="status" className="attach-status"><Icon name="lock" size={15} /><span>{messages[availability] || messages.unavailable}</span></p>}
      </div>
    </Modal> : <Modal open={open} onClose={close} title="Add files" description={imagesOnly ? 'Images, up to eight (3 MiB each).' : 'Images or PDFs, up to eight (3 MiB each).'} size="sm">
      {enabled ? <label className="mt-4 block text-sm text-muted">{imagesOnly ? 'Choose JPEG, PNG or WebP images' : 'Choose JPEG, PNG, WebP or PDF files'}
        <input type="file" multiple accept={imagesOnly ? 'image/jpeg,image/png,image/webp' : 'image/jpeg,image/png,image/webp,application/pdf'} onChange={choose} disabled={disabled || busy} className="mt-2 block max-w-full text-xs" />
      </label> : <p role="status" className="mt-4 text-sm text-muted">{messages[availability] || messages.unavailable}</p>}
      {error ? <p role="alert" className="mt-2 text-xs text-danger">{error}</p> : null}
    </Modal>}
  </>;
}
