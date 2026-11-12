import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NOTICE_CATEGORIES, ROUTES } from '@/lib/constants';
import { PROXY_ROUTES } from '@/lib/auth/proxy-routes';
import { getNoticeArchiveEntry, listNoticeArchive } from '@/lib/data/campus';
import { ContentCard } from '@/components/content/ContentCard';
import { NoticeArchiveList, NoticeArchiveRecord, NoticeboardViews } from '@/components/campus/NoticeArchive';
import { DATE_UNAVAILABLE, formatDate, formatRecordDate } from '@/lib/utils';

/**
 * The noticeboard archive.
 *
 * Three things are pinned here, because each is a way the archive could go
 * wrong without any query failing:
 *
 *   1. the imported content: 64 records with their exact titles, a real
 *      description each, and nothing the brief did not supply (no figures on
 *      the placement records, no links, no dates or venues);
 *   2. the boundary with current notices: the archive reads only
 *      `status = 'archived'` records that are registered, the noticeboard reads
 *      only `published`, and the two are never merged;
 *   3. the presentation: full text, labelled as archive, no image;
 *   4. the dates: only what the original posters give. An exact date is kept
 *      and shown in full; a year alone is stored as a flagged 1 January
 *      placeholder and shown as the year; a record with neither says
 *      "Date unavailable". No date decides what is current.
 */

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const SCHEMA_SQL = read('supabase/migrations/20261112000026_072_notice_archive.sql');
const IMPORT_SQL = read('supabase/migrations/20261112000027_073_pccoe_noticeboard_archive.sql');
const RETURN_SQL = read('supabase/migrations/20261112000029_075_return_pccoe_noticeboard_to_archive.sql');
const DATE_SCHEMA_SQL = read('supabase/migrations/20261112000030_076_notice_archive_dates.sql');
const DATES_SQL = read('supabase/migrations/20261112000031_077_pccoe_noticeboard_dates.sql');

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');
const SEP = '\x1f';
const html = (node) => renderToStaticMarkup(React.createElement(React.Fragment, null, node));
/** SQL with `--` comments removed, so prose about a statement is not mistaken for one. */
const statements = (sql) => sql.replace(/--[^\n]*/g, '');

// Titles exactly as supplied, section by section, in the supplied order.
const TITLES = {
  'itsa': [
    "AI Workshop",
    "Induction '25",
    "TechPulse-2K25",
    "TechRoom 2.0",
    "Teacher's Day",
    "SWC Meditation",
    "Abhidnya 2.0 Bruteforge",
    "Akshardhara",
    "PRAXIS",
    "INNOVEDA '24",
    "Farewell '25",
    "Induction '24",
  ],
  'mlsc': [
    "Datathon",
    "Miniscape",
    "BlueBit 4.0",
    "TechRoom",
    "Project Development",
    "Problemathon",
    "AIQuest",
    "AI Canvas",
    "Recurring MLSC Sessions",
  ],
  'ieee': [
    "Invent Pitch",
    "Membership Drive",
    "IoT Workshop",
    "Resume Building / Interview Skills",
    "IEEE Awards and Achievements",
  ],
  'higher-studies': [
    "GRE Readiness",
    "Mock GATE",
    "Higher Education Lecture on AI",
    "Alumni Information",
  ],
  'nss-isr': [
    "Campus and Environmental Drives",
    "Donation Initiatives",
    "E-Waste Collection",
    "Energy Conservation",
    "Waste Segregation",
    "Road Safety Awareness",
    "Anti-Drug Awareness",
  ],
  'entrepreneurship-innovation': [
    "Expert Talks",
    "Entrepreneurship Sessions",
    "Intellectual Property Awareness",
    "Technology Readiness Level (TRL) Sessions",
    "Investment-Related Sessions",
    "Crowdfunding Awareness",
    "AI-Related Webinars",
  ],
  'art-circle': [
    "Firodiya Karandak 2024",
    "Firodiya Karandak 2026",
    "Vinodattam",
    "DHC-4",
    "Akshardhara",
    "Social Activity Workshop",
    "Diya Painting",
    "Digital Poster / Drawing Competition",
    "Kavi Sammelan",
    "Swartarang",
  ],
  'sports': [
    "Sports Achievements",
  ],
  'alphabyte-hackathon': [
    "Alphabyte Hackathon — Student Achievement",
  ],
  'placement': [
    "Placement Overview — AY 2022–23",
    "Placement Overview — AY 2023–24",
    "Placement Overview — AY 2024–25",
    "Placement Overview — AY 2025–26",
  ],
  'departmental': [
    "Teaching and Learning Activities",
    "Student Projects",
    "Pedagogy and Academic Practices",
    "Departmental Academic Showcase",
  ],
};

const manifest = JSON.parse(/\$json\$(\[[\s\S]*?\])\$json\$/.exec(IMPORT_SQL)[1]);
const entries = manifest.flatMap((section) => section.entries.map((entry) => ({ ...entry, section: section.key })));
const bySection = (key) => entries.filter((entry) => entry.section === key);

