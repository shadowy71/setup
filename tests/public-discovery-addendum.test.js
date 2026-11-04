import { describe, expect, it } from 'vitest';
import { eventCalendar } from '@/lib/discovery/calendar';
import { eventStartMs, relatedClubs, hasVerifiedRecruitment, upcomingRelatedEvents } from '@/lib/discovery/public';

const club = { id: '1', slug: 'coding', name: 'Coding', kind: 'club', status: 'published', visibility: 'public', club_category: 'Technical', organization_type: 'technical_club', directory_aliases: 'robotics, coding' };
const event = { id: '15fe0000-0000-4000-a000-000000000001', status: 'published', title: 'Robotics, workshop; fun', starts_on: '2026-11-20', start_time: '10:30:00', ends_on: '2026-11-20', end_time: '12:00:00', location: 'Hall A', description: 'Line one\r\nBEGIN:EVIL' };

describe('public discovery and calendar', () => {
  it('recommends deterministic public matches, excluding private and current clubs', () => {
    const rows = [
      { ...club, id: '2', slug: 'alpha' },
      { ...club, id: '3', slug: 'private', visibility: 'private' },
      { ...club, id: '4', slug: 'draft', status: 'draft' },
      { ...club, id: '5', slug: 'other', club_category: 'Sports', organization_type: 'sports_group', directory_aliases: '' },
      { ...club, id: '6', slug: 'alias', club_category: 'Arts', organization_type: 'creative_group', directory_aliases: 'robotics' },
      club,
    ];
    expect(relatedClubs(club, rows).map((c) => c.slug)).toEqual(['alpha', 'alias']);
    expect(relatedClubs(club, rows.slice().reverse()).map((c) => c.slug)).toEqual(['alpha', 'alias']);
  });
  it('does not infer recruiting from vague or closed text', () => {
    expect(hasVerifiedRecruitment({ admin_assigned: true, recruitment_info: 'Applications are open' })).toBe(true);
    for (const recruitment_info of ['', 'Contact the club', 'Not currently recruiting', 'Recruitment is closed', 'Applications are open but paused']) expect(hasVerifiedRecruitment({ admin_assigned: true, recruitment_info })).toBe(false);
    expect(hasVerifiedRecruitment({ admin_assigned: false, recruitment_info: 'Applications are open' })).toBe(false);
  });
  it('uses a valid start time and excludes cancelled, missing and expired starts', () => {
    expect(new Date(eventStartMs(event)).toISOString()).toBe('2026-11-20T05:00:00.000Z');
    expect(eventStartMs({ ...event, status: 'cancelled' })).toBeNull();
    expect(eventStartMs({ ...event, status: 'completed' })).toBeNull();
    expect(eventStartMs({ ...event, start_time: null })).toBeNull();
    expect(eventStartMs({ ...event, starts_on: '2026-02-30' })).toBeNull();
    expect(upcomingRelatedEvents([event, { ...event, id: 'second' }], event.id, Date.parse('2026-11-20T04:59:00Z'))).toHaveLength(1);
    expect(upcomingRelatedEvents([event], 'other', Date.parse('2026-11-20T05:01:00Z'))).toHaveLength(0);
  });
  it('generates an escaped, folded iCalendar in UTC without inventing times', () => {
    const ics = eventCalendar({ ...event, title: `${'अ'.repeat(45)}, fun` }, new Date('2026-11-01T00:00:00Z'));
    expect(ics).toContain('DTSTART:20261120T050000Z\r\n');
    expect(ics).toContain('DTEND:20261120T063000Z\r\n');
    expect(ics).toContain('DESCRIPTION:Line one\\nBEGIN:EVIL');
    expect(ics).not.toContain('\r\nBEGIN:EVIL');
    expect(ics.replace(/\r\n[ \t]/g, '')).toContain('\\, fun');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(eventCalendar({ ...event, start_time: null })).toBeNull();
    expect(eventCalendar({ ...event, status: 'draft' })).toBeNull();
    expect(eventCalendar({ ...event, ends_on: '2026-11-19' })).toBeNull();
    expect(eventCalendar({ ...event, end_time: null })).not.toContain('DTEND:');
  });
});
