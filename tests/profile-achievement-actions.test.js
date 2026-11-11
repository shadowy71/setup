import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: vi.fn(), client: vi.fn(), revalidate: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('@/lib/auth/session', () => ({ getActiveUser: m.user }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: m.client }));
import { saveProfileAchievement, deleteProfileAchievement, moderateProfileAchievement } from '@/lib/actions/achievements';
const id='a42f69c3-4128-4d6e-a81e-99accf2d23a1';
let calls, result;
function db() { return { from(table) { calls.push(['table',table]); return {
  update(row) { calls.push(['update',row]); return this; }, insert(row) { calls.push(['insert',row]); return this; }, delete() { return this; },
  eq(key,value) { calls.push(['eq',key,value]); return this; }, select() { return this; }, async maybeSingle() { return result; },
}; } }; }
function form(values) { const data=new FormData(); for(const [key,value] of Object.entries(values)) data.set(key,value); return data; }
beforeEach(() => { vi.clearAllMocks(); calls=[]; result={data:{id},error:null}; m.user.mockResolvedValue({profile:{id:'owner',username:'owner'},permissions:[]}); m.client.mockResolvedValue(db()); });
describe('profile achievement actions', () => {
  const valid={ title:'Award', description:'Won a contest', category:'competition', achieved_on:'2026-01-10' };
  it('creates only for the signed-in owner and does not set moderation status', async () => {
    expect((await saveProfileAchievement(form(valid))).ok).toBe(true);
    expect(calls.find(([kind])=>kind==='insert')[1]).toMatchObject({owner_id:'owner',...valid});
    expect(calls.find(([kind])=>kind==='insert')[1]).not.toHaveProperty('status');
  });
  it('validates content and scopes edits/deletes to the current owner', async () => {
    expect((await saveProfileAchievement(form({...valid,category:'invented'}))).ok).toBe(false);
    expect(m.client).not.toHaveBeenCalled();
    expect((await saveProfileAchievement(form({...valid,id}))).ok).toBe(true);
    expect(calls).toContainEqual(['eq','owner_id','owner']);
    result={data:null,error:null}; expect((await deleteProfileAchievement(form({id}))).ok).toBe(false);
  });
  it('denies non-moderators before any database call', async () => {
    expect((await moderateProfileAchievement(form({id,status:'hidden'}))).ok).toBe(false);
    expect(m.client).not.toHaveBeenCalled();
  });
});
