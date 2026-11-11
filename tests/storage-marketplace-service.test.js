import { beforeEach, describe, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({client:vi.fn(),remove:vi.fn()}));
vi.mock('@/lib/supabase/admin',()=>({getAdminClient:m.client}));
vi.mock('@/lib/storage',()=>({deleteFileByUploadKeyV3:m.remove}));
import { marketplaceFile,cleanupMarketplaceFile,reconcileMarketplaceFiles } from '@/lib/storage/marketplace-attachments';
let rows,calls;
function builder(table) {let data=rows[table]||[];return {select(){return this;},update(){return this;},eq(k,v){data=data.filter((r)=>r[k]===v);return this;},order(){return this;},async maybeSingle(){return {data:data[0]||null,error:null};},async limit(n){return {data:data.slice(0,n),error:null};},then(resolve){return Promise.resolve({error:null}).then(resolve);}};}
beforeEach(()=>{vi.resetAllMocks();rows={storage_files:[],marketplace_attachment_links:[]};calls=[];m.remove.mockResolvedValue();m.client.mockReturnValue({from:builder,rpc:async(name,args)=>{calls.push([name,args]);return {error:null};}});});
describe('marketplace image cleanup',()=>{
  it('requires an explicit listing association even when IDs collide',async()=>{
    rows.storage_files.push({id:'file',resource_id:'listing',resource_type:'marketplace_image',status:'ready'});
    expect(await marketplaceFile('listing','file')).toBeNull();
    rows.marketplace_attachment_links.push({listing_id:'listing',file_id:'file'}); expect((await marketplaceFile('listing','file')).id).toBe('file');
  });
  it('keeps deletion pending until confirmed and retries pending work',async()=>{
    rows.storage_files.push({id:'file',gateway_key:'key',resource_type:'marketplace_image',status:'delete_pending'});m.remove.mockRejectedValueOnce(Error('offline'));
    expect(await cleanupMarketplaceFile('file')).toBe(false);expect(calls).toEqual([]);
    expect(await reconcileMarketplaceFiles()).toEqual({processed:1,retryPending:false});
    expect(calls).toContainEqual(['storage_complete_marketplace_image_delete',{p_file:'file'}]);
  });
});
