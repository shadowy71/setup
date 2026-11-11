import { beforeEach, describe, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({user:vi.fn(),client:vi.fn(),revalidate:vi.fn()}));
vi.mock('next/cache',()=>({revalidatePath:m.revalidate,revalidateTag:vi.fn(),unstable_cache:(fn)=>fn}));
vi.mock('@/lib/auth/session',()=>({getActiveUser:m.user}));
vi.mock('@/lib/supabase/server',()=>({getServerClient:m.client}));
import { saveEvent,saveNotice } from '@/lib/actions/campus';
const id='bd1a8667-0af5-4a9d-9f34-f8f4d2815cd4'; let writes;
function form(values) { const f=new FormData(); for(const [key,value] of Object.entries(values)) f.set(key,value); return f; }
function db() { return {from(table) {return {select(){return this;},eq(){return this;},update(row){writes.push([table,row]);return this;},insert(row){writes.push([table,row]);return this;},async maybeSingle(){return {data:{published_at:'2025-01-01T00:00:00Z'},error:null};},async single(){return {data:{id},error:null};}};}}; }
beforeEach(()=>{ vi.clearAllMocks(); writes=[];m.user.mockResolvedValue({profile:{id,username:'staff'},permissions:['manage_events','manage_notices']});m.client.mockResolvedValue(db()); });
describe('official content edits',()=>{
  it('edits past events without changing original publication time or provenance',async()=>{
    const result=await saveEvent(form({id,title:'Event',description:'An event description',starts_on:'2025-01-01',location:'Campus',status:'completed'}));
    expect(result.ok).toBe(true);expect(writes[0][1].published_at).toBe('2025-01-01T00:00:00Z');expect(writes[0][1]).not.toHaveProperty('is_official');
  });
  it('retains the publication time of an edited notice',async()=>{
    expect((await saveNotice(form({id,title:'Notice',body:'An official notice',category:'general',status:'published'}))).ok).toBe(true);
    expect(writes[0][1].published_at).toBe('2025-01-01T00:00:00Z');
  });
  it('denies a student before accessing database',async()=>{
    m.user.mockResolvedValue({profile:{id},permissions:[]});
    expect((await saveNotice(form({title:'Notice'}))).ok).toBe(false);expect(m.client).not.toHaveBeenCalled();
  });
});
