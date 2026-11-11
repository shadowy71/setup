import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/storage/marketplace-access',()=>({visibleMarketplaceListing:vi.fn()}));
vi.mock('@/lib/storage/marketplace-attachments',()=>({marketplaceFiles:vi.fn(),marketplaceFile:vi.fn(),cleanupMarketplaceFile:vi.fn()}));
vi.mock('@/lib/storage/post-access',()=>({sameOrigin:vi.fn()}));
vi.mock('@/lib/storage/post-attachments',()=>({downloadPostAttachment:vi.fn(),thumbnailPostAttachment:vi.fn()}));
import { visibleMarketplaceListing } from '@/lib/storage/marketplace-access';
import { marketplaceFiles,marketplaceFile,cleanupMarketplaceFile } from '@/lib/storage/marketplace-attachments';
import { sameOrigin } from '@/lib/storage/post-access';
import { downloadPostAttachment,thumbnailPostAttachment } from '@/lib/storage/post-attachments';
import { GET as list,PATCH } from '@/app/api/storage/marketplace/[id]/route';
import { GET,DELETE } from '@/app/api/storage/marketplace/[id]/[file]/route';
const id='d6c50c2c-c061-497e-ae3a-0289944cd024',file='f4b5c514-200e-4cae-912f-6b8d03f71589',draft='a3c50c2c-c061-497e-ae3a-0289944cd024';
const ctx={params:Promise.resolve({id,file})}; const meta={id:file,checksum:'a'.repeat(64),mime_type:'image/png',provider_file_id:'private'}; let rpc;
function req(method='GET',body=null,headers={}) {return new Request(`https://pccoe.in/api/storage/marketplace/${id}/${file}`,{method,headers:{origin:'https://pccoe.in',...headers},...(body?{body:JSON.stringify(body)}:{})});}
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('CAMPUS_MARKET_ATTACHMENTS_ENABLED','1');vi.stubEnv('CAMPUS_STORAGE_V3_ENABLED','1');sameOrigin.mockReturnValue(true);rpc=vi.fn().mockResolvedValue({data:true,error:null});visibleMarketplaceListing.mockResolvedValue({canEdit:true,db:{rpc}});});
afterEach(()=>vi.unstubAllEnvs());
describe('marketplace attachment routes',()=>{
  it('denies inaccessible listings before touching private metadata or honoring conditional cache',async()=>{
    visibleMarketplaceListing.mockResolvedValue({status:404});
    expect((await list(req(),ctx)).status).toBe(404);expect((await GET(req('GET',null,{'if-none-match':`"${meta.checksum}"`}),ctx)).status).toBe(404);
    expect(marketplaceFiles).not.toHaveBeenCalled();expect(marketplaceFile).not.toHaveBeenCalled();
  });
  it('limits editing to owners or authorized moderators and requires the feature flags',async()=>{
    visibleMarketplaceListing.mockResolvedValueOnce({canEdit:false,db:{rpc}});
    expect((await PATCH(req('PATCH',{files:[file]}),ctx)).status).toBe(403);
    sameOrigin.mockReturnValueOnce(false);expect((await PATCH(req('PATCH',{files:[file]}),ctx)).status).toBe(403);
    vi.stubEnv('CAMPUS_MARKET_ATTACHMENTS_ENABLED','0');expect((await PATCH(req('PATCH',{files:[file]}),ctx)).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('routes bounded reorder and draft claims through session-scoped database functions',async()=>{
    expect((await PATCH(req('PATCH',{files:[file]}),ctx)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('marketplace_reorder_images',{p_listing:id,p_files:[file]});
    expect((await PATCH(req('PATCH',{draft,files:[file]}),ctx)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('marketplace_claim_draft',{p_draft:draft,p_listing:id,p_files:[file]});
    expect((await PATCH(req('PATCH',{files:Array(9).fill(file)}),ctx)).status).toBe(400);
  });
  it('returns private thumbnails and revalidates after authorization without downloading',async()=>{
    marketplaceFile.mockResolvedValue(meta);thumbnailPostAttachment.mockResolvedValue(Buffer.from('thumb'));
    const url=`https://pccoe.in/api/storage/marketplace/${id}/${file}?size=thumb`;
    const first=await GET(new Request(url),ctx);expect(first.status).toBe(200);expect(first.headers.get('etag')).toBe(`"${meta.checksum}-thumb-v1"`);
    const cached=await GET(new Request(url,{headers:{'if-none-match':`"${meta.checksum}-thumb-v1"`}}),ctx);expect(cached.status).toBe(304);expect(thumbnailPostAttachment).toHaveBeenCalledTimes(1);expect(downloadPostAttachment).not.toHaveBeenCalled();
  });
  it('retires only the requested image and reports pending cleanup',async()=>{
    visibleMarketplaceListing.mockResolvedValueOnce({canEdit:false,db:{rpc}});expect((await DELETE(req('DELETE'),ctx)).status).toBe(403);
    cleanupMarketplaceFile.mockResolvedValue(false);
    expect(await (await DELETE(req('DELETE'),ctx)).json()).toEqual({ok:true,cleanupPending:true});
    expect(rpc).toHaveBeenCalledWith('marketplace_retire_image',{p_listing:id,p_file:file});expect(cleanupMarketplaceFile).toHaveBeenCalledWith(file);
  });
});
