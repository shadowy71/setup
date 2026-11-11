import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FileUpload } from '@/components/storage/FileUpload';
import { IdentityMark } from '@/components/ui/surfaces';

describe('profile photo interface', () => {
  it('keeps selection locked and explains permission when uploads are disabled', () => {
    const html = renderToStaticMarkup(React.createElement(FileUpload, { username: 'alice', name: 'Alice', enabled: false, available: true }));
    expect(html).toContain('File uploads are currently available to selected contributors.');
    expect(html).toMatch(/type="file"[^>]*disabled/);
    expect(html).toContain('Choose photo');
  });
  it('renders the controlled picker for eligible users', () => {
    const html = renderToStaticMarkup(React.createElement(FileUpload, { username: 'alice', name: 'Alice', enabled: true, available: true }));
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).not.toMatch(/type="file"[^>]*disabled/);
  });
  it('uses a same-origin authenticated avatar and keeps initials fallback', () => {
    const html = renderToStaticMarkup(React.createElement(IdentityMark, { username: 'alice', name: 'Alice' }));
    expect(html).toContain('/api/storage/profile-photo/alice?v=0');
    expect(html).toContain('>A<img');
    expect(renderToStaticMarkup(React.createElement(IdentityMark, { name: 'Alice' }))).toContain('>A</span>');
  });
});
