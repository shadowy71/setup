import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), client: vi.fn(), revalidate: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate, revalidateTag: vi.fn(), unstable_cache: (fn) => fn }));
vi.mock('@/lib/auth/session', () => ({ getActiveUser: mocks.user }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: mocks.client }));
import { updateOwnCampusBoard, deleteOwnCampusBoard } from '@/lib/actions/campus-board';
const id = '7fcd8ecb-002f-4c30-bcdc-9306d117f191';
let calls, result;
function db() {
  return { from(table) { calls.push(['table', table]); return {
    update(row) { calls.push(['update', row]); return this; },
    delete() { calls.push(['delete']); return this; },
    eq(key, value) { calls.push(['eq', key, value]); return this; },
    select() { return this; },
    async maybeSingle() { return result; },
  }; } };
}
function form(values) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }
const housing = { type: 'housing', id, title: 'A room', description: 'Room near campus', area: 'Wakad', budget: '', room_type: 'shared', available_from: '' };
beforeEach(() => { vi.clearAllMocks(); calls = []; result = { data: { id }, error: null }; mocks.user.mockResolvedValue({ profile: { id: 'owner' } }); mocks.client.mockResolvedValue(db()); });
describe('student board management', () => {
  it('validates and updates only owner fields without changing moderation status', async () => {
    expect((await updateOwnCampusBoard(form(housing))).ok).toBe(true);
    expect(calls).toContainEqual(['eq', 'creator_id', 'owner']);
    expect(calls).toContainEqual(['eq', 'id', id]);
    const row = calls.find(([kind]) => kind === 'update')[1];
    expect(row).not.toHaveProperty('creator_id'); expect(row).not.toHaveProperty('status');
    expect(row.budget).toBeNull(); expect(mocks.revalidate).toHaveBeenCalledWith('/campus/housing');
  });
  it('rejects invalid inputs without touching the database', async () => {
    expect((await updateOwnCampusBoard(form({ ...housing, title: '' }))).ok).toBe(false);
    expect((await deleteOwnCampusBoard(form({ type: 'housing', id: 'bad' }))).ok).toBe(false);
    expect((await deleteOwnCampusBoard(form({ type: 'other', id }))).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('does not report success for a missing or non-owned row', async () => {
    result = { data: null, error: null };
    expect((await updateOwnCampusBoard(form(housing))).ok).toBe(false);
    expect((await deleteOwnCampusBoard(form({ type: 'projects', id }))).ok).toBe(false);
    expect(calls).toContainEqual(['eq', 'creator_id', 'owner']);
  });
  it('requires authentication and rejects unsafe project links', async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await deleteOwnCampusBoard(form({ type: 'rides', id }))).ok).toBe(false);
    expect((await updateOwnCampusBoard(form({ type: 'projects', id, title: 'Project', description: 'A project description', technologies: 'JS', repo_url: 'javascript:alert(1)' }))).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('removes an owned ride and revalidates the correct board', async () => {
    expect((await deleteOwnCampusBoard(form({ type: 'rides', id }))).ok).toBe(true);
    expect(calls).toContainEqual(['table', 'ride_posts']); expect(calls).toContainEqual(['delete']);
    expect(mocks.revalidate).toHaveBeenCalledWith('/campus/rides');
  });
});
