/**
 * The rendered "Busiest right now" rail: the widths must come from the server's
 * trending score through the absolute log scale, and only a discussion at the
 * substantial-engagement benchmark gets a full (and subtly marked) bar.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HomeRail } from '@/components/home/HomeRail';

const row = (id, score, reaction_count = 0, comment_count = 0) => ({
  id, title: `Discussion ${id}`, body: 'body', reaction_count, comment_count, score,
});

describe('HomeRail render', () => {
  it('renders server scores as bounded widths', () => {
    const html = renderToStaticMarkup(React.createElement(HomeRail, {
      trending: [row('a', 1.986, 2, 0), row('b', 0.993, 1, 0), row('c', 0, 0, 0)],
    }));
    expect(html).toContain('width:34%');
    expect(html).toContain('width:21%');
    expect(html).toContain('width:0%');
    expect(html).not.toContain('width:100%');
    expect(html).toContain('Busiest right now');
  });

  it('marks only benchmark-level discussions as hot', () => {
    const html = renderToStaticMarkup(React.createElement(HomeRail, {
      trending: [row('peak', 26, 26, 0), row('low', 2, 2, 0)],
    }));
    expect(html).toContain('data-hot="true"');
    expect(html).toContain('width:100%');
    expect(html).toContain('width:34%');
  });
});
