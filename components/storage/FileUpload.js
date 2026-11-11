'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Card, IdentityMark, Notice } from '@/components/ui';

export function FileUpload({ username, name, enabled, available }) {
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);
  const input = useRef(null);
  const requestId = useRef(null);
  const previewRef = useRef(null);
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);
  function notify() { setVersion((v) => v + 1); window.dispatchEvent(new CustomEvent('campus-avatar-changed', { detail: username })); }
  function cancel() { if (previewRef.current) URL.revokeObjectURL(previewRef.current); previewRef.current = null; setSelected(null); setPreview(null); requestId.current = null; if (input.current) input.current.value = ''; }
  function choose(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size < 1 || file.size > 3 * 1024 * 1024) {
      setMessage('Choose a JPEG, PNG or WebP image no larger than 3 MiB.'); event.target.value = ''; return;
    }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = URL.createObjectURL(file); setPreview(previewRef.current);
    requestId.current = crypto.randomUUID(); setSelected(file); setMessage('');
  }
  function upload() {
    if (!selected || progress !== null) return;
    setProgress(0); setMessage('');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/storage/profile-photo');
    xhr.setRequestHeader('Content-Type', selected.type);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(selected.name));
    xhr.setRequestHeader('X-Upload-Id', requestId.current);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.round(100 * event.loaded / event.total)); };
    xhr.onload = () => {
      setProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) { cancel(); notify(); setMessage('Profile photo updated.'); }
      else { try { setMessage(JSON.parse(xhr.responseText).error || 'Upload failed. Retry the same file.'); } catch { setMessage('Upload failed. Retry the same file.'); } }
    };
    xhr.onerror = () => { setProgress(null); setMessage('Connection failed. Retry the same file.'); };
    xhr.send(selected);
  }
  async function remove() {
    setProgress(0); setMessage('');
    try {
      const response = await fetch('/api/storage/profile-photo', { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Removal failed.');
      cancel(); notify(); setMessage(body.cleanupPending ? 'Photo removed. Storage cleanup is pending; retry removal later.' : 'Profile photo removed.');
    } catch (error) { setMessage(error.message || 'Removal failed. Please retry.'); }
    finally { setProgress(null); }
  }
  const locked = !available || !enabled;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="t-section">Profile photo</h2>
      <div className="flex items-center gap-3">
        {preview && selected ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Selected photo preview" className="h-16 w-16 rounded-full object-cover" />
        ) : <IdentityMark key={version} name={name} username={username} size={64} />}
        <p className="text-sm text-muted">JPEG, PNG or WebP, up to 3 MiB. Images may contain embedded metadata.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="profile-photo-input" disabled={locked || progress !== null} onChange={choose} />
        <Button type="button" disabled={locked || progress !== null} onClick={() => input.current?.click()} className={locked ? 'opacity-50' : ''}>Choose photo</Button>
        {selected ? <Button type="button" disabled={progress !== null} onClick={upload}>Upload photo</Button> : null}
        {selected ? <Button type="button" variant="secondary" disabled={progress !== null} onClick={cancel}>Cancel</Button> : null}
        <Button type="button" variant="secondary" disabled={progress !== null} onClick={remove}>Remove photo</Button>
      </div>
      {!enabled ? <Notice tone="warning" icon="lock">File uploads are currently available to selected contributors.</Notice> : null}
      {enabled && !available ? <Notice tone="warning">Profile photo uploads are not available yet.</Notice> : null}
      {progress !== null ? <p role="status" className="text-sm">Uploading or removing… {progress}%</p> : null}
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </Card>
  );
}
