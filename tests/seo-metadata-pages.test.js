import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ club: null, event: null }));
vi.mock('@/lib/data/public', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, getPublicClubBySlug: async () => ({ item: fixture.club }), getPublicEventById: async () => ({ item: fixture.event }), getPublicClubIdentityById: async () => ({ item: fixture.club }) };
});

const { generateMetadata: clubPageMetadata } = await import('@/app/(public)/c/[slug]/page');
const { generateMetadata: eventPageMetadata } = await import('@/app/(public)/campus/events/[id]/page');
const { generateMetadata: clubDirectoryMetadata } = await import('@/app/(public)/clubs/page');
const { generateMetadata: eventDirectoryMetadata } = await import('@/app/(public)/campus/events/page');
const id = '15fe0000-0000-4000-a000-000000000001';

describe('public page metadata boundaries', () => {
  beforeEach(() => { fixture.club = null; fixture.event = null; });
  it('indexes only the unfiltered directory variants', async () => {
    for (const generate of [clubDirectoryMetadata, eventDirectoryMetadata]) {
      expect((await generate({ searchParams: Promise.resolve({}) })).robots.index).toBe(true);
      const filtered = await generate({ searchParams: Promise.resolve({ q: 'robotics' }) });
      expect(filtered.robots.index).toBe(false);
      expect(filtered.robots.follow).toBe(true);
      expect(filtered.alternates.canonical).toBeTruthy();
    }
  });
  it('never exposes unknown, unpublished or private club names', async () => {
    const props = { params: Promise.resolve({ slug: 'test-club' }) };
    expect((await clubPageMetadata(props)).robots.index).toBe(false);
    fixture.club = { kind: 'club', status: 'draft', visibility: 'public', slug: 'test-club', name: 'Secret draft' };
    expect(JSON.stringify(await clubPageMetadata(props))).not.toContain('Secret draft');
    fixture.club = { ...fixture.club, status: 'published', visibility: 'private' };
    expect(JSON.stringify(await clubPageMetadata(props))).not.toContain('Secret draft');
    fixture.club = { ...fixture.club, visibility: 'public', description: 'Public description' };
    expect((await clubPageMetadata(props)).alternates.canonical).toBe('/c/test-club');
  });
  it('never exposes unpublished or unknown event names or private organizer details', async () => {
    const props = { params: Promise.resolve({ id }) };
    expect((await eventPageMetadata(props)).robots.index).toBe(false);
    fixture.event = { id, title: 'Secret event', status: 'draft', club_id: 'x' };
    expect(JSON.stringify(await eventPageMetadata(props))).not.toContain('Secret event');
    fixture.event = { ...fixture.event, status: 'published', title: 'Public event', starts_on: '2026-11-20' };
    fixture.club = { kind: 'club', status: 'published', visibility: 'private', name: 'Secret club', slug: 'secret' };
    const meta = await eventPageMetadata(props);
    expect(meta.robots.index).toBe(true);
    expect(JSON.stringify(meta)).not.toContain('Secret club');
    expect(meta.alternates.canonical).toBe(`/campus/events/${id}`);
    expect((await eventPageMetadata({ params: Promise.resolve({ id: 'invalid' }) })).robots.index).toBe(false);
  });
});
