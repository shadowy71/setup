import { describe, expect, it } from 'vitest';

import { isPermanentRealtimeAuthorizationError } from '@/lib/realtime/authorization';

describe('permanent Realtime authorization failures', () => {
  it.each([
    ['server Unauthorized reply', new Error('Unauthorized')],
    ['structured RLS reply', new Error('channel join failed', { cause: { reason: 'RlsPolicyError' } })],
    ['Postgres privilege failure', new Error('permission denied for function can_access_own_random_session')],
    ['structured SQLSTATE', new Error('channel join failed', { cause: { code: '42501' } })],
    ['explicit authorization wording', new Error('profile is not authorized for this topic')],
  ])('stops automatic rejoin for %s', (_label, error) => {
    expect(isPermanentRealtimeAuthorizationError(error)).toBe(true);
  });

  it.each([
    ['missing error', undefined],
    ['transport loss', new Error('channel error: transport failure', { cause: { code: 1006 } })],
    ['ordinary socket close', new Error('socket closed: 1006')],
    ['expired access token', new Error('Unauthorized: JWT expired')],
    ['invalid token in the structured cause', new Error('channel join failed', { cause: { reason: 'invalid access token' } })],
  ])('keeps the normal recovery path for %s', (_label, error) => {
    expect(isPermanentRealtimeAuthorizationError(error)).toBe(false);
  });

  it('handles circular error causes without throwing', () => {
    const error = new Error('channel error');
    error.cause = error;
    expect(isPermanentRealtimeAuthorizationError(error)).toBe(false);
  });
});
