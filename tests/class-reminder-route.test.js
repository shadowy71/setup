import { afterEach, describe, expect, it, vi } from 'vitest';
const currentUser = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/session', () => ({ getCurrentUser: currentUser, BLOCKED_STATUSES: ['suspended', 'banned', 'deactivated', 'deleted'] }));
import { GET } from '@/app/api/reminders/me/route';

const student = { accountType: 'student', accountStatus: 'active', needsProfileSetup: false, profile: { id: 'profile', username: 'student', profile_completed: true, class_reminder_popups: true, division: 'o' } };
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe('session-derived reminder endpoint', () => {
  it('returns only the current IST date, canonical profile division and academic events', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-23T00:00:00Z')); currentUser.mockResolvedValue(student);
    const response = await GET(); const data = await response.json();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(data).toMatchObject({ profileId: 'profile', division: 'O', dateKey: '2026-11-23', eligible: true });
    expect(data.reminders.length).toBeGreaterThan(0);
    expect(data.reminders.every((x) => x.division === 'O' && x.event_date === '2026-11-23' && ['batch', 'standard'].includes(x.kind))).toBe(true);
    expect(data.reminders.some((x) => x.location && x.start_label)).toBe(true);
  });
  it('returns no reminders for visitors or missing divisions, and rejects missing sessions', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-23T00:00:00Z'));
    currentUser.mockResolvedValueOnce({ ...student, accountType: 'visitor' }).mockResolvedValueOnce({ ...student, profile: { ...student.profile, division: null } }).mockResolvedValueOnce(null);
    expect((await (await GET()).json()).reminders).toEqual([]);
    expect((await (await GET()).json()).reminders).toEqual([]);
    expect((await GET()).status).toBe(401);
  });
});
