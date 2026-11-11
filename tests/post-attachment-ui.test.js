import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftAttachments } from '@/components/posts/DraftAttachments';
import { FullImage, snapshotThumbnail } from '@/components/posts/PostAttachments';

afterEach(() => vi.unstubAllGlobals());
describe('post attachment presentation', () => {
  it('places an add files action next to the GIF control, with instructions hidden until its dialog opens', () => {
    const html = renderToStaticMarkup(React.createElement(DraftAttachments, {
      items: [], setItems: () => {}, disabled: false, busy: false, postId: null,
      submit: React.createElement('button', {type:'submit'}, 'Post'),
    }, React.createElement('button', {type:'button'}, 'GIF')));
    expect(html.indexOf('GIF')).toBeLessThan(html.indexOf('Add files'));
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Images or PDFs, up to eight');
    expect(html).toContain('<svg');
  });
  it('renders the existing thumbnail immediately underneath the full-quality image', () => {
    const html = renderToStaticMarkup(React.createElement(FullImage, {postId:'p',file:{id:'f',original_name:'wide.png'},preview:'data:image/webp;base64,preview'}));
    expect(html).toContain('data:image/webp;base64,preview');
    expect(html).toContain('/api/storage/posts/p/f');
    expect(html).toContain('Loading full-quality image');
    expect(html).toContain('object-contain');
    expect(html).not.toContain('object-cover');
  });
  it('copies displayed pixels without making another request, falling back safely', () => {
    const drawImage = vi.fn(); const toDataURL = vi.fn().mockReturnValue('data:image/webp;base64,preview');
    const canvas = { getContext: () => ({drawImage}), toDataURL };
    vi.stubGlobal('document', {createElement: vi.fn().mockReturnValue(canvas)});
    const image = {complete:true,naturalWidth:480,naturalHeight:240};
    expect(snapshotThumbnail(image)).toBe('data:image/webp;base64,preview');
    expect(canvas.width).toBe(480); expect(canvas.height).toBe(240); expect(drawImage).toHaveBeenCalledWith(image,0,0);
    expect(snapshotThumbnail({complete:false})).toBeNull();
    canvas.getContext = () => {throw Error('blocked');}; expect(snapshotThumbnail(image)).toBeNull();
  });
});
