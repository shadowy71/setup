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
 *   3. the presentation: full text, labelled as archive, no image, no date.
 */

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const SCHEMA_SQL = read('supabase/migrations/20261112000026_072_notice_archive.sql');
const IMPORT_SQL = read('supabase/migrations/20261112000027_073_pccoe_noticeboard_archive.sql');

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
  ...overrides,
});

const TABLES = {
  notice_archive_entries: [
    entry({ source_key: 'batch/placement/ay-2022-23', notice_id: 'n3', section_key: 'placement',
      section_label: 'Placement Statistics Archive', organization: 'PCCOE', community_id: null,
      source_category: 'Placement / Academic', period: 'AY 2022–23',
      source_note: 'Exact numerical statistics were not retained. This entry is not a numerical placement report.',
      sort_order: 57 }),
    entry({ source_key: 'batch/itsa/induction-25', notice_id: 'n2', source_category: 'Club / Cultural', period: '2025', sort_order: 2 }),
    entry({}),
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
        { id: 'n1', title: 'AI Workshop', body: LONG_BODY, organization: 'ITSA', sourceCategory: 'Technical / Workshop', period: null, note: null, sourceKey: 'batch/itsa/ai-workshop' },
        { id: 'n2', title: "Induction '25", body: 'The ITSA induction programme for the 2025 student intake.', organization: 'ITSA', sourceCategory: 'Club / Cultural', period: '2025', note: null, sourceKey: 'batch/itsa/induction-25' },
      ],
    },
    {
      key: 'placement', label: 'Placement Statistics Archive', name: 'Placement Statistics Archive', organization: 'PCCOE', club: null,
      records: [
        { id: 'n3', title: 'Placement Overview — AY 2022–23', body: 'Institutional placement information displayed for the academic year 2022–23.', organization: 'PCCOE', sourceCategory: 'Placement / Academic', period: 'AY 2022–23',
          note: 'Exact numerical statistics were not retained. This entry is not a numerical placement report.', sourceKey: 'batch/placement/ay-2022-23' },
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
    expect(markup).toContain('ITSA · 2025');
    expect(markup).toContain('PCCOE · AY 2022–23');
    expect(markup).toContain('Source note: Exact numerical statistics were not retained. This entry is not a numerical placement report.');
    expect(markup).toContain('Technical / Workshop');
    for (const id of ['n1', 'n2', 'n3']) expect(markup).toContain(`href="/campus/noticeboard/${id}"`);
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
    expect(linked).not.toContain('>Period<');
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
