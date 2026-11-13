import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui', () => ({
  Button: ({ children, icon, ...props }) => React.createElement('button', { ...props, 'data-icon': icon }, children),
  Modal: ({ open, title, description, footer, children }) => open
    ? React.createElement('section', { role: 'dialog', 'aria-label': title, 'data-description': description }, children, footer)
    : null,
}));

import {
  ATTACHMENT_MAX_BYTES,
  AttachmentDropzone,
  AttachmentPreview,
  attachmentRejectionMessage,
  validateAttachmentSelection,
} from '@/components/posts/DraftAttachments';

const file = (name, type, size = 1024) => ({ name, type, size });

describe('attachment popup', () => {
  it('offers a styled dropzone with the picker, the promise, the limits and no browser file chrome', () => {
    const html = renderToStaticMarkup(React.createElement(AttachmentDropzone, { imagesOnly: true, maxItems: 8, remaining: 8 }));
    expect(html).toContain('Drag and drop your photos here');
    expect(html).toContain('Share your moments with your campus community.');
    expect(html).toContain('Choose from device');
    expect(html).toContain('JPEG, PNG or WebP · Maximum 3 MB per image · Up to 8 images.');
    // The native control stays in the DOM for accessibility, never for looks.
    expect(html).toContain('type="file"');
    expect(html).toContain('multiple=""');
    expect(html).toContain('image/jpeg,image/png,image/webp');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain('class="sr-only"');
    expect(html).toContain('attach-drop__cta');
  });

  it('accepts PDFs only where the scope allows them', () => {
    const images = renderToStaticMarkup(React.createElement(AttachmentDropzone, { imagesOnly: true }));
    const files = renderToStaticMarkup(React.createElement(AttachmentDropzone, { imagesOnly: false }));
    expect(images).not.toContain('application/pdf');
    expect(files).toContain('application/pdf');
    expect(files).toContain('JPEG, PNG, WebP or PDF');
  });

  it('stops offering a dropzone at capacity and says what to do', () => {
    const html = renderToStaticMarkup(React.createElement(AttachmentDropzone, { imagesOnly: true, maxItems: 8, remaining: 0 }));
    expect(html).not.toContain('type="file"');
    expect(html).toContain('8 photos added. Remove one to add another.');
  });

  it('separates what can be added from unsupported, oversized and surplus files', () => {
    const result = validateAttachmentSelection(
      [file('a.jpg', 'image/jpeg'), file('notes.txt', 'text/plain'), file('big.png', 'image/png', ATTACHMENT_MAX_BYTES + 1), file('b.webp', 'image/webp')],
      { imagesOnly: true, remaining: 8 },
    );
    expect(result.accepted.map((item) => item.name)).toEqual(['a.jpg', 'b.webp']);
    expect(result.rejected).toEqual([
      { name: 'notes.txt', reason: 'type' },
      { name: 'big.png', reason: 'size' },
    ]);
    expect(validateAttachmentSelection([file('c.pdf', 'application/pdf')], { imagesOnly: true }).rejected).toEqual([
      { name: 'c.pdf', reason: 'type' },
    ]);
    expect(validateAttachmentSelection([file('c.pdf', 'application/pdf')], { imagesOnly: false }).accepted).toHaveLength(1);
  });

  it('counts the remaining slots rather than dropping a whole selection', () => {
    const result = validateAttachmentSelection([file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg'), file('c.jpg', 'image/jpeg')], { remaining: 2 });
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toEqual([{ name: 'c.jpg', reason: 'limit' }]);
  });

  it('explains a refused file in plain language', () => {
    expect(attachmentRejectionMessage([{ name: 'notes.txt', reason: 'type' }], { imagesOnly: true })).toBe('notes.txt is not a JPEG, PNG or WebP image.');
    expect(attachmentRejectionMessage([{ name: 'big.png', reason: 'size' }], { imagesOnly: true })).toBe('big.png is larger than 3 MB.');
    expect(attachmentRejectionMessage([{ name: 'a.pdf', reason: 'type' }], { imagesOnly: false })).toBe('a.pdf is not an image or PDF.');
    expect(attachmentRejectionMessage([{ name: 'c.jpg', reason: 'limit' }], { imagesOnly: true, remaining: 2 })).toBe('Only 2 more photos could be added.');
    expect(attachmentRejectionMessage([{ name: 'c.jpg', reason: 'limit' }], { imagesOnly: true, remaining: 0, maxItems: 8 })).toBe('Up to 8 photos can be added. Remove one to add another.');
    expect(attachmentRejectionMessage([])).toBe('');
  });

  it('renders a proportional preview grid with a count and per-image removal', () => {
    const items = [
      { id: '1', file: file('wide.jpg', 'image/jpeg'), preview: 'blob:1', progress: 0 },
      { id: '2', file: file('tall.jpg', 'image/jpeg'), preview: 'blob:2', progress: 40 },
      { id: '3', file: file('notes.pdf', 'application/pdf'), preview: null, progress: 0 },
    ];
    const html = renderToStaticMarkup(React.createElement(AttachmentPreview, {
      items, imagesOnly: false, maxItems: 8, onRemove: () => {}, onMove: () => {},
    }));
    expect(html).toContain('3');
    expect(html).toContain('of 8 files selected');
    expect(html).toContain('data-count="3"');
    expect(html).toContain('wide.jpg');
    expect(html).toContain('notes.pdf');
    // Images keep their proportions; the tile is a well, not a crop.
    expect(html).toContain('attach-tile__img');
    expect(html).toContain('aria-label="Remove wide.jpg"');
    expect(html).not.toContain('cover photo');
    expect(html).toContain('--attach-progress:40%');
  });

  it('marks the cover only in image-only scopes', () => {
    const items = [
      { id: '1', file: file('first.jpg', 'image/jpeg'), preview: 'blob:1' },
      { id: '2', file: file('next.png', 'image/png'), preview: 'blob:2' },
    ];
    const html = renderToStaticMarkup(React.createElement(AttachmentPreview, {
      items, imagesOnly: true, onMove: () => {}, onRemove: () => {},
    }));
    expect(html).toContain('attach-tile__cover');
    expect(html).toContain('aria-label="Make next.png the cover photo"');
  });

  it('accepts the exact byte boundary and rejects empty files explicitly', () => {
    const result = validateAttachmentSelection([
      file('boundary.png', 'image/png', ATTACHMENT_MAX_BYTES),
      file('empty.jpg', 'image/jpeg', 0),
    ], { imagesOnly: true });
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toEqual([{ name: 'empty.jpg', reason: 'empty' }]);
    expect(attachmentRejectionMessage(result.rejected)).toContain('empty.jpg is empty.');
  });

  it('never offers reordering to a published post', () => {
    const items = [{ id: '1', file: file('wide.jpg', 'image/jpeg'), preview: 'blob:1', progress: 100 }];
    const html = renderToStaticMarkup(React.createElement(AttachmentPreview, {
      items, postId: 'post-id', onRemove: () => {}, onMove: () => {},
    }));
    expect(html).not.toContain('Remove wide.jpg');
    expect(html).not.toContain('cover photo');
  });

  it('renders nothing when no image has been chosen', () => {
    expect(renderToStaticMarkup(React.createElement(AttachmentPreview, { items: [] }))).toBe('');
  });
});
