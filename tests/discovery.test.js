import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { validate } from '@/lib/validation/primitives';
import { eventSchema, opportunitySchema, searchQuerySchema } from '@/lib/validation/schemas';
import {
  monthGrid,
  monthLabel,
  monthParam,
  parseMonthParam,
  shiftMonth,
} from '@/components/campus/eventMeta';
import {
  EVENT_CATEGORIES,
  OPPORTUNITY_CATEGORIES,
  PERMISSION_KEYS,
  DEFAULT_STUDENT_PERMISSIONS,
  FEATURE_FLAG_KEYS,
  ROUTES,
  SEARCH_SCOPES,
} from '@/lib/constants';

/**
 * Discovery upgrades: calendar helpers, category vocabularies, search scope
 * and the permission/flag catalogue additions. The database side of the
 * catalogue is asserted by `npm run audit:db`; these tests pin the JS half.
 */

const goodEvent = {
  title: 'Robotics workshop',
  description: 'A hands-on evening with the robotics club kit.',
  starts_on: '2030-03-01',
  location: 'Main auditorium',
};

describe('event categories', () => {
  it('accepts a known category and rejects an unknown one', () => {
    expect(validate({ ...goodEvent, category: 'workshop' }, eventSchema).ok).toBe(true);
    expect(validate({ ...goodEvent }, eventSchema).ok).toBe(true);
    const bad = validate({ ...goodEvent, category: 'secret-rave' }, eventSchema);
    expect(bad.ok).toBe(false);
    expect(bad.errors.category).toBeTruthy();
  });

  it('matches the database CHECK constraint in migration 024', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261005000024_024_study_partners_and_discovery.sql'),
      'utf8',
    );
    for (const { value } of EVENT_CATEGORIES) expect(sql).toContain(`'${value}'`);
    expect(EVENT_CATEGORIES.map((c) => c.value)).toEqual(
      ['academic', 'cultural', 'sports', 'technical', 'workshop', 'club', 'placement', 'other'],
    );
  });
});

describe('opportunity categories', () => {
  const good = {
    title: 'Summer internship',
    organization: 'Acme Labs',
    description: 'A twelve-week software internship for pre-final students.',
  };

  it('accepts a known category and rejects an unknown one', () => {
    expect(validate({ ...good, category: 'internship' }, opportunitySchema).ok).toBe(true);
    expect(validate({ ...good }, opportunitySchema).ok).toBe(true);
    const bad = validate({ ...good, category: 'crypto-giveaway' }, opportunitySchema);
    expect(bad.ok).toBe(false);
    expect(bad.errors.category).toBeTruthy();
  });

  it('matches the database CHECK constraint in migration 024', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261005000024_024_study_partners_and_discovery.sql'),
      'utf8',
    );
    for (const { value } of OPPORTUNITY_CATEGORIES) expect(sql).toContain(`'${value}'`);
  });
});

describe('calendar helpers', () => {
  it('parses month params and falls back to the current month', () => {
    expect(parseMonthParam('2030-03')).toEqual({ year: 2030, month: 3 });
    expect(parseMonthParam('2030-13')).toEqual(parseMonthParam(null));
    expect(parseMonthParam('tomorrow')).toEqual(parseMonthParam(null));
    expect(parseMonthParam(null)).toEqual({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 });
  });

  it('shifts across year boundaries and formats params', () => {
    expect(shiftMonth(2030, 1, -1)).toEqual({ year: 2029, month: 12 });
    expect(shiftMonth(2030, 12, 1)).toEqual({ year: 2031, month: 1 });
    expect(monthParam(2030, 3)).toBe('2030-03');
    expect(monthLabel(2030, 3)).toContain('2030');
  });

  it('builds a six-week Monday-first grid containing the whole month', () => {
    const grid = monthGrid(2030, 3);
    expect(grid).toHaveLength(42);
    expect(new Set(grid).size).toBe(42);
    expect(grid).toContain('2030-03-01');
    expect(grid).toContain('2030-03-31');
    // 2030-03-01 is a Friday: with Monday-first weeks the grid starts on Mon 25 Feb.
    expect(grid[0]).toBe('2030-02-25');
    expect(new Date(`${grid[0]}T00:00:00Z`).getUTCDay()).toBe(1);
  });
});

describe('study search scope', () => {
  it('is a first-class scope with a label', () => {
    expect(SEARCH_SCOPES.map((scope) => scope.value)).toContain('study');
    expect(SEARCH_SCOPES.find((scope) => scope.value === 'study').label).toBe('Study & teams');
    expect(validate({ q: 'dbms', scope: 'study' }, searchQuerySchema).ok).toBe(true);
    expect(validate({ q: 'dbms', scope: 'nope' }, searchQuerySchema).ok).toBe(false);
  });
});

describe('study routes', () => {
  it('exposes the finder routes', () => {
    expect(ROUTES.study).toBe('/campus/study');
    expect(ROUTES.studyNew).toBe('/campus/study/new');
    expect(ROUTES.studyPost('abc')).toBe('/campus/study/abc');
  });

  it('ships the pages the routes promise', () => {
    for (const page of [
      'app/(shell)/(app)/campus/study/page.js',
      'app/(shell)/(app)/campus/study/new/page.js',
      'app/(shell)/(app)/campus/study/[id]/page.js',
      'app/(shell)/(app)/campus/events/new/page.js',
    ]) {
      expect(fs.existsSync(path.join(process.cwd(), page)), page).toBe(true);
    }
  });
});

describe('new permissions and flags', () => {
  it('catalogues the study and event-submission permissions for students', () => {
    for (const key of ['create_study_posts', 'submit_events']) {
      expect(PERMISSION_KEYS).toContain(key);
      expect(DEFAULT_STUDENT_PERMISSIONS).toContain(key);
    }
  });

  it('catalogues the study partners feature flag', () => {
    expect(FEATURE_FLAG_KEYS).toContain('study_partners');
  });

  it('seeds both in migration 024', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261005000024_024_study_partners_and_discovery.sql'),
      'utf8',
    );
    expect(sql).toContain('create_study_posts');
    expect(sql).toContain('submit_events');
    expect(sql).toContain('study_partners');
    expect(sql).toContain('study_partner_posts');
    expect(sql).toContain('row level security');
  });
});
