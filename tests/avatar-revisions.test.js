import { describe, expect, it, vi } from 'vitest';
import { avatarRevision, invalidateAvatar, subscribeAvatar } from '@/lib/media/avatar-revisions';

describe('shared avatar URL invalidation', () => {
  it('updates all instances of the same identity without touching other identities', () => {
    const aliceA = vi.fn(), aliceB = vi.fn(), bob = vi.fn();
    const offA = subscribeAvatar('alice-test', aliceA), offB = subscribeAvatar('alice-test', aliceB), offC = subscribeAvatar('bob-test', bob);
    expect(avatarRevision('alice-test')).toBe(0);
    invalidateAvatar('alice-test');
    expect(avatarRevision('alice-test')).toBe(1);
    expect(aliceA).toHaveBeenCalledOnce(); expect(aliceB).toHaveBeenCalledOnce(); expect(bob).not.toHaveBeenCalled();
    offA(); offB(); offC();
    invalidateAvatar('alice-test');
    expect(avatarRevision('alice-test')).toBe(2);
    expect(aliceA).toHaveBeenCalledOnce();
  });
});
