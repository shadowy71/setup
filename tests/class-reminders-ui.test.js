// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const claims = new Set();
const handlers = new Set();
vi.mock('@/lib/reminders/browser', () => ({
  reminderKey: (profile, item) => `${profile}|${item.division}|${item.event_date}|${item.event_key}`,
  claimReminder: vi.fn(async (key) => { if (claims.has(key)) return false; claims.add(key); return true; }),
  listenReminderSignals: (handler) => { handlers.add(handler); return () => handlers.delete(handler); },
}));
import { ClassReminderPopup } from '@/components/reminders/ClassReminderPopup';

const profileId = 'profile-a';
const dateKey = '2026-11-23';
function event(id, at, start, division = 'O') {
  return { event_key: `${dateKey}|Monday|${id}`, event_date: dateKey, division, subject: id, start_label: start.slice(11, 16), reminder_at: at, class_start_at: start };
}
const first = event('first', '2026-11-23T03:20:00Z', '2026-11-23T03:30:00Z');
const second = event('second', '2026-11-23T04:20:00Z', '2026-11-23T04:30:00Z');
let data;
let roots;
let hidden;

async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }
async function mount(id = profileId) {
  const div = document.createElement('div'); document.body.appendChild(div);
  const root = createRoot(div); roots.push(root);
  await act(async () => { root.render(React.createElement(ClassReminderPopup, { profileId: id })); });
  await flush();
  return root;
}
function signal(message) { for (const handler of handlers) handler(message); }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-23T03:00:00Z'));
  claims.clear(); handlers.clear(); roots = []; hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  data = { ok: true, eligible: true, profileId, dateKey, division: 'O', reminders: [first, second] };
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })));
});
afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount(); });
  document.body.innerHTML = ''; vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('authenticated class reminder timer lifecycle', () => {
  it('schedules separate timers at T-10 and displays both classes', async () => {
    await mount(); expect(document.body.textContent).not.toContain('first');
    await act(async () => { await vi.advanceTimersByTimeAsync(20 * 60 * 1000); });
    expect(document.body.textContent).toContain('first');
    expect(document.body.textContent).toContain('Class starts in 10 minutes');
    await act(async () => document.querySelector('[aria-label="Dismiss class reminder"]').click());
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60 * 1000); });
    expect(document.body.textContent).toContain('second');
  });

  it('catches up truthfully and does not repeat after refresh or in a second tab', async () => {
    vi.setSystemTime(new Date('2026-11-23T03:25:00Z'));
    await mount(); expect(document.body.textContent).toContain('Class starts soon');
    await act(async () => document.querySelector('[aria-label="Dismiss class reminder"]').click());
    await mount(); expect(document.body.textContent).not.toContain('first');
    expect(claims.size).toBe(1);
  });

  it('reconciles a hidden or sleeping tab and never shows a started class', async () => {
    await mount(); hidden = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60 * 1000); });
    expect(document.body.textContent).not.toContain('first');
    hidden = false;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); await flush();
    expect(document.body.textContent).not.toContain('first');
  });

  it('shows only one popup across simultaneous tabs and catches up on pageshow', async () => {
    await mount(); await mount(); hidden = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(25 * 60 * 1000); });
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(0);
    hidden = false;
    await act(async () => window.dispatchEvent(new Event('pageshow'))); await flush();
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(document.body.textContent).toContain('Class starts soon');
  });

  it('rechecks the server when preference and division change', async () => {
    await mount(); data = { ...data, eligible: false, reminders: [] };
    await act(async () => signal({ type: 'changed', profileId })); await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(20 * 60 * 1000); });
    expect(document.body.textContent).not.toContain('first');
    data = { ...data, eligible: true, reminders: [first] };
    await act(async () => signal({ type: 'changed', profileId })); await flush();
    expect(document.body.textContent).toContain('first');
  });

  it('continues an authenticated same-day schedule offline and refreshes on reconnect', async () => {
    await mount(); fetch.mockRejectedValue(new Error('offline'));
    await act(async () => { await vi.advanceTimersByTimeAsync(20 * 60 * 1000); });
    expect(document.body.textContent).toContain('first');
    fetch.mockImplementation(async () => ({ ok: true, json: async () => data }));
    await act(async () => window.dispatchEvent(new Event('online'))); await flush();
    expect(fetch).toHaveBeenCalled();
  });

  it('clears immediately on disable or logout and rebuilds on enabling', async () => {
    await mount();
    await act(async () => signal({ type: 'disabled', profileId }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20 * 60 * 1000); });
    expect(document.body.textContent).not.toContain('first');
    await act(async () => signal({ type: 'changed', profileId })); await flush();
    expect(document.body.textContent).toContain('first');
    await act(async () => signal({ type: 'signout' }));
    expect(document.body.textContent).not.toContain('first');
  });

  it('replaces old division and rejects account mismatches and ineligible users', async () => {
    await mount();
    data = { ...data, division: 'P', reminders: [event('new division', first.reminder_at, first.class_start_at, 'P')] };
    await act(async () => signal({ type: 'changed', profileId })); await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(20 * 60 * 1000); });
    expect(document.body.textContent).toContain('new division'); expect(document.body.textContent).not.toContain('first');
    data = { ...data, profileId: 'different-account' };
    await act(async () => signal({ type: 'changed', profileId })); await flush();
    expect(document.body.textContent).not.toContain('new division');
    data = { ...data, profileId, eligible: false, reminders: [] };
    await act(async () => signal({ type: 'changed', profileId })); await flush();
    expect(document.body.textContent).not.toContain('new division');
  });

  it('clears yesterday at IST midnight and asks for a new day', async () => {
    vi.setSystemTime(new Date('2026-11-23T18:29:55Z')); await mount();
    data = { ...data, dateKey: '2026-11-24', reminders: [] };
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(fetch.mock.calls.length).toBeGreaterThan(1);
    expect(document.body.textContent).not.toContain('first');
  });
});