describe('noticeboard archive import (migration 073)', () => {
  it('holds every supplied entry once, under its exact title, in order', () => {
    expect(manifest.map((section) => section.key)).toEqual(Object.keys(TITLES));
    for (const section of manifest) {
      expect(section.entries.map((entry) => entry.title), section.key).toEqual(TITLES[section.key]);
    }
    expect(entries).toHaveLength(64);
    expect(new Set(entries.map((entry) => `${entry.section}/${entry.slug}`)).size).toBe(64);
  });

  it('keeps years in titles and leaves SWC and DHC-4 unexpanded', () => {
    const titles = entries.map((entry) => entry.title);
    for (const title of [
      "Induction '25", 'TechPulse-2K25', "INNOVEDA '24", "Farewell '25", "Induction '24",
      'Firodiya Karandak 2024', 'Firodiya Karandak 2026', 'SWC Meditation', 'DHC-4',
    ]) {
      expect(titles).toContain(title);
    }
    for (const entry of entries) {
      expect(`${entry.title} ${entry.body}`, entry.slug).not.toMatch(/\b(SWC|DHC-4)\s*\(/);
    }
  });

  it('gives every record a real description, never a title or a one-line placeholder', () => {
    for (const entry of entries) {
      expect(entry.title.length, entry.slug).toBeGreaterThanOrEqual(3);
      expect(entry.title.length, entry.slug).toBeLessThanOrEqual(140);
      expect(entry.body.length, entry.slug).toBeGreaterThanOrEqual(120);
      expect(entry.body.length, entry.slug).toBeLessThanOrEqual(4000);
      expect(entry.body.split(/\s+/).length, entry.slug).toBeGreaterThanOrEqual(15);
      expect(entry.body.trim(), entry.slug).not.toBe(entry.title);
      expect(entry.body, entry.slug).toMatch(/[.!?]$/);
    }
  });

  it('stores the text exactly as supplied: every digest matches its fields', () => {
    for (const section of manifest) {
      expect(
        md5([
          section.key, section.label, section.organization, section.attribution,
          section.match_keys.join('|'), section.match_names.join('|'),
        ].join(SEP)),
        section.key,
      ).toBe(section.digest);
    }
    for (const entry of entries) {
      expect(
        md5([
          entry.section, entry.slug, entry.title, entry.source_category, entry.category,
          entry.period || '', entry.note || '', entry.body,
        ].join(SEP)),
        `${entry.section}/${entry.slug}`,
      ).toBe(entry.digest);
    }
  });

  it('maps each source category onto a real notice category and never marks history as important', () => {
    const allowed = NOTICE_CATEGORIES.map((category) => category.value).filter((value) => value !== 'important');
    for (const entry of entries) {
      expect(allowed, entry.slug).toContain(entry.category);
      expect(entry.source_category.length, entry.slug).toBeGreaterThan(1);
    }
    // One source wording always maps to one category.
    const mapping = new Map();
    for (const entry of entries) {
      if (mapping.has(entry.source_category)) expect(mapping.get(entry.source_category)).toBe(entry.category);
      mapping.set(entry.source_category, entry.category);
    }
    expect(mapping.size).toBe(21);
  });

  it('keeps sports to one archive-level record', () => {
    const sports = bySection('sports');
    expect(sports).toHaveLength(1);
    expect(sports[0].title).toBe('Sports Achievements');
    expect(sports[0].note).toMatch(/were not preserved/);
    expect(sports[0].body).not.toMatch(/\d/);
  });

  it('keeps four placement records, one per academic year, with no figures', () => {
    const placement = bySection('placement');
    expect(placement.map((entry) => entry.period)).toEqual(['AY 2022–23', 'AY 2023–24', 'AY 2024–25', 'AY 2025–26']);
    for (const entry of placement) {
      expect(entry.title).toBe(`Placement Overview — ${entry.period}`);
      // The academic year is the only number a placement record may carry.
      const withoutYear = entry.body.replace(entry.period.replace('AY ', ''), '');
      expect(withoutYear, entry.slug).not.toMatch(/\d/);
      expect(entry.body, entry.slug).not.toMatch(/%|₹|\b(LPA|CTC|lakh|crore|package|highest|average|median|offers?|recruiters?)\b/i);
      expect(entry.note).toBe('Exact numerical statistics were not retained. This entry is not a numerical placement report.');
    }
  });

  it('carries a period only where the record itself states that year', () => {
    const dated = entries.filter((entry) => entry.period);
    expect(dated).toHaveLength(11);
    for (const entry of dated) {
      expect(entry.period, entry.slug).toMatch(/^(\d{4}|AY \d{4}–\d{2})$/);
      expect(entry.body, entry.slug).toContain(entry.period.replace('AY ', ''));
    }
    // A year is a label. Nothing in the batch is a calendar date or a time.
    for (const entry of entries) {
      const text = `${entry.title} ${entry.body} ${entry.note || ''}`;
      expect(text, entry.slug).not.toMatch(/\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);
      expect(text, entry.slug).not.toMatch(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?(am|pm)\b/i);
    }
  });

  it('adds no link, address, handle or attachment to any record', () => {
    for (const entry of entries) {
      const text = `${entry.title} ${entry.body} ${entry.note || ''}`;
      expect(text, entry.slug).not.toMatch(/https?:|www\.|@|\.(com|org|in|io|edu)\b|bit\.ly|forms\.gle/i);
      expect(text, entry.slug).not.toMatch(/\.(png|jpe?g|webp|gif|pdf)\b|\[image|\bplaceholder\b/i);
    }
  });

  it('attributes four sections to the institution and never links those to a club', () => {
    const institutional = manifest.filter((section) => section.attribution === 'institution');
    expect(institutional.map((section) => section.key)).toEqual(['sports', 'alphabyte-hackathon', 'placement', 'departmental']);
    for (const section of institutional) expect(section.organization).toBe('PCCOE');
    expect(manifest.filter((section) => section.attribution === 'organization')).toHaveLength(7);
    expect(statements(IMPORT_SQL)).toContain("where v_section.attribution = 'organization'");
  });

  it('writes archived notices and their provenance, and nothing else', () => {
    const sql = statements(IMPORT_SQL);
    const targets = [...sql.matchAll(/insert\s+into\s+([a-z_.]+)/gi)].map((match) => match[1]);
    expect(targets).toEqual(['public.notices', 'public.notice_archive_entries']);
    expect(sql).not.toMatch(/\b(update|delete\s+from|truncate|alter|drop|create|grant|revoke)\b/i);
    expect(sql).not.toMatch(/disable\s+trigger|session_replication_role|row_security|storage\./i);
    expect(sql).toMatch(/'normal', false, 'archived', c_publisher/);
    // Never pinned, never expiring, never stamped as published: none of those
    // columns is written, so each keeps its default.
    const columns = /insert into public\.notices \(([^)]*)\)/.exec(sql)[1].split(',').map((name) => name.trim());
    expect(columns).toEqual(['title', 'body', 'category', 'importance', 'pinned', 'status', 'created_by']);
  });

  it('is keyed by a deterministic source identifier and skips keys that are already registered', () => {
    const sql = statements(IMPORT_SQL);
    expect(sql).toContain("c_batch        constant text := 'pccoe-noticeboard-2026-11';");
    expect(sql).toContain("c_publisher    constant uuid := 'fc79f76a-3355-4788-bbf8-3e6d529ff957';");
    expect(sql).toContain("v_key := c_batch || '/' || v_section.key || '/' || v_entry.slug;");
    expect(sql).toMatch(/if exists \(select 1 from public\.notice_archive_entries where source_key = v_key\) then\s+v_present := v_present \+ 1;\s+continue;/);
    for (const entry of entries) expect(`${entry.section}/${entry.slug}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/);
    // The notice that already existed before the import is not part of it.
    expect(IMPORT_SQL).not.toContain('Campus + Onboarding');
  });
});

describe('noticeboard archive schema (migration 072)', () => {
  const sql = statements(SCHEMA_SQL);

  it('opens archived notices to students only when they are registered archive records', () => {
    expect(sql).toMatch(
      /create policy notices_select_archive on public\.notices\s+for select to authenticated\s+using \(status = 'archived' and public\.notice_archive_listed\(id\)\);/,
    );
    expect([...sql.matchAll(/create policy (\w+)/g)].map((match) => match[1])).toEqual([
      'notices_select_archive',
      'notice_archive_entries_select',
    ]);
    expect(sql).not.toMatch(/using\s*\(\s*true\s*\)/i);
  });

  it('changes no existing policy, grant, trigger or row', () => {
    expect(sql).not.toMatch(/\b(drop|alter)\s+policy\b/i);
    expect(sql).not.toMatch(/disable\s+trigger|disable\s+row\s+level|session_replication_role/i);
    expect(sql).not.toMatch(/\b(insert\s+into|update|delete\s+from|truncate)\b/i);
    expect([...sql.matchAll(/alter table (\S+)/g)].map((match) => match[1])).toEqual(['public.notice_archive_entries']);
  });

  it('keeps provenance read-only for clients and closed to anon', () => {
    expect(sql).toContain('alter table public.notice_archive_entries enable row level security;');
    expect(sql).toContain('revoke all on public.notice_archive_entries from public, anon, authenticated;');
    expect(sql).toContain('grant select on public.notice_archive_entries to authenticated;');
    expect(sql).not.toMatch(/grant[^;]*\bto\b[^;]*\banon\b/i);
    expect(sql).toContain('revoke all on function public.notice_archive_listed(uuid) from public, anon;');
  });

  it('registers the new table with transactional backup capture', () => {
    expect(sql.trim().endsWith('select public.backup_sync_triggers();')).toBe(true);
  });
});

describe('return to the archive (migration 075)', () => {
  const sql = statements(RETURN_SQL);

  it('addresses the batch that migration 073 imports', () => {
    const batch = (text) => /c_batch\s+constant text := '([a-z0-9-]+)'/.exec(text)?.[1];
    expect(batch(RETURN_SQL)).toBe('pccoe-noticeboard-2026-11');
    expect(batch(RETURN_SQL)).toBe(batch(IMPORT_SQL));
  });

  it('writes status and publication time on notices, and nothing else', () => {
    expect([...sql.matchAll(/\bupdate\s+([a-z_.]+)/gi)].map((match) => match[1])).toEqual(['public.notices']);
    expect(sql).not.toMatch(/\b(insert\s+into|delete\s+from|truncate|alter|drop|create|grant|revoke)\b/i);
    expect(sql).not.toMatch(/disable\s+trigger|session_replication_role|row_security|storage\./i);
    const assignments = /\bset\s+([\s\S]*?)\s+from\s+public\.notice_archive_entries/.exec(sql)[1];
    expect(assignments.split(/,\s*\n/).map((line) => line.trim())).toEqual(["status = 'archived'", 'published_at = null']);
    expect(sql).not.toMatch(/\b(title|body|category|importance|pinned|expires_at|created_by)\b/);
  });

  it('returns only records that were published and never saved by staff', () => {
    expect(sql).toMatch(
      /where e\.notice_id = n\.id\s+and e\.source_key like c_batch \|\| '\/%'\s+and n\.status = 'published'\s+and n\.published_at is not null\s+and n\.updated_by is null;/,
    );
  });
});

describe('archive record dates: schema (migration 076)', () => {
  const sql = statements(DATE_SCHEMA_SQL);

  it('adds four columns to the provenance table and touches nothing else', () => {
    expect([...sql.matchAll(/alter table (\S+)/g)].map((match) => match[1])).toEqual([
      'public.notice_archive_entries',
      'public.notice_archive_entries',
    ]);
    expect([...sql.matchAll(/add column (\w+)\s+([a-z ]+?)[,;]/g)].map((match) => `${match[1]} ${match[2].trim()}`)).toEqual([
      'occurred_on date',
      'occurred_until date',
      'date_is_approximate boolean not null default false',
      'date_note text',
    ]);
    expect(sql).not.toMatch(/\b(policy|grant|revoke|trigger|insert\s+into|update|delete\s+from|truncate|drop)\b/i);
    expect(sql).not.toMatch(/public\.notices\b/);
  });

  it('lets a placeholder be 1 January of the known year and nothing more precise', () => {
    const check = /add constraint notice_archive_entries_date_placeholder_check\s+check \(([\s\S]*?)\n    \),/.exec(sql)[1];
    expect(check.replace(/\s+/g, ' ').trim()).toBe(
      'not date_is_approximate or ( occurred_on is not null and occurred_until is null ' +
        'and extract(month from occurred_on) = 1 and extract(day from occurred_on) = 1 )',
    );
    expect(sql).toContain(
      'check (occurred_until is null or (occurred_on is not null and occurred_until > occurred_on))',
    );
  });
});

// The dates exactly as they were supplied, in words. The manifest in migration
// 077 holds the same dates as ISO days, so a slip in either shows up here.
const SUPPLIED_DATES = {
  'itsa/ai-workshop': '21 July 2025',
  'itsa/induction-25': '30 July 2025',
  'itsa/techpulse-2k25': '30 July 2025',
  'itsa/techroom-2-0': '18 August 2025',
  'itsa/teachers-day': '9 September 2025',
  'itsa/swc-meditation': '12 September 2025',
  'itsa/abhidnya-2-0-bruteforge': '16–17 September 2025',
  'itsa/akshardhara': '13 October 2025',
  'itsa/praxis': '23–24 January 2026',
  'itsa/innoveda-24': '22–23 October 2024',
  'itsa/farewell-25': '17 April 2025',
  'itsa/induction-24': '29 August 2024',
  'mlsc/techroom': '25 August 2025',
  'mlsc/aiquest': '17 September 2025',
  'mlsc/project-development': '11 November 2025',
  'mlsc/bluebit-4-0': '16 March 2026',
  'higher-studies/gre-readiness': '5 August 2025',
  'higher-studies/mock-gate': '17 September 2025',
  'higher-studies/higher-education-lecture-on-ai': '20 September 2025',
  'ieee/invent-pitch': '7 August 2025',
  'ieee/iot-workshop': '22 January 2025',
  'ieee/membership-drive': '24 September 2025',
  'ieee/resume-building-interview-skills': '16 February 2026',
  'nss-isr/energy-conservation': '13 August 2025',
  'nss-isr/donation-initiatives': '24 August 2025',
  'nss-isr/e-waste-collection': '24 August 2025',
  'nss-isr/road-safety-awareness': '24 August 2025',
};
// Only the year is known.
const SUPPLIED_YEARS = {
  'art-circle/firodiya-karandak-2024': 2024,
  'art-circle/vinodattam': 2024,
  'art-circle/akshardhara': 2025,
  'art-circle/social-activity-workshop': 2025,
  'art-circle/firodiya-karandak-2026': 2026,
  'art-circle/kavi-sammelan': 2026,
  'art-circle/swartarang': 2026,
};
// Not calendar dates: an academic year, and a span of award years.
const SUPPLIED_LABELS = {
  'ieee/ieee-awards-and-achievements': '2022–2025',
  'art-circle/diya-painting': 'AY 2025–26',
  'art-circle/digital-poster-drawing-competition': 'AY 2025–26',
};
// The year of these two comes from the edition title, not from the poster.
const YEAR_FROM_EDITION_TITLE = ['itsa/farewell-25', 'ieee/iot-workshop'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function spokenDate(text) {
  const [, first, last, month, year] = /^(\d{1,2})(?:–(\d{1,2}))? ([A-Z][a-z]+) (\d{4})$/.exec(text);
  const iso = (day) => `${year}-${String(MONTHS.indexOf(month) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return last ? { day: iso(first), last_day: iso(last) } : { day: iso(first) };
}

describe('archive record dates: the PCCOE batch (migration 077)', () => {
  const sql = statements(DATES_SQL);
  const dates = JSON.parse(/\$json\$(\[[\s\S]*?\])\$json\$/.exec(DATES_SQL)[1]);
  const byKey = new Map(dates.map((line) => [line.key, line]));
  const recordKeys = entries.map((entry) => `${entry.section}/${entry.slug}`);
  const withoutNote = ({ key: _key, note: _note, ...rest }) => rest;

  it('names each record once, and only records that migration 073 imports', () => {
    expect(byKey.size).toBe(dates.length);
    for (const key of byKey.keys()) expect(recordKeys).toContain(key);
    expect(/c_batch constant text := '([a-z0-9-]+)'/.exec(DATES_SQL)[1]).toBe('pccoe-noticeboard-2026-11');
    expect(sql).toContain("where e.source_key = c_batch || '/' || d.key");
  });

  it('holds every exact date as it was supplied, day for day', () => {
    const exact = dates.filter((line) => line.day);
    expect(exact.map((line) => line.key).sort()).toEqual(Object.keys(SUPPLIED_DATES).sort());
    for (const [key, text] of Object.entries(SUPPLIED_DATES)) expect(withoutNote(byKey.get(key)), key).toEqual(spokenDate(text));
    expect(exact.filter((line) => line.last_day).map((line) => line.key)).toEqual([
      'itsa/abhidnya-2-0-bruteforge', 'itsa/praxis', 'itsa/innoveda-24',
    ]);
  });

  it('never gives a day or a month to a record whose year is all that is known', () => {
    const years = dates.filter((line) => 'year' in line);
    expect(Object.fromEntries(years.map((line) => [line.key, line.year]))).toEqual(SUPPLIED_YEARS);
    for (const line of years) expect(Object.keys(line).sort()).toEqual(['key', 'year']);
    // The placeholder is built in one place: 1 January of the year, flagged.
    expect(sql).toContain('set occurred_on = coalesce(d.day, make_date(d.year, 1, 1)),');
    expect(sql).toContain('date_is_approximate = d.year is not null,');
    expect(DATES_SQL).not.toMatch(/"\d{4}-01-01"/);
  });

  it('keeps an academic year and a span of years as labels, never as dates', () => {
    const labels = dates.filter((line) => !line.day && !('year' in line));
    expect(Object.fromEntries(labels.map((line) => [line.key, line.period]))).toEqual(SUPPLIED_LABELS);
    for (const line of dates) if (line.day || 'year' in line) expect(line.period, line.key).toBeUndefined();
    // The four placement records already carry their academic year and get no date.
    for (const key of recordKeys.filter((key) => key.startsWith('placement/'))) expect(byKey.has(key)).toBe(false);
  });

  it('leaves every other record undated instead of guessing', () => {
    const undated = recordKeys.filter((key) => !byKey.has(key));
    expect(undated).toHaveLength(27);
    for (const section of ['entrepreneurship-innovation', 'sports', 'alphabyte-hackathon', 'placement', 'departmental']) {
      expect(dates.filter((line) => line.key.startsWith(`${section}/`)), section).toEqual([]);
    }
    expect(undated).toEqual(expect.arrayContaining([
      'mlsc/datathon', 'mlsc/miniscape', 'mlsc/problemathon', 'mlsc/ai-canvas', 'mlsc/recurring-mlsc-sessions',
      'higher-studies/alumni-information', 'nss-isr/campus-and-environmental-drives', 'nss-isr/waste-segregation',
      'nss-isr/anti-drug-awareness', 'art-circle/dhc-4',
    ]));
    // Nothing is derived from today's date or from a title: outside the manifest,
    // the statement reads neither.
    const logic = sql.replace(/\$json\$[\s\S]*?\$json\$/, '');
    expect(logic).not.toBe(sql);
    expect(logic).not.toMatch(/now\(\)|current_date|current_timestamp|clock_timestamp|\btitle\b/i);
  });

  it('records where a year comes from when the poster does not give it', () => {
    const noted = dates.filter((line) => line.note).map((line) => line.key);
    expect(noted.sort()).toEqual([
      ...YEAR_FROM_EDITION_TITLE, 'ieee/ieee-awards-and-achievements', 'nss-isr/donation-initiatives', 'nss-isr/e-waste-collection',
    ].sort());
    for (const key of YEAR_FROM_EDITION_TITLE) expect(byKey.get(key).note).toContain('the year comes from the edition title');
    expect(byKey.get('ieee/ieee-awards-and-achievements').note).toBe(
      'Award years: Nupur Kulkarni — 2022; Rakshit Jain — 2024; Disha Kamalskar — 2024; Vaishnavi Nimse — 2025; ' +
        'Darrel Chong Student Activity Award — 2025.',
    );
  });

  it('writes dates on provenance only, and never over a date that is already there', () => {
    expect([...sql.matchAll(/\bupdate\s+([a-z_.]+)/gi)].map((match) => match[1])).toEqual(['public.notice_archive_entries']);
    expect(sql).not.toMatch(/\b(insert\s+into|delete\s+from|truncate|alter|drop|create|grant|revoke)\b/i);
    expect(sql).not.toMatch(/public\.(notices|events|academic_calendar|notifications)\b/);
    expect(sql).toMatch(
      /and e\.occurred_on is null\s+and e\.occurred_until is null\s+and not e\.date_is_approximate\s+and e\.date_note is null/,
    );
    expect(sql).toContain('period = coalesce(e.period, d.period),');
  });
});

describe('formatRecordDate', () => {
  it('shows an exact date in full, and both days of a longer activity', () => {
    expect(formatRecordDate({ on: '2025-07-21' })).toBe(formatDate('2025-07-21'));
    expect(formatRecordDate({ on: '2025-07-21' })).toMatch(/^21 \S+ 2025$/);
    const range = formatRecordDate({ on: '2025-09-16', until: '2025-09-17' });
    expect(range).toBe(`${formatDate('2025-09-16')} – ${formatDate('2025-09-17')}`);
    expect(range).toMatch(/^16 \S+ 2025 – 17 \S+ 2025$/);
  });

  it('shows a placeholder date as the year alone, never as 1 January', () => {
    expect(formatRecordDate({ on: '2025-01-01', approximate: true })).toBe('2025');
    expect(formatRecordDate({ on: '2026-01-01', approximate: true, period: '2026' })).toBe('2026');
    expect(formatRecordDate({ on: '2024-01-01', until: '2024-01-02', approximate: true })).toBe('2024');
    // A real 1 January is an exact date like any other.
    expect(formatRecordDate({ on: '2025-01-01' })).toBe(formatDate('2025-01-01'));
    expect(formatRecordDate({ on: '2025-01-01' })).toMatch(/^1 \S+ 2025$/);
  });

  it('falls back to the stated period, then to "Date unavailable"', () => {
    expect(DATE_UNAVAILABLE).toBe('Date unavailable');
    expect(formatRecordDate({ period: 'AY 2025–26' })).toBe('AY 2025–26');
    expect(formatRecordDate({ on: null, until: null, approximate: false, period: null })).toBe('Date unavailable');
    expect(formatRecordDate({})).toBe('Date unavailable');
    expect(formatRecordDate()).toBe('Date unavailable');
    expect(formatRecordDate({ on: 'not a date' })).toBe('Date unavailable');
    // A flag without a date says nothing about the year.
    expect(formatRecordDate({ approximate: true })).toBe('Date unavailable');
  });
});

/* -------------------------------------------------------------------------- */
/* Read model                                                                 */
/* -------------------------------------------------------------------------- */

function fakeDb(tables, { fail = [] } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, columns: null, eq: [], in: null, order: [], limit: null };
      calls.push(call);
      const run = () => {
        if (fail.includes(table)) return { data: null, error: { message: 'boom' } };
        let rows = [...(tables[table] || [])];
        for (const [column, value] of call.eq) rows = rows.filter((row) => row[column] === value);
        if (call.in) rows = rows.filter((row) => call.in[1].includes(row[call.in[0]]));
        for (const [column, ascending] of [...call.order].reverse()) {
          rows.sort((a, b) => (a[column] > b[column] ? 1 : a[column] < b[column] ? -1 : 0) * (ascending ? 1 : -1));
        }
        if (call.limit !== null) rows = rows.slice(0, call.limit);
        return { data: rows, error: null };
      };
      const api = {
        select(columns) { call.columns = columns; return api; },
        eq(column, value) { call.eq.push([column, value]); return api; },
        in(column, values) { call.in = [column, values]; return api; },
        order(column, options = {}) { call.order.push([column, options.ascending !== false]); return api; },
        limit(value) { call.limit = value; return api; },
        maybeSingle() {
          const result = run();
          return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
        },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      return api;
    },
  };
}

const CLUB = { id: 'c1', name: 'ITSA', slug: 'itsa', status: 'published' };
const LONG_BODY =
  'An ITSA learning initiative focused on Artificial Intelligence and its growing role in technology. The workshop ' +
  'introduces students to the field of AI, its fundamental concepts and its relevance to modern computing. It ' +
  'provides an opportunity for students to develop awareness of AI and explore its applications.';

const entry = (overrides) => ({
  source_key: 'batch/itsa/ai-workshop',
  notice_id: 'n1',
  section_key: 'itsa',
  section_label: 'ITSA — Information Technology Student Association',
  organization: 'ITSA',
  community_id: 'c1',
  source_category: 'Technical / Workshop',
  period: null,
  source_note: null,
  sort_order: 1,
  created_at: '2026-11-11T18:00:00Z',
  occurred_on: null,
  occurred_until: null,
  date_is_approximate: false,
  date_note: null,
  ...overrides,
});

const TABLES = {
  notice_archive_entries: [
    entry({ source_key: 'batch/placement/ay-2022-23', notice_id: 'n3', section_key: 'placement',
      section_label: 'Placement Statistics Archive', organization: 'PCCOE', community_id: null,
      source_category: 'Placement / Academic', period: 'AY 2022–23',
      source_note: 'Exact numerical statistics were not retained. This entry is not a numerical placement report.',
      sort_order: 57 }),
    entry({ source_key: 'batch/itsa/induction-25', notice_id: 'n2', source_category: 'Club / Cultural', period: '2025', sort_order: 2,
      occurred_on: '2025-01-01', date_is_approximate: true }),
    entry({ occurred_on: '2025-09-16', occurred_until: '2025-09-17', date_note: 'The year comes from the edition title.' }),
    // Registered, but staff re-published it: it is a current notice now.
    entry({ source_key: 'batch/itsa/republished', notice_id: 'n4', sort_order: 3 }),
    // Registered, but staff deleted the notice: the key stays, the record is gone.
    entry({ source_key: 'batch/itsa/deleted', notice_id: null, sort_order: 4 }),
  ],
  notices: [
    { id: 'n1', title: 'AI Workshop', body: LONG_BODY, status: 'archived' },
    { id: 'n2', title: "Induction '25", body: 'The ITSA induction programme for the 2025 student intake.', status: 'archived' },
    { id: 'n3', title: 'Placement Overview — AY 2022–23', body: 'Institutional placement information displayed for the academic year 2022–23.', status: 'archived' },
    { id: 'n4', title: 'Back on the board', body: 'A notice staff published again.', status: 'published' },
    { id: 'n9', title: 'Campus + Onboarding', body: 'A current notice.', status: 'published' },
  ],
  communities: [CLUB],
};

describe('listNoticeArchive', () => {
  it('groups registered archive records by section in recorded order', async () => {
    const db = fakeDb(TABLES);
    const result = await listNoticeArchive(db);

    expect(result.unavailable).toBe(false);
    expect(result.total).toBe(3);
    expect(result.sections.map((section) => section.key)).toEqual(['itsa', 'placement']);
    expect(result.sections[0]).toMatchObject({
      label: 'ITSA — Information Technology Student Association',
      name: 'ITSA',
      organization: 'ITSA',
      club: { id: 'c1', slug: 'itsa' },
    });
    expect(result.sections[0].records.map((record) => record.title)).toEqual(['AI Workshop', "Induction '25"]);
    expect(result.sections[0].records[0].body).toBe(LONG_BODY);
    expect(result.sections[0].records[1].period).toBe('2025');
    // Dates travel as stored; the flag says the 1 January is only a placeholder.
    expect(result.sections[0].records[0]).toMatchObject({
      occurredOn: '2025-09-16', occurredUntil: '2025-09-17', dateIsApproximate: false,
      dateNote: 'The year comes from the edition title.',
    });
    expect(result.sections[0].records[1]).toMatchObject({ occurredOn: '2025-01-01', occurredUntil: null, dateIsApproximate: true, dateNote: null });
    expect(result.sections[1].records[0]).toMatchObject({ occurredOn: null, occurredUntil: null, dateIsApproximate: false, dateNote: null });
    // The archive keeps its recorded order: no read is ordered or filtered by a date.
    for (const call of db.calls) {
      expect(call.order.map(([column]) => column).filter((column) => /occurred|date/.test(column))).toEqual([]);
      expect(call.eq.map(([column]) => column).filter((column) => /occurred|date/.test(column))).toEqual([]);
    }
    expect(db.calls[0].columns).toContain('occurred_on, occurred_until, date_is_approximate, date_note');
    expect(result.sections[1]).toMatchObject({ name: 'Placement Statistics Archive', organization: 'PCCOE', club: null });
    expect(result.sections[1].records[0]).toMatchObject({
      sourceCategory: 'Placement / Academic',
      period: 'AY 2022–23',
      note: 'Exact numerical statistics were not retained. This entry is not a numerical placement report.',
    });
  });

  it('reads archived notices only, so a current notice can never be listed as history', async () => {
    const db = fakeDb(TABLES);
    const result = await listNoticeArchive(db);
    const titles = result.sections.flatMap((section) => section.records.map((record) => record.title));

    expect(titles).not.toContain('Back on the board');
    expect(titles).not.toContain('Campus + Onboarding');
    const noticeReads = db.calls.filter((call) => call.table === 'notices');
    expect(noticeReads.length).toBeGreaterThan(0);
    for (const call of noticeReads) {
      expect(call.eq).toContainEqual(['status', 'archived']);
      expect(call.in[0]).toBe('id');
      expect(call.in[1]).not.toContain(null);
    }
    // Only notices that are registered are ever asked for.
    expect(noticeReads.flatMap((call) => call.in[1]).sort()).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  it('reports a failed read as unavailable instead of an empty archive', async () => {
    expect(await listNoticeArchive(fakeDb(TABLES, { fail: ['notice_archive_entries'] }))).toEqual({
      sections: [], total: 0, unavailable: true,
    });
    expect((await listNoticeArchive(fakeDb(TABLES, { fail: ['notices'] }))).unavailable).toBe(true);
  });

  it('keeps the text attribution when the club cannot be read', async () => {
    const result = await listNoticeArchive(fakeDb(TABLES, { fail: ['communities'] }));
    expect(result.unavailable).toBe(false);
    expect(result.sections[0]).toMatchObject({ organization: 'ITSA', club: null });
  });

  it('returns an empty, available archive when nothing is registered', async () => {
    const db = fakeDb({ notice_archive_entries: [], notices: TABLES.notices });
    expect(await listNoticeArchive(db)).toEqual({ sections: [], total: 0, unavailable: false });
    expect(db.calls.map((call) => call.table)).toEqual(['notice_archive_entries']);
  });

  it('reads every record of a large archive in bounded requests', async () => {
    const many = Array.from({ length: 170 }, (_, index) => ({ id: `m${index}`, title: `Record ${index}`, body: LONG_BODY, status: 'archived' }));
    const db = fakeDb({
      notice_archive_entries: many.map((notice, index) => entry({ source_key: `batch/itsa/r-${index}`, notice_id: notice.id, community_id: null, sort_order: index + 1 })),
      notices: many,
    });
    const result = await listNoticeArchive(db);
    expect(result.total).toBe(170);
    expect(result.sections[0].records[169].title).toBe('Record 169');
    const sizes = db.calls.filter((call) => call.table === 'notices').map((call) => call.in[1].length);
    expect(sizes).toEqual([80, 80, 10]);
  });
});

describe('getNoticeArchiveEntry', () => {
  it('returns provenance with the linked club for a registered notice', async () => {
    const found = await getNoticeArchiveEntry(fakeDb(TABLES), 'n1');
    expect(found).toMatchObject({ source_key: 'batch/itsa/ai-workshop', organization: 'ITSA', club: { slug: 'itsa' } });
  });

  it('returns null for a notice that is not an archive record', async () => {
    expect(await getNoticeArchiveEntry(fakeDb(TABLES), 'n9')).toBeNull();
  });

  it('carries no club for an institutional record', async () => {
    const found = await getNoticeArchiveEntry(fakeDb(TABLES), 'n3');
    expect(found).toMatchObject({ organization: 'PCCOE', period: 'AY 2022–23', club: null });
  });
});

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

describe('archive presentation', () => {
  const sections = [
    {
      key: 'itsa', label: 'ITSA — Information Technology Student Association', name: 'ITSA', organization: 'ITSA',
      club: { id: 'c1', name: 'ITSA', slug: 'itsa' },
      records: [
        { id: 'n1', title: 'AI Workshop', body: LONG_BODY, organization: 'ITSA', sourceCategory: 'Technical / Workshop', period: null, note: null, sourceKey: 'batch/itsa/ai-workshop', occurredOn: '2025-07-21' },
        { id: 'n2', title: "Induction '25", body: 'The ITSA induction programme for the 2025 student intake.', organization: 'ITSA', sourceCategory: 'Club / Cultural', period: '2025', note: null, sourceKey: 'batch/itsa/induction-25', occurredOn: '2025-09-16', occurredUntil: '2025-09-17' },
      ],
    },
    {
      key: 'placement', label: 'Placement Statistics Archive', name: 'Placement Statistics Archive', organization: 'PCCOE', club: null,
      records: [
        { id: 'n3', title: 'Placement Overview — AY 2022–23', body: 'Institutional placement information displayed for the academic year 2022–23.', organization: 'PCCOE', sourceCategory: 'Placement / Academic', period: 'AY 2022–23',
          note: 'Exact numerical statistics were not retained. This entry is not a numerical placement report.', sourceKey: 'batch/placement/ay-2022-23' },
      ],
    },
    {
      key: 'art-circle', label: 'Art Circle', name: 'Art Circle', organization: 'Art Circle', club: null,
      records: [
        // Only the year is known: stored as 1 January 2026, flagged.
        { id: 'n5', title: 'Kavi Sammelan', body: 'A poetry gathering organised by the Art Circle.', organization: 'Art Circle', sourceCategory: 'Cultural',
          period: null, note: null, sourceKey: 'batch/art-circle/kavi-sammelan', occurredOn: '2026-01-01', dateIsApproximate: true },
        { id: 'n6', title: 'DHC-4', body: 'A named Art Circle programme identified by the title DHC-4.', organization: 'Art Circle', sourceCategory: 'Cultural',
          period: null, note: null, sourceKey: 'batch/art-circle/dhc-4' },
      ],
    },
  ];

  it('shows the whole description, not a card preview', () => {
    expect(LONG_BODY.length).toBeGreaterThan(260);
    const markup = html(React.createElement(NoticeArchiveList, { sections }));
    expect(markup).toContain(LONG_BODY);
    // The same card truncates everywhere else.
    expect(html(ContentCard({ href: '/x', title: 'AI Workshop', description: LONG_BODY }))).not.toContain(LONG_BODY);
    expect(html(ContentCard({ href: '/x', title: 'AI Workshop', description: LONG_BODY, fullDescription: true }))).toContain(LONG_BODY);
  });

  it('labels every record as archive and presents nothing as current or upcoming', () => {
    const markup = html(React.createElement(NoticeArchiveList, { sections }));
    expect(markup.match(/>Archive<\/span>/g).length).toBeGreaterThanOrEqual(3);
    expect(markup).toContain('Past activity, kept for reference.');
    expect(markup).toContain('Nothing in the archive is a current announcement.');
    expect(markup).toContain('not copies of the original posters');
    expect(markup).not.toMatch(/Upcoming|Pinned|Published |Official|Register|RSVP|Expires/);
    expect(markup).not.toMatch(/<img|<picture|<video|background-image/);
    expect(markup).not.toContain('<time');
  });

  it('attributes each record, links only a club that exists, and shows source notes', () => {
    const markup = html(React.createElement(NoticeArchiveList, { sections }));
    expect(markup).toContain('2 records · ITSA');
    expect(markup).toContain('1 record · PCCOE');
    expect(markup).toContain('href="/c/itsa"');
    expect(markup.match(/href="\/c\//g)).toHaveLength(1);
    expect(markup).toContain(`ITSA · ${formatDate('2025-07-21')}`);
    expect(markup).toContain(`ITSA · ${formatDate('2025-09-16')} – ${formatDate('2025-09-17')}`);
    expect(markup).toContain('PCCOE · AY 2022–23');
    expect(markup).toContain('Source note: Exact numerical statistics were not retained. This entry is not a numerical placement report.');
    expect(markup).toContain('Technical / Workshop');
    for (const id of ['n1', 'n2', 'n3']) expect(markup).toContain(`href="/campus/noticeboard/${id}"`);
  });

  it('shows a year alone for a placeholder date and says when a date is unavailable', () => {
    const markup = html(React.createElement(NoticeArchiveList, { sections }));
    expect(markup).toContain('Art Circle · 2026');
    expect(markup).toContain('Art Circle · Date unavailable');
    // The stored placeholder day never reaches the page, in any spelling.
    expect(markup).not.toContain(formatDate('2026-01-01'));
    expect(markup).not.toMatch(/\b0?1 Jan(uary)? 2026|2026-01-01|January/);
    expect(markup).toContain('where only the year could be read, only the year is shown');
    // Records stay in the order they were recorded, not in date order.
    const order = ['AI Workshop', 'Induction &#x27;25', 'Placement Overview', 'Kavi Sammelan', 'DHC-4'].map((title) => markup.indexOf(title));
    expect(order.every((position) => position > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('narrows to one section and ignores a section that does not exist', () => {
    const placement = html(React.createElement(NoticeArchiveList, { sections, activeSection: 'placement' }));
    expect(placement).toContain('Placement Overview — AY 2022–23');
    expect(placement).not.toContain(LONG_BODY);
    expect(placement).toContain('href="/campus/noticeboard/archive?section=itsa"');
    expect(placement).toContain('<a class="chip" data-active="true" href="/campus/noticeboard/archive?section=placement">');
    expect(placement.match(/data-active="true"/g)).toHaveLength(1);

    const unknown = html(React.createElement(NoticeArchiveList, { sections, activeSection: 'no-such-section' }));
    expect(unknown).toContain(LONG_BODY);
    expect(unknown).toContain('Placement Overview — AY 2022–23');
  });

  it('distinguishes an empty archive from one that could not be loaded', () => {
    const empty = html(React.createElement(NoticeArchiveList, { sections: [] }));
    expect(empty).toContain('Nothing in the archive yet');
    expect(empty).not.toContain('could not be loaded');

    const failed = html(React.createElement(NoticeArchiveList, { sections: [], unavailable: true }));
    expect(failed).toContain('The archive could not be loaded right now.');
    expect(failed).not.toContain('Nothing in the archive yet');
  });

  it('marks the active view in the switch between current notices and the archive', () => {
    const current = html(React.createElement(NoticeboardViews, { active: 'current' }));
    expect(current).toMatch(/href="\/campus\/noticeboard"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/campus\/noticeboard"/);
    expect(current).toContain('href="/campus/noticeboard/archive"');
    expect(current.match(/aria-current="page"/g)).toHaveLength(1);

    const archive = html(React.createElement(NoticeboardViews, { active: 'archive' }));
    expect(archive).toMatch(/href="\/campus\/noticeboard\/archive"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/campus\/noticeboard\/archive"/);
    expect(archive.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('renders one record in full with its attribution', () => {
    const markup = html(
      React.createElement(NoticeArchiveRecord, {
        notice: { id: 'n3', title: 'Placement Overview — AY 2022–23', body: 'Institutional placement information displayed for the academic year 2022–23.' },
        entry: entry({ section_key: 'placement', section_label: 'Placement Statistics Archive', organization: 'PCCOE',
          source_category: 'Placement / Academic', period: 'AY 2022–23', club: null,
          source_note: 'Exact numerical statistics were not retained. This entry is not a numerical placement report.' }),
      }),
    );
    expect(markup).toContain('Archive record, not a current announcement.');
    expect(markup).toContain('not a copy of the original poster');
    expect(markup).toContain('Institutional placement information displayed for the academic year 2022–23.');
    expect(markup).toContain('This entry is not a numerical placement report.');
    expect(markup).toContain('Placement Statistics Archive');
    expect(markup).toContain('AY 2022–23');
    expect(markup).toMatch(/>When<\/dt><dd>AY 2022–23<\/dd>/);
    // The exact title is repeated in the details, where case is preserved.
    expect(markup).toContain('<dd>Placement Overview — AY 2022–23</dd>');
    expect(markup).not.toContain('href="/c/');
    expect(markup).not.toMatch(/<img|Official|Pinned|Published /);

    const linked = html(
      React.createElement(NoticeArchiveRecord, {
        notice: { id: 'n1', title: 'AI Workshop', body: LONG_BODY },
        entry: entry({ club: { id: 'c1', name: 'ITSA', slug: 'itsa' } }),
      }),
    );
    expect(linked).toContain('href="/c/itsa"');
    expect(linked).toContain(LONG_BODY);
    expect(linked).not.toContain('Source note');
    expect(linked).toMatch(/>When<\/dt><dd>Date unavailable<\/dd>/);

    const record = (dates) => html(
      React.createElement(NoticeArchiveRecord, { notice: { id: 'n1', title: 'AI Workshop', body: LONG_BODY }, entry: entry({ club: null, ...dates }) }),
    );
    expect(record({ occurred_on: '2025-07-21' })).toContain(`>When</dt><dd>${formatDate('2025-07-21')}</dd>`);
    const yearOnly = record({ occurred_on: '2024-01-01', date_is_approximate: true, period: '2024' });
    expect(yearOnly).toMatch(/>When<\/dt><dd>2024<\/dd>/);
    expect(yearOnly).not.toContain(formatDate('2024-01-01'));
    expect(yearOnly).not.toMatch(/2024-01-01|January/);
    const noted = record({ occurred_on: '2025-04-17', date_note: 'The day and month are from the poster; the year comes from the edition title.' });
    expect(noted).toContain(formatDate('2025-04-17'));
    expect(noted).toContain('the year comes from the edition title.');
  });
});

describe('archive routing and the boundary with current notices', () => {
  const page = (file) => read(`app/(app)/campus/noticeboard/${file}`);

  it('addresses the archive under the noticeboard and classifies the route', () => {
    expect(ROUTES.noticeboard).toBe('/campus/noticeboard');
    expect(ROUTES.noticeArchive()).toBe('/campus/noticeboard/archive');
    expect(ROUTES.noticeArchive('nss-isr')).toBe('/campus/noticeboard/archive?section=nss-isr');
    expect(PROXY_ROUTES).toContain('/campus/noticeboard/archive');
  });

  it('keeps the noticeboard on published notices and the archive on its own read', () => {
    const board = page('page.js');
    expect(board).toContain('listPublishedNotices');
    expect(board).not.toContain('listNoticeArchive');
    expect(board).toContain('<NoticeboardViews active="current" />');

    const archive = page('archive/page.js');
    expect(archive).toContain('await requireUser();');
    expect(archive).toContain('listNoticeArchive(supabase)');
    expect(archive).not.toMatch(/listPublishedNotices|listNotices\(/);
    expect(archive).not.toMatch(/unstable_cache|use cache/);

    // Archive rows are per-reader and policy-scoped; they never enter the
    // shared public cache.
    expect(read('lib/data/public-cache.js')).not.toMatch(/archived|notice_archive_entries/);
  });

  it('opens an archived notice to students only when it is a registered record', () => {
    const detail = page('[id]/page.js');
    expect(detail).toContain("notice.status === 'archived' ? await getNoticeArchiveEntry(supabase, notice.id) : null");
    expect(detail).toContain("if (notice.status !== 'published' && !archiveEntry && !isStaff) notFound();");
    expect(detail).toContain('<NoticeArchiveRecord notice={notice} entry={archiveEntry} />');
  });

  it('keeps every current surface pinned to published notices', () => {
    const data = read('lib/data/campus.js');
    const listNotices = data.slice(data.indexOf('export async function listNotices'), data.indexOf('export const getNotice'));
    expect(listNotices).toContain(".eq('status', PUBLISHED)");
    expect(read('lib/data/public-cache.js')).toContain("status = 'published'");
  });
});
