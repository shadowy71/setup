import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import RetroErrorPage from '@/components/feedback/RetroErrorPage';
import { PROXY_ROUTES, isKnownRoute } from '@/lib/auth/proxy-routes';

vi.mock('next/link', () => ({ default: ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children) }));

function appRoutes(dir = 'app', parts = []) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return appRoutes(path.join(dir, entry.name), entry.name.startsWith('(') ? parts : [...parts, entry.name]);
    return /^(page|route)\.(js|jsx|ts|tsx)$/.test(entry.name) ? ['/' + parts.join('/')] : [];
  });
}

describe('retro error experience', () => {
  it('renders distinct accessible 404 and runtime messages', () => {
    const missing = renderToStaticMarkup(React.createElement(RetroErrorPage));
    expect(missing).toContain('This page went off the air.');
    expect(missing).toContain('NOT FOUND');
    expect(missing).toContain('href="/"');
    expect(missing).toContain('aria-hidden="true"');
    const error = renderToStaticMarkup(React.createElement(RetroErrorPage, { runtime: true, reset: () => {} }));
    expect(error).toContain('SIGNAL LOST');
    expect(error).toContain('Something went wrong.');
    expect(error).not.toContain('404');
    expect(error).toContain('Retry');
  });
  it('wires Retry directly to reset', () => {
    const reset = vi.fn();
    const tree = RetroErrorPage({ runtime: true, reset });
    const copy = tree.props.children[2];
    const button = copy.props.children.find((child) => child?.type === 'button');
    button.props.onClick();
    expect(reset).toHaveBeenCalledOnce();
  });
  it('keeps the proxy inventory in sync with every app page and handler', () => {
    expect([...PROXY_ROUTES].sort()).toEqual(appRoutes().sort());
  });
  it('matches protected static and dynamic routes without swallowing unknown paths', () => {
    for (const route of ['/home', '/clubs/new', '/clubs/x/manage', '/campus/events/new', '/post/bad', '/explore/resources/x']) expect(isKnownRoute(route), route).toBe(true);
    for (const route of ['/no-such-page', '/home/no-such-page', '/clubs/x/manage/unknown', '/campus/events/x/unknown']) expect(isKnownRoute(route), route).toBe(false);
  });
});
