import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StorageHealth } from '@/components/admin/StorageHealth';
import { Input } from '@/components/ui/fields';

describe('storage administrative interface', () => {
  it('describes the health check without implying uploads work', () => {
    const html = renderToStaticMarkup(React.createElement(StorageHealth));
    expect(html).toContain('Check upload storage connectivity');
    expect(html).toContain('Backups use a separate connection');
    expect(html).not.toContain('GOOGLE_APPS_SCRIPT');
  });
  it('rejects file types in the generic input, including dynamic case variants', () => {
    expect(() => renderToStaticMarkup(React.createElement(Input, { type: 'FILE' }))).toThrow('dedicated upload component');
    expect(renderToStaticMarkup(React.createElement(Input, { type: 'text' }))).toContain('type="text"');
  });
});
