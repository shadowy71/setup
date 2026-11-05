import { describe, expect, it } from 'vitest';
import { AI_ML_BRANCH, LEGACY_AI_DS_BRANCH, branchFilterValues, normalizeBranch } from '@/lib/branches';
import { BRANCHES } from '@/lib/constants';
import { listResources, listStudyPosts } from '@/lib/data/campus';
import { getPublicProfile } from '@/lib/data/profiles';
import { globalSearch } from '@/lib/search';
import { profileSetupSchema, profileUpdateSchema, studyPostSchema, resourceSchema, communitySchema, studyGroupSchema, clubSchema } from '@/lib/validation/schemas';
import { getDivisionTimetable } from '@/lib/timetable';
import { describeBatch } from '@/lib/timetable/batch';

const legacy = [LEGACY_AI_DS_BRANCH, 'AI & DS', 'AI and Data Science', 'Artificial Intelligence and Data Science', 'AI-DS', 'ai / ds', 'AI-ML', 'Artificial Intelligence and Machine Learning'];

describe('AI & ML branch rename', () => {
  it('offers one canonical option and normalizes complete legacy labels only', () => {
    expect(BRANCHES.filter((branch) => branch === AI_ML_BRANCH)).toHaveLength(1);
    for (const value of legacy) expect(normalizeBranch(value), value).toBe(AI_ML_BRANCH);
    for (const value of ['Data Structures', 'Data Science', 'Computer Engineering', 'AI & DS study group', null]) expect(normalizeBranch(value)).toBe(value);
  });
  it('accepts old clients and writes the canonical label in every branch schema', () => {
    for (const schema of [profileSetupSchema, profileUpdateSchema, studyPostSchema, resourceSchema, communitySchema, studyGroupSchema, clubSchema]) {
      expect(schema?.branch, 'missing schema branch').toBeTypeOf('function');
      for (const value of legacy) expect(schema.branch(value)).toMatchObject({ ok: true, value: AI_ML_BRANCH });
      expect(schema.branch('Data Structures').ok).toBe(false);
    }
  });
  it('uses both current and historic stored values for resource and study filters', async () => {
    expect(branchFilterValues(LEGACY_AI_DS_BRANCH)).toEqual([AI_ML_BRANCH, LEGACY_AI_DS_BRANCH]);
    for (const load of [listResources, listStudyPosts]) {
      const calls = [];
      const query = new Proxy({}, { get(_target, key) {
        if (key === 'then') return (resolve) => resolve({ data: [], error: null });
        return (...args) => { calls.push([key, ...args]); return query; };
      } });
      await load({ from: () => query }, { branch: AI_ML_BRANCH });
      expect(calls).toContainEqual(['in', 'branch', [AI_ML_BRANCH, LEGACY_AI_DS_BRANCH]]);
    }
  });
  it('displays legacy public profiles and visible search metadata without changing privacy fields', async () => {
    const row = { username: 'student', branch: LEGACY_AI_DS_BRANCH, year: 'First Year' };
    const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: row }; } };
    expect(await getPublicProfile({ from: () => query }, 'student')).toMatchObject({ ...row, branch: AI_ML_BRANCH });
    const search = await globalSearch({ rpc: async () => ({ data: [{ scope: 'people', meta: { branch: LEGACY_AI_DS_BRANCH, year: 'First Year' } }] }) }, { query: 'student', enforceLimit: false });
    expect(search.groups[0].items[0].meta).toEqual({ branch: AI_ML_BRANCH, year: 'First Year' });
  });
  it('renames division labels without changing timetable identity or source events', () => {
    for (const division of ['Q', 'R']) {
      const batch = describeBatch(division);
      expect(batch).toMatchObject({ division, label: AI_ML_BRANCH, appId: `campusplus-timetable-${division.toLowerCase()}` });
      const timetable = getDivisionTimetable(division);
      expect(timetable.label).toBe(AI_ML_BRANCH);
      expect(timetable.days.every((day) => day.branch === AI_ML_BRANCH && day.events.length)).toBe(true);
    }
  });
});
