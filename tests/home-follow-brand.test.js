import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/actions/follows', () => ({ setFollowing: vi.fn() }));
vi.mock('@/components/social/ReportDialog', () => ({ ReportDialog: () => null }));
vi.mock('@/components/posts/ReactionBar', () => ({ ReactionBar: () => null }));
vi.mock('@/components/posts/PostActions', () => ({ PostActions: () => null }));

const { PostCard } = await import('@/components/posts/PostCard');

const post = {
  id: 'post-1', author_id: 'author-1', author_username: 'student',
  author_display_name: 'Student', following_by_me: false,
  created_at: '2026-11-01T00:00:00Z', kind: 'post', body: 'Hello campus',
};

describe('home feed follow controls', () => {
  it('can hide follow on home cards without removing it elsewhere', () => {
    const render = (showFollow) => renderToStaticMarkup(React.createElement(PostCard, { post, currentUserId: 'viewer', showFollow }));
    expect(render(false)).not.toContain('Follow @student');
    expect(render(true)).toContain('Follow @student');
  });

  it('hides follow for both home feed modes', () => {
    for (const file of ['components/home/StreamItem.js', 'components/home/FollowingFeed.js']) {
      expect(readFileSync(file, 'utf8')).toContain('showFollow={false}');
    }
  });
});

describe('mobile header wordmark', () => {
  it('keeps the full word visible and makes space on narrow screens', () => {
    const css = readFileSync('app/styles/header-glass.css', 'utf8');
    expect(css).toMatch(/\.shell-header \.brand-word\s*\{[^}]*text-overflow:\s*clip/s);
    expect(css).toMatch(/@media \(max-width: 380px\)[\s\S]*?\.shell-header \.brand-mark\s*\{\s*display:\s*none/);
    expect(css).not.toMatch(/\.shell-header \.brand-word\s*\{\s*display:\s*none/);
  });
});
