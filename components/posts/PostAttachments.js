/* eslint-disable @next/next/no-img-element */
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui';

/** Post-scoped images and PDFs; the endpoint applies RLS on every request. */
export function PostAttachments({ postId, manage = false }) {
  const [files, setFiles] = useState([]); const [canUpload, setCanUpload] = useState(false);
  const [selected, setSelected] = useState([]); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState(null); const closeLightbox = useCallback(() => setLightbox(null), []); const root = useRef(null); const [visible, setVisible] = useState(manage);
  const load = useCallback(async () => { try { const response = await fetch(`/api/storage/posts/${postId}`, { cache: 'no-store' }); if (!response.ok) return; const data = await response.json(); setFiles(data.attachments || []); setCanUpload(data.canUpload === true); return data.attachments || []; } catch { /* keep existing view */ } return null; }, [postId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (visible) { load(); return; } const target = root.current; if (!target) return; const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '300px' }); observer.observe(target); return () => observer.disconnect(); }, [visible, load]);
  const previews = useRef(new Set());
  useEffect(() => () => { for (const url of previews.current) URL.revokeObjectURL(url); previews.current.clear(); }, []);
  function release(item) { if (item.preview) { URL.revokeObjectURL(item.preview); previews.current.delete(item.preview); } }
  function choose(event, replaceId = null) {
    const incoming = Array.from(event.target.files || []); event.target.value = '';
    if (replaceId && incoming.some((file) => !file.type.startsWith('image/'))) { setMessage('Choose an image to replace this image.'); return; }
    if (incoming.some((file) => !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type) || file.size < 1 || file.size > 3 * 1024 * 1024)) { setMessage('Choose JPEG, PNG, WebP or PDF files up to 3 MiB.'); return; }
    if (files.length + selected.length + incoming.length > 8) { setMessage('A post can have up to eight attachments.'); return; }
    const added = incoming.map((file) => { const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null; if (preview) previews.current.add(preview); return { file, id: crypto.randomUUID(), preview, progress: 0, replaceId }; });
    setSelected((old) => [...old, ...added]); setMessage('');
  }
  async function upload(item) {
    setBusy(true); setMessage('');
    const result = await new Promise((resolve) => { const xhr = new XMLHttpRequest(); xhr.open('POST', `/api/storage/posts/${postId}`); xhr.setRequestHeader('Content-Type', item.file.type); xhr.setRequestHeader('X-File-Name', encodeURIComponent(item.file.name)); xhr.setRequestHeader('X-Upload-Id', item.id);
      xhr.upload.onprogress = (event) => { if (event.lengthComputable) setSelected((old) => old.map((entry) => entry.id === item.id ? { ...entry, progress: Math.round(event.loaded / event.total * 100) } : entry)); };
      xhr.onload = () => { let body = {}; try { body = JSON.parse(xhr.responseText); } catch {} resolve({ ok: xhr.status >= 200 && xhr.status < 300, error: body.error }); }; xhr.onerror = () => resolve({ ok: false }); xhr.send(item.file); });
    if (result.ok) {
      if (item.replaceId) {
        try {
          const removal = await fetch(`/api/storage/posts/${postId}/${item.replaceId}`, { method: 'DELETE' });
          if (!removal.ok) { const current = await load(); if (!current || current.some((file) => file.id === item.replaceId)) throw Error(); }
        } catch { setMessage('New image uploaded, but the old image could not be removed. Retry replacement.'); await load(); setBusy(false); return; }
      }
      release(item); setSelected((old) => old.filter((entry) => entry.id !== item.id)); await load();
    } else setMessage(result.error || 'Upload failed. Retry the same file.');
    setBusy(false);
  }
  async function move(index, delta) {
    const next = [...files]; const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/storage/posts/${postId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: next.map((file) => file.id) }) });
      if (!response.ok) throw Error();
      setFiles(next);
    } catch { setMessage('Could not reorder attachments. Refresh and retry.'); await load(); } finally { setBusy(false); }
  }
  async function remove(file) { setBusy(true); try { const response = await fetch(`/api/storage/posts/${postId}/${file.id}`, { method: 'DELETE' }); if (!response.ok) throw Error(); await load(); } catch { setMessage('Removal failed. Please retry.'); } finally { setBusy(false); } }
  return <div ref={root} className={files.length || (manage && canUpload) ? 'mt-3' : ''}>
    {files.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{files.map((file, index) => <div key={file.id} className="min-w-0 rounded border border-line p-1">
      {file.mime_type.startsWith('image/') ? <button type="button" onClick={() => setLightbox(file)} aria-label={`View ${file.original_name}`} className="block w-full"><img src={`/api/storage/posts/${postId}/${file.id}?size=thumb`} alt={file.original_name} loading="lazy" decoding="async" className="aspect-square w-full rounded object-cover" /></button> : <a className="block break-all p-2 text-sm underline" href={`/api/storage/posts/${postId}/${file.id}`}>{file.original_name} · {(file.byte_size / 1024).toFixed(0)} KiB</a>}
      {manage ? <div className="flex flex-wrap gap-2 text-xs">{file.mime_type.startsWith('image/') ? <label className="p-1 underline">Replace<input aria-label={`Replace ${file.original_name}`} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => choose(event, file.id)} className="sr-only" /></label> : null}<button type="button" disabled={busy || index === 0} onClick={() => move(index, -1)} className="p-1 underline">Earlier</button><button type="button" disabled={busy || index === files.length - 1} onClick={() => move(index, 1)} className="p-1 underline">Later</button><button type="button" disabled={busy} onClick={() => remove(file)} className="p-1 text-muted underline">Remove</button></div> : null}
    </div>)}</div> : null}
    {manage && canUpload ? <div className="mt-2"><label className="text-xs text-muted">Add images or PDFs (up to eight; 3 MiB each)<input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={choose} className="block text-xs" /></label></div> : null}
    {selected.map((item) => <div key={item.id} className="mt-2 flex items-center gap-2 text-xs">{item.preview ? <img src={item.preview} alt="" className="h-10 w-10 rounded object-cover" /> : null}<span className="min-w-0 truncate">{item.file.name}</span><button type="button" disabled={busy} onClick={() => upload(item)} className="underline">Upload {item.progress ? `${item.progress}%` : ''}</button><button type="button" disabled={busy} onClick={() => { release(item); setSelected((old) => old.filter((entry) => entry.id !== item.id)); }} className="underline">Cancel</button></div>)}
    {message ? <p role="status" className="mt-2 text-xs text-danger">{message}</p> : null}
    <Modal open={Boolean(lightbox)} onClose={closeLightbox} title={lightbox?.original_name || 'Image'} size="lg">
      {lightbox ? <img src={`/api/storage/posts/${postId}/${lightbox.id}`} alt={lightbox.original_name} className="max-h-[75vh] w-full object-contain" /> : null}
      {lightbox && files.filter((file) => file.mime_type.startsWith('image/')).length > 1 ? <div className="mt-2 flex justify-between text-sm">
        <button type="button" onClick={() => { const images = files.filter((file) => file.mime_type.startsWith('image/')); const index = images.findIndex((file) => file.id === lightbox.id); setLightbox(images[(index - 1 + images.length) % images.length]); }}>Previous</button>
        <button type="button" onClick={() => { const images = files.filter((file) => file.mime_type.startsWith('image/')); const index = images.findIndex((file) => file.id === lightbox.id); setLightbox(images[(index + 1) % images.length]); }}>Next</button>
      </div> : null}
    </Modal>
  </div>;
}
