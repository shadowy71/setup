// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const action = vi.fn(async () => ({ ok: true }));
const signal = vi.fn();
vi.mock('@/lib/actions/reminders', () => ({ setClassReminderPreference: (...args) => action(...args) }));
vi.mock('@/lib/reminders/browser', () => ({ signalReminders: (...args) => signal(...args) }));
import { ClassReminderSettings } from '@/components/reminders/ClassReminderSettings';

let root;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; action.mockClear(); signal.mockClear(); });
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; document.body.innerHTML = ''; vi.unstubAllGlobals(); });
it('enables only the account preference, with no browser permission or push subscription', async () => {
  const requestPermission = vi.fn(); const subscribe = vi.fn();
  vi.stubGlobal('Notification', { permission: 'default', requestPermission });
  vi.stubGlobal('PushManager', { subscribe });
  const node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node);
  await act(async () => root.render(React.createElement(ClassReminderSettings, { profileId: 'p', accountType: 'student', division: 'O' })));
  await act(async () => node.querySelector('input').click());
  expect(action).toHaveBeenCalledWith(true);
  expect(signal).toHaveBeenCalledWith('changed', 'p');
  expect(requestPermission).not.toHaveBeenCalled(); expect(subscribe).not.toHaveBeenCalled();
  expect(node.textContent).toContain('open in a browser tab');
});
