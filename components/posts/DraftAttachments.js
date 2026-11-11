/* eslint-disable @next/next/no-img-element */
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal } from '@/components/ui';

export function DraftAttachments({ items, setItems, disabled, postId, busy, children, submit }) {
  const [enabled, setEnabled] = useState(false); const [availability, setAvailability] = useState('checking'); const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const urls = useRef(new Set());
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/storage/post-upload-availability', { signal: controller.signal, cache: 'no-store' })
      .then((response) => response.json()).then((data) => { setEnabled(data?.enabled === true); setAvailability(data?.reason || (data?.enabled ? 'enabled' : 'unavailable')); })
      .catch(() => { if (!controller.signal.aborted) setAvailability('unavailable'); });
    return () => controller.abort();
  }, []);
  useEffect(() => { const active = new Set(items.map((item) => item.preview).filter(Boolean)); for (const url of urls.current) if (!active.has(url)) { URL.revokeObjectURL(url); urls.current.delete(url); } for (const url of active) urls.current.add(url); }, [items]);
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); }, []);
  function remove(item) { if (item.preview) { URL.revokeObjectURL(item.preview); urls.current.delete(item.preview); } setItems((old) => old.filter((entry) => entry.id !== item.id)); }
  function choose(event) {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (items.length + files.length > 8) { setError('Choose at most eight files.'); return; }
    if (files.some((file) => !['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type) || file.size < 1 || file.size > 3 * 1024 * 1024)) { setError('Choose JPEG, PNG, WebP or PDF files up to 3 MiB each.'); return; }
    const next = files.map((file) => { const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null; if (preview) urls.current.add(preview); return { file, preview, id: crypto.randomUUID(), progress: 0 }; });
    setItems((old) => [...old, ...next]); setError(''); setOpen(false);
  }
  function move(index, delta) { setItems((old) => { const next = [...old]; const target = index + delta; if (target < 0 || target >= next.length) return old; [next[index],next[target]] = [next[target],next[index]]; return next; }); }
  const messages = { checking: 'Checking attachment availability…', disabled: 'Attachments are disabled on this deployment.', permission: 'Attachments require upload permission from an administrator.', sign_in: 'Sign in to attach files.', unavailable: 'Attachment availability could not be checked. Try again later.' };
  return <>
    {items.length ? <div className="mt-3 text-xs">{items.map((item, index) => <div key={item.id} className="mt-2 flex flex-wrap items-center gap-2">
      {item.preview ? <img src={item.preview} alt="" className="max-h-14 max-w-20 rounded object-contain" /> : null}
      <span className="max-w-40 truncate">{item.file.name} · {(item.file.size / 1024).toFixed(0)} KiB</span>
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
    <Modal open={open} onClose={close} title="Add files" description="Images or PDFs, up to eight (3 MiB each)." size="sm">
      {enabled ? <label className="mt-4 block text-sm text-muted">Choose JPEG, PNG, WebP or PDF files
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={choose} disabled={disabled || busy} className="mt-2 block max-w-full text-xs" />
      </label> : <p role="status" className="mt-4 text-sm text-muted">{messages[availability] || messages.unavailable}</p>}
      {error ? <p role="alert" className="mt-2 text-xs text-danger">{error}</p> : null}
    </Modal>
  </>;
}
