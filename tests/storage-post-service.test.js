import { beforeEach, describe, expect, it, vi } from 'vitest';
const m=vi.hoisted(() => ({ client:vi.fn(), remove:vi.fn(), download:vi.fn() }));
vi.mock('@/lib/supabase/admin',()=>({getAdminClient:m.client}));
vi.mock('@/lib/storage',()=>({uploadFileV3:vi.fn(),downloadFile:m.download,deleteFileByUploadKeyV3:m.remove}));
import { cleanPostAttachment, reconcilePostAttachments, getPostAttachment } from '@/lib/storage/post-attachments';
let rows, calls;
function builder(table) {
  let filtered=rows[table] || [];
  return { select(){return this;}, update(){return this;}, eq(k,v){filtered=filtered.filter((r)=>r[k]===v);return this;}, lt(){return this;}, or(){return this;}, order(){return this;}, async maybeSingle(){return {data:filtered[0] || null,error:null};}, async limit(n){return {data:filtered.slice(0,n),error:null};}, then(resolve){return Promise.resolve({error:null}).then(resolve);} };
}
beforeEach(()=>{ vi.resetAllMocks(); rows={storage_files:[],post_upload_drafts:[]}; calls=[]; m.client.mockReturnValue({from:builder,rpc:async (name,args)=>{calls.push([name,args]);return {data:null,error:null};}}); m.remove.mockResolvedValue(undefined); });
describe('post attachment cleanup',()=>{
  it('refuses files without an explicit post link even if resource IDs collide', async () => {
    rows.storage_files.push({id:'file', resource_id:'post', resource_type:'post_attachment', status:'ready'});
    expect(await getPostAttachment('post','file')).toBeNull();
    rows.post_attachment_links = [{post_id:'post',file_id:'file'}];
    expect((await getPostAttachment('post','file')).id).toBe('file');
  });
  it('keeps deletion pending if the gateway delete fails and retries later',async()=>{
    rows.storage_files.push({id:'file',gateway_key:'key',resource_type:'post_attachment',status:'delete_pending'});
    m.remove.mockRejectedValueOnce(Error('offline'));
    expect(await cleanPostAttachment('file')).toBe(false);
    expect(calls).toEqual([]);
    expect(await cleanPostAttachment('file')).toBe(true);
    expect(calls).toContainEqual(['storage_complete_post_attachment_delete',{p_file:'file'}]);
  });
  it('retires expired drafts and attempts pending deletion in a bounded pass',async()=>{
    rows.post_upload_drafts.push({id:'draft',owner_id:'owner',state:'open'});
    rows.storage_files.push({id:'file',owner_id:'owner',status:'delete_pending',resource_type:'post_attachment',gateway_key:'key'});
    expect(await reconcilePostAttachments()).toEqual({processed:1,retryPending:false});
    expect(calls).toContainEqual(['storage_abandon_post_draft',{p_owner:'owner',p_draft:'draft'}]);
    expect(calls).toContainEqual(['storage_complete_post_attachment_delete',{p_file:'file'}]);
  });
});

describe('post upload preparation and retry compatibility', () => {
  it('uses the original checksum for a reservation created before image optimization', async () => {
    const { default: sharp } = await import('sharp');
    const { createHash } = await import('node:crypto');
    const { savePostAttachment } = await import('@/lib/storage/post-attachments');
    const bytes = await sharp({create:{width:80,height:40,channels:3,background:'#ff0000'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    const checksum = createHash('sha256').update(bytes).digest('hex');
    rows.storage_files.push({id:'file',owner_id:'owner',request_id:'request',checksum,byte_size:bytes.length,status:'ready',gateway_key:'key'});
    m.client.mockReturnValue({from:builder,rpc:async (name,args) => {
      calls.push([name,args]);
      if (name === 'consume_rate_limit') return {data:{allowed:true},error:null};
      if (name === 'storage_reserve_draft_attachment') return {data:'file',error:null};
      throw Error('unexpected RPC');
    }});
    expect(await savePostAttachment({owner:'owner',draft:'draft',requestId:'request',name:'photo.jpg',mime:'image/jpeg',bytes})).toBe('file');
    expect(calls).toContainEqual(['storage_reserve_draft_attachment',expect.objectContaining({p_checksum:checksum,p_size:bytes.length})]);
  });
});
