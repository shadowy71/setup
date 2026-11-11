import { beforeEach, describe, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({access:vi.fn(),images:vi.fn(),image:vi.fn(),cleanup:vi.fn(),download:vi.fn(),thumb:vi.fn()}));
vi.mock('@/lib/storage/event-attachments',()=>({visibleEvent:m.access,eventFiles:m.images,eventFile:m.image,cleanEventFile:m.cleanup}));
vi.mock('@/lib/storage/post-attachments',()=>({downloadPostAttachment:m.download,thumbnailPostAttachment:m.thumb}));
import { GET, PATCH } from '@/app/api/storage/event/[id]/route';
import { GET as getFile, DELETE } from '@/app/api/storage/event/[id]/[file]/route';
const id='7a03b47d-92e4-4c50-9acd-9959f4c97ff1', file='487952c1-60f9-4ea5-8fd1-499c07ca76d4', draft='fcb076ca-2883-44b9-94fa-897525953a09';
const params=Promise.resolve({id,file});
const req=(method,body)=>new Request(`https://pccoe.in/api/storage/event/${id}`,{method,headers:{origin:'https://pccoe.in','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
let rpc;
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('CAMPUS_EVENT_ATTACHMENTS_ENABLED','1');vi.stubEnv('CAMPUS_STORAGE_V3_ENABLED','1');rpc=vi.fn().mockResolvedValue({data:true,error:null});m.access.mockResolvedValue({user:{profile:{id:'owner'}},post:{status:'published'},canManage:true,db:{rpc}});m.images.mockResolvedValue([]);});
describe('event attachment endpoint',()=>{
  it('does not query the attachment ledger while disabled',async()=>{vi.stubEnv('CAMPUS_EVENT_ATTACHMENTS_ENABLED','0');expect(await (await GET(req('GET'),{params})).json()).toEqual({attachments:[],canEdit:false});expect(m.images).not.toHaveBeenCalled();});
  it('does not reveal files when the report is unavailable',async()=>{m.access.mockResolvedValue({status:404});expect((await GET(req('GET'),{params})).status).toBe(404);expect((await getFile(req('GET'),{params})).status).toBe(404);expect(m.images).not.toHaveBeenCalled();expect(m.image).not.toHaveBeenCalled();});
  it('rejects cross-origin, non-manager and malformed claims',async()=>{expect((await PATCH(new Request('https://pccoe.in/x',{method:'PATCH',headers:{origin:'https://evil.test'}}),{params})).status).toBe(403);m.access.mockResolvedValueOnce({user:{profile:{id:'other'}},post:{status:'published'},canManage:false,db:{rpc}});expect((await PATCH(req('PATCH',{draft,files:[file]}),{params})).status).toBe(403);expect((await PATCH(req('PATCH',{draft,files:['bad']}),{params})).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
  it('claims through the session RPC and never sends provider identifiers',async()=>{expect((await PATCH(req('PATCH',{draft,files:[file]}),{params})).status).toBe(200);expect(rpc).toHaveBeenCalledWith('event_claim_draft',{p_draft:draft,p_post:id,p_files:[file]});expect(JSON.stringify(await (await GET(req('GET'),{params})).json())).not.toContain('provider_file_id');});
  it('serves PDFs as downloads and never generates an image thumbnail for them',async()=>{m.image.mockResolvedValue({id:file,mime_type:'application/pdf',checksum:'a'.repeat(64),provider_file_id:'private'});m.download.mockResolvedValue(Buffer.from('pdf'));const result=await getFile(new Request(`https://pccoe.in/api/storage/event/${id}/${file}?size=thumb`),{params});expect(result.headers.get('content-type')).toBe('application/pdf');expect(result.headers.get('content-disposition')).toBe('attachment');expect(m.thumb).not.toHaveBeenCalled();});
  it('retires before attempting provider cleanup',async()=>{m.cleanup.mockResolvedValue(false);const result=await DELETE(req('DELETE'),{params});expect(await result.json()).toEqual({ok:true,cleanupPending:true});expect(rpc).toHaveBeenCalledWith('event_retire_attachment',{p_post:id,p_file:file});expect(m.cleanup).toHaveBeenCalledWith(file);});
});
