/* eslint-disable @next/next/no-img-element */
'use client';
import { useEffect, useRef, useState } from 'react';

export function DraftAttachments({ items, setItems, disabled, postId, busy }) {
  const [enabled, setEnabled] = useState(false); const [error, setError] = useState('');
  const urls = useRef(new Set());
  useEffect(() => { const controller = new AbortController(); fetch('/api/storage/post-upload-availability', { signal: controller.signal, cache: 'no-store' }).then((response) => response.ok ? response.json() : null).then((data) => setEnabled(data?.enabled === true)).catch(() => {}); return () => controller.abort(); }, []);
  useEffect(() => { const active = new Set(items.map((item) => item.preview).filter(Boolean)); for (const url of urls.current) if (!active.has(url)) { URL.revokeObjectURL(url); urls.current.delete(url); } for (const url of active) urls.current.add(url); }, [items]);
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); }, []);
  function remove(item) { if (item.preview) { URL.revokeObjectURL(item.preview); urls.current.delete(item.preview); } setItems((old) => old.filter((entry) => entry.id !== item.id)); }
  function choose(event) {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (items.length + files.length > 8) { setError('Choose at most eight files.'); return; }
    if (files.some((file) => !['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type) || file.size < 1 || file.size > 3 * 1024 * 1024)) { setError('Choose JPEG, PNG, WebP or PDF files up to 3 MiB each.'); return; }
    const next = files.map((file) => { const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null; if (preview) urls.current.add(preview); return { file, preview, id: crypto.randomUUID(), progress: 0 }; });
    setItems((old) => [...old, ...next]); setError('');
  }
  function move(index, delta) { setItems((old) => { const next = [...old]; const target = index + delta; if (target < 0 || target >= next.length) return old; [next[index],next[target]] = [next[target],next[index]]; return next; }); }
  if (!enabled && !items.length) return null;
  return <div className="mt-3 text-xs">
    {!postId ? <label className="text-muted">Images or PDFs, up to eight (3 MiB each)<input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={choose} disabled={disabled || busy} className="block text-xs" /></label> : null}
    {items.map((item, index) => <div key={item.id} className="mt-2 flex flex-wrap items-center gap-2">
      {item.preview ? <img src={item.preview} alt="" className="h-10 w-10 rounded object-cover" /> : null}
      <span className="max-w-40 truncate">{item.file.name} · {(item.file.size / 1024).toFixed(0)} KiB</span>
      {item.progress ? <span>{item.progress}%</span> : null}
      {!postId ? <><button type="button" disabled={disabled || busy || index === 0} onClick={() => move(index,-1)} className="underline">Earlier</button><button type="button" disabled={disabled || busy || index === items.length - 1} onClick={() => move(index,1)} className="underline">Later</button></> : null}
      {!postId ? <button type="button" disabled={disabled || busy} onClick={() => remove(item)} className="underline">Remove</button> : null}
    </div>)}
    {error ? <p role="alert" className="mt-2 text-danger">{error}</p> : null}
  </div>;
}
