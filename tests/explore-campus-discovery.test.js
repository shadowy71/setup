import { describe, expect, it } from 'vitest';
import { publicClubs, selectClubs, upcomingEvents, interestLinks } from '@/lib/explore/campus-discovery';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CampusDiscovery } from '@/components/explore/CampusDiscovery';

const club = { id: '15fe0000-0000-4000-a000-000000000001', kind: 'club', status: 'published', visibility: 'public', slug: 'coding-club', name: 'Coding Club', club_category: 'Technical', organization_type: 'technical_club', description: 'Programming and robotics', recruitment_info: 'Applications closed', directory_aliases: 'robotics', member_count: 2 };
const event = { id: '15fe0000-0000-4000-a000-000000000002', title: 'Workshop', status: 'published', starts_on: '2026-11-05', start_time: '10:00', location: 'Lab', club_id: club.id };
const props = { clubs: [club], recruitment: [club], events: [event], hosts: new Map([[club.id, club]]), interests: interestLinks([club]) };

describe('Explore campus discovery', () => {
  it('only selects published public clubs with canonical slugs and varies categories', () => {
    const sports = { ...club, slug: 'sports-club', club_category: 'Sports' };
    const clubs = publicClubs([club, { ...club, slug: 'other-club' }, sports, { ...club, visibility: 'private' }, { ...club, status: 'draft' }, { ...club, slug: null }]);
    expect(clubs).toHaveLength(3);
    expect(selectClubs(clubs, 2).map((item) => item.slug)).toEqual(['coding-club', 'sports-club']);
  });
  it('keeps future published events, excluding drafts, cancellations and uncertain same-day times', () => {
    const now = Date.parse('2026-11-04T12:00:00Z');
    expect(upcomingEvents([event, { ...event, status: 'draft' }, { ...event, status: 'cancelled' }, { ...event, starts_on: '2026-11-04', start_time: null }, { ...event, starts_on: '2026-02-30' }], now)).toEqual([event]);
    expect(upcomingEvents([{ ...event, start_time: null }], now)).toHaveLength(1);
    expect(upcomingEvents([event], Date.parse('2026-11-05T05:00:00Z'))).toHaveLength(0);
  });
  it('uses supported category, type and real searchable terms for shortcuts', () => {
    const links = interestLinks([club]);
    expect(links).toContainEqual({ label: 'Technical', href: '/clubs?category=Technical' });
    expect(links).toContainEqual({ label: 'Technical club', href: '/clubs?type=technical_club' });
    expect(links).toContainEqual({ label: 'Robotics', href: '/clubs?q=Robotics' });
    expect(links.some((item) => item.label === 'Cybersecurity')).toBe(false);
  });
  it('renders canonical links and labels recruitment as unconfirmed', () => {
    const html = renderToStaticMarkup(createElement(CampusDiscovery, props));
    expect(html).toContain('href="/c/coding-club"');
    expect(html).toContain(`href="/campus/events/${event.id}"`);
    expect(html).toContain('Hosted by Coding Club');
    expect(html).toContain('Applications closed');
    expect(html).toContain('do not confirm applications are open');
    expect(html).not.toContain('>Recruiting<');
  });
  it('distinguishes empty and unavailable public collections', () => {
    const html = renderToStaticMarkup(createElement(CampusDiscovery, { clubs: [], recruitment: [], events: [], hosts: new Map(), interests: [], clubsUnavailable: true, recruitmentUnavailable: false, eventsUnavailable: true }));
    expect(html).toContain('Clubs are temporarily unavailable.');
    expect(html).toContain('No public recruitment information is available yet.');
    expect(html).toContain('Events are temporarily unavailable.');
  });
});
