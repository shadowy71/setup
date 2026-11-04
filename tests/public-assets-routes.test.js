import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ club: null, event: null, unavailable: false }));
vi.mock('@/lib/data/public', async (original) => ({ ...(await original()), getPublicClubBySlug: async () => ({ item: fixture.club, unavailable: fixture.unavailable }), getPublicEventById: async () => ({ item: fixture.event, unavailable: fixture.unavailable }), getPublicClubIdentityById: async () => ({ item: fixture.club }) }));
vi.mock('next/og', () => ({ ImageResponse: class { constructor(element, options) { this.element = element; this.options = options; this.status = 200; } } }));
const { GET: clubImage } = await import('@/app/api/public/club-image/[slug]/route');
const { GET: eventImage } = await import('@/app/api/public/event-image/[id]/route');
const { GET: calendar } = await import('@/app/api/public/event-calendar/[id]/route');
const id = '15fe0000-0000-4000-a000-000000000001';
const event = { id, title: 'Workshop', status: 'published', starts_on: '2026-11-20', start_time: '10:30' };
const props = (key, value) => ({ params: Promise.resolve({ [key]: value }) });

describe('anonymous share assets', () => {
  beforeEach(() => { fixture.club = null; fixture.event = null; fixture.unavailable = false; });
  it('returns a club image only for published public clubs', async () => {
    fixture.club = { id, slug: 'coding', name: 'Coding Club', kind: 'club', status: 'draft', visibility: 'public' };
    expect((await clubImage(null, props('slug', 'coding'))).status).toBe(404);
    fixture.club.status = 'published'; fixture.club.visibility = 'private';
    expect((await clubImage(null, props('slug', 'coding'))).status).toBe(404);
    fixture.club.visibility = 'public';
    const image = await clubImage(null, props('slug', 'coding'));
    expect(image.status).toBe(200);
    expect(image.options.width).toBe(1200);
    expect(image.options.headers['Cache-Control']).toBe('no-store');
    expect(image.element.props.title).toBe('Coding Club');
    expect((await clubImage(null, props('slug', 'bad!'))).status).toBe(404);
  });
  it('never returns a draft, cancelled event or its calendar', async () => {
    for (const status of ['draft', 'cancelled', 'completed']) {
      fixture.event = { ...event, status };
      expect((await eventImage(null, props('id', id))).status).toBe(404);
      expect((await calendar(null, props('id', id))).status).toBe(404);
    }
    fixture.event = event;
    const image = await eventImage(null, props('id', id));
    expect(image.status).toBe(200);
    expect(image.element.props.title).toBe('Workshop');
    const response = await calendar(null, props('id', id));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/calendar');
    expect(await response.text()).toContain('DTSTART:20261120T050000Z');
  });
});
