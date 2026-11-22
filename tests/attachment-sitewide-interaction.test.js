// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui', () => ({
  Button: ({ children, icon: _icon, variant: _variant, size: _size, ...props }) => React.createElement('button', props, children),
  Modal: ({ open, title, description, className, children, footer }) => open
    ? React.createElement('section', { role: 'dialog', 'aria-label': title, className }, React.createElement('p', null, description), children, footer) : null,
}));

import { DraftAttachments } from '@/components/posts/DraftAttachments';

function Form({ scope, imagesOnly = false, maxItems = 8 }) {
  const [items, setItems] = useState([]);
  return React.createElement(DraftAttachments, { scope, imagesOnly, maxItems, items, setItems });
}
let container;
let root;
async function mount(props) {
  await act(async () => { root = createRoot(container); root.render(React.createElement(Form, props)); });
  await act(async () => { container.querySelector('button').click(); });
}
async function pick(files) {
  const input = container.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
const makeFile = (name, type) => new File(['content'], name, { type });
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ enabled: true }) }));
  URL.createObjectURL = vi.fn(() => `blob:${crypto.randomUUID()}`);
  URL.revokeObjectURL = vi.fn();
  container = document.createElement('div'); document.body.append(container);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null; container.remove(); vi.unstubAllGlobals(); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('sitewide attachment dialog', () => {
  it.each([
    ['post', false], ['marketplace', true], ['lost_found', true], ['housing', false],
    ['ride', false], ['team', false], ['project', false], ['gig', false],
    ['achievement', false], ['notice', false], ['event', false], ['space', false], ['space', true],
  ])('uses the Home dialog for %s, imagesOnly=%s', async (scope, imagesOnly) => {
    await mount({ scope, imagesOnly });
    const dialog = container.querySelector('.dialog-attachment');
    expect(dialog.textContent).toContain('Drag and drop your photos here');
    expect(dialog.textContent).toContain('Choose from device');
    expect(dialog.querySelector('input').accept.includes('application/pdf')).toBe(!imagesOnly);
    expect(dialog.textContent).toContain(imagesOnly ? 'Up to 8 images.' : 'Up to 8 files.');
    expect(fetch.mock.calls[0][0]).toBe(`/api/storage/post-upload-availability${scope === 'post' ? '' : `?scope=${scope}`}`);
  });

  it('adds valid files, reports rejected ones, preserves selection on continue and supports removal', async () => {
    await mount({ scope: 'housing', maxItems: 2 });
    await pick([makeFile('photo.png', 'image/png'), makeFile('notes.pdf', 'application/pdf'), makeFile('extra.png', 'image/png'), makeFile('bad.txt', 'text/plain')]);
    expect(container.querySelectorAll('.attach-tile')).toHaveLength(2);
    expect(container.querySelector('[role=alert]').textContent).toMatch(/Only 2 more files|bad.txt/);
    expect(container.querySelector('.attach-limit').textContent).toContain('2 files added');
    await act(async () => container.querySelector('[aria-label="Remove photo.png"]').click());
    expect(container.querySelectorAll('.attach-tile')).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    const continueButton = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Continue');
    await act(async () => continueButton.click());
    expect(container.querySelector('[role=dialog]')).toBeNull();
    expect(container.textContent).toContain('notes.pdf');
  });

  it('accepts drops and enforces image-only rules with accurate remaining slots', async () => {
    await mount({ scope: 'marketplace', imagesOnly: true, maxItems: 1 });
    const drop = container.querySelector('.attach-drop');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [makeFile('notes.pdf', 'application/pdf'), makeFile('photo.jpg', 'image/jpeg')] } });
    await act(async () => drop.dispatchEvent(event));
    expect(container.querySelectorAll('.attach-tile')).toHaveLength(1);
    expect(container.querySelector('[role=alert]').textContent).toContain('notes.pdf is not a JPEG');
    expect(container.querySelector('.attach-limit').textContent).toContain('1 photo added');
    expect(container.querySelector('.attach-tile__cover')).toBeNull();
  });
});
