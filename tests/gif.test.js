import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GifAttachment } from '@/components/media/GifPicker';
import { gifRefValidator } from '@/lib/validation/schemas';

/**
 * GIF attachments must never resize the card they sit in.
 *
 * An external GIF's true shape is only known after it downloads, so the
 * dimensions captured when it was picked are what reserve its space. These
 * tests pin both halves: the reference keeps its dimensions all the way to
 * the database, and the renderer either uses them exactly or falls back to a
 * fixed frame that cannot move.
 */

const html = (node) => renderToStaticMarkup(React.createElement(React.Fragment, null, node));
const read = (file) => fs.readFileSync(file, 'utf8');
const GIF_URL = 'https://media.giphy.com/media/abc123/giphy.gif';

/* Tests are plain .js here, so elements are built without JSX (the JSX
   transform is scoped to app/components). */
const gif = (props) => React.createElement(GifAttachment, props);

describe('gif attachment layout', () => {
  it('reserves the real aspect ratio when dimensions are stored', () => {
    const markup = html(gif({ gif: { url: GIF_URL, width: 480, height: 270, title: 'Wave' } }));

    expect(markup).toContain('width="480"');
    expect(markup).toContain('height="270"');
    expect(markup).toContain('aspect-ratio:480 / 270');
    // Never larger than its natural size, never taller than the card allows.
    expect(markup).toContain('max-h-72');
    expect(markup).toContain('max-w-full');
    expect(markup).toContain('alt="Wave"');
  });

  it('never stretches a small GIF past its natural size', () => {
    const markup = html(gif({ gif: { url: GIF_URL, width: 120, height: 120 } }));
    expect(markup).toContain('width="120"');
    expect(markup).toContain('height="120"');
    expect(markup).toContain('aspect-ratio:120 / 120');
  });

  it('keeps a fixed frame for references stored without dimensions', () => {
    // Old rows cannot know their shape; they must not be able to move the
    // page when the GIF finally arrives.
    const markup = html(gif({ gif: { url: GIF_URL } }));

    expect(markup).toContain('aspect-ratio:16 / 9');
    expect(markup).toContain('object-contain');
    expect(markup).toContain('max-w-[20rem]');
    expect(markup).not.toContain('aspect-ratio:NaN');
  });

  it('treats a placeholder 1×1 reference as unknown instead of square', () => {
    const markup = html(gif({ gif: { url: GIF_URL, width: 1, height: 1 } }));
    expect(markup).toContain('aspect-ratio:16 / 9');
    expect(markup).not.toContain('aspect-ratio:1 / 1');
  });

  it('renders nothing without a URL', () => {
    expect(html(gif({ gif: null }))).toBe('');
    expect(html(gif({ gif: {} }))).toBe('');
  });

  it('applies the caller width cap without losing the reserved ratio', () => {
    // Chat quotes a smaller GIF in a message bubble.
    const markup = html(gif({ gif: { url: GIF_URL, width: 480, height: 270 }, className: 'max-w-[14rem]' }));
    expect(markup).toContain('max-w-[14rem]');
    expect(markup).toContain('aspect-ratio:480 / 270');
  });
});

describe('gif reference keeps what the renderer needs', () => {
  it('has no dimensions for references that never carried any', () => {
    const result = gifRefValidator({ id: 'abc123', url: GIF_URL });
    expect(result.ok).toBe(true);
    expect(result.value.width).toBeNull();
    expect(result.value.height).toBeNull();
  });

  it('does not invent a 1×1 box from null dimensions', () => {
    // `Number(null)` is 0, which used to be clamped up to 1.
    const result = gifRefValidator({ id: 'abc123', url: GIF_URL, width: null, height: null });
    expect(result.value.width).toBeNull();
    expect(result.value.height).toBeNull();
  });

  it('keeps numeric dimensions, clamped to something sane', () => {
    const normal = gifRefValidator({ id: 'abc123', url: GIF_URL, width: 480, height: 200 });
    expect(normal.value).toMatchObject({ width: 480, height: 200 });

    const huge = gifRefValidator({ id: 'abc123', url: GIF_URL, width: 99999, height: 240 });
    expect(huge.value.width).toBe(2000);
    expect(huge.value.height).toBe(240);

    const broken = gifRefValidator({ id: 'abc123', url: GIF_URL, width: 'wide', height: -4 });
    expect(broken.value.width).toBeNull();
    expect(broken.value.height).toBeNull();
  });

  it('does not replace results with skeletons on every keystroke', () => {
    const picker = read('components/media/GifPicker.js');
    // Skeletons only for the first load; later searches keep the grid and
    // show a quiet status line.
    expect(picker).toContain('busy && items.length === 0');
    expect(picker).toContain('busy && items.length > 0');
    expect(picker).toContain('Searching…');
    // Opening counts as busy until the first response, so the empty message
    // cannot flash during the debounce window.
    expect(picker).toContain('const busy = loading || (open && !loadedOnce)');
    expect(picker).toContain('setLoadedOnce(true)');
  });

  it('carries the preview and dimensions from the picker to the payload', () => {
    const picker = read('components/media/GifPicker.js');
    // Thumbnails must use the small preview, not the full GIF.
    expect(picker).toContain('src={gif.preview || gif.url}');
    expect(picker).not.toContain('gif.previewUrl');
    // And the pick must include everything the attachment needs to reserve
    // its box: preview, width and height.
    expect(picker).toMatch(/preview: gif\.preview \|\| gif\.url/);
    expect(picker).toMatch(/picked\.width = Number\(gif\.width\)/);
    expect(picker).toMatch(/picked\.height = Number\(gif\.height\)/);
  });
});
