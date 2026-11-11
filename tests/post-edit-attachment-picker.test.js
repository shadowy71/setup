import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/components/ui', () => ({
  Button: ({ children, icon, ...props }) => React.createElement('button', { ...props, 'data-icon': icon }, children),
  Modal: ({open, title, description, children}) => open ? React.createElement('section', { role:'dialog', 'aria-label': title }, React.createElement('p', null, description), children) : null,
}));
import { EditAttachmentPicker } from '@/components/posts/PostAttachments';
const base = { disabled:false, onOpen:vi.fn(), onClose:vi.fn(), onChoose:vi.fn() };
describe('post editor attachment picker', () => {
  it('shows the paperclip add-files button without the file input or limit text before opening', () => {
    const html = renderToStaticMarkup(React.createElement(EditAttachmentPicker, {...base, open:false}));
    expect(html).toContain('Add files'); expect(html).toContain('data-icon="paperclip"');
    expect(html).toContain('aria-expanded="false"'); expect(html).not.toContain('type="file"'); expect(html).not.toContain('3 MiB');
  });
  it('shows the limits, multiple file input and errors inside the popup', () => {
    const html = renderToStaticMarkup(React.createElement(EditAttachmentPicker, {...base, open:true,error:'A post can have up to eight attachments.'}));
    expect(html).toContain('role="dialog"'); expect(html).toContain('Images or PDFs, up to eight (3 MiB each).');
    expect(html).toContain('type="file"'); expect(html).toContain('multiple'); expect(html).toContain('application/pdf'); expect(html).toContain('role="alert"');
  });
  it('disables the action and picker while an upload is in progress', () => {
    const html = renderToStaticMarkup(React.createElement(EditAttachmentPicker, {...base, open:true,disabled:true}));
    expect((html.match(/disabled=""/g) || [])).toHaveLength(2);
  });
});
