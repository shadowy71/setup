import { describe, expect, it, vi } from 'vitest';
import { uploadPostFiles } from '@/lib/media/post-upload';
function item(id) { return { id, file: { name: `${id}.png`, type: 'image/png' } }; }
function requests(outcomes, calls) {
  return () => ({ headers: {}, upload: {}, open(method, url) { this.method = method; this.url = url; }, setRequestHeader(k, v) { this.headers[k] = v; }, send(file) { calls.push({ url: this.url, headers: this.headers, file }); const outcome = outcomes.shift(); this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 }); if (outcome === 'network') return this.onerror(); this.status = outcome; this.responseText = '{}'; this.onload(); } });
}
describe('ordered post uploads', () => {
  it('stops after a failure, retaining idempotency keys for retry', async () => {
    const calls = [], uploaded = vi.fn(), progress = vi.fn();
    const items = [item('one'),item('two'),item('three')];
    const first = await uploadPostFiles('post', items, { makeRequest: requests([200,'network'], calls), onUploaded: uploaded, onProgress: progress });
    expect(first.ok).toBe(false); expect(calls.map((c) => c.headers['X-Upload-Id'])).toEqual(['one','two']);
    expect(uploaded.mock.calls).toEqual([['one', undefined]]); expect(progress).toHaveBeenCalledWith('two', 50);
    const retry = await uploadPostFiles('post', items.slice(1), { makeRequest: requests([200,200], calls), onUploaded: uploaded });
    expect(retry.ok).toBe(true); expect(calls.map((c) => c.headers['X-Upload-Id'])).toEqual(['one','two','two','three']);
  });
  it('waits for durable recovery bookkeeping before starting the next upload', async () => {
    const calls = []; let release;
    const saving = new Promise((resolve) => { release = resolve; });
    const uploading = uploadPostFiles('post', [item('one'),item('two')], { makeRequest: requests([200,200],calls), onUploaded: async (id) => { if (id === 'one') await saving; } });
    await Promise.resolve(); expect(calls).toHaveLength(1);
    release(); expect((await uploading).ok).toBe(true); expect(calls).toHaveLength(2);
  });
  it('stops before the next upload when recovery storage fails', async () => {
    const calls = [];
    await expect(uploadPostFiles('post',[item('one'),item('two')], { makeRequest: requests([200,200],calls), onUploaded: async () => { throw Error('storage full'); } })).rejects.toThrow('storage full');
    expect(calls).toHaveLength(1);
  });
  it('returns an error if sending fails synchronously', async () => {
    const result = await uploadPostFiles('post',[item('one')], { makeRequest: () => { throw Error('offline'); } });
    expect(result.ok).toBe(false);
  });
});
