import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { DIVISIONS } from '@/lib/constants';
import { validate } from '@/lib/validation/primitives';
import {
  onboardingSchema,
  profileSetupSchema,
  profileUpdateSchema,
} from '@/lib/validation/schemas';

/**
 * Student divisions A–R.
 *
 * DIVISIONS in lib/constants.js is the single source of truth: the onboarding
 * form, Settings → Profile and both server-side profile schemas all consume
 * it, and the database column is plain text (no CHECK list), so extending the
 * constant extends every workflow at once. These tests pin the full range so
 * a future edit cannot silently narrow it again.
 */

const EXPECTED = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I',
  'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R',
];

const profilePayload = (division) => ({
  display_name: 'Asha Kulkarni',
  branch: 'Computer Engineering',
  year: 'Second Year',
  division,
  show_branch_year: true,
});

const onboardingPayload = (division) => ({
  username: 'asha_k',
  accept_rules: true,
  allow_dms_from_everyone: true,
  ...profilePayload(division),
});

describe('DIVISIONS constant', () => {
  it('is exactly A through R, in order, with no duplicates', () => {
    expect(DIVISIONS).toEqual(EXPECTED);
    expect(DIVISIONS).toHaveLength(18);
    expect(new Set(DIVISIONS).size).toBe(18);
    expect(DIVISIONS[0]).toBe('A');
    expect(DIVISIONS.at(-1)).toBe('R');
  });

  it('is the list every division workflow consumes (no hardcoded copies)', () => {
    for (const file of [
      'components/auth/OnboardingForm.js',
      'app/(shell)/(app)/settings/page.js',
      'lib/validation/schemas.js',
    ]) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source, `${file} must use the shared DIVISIONS constant`).toContain('DIVISIONS');
    }
    // And no page/component carries its own competing literal list.
    const roots = ['app', 'components', 'lib'];
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js') && !full.endsWith(path.join('lib', 'constants.js'))) {
          if (/\[\s*'A',\s*'B',\s*'C'/.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});

describe('division validation (save path)', () => {
  it('accepts every division A–R in profile setup, onboarding and profile update', () => {
    for (const division of EXPECTED) {
      expect(
        validate(profilePayload(division), profileSetupSchema).data?.division,
        `profileSetup ${division}`,
      ).toBe(division);
      expect(
        validate(profilePayload(division), profileUpdateSchema).data?.division,
        `profileUpdate ${division}`,
      ).toBe(division);
      expect(
        validate(onboardingPayload(division), onboardingSchema).data?.division,
        `onboarding ${division}`,
      ).toBe(division);
    }
  });

  it('round-trips the boundary and newly added divisions unchanged', () => {
    // A and R are the boundaries; K–Q are the divisions this change added.
    for (const division of ['A', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R']) {
      const result = validate(profilePayload(division), profileUpdateSchema);
      expect(result.ok, division).toBe(true);
      expect(result.data.division).toBe(division);
    }
    // Previously supported divisions keep working exactly as before.
    for (const division of ['A', 'B', 'C', 'D', 'E']) {
      expect(validate(profilePayload(division), profileUpdateSchema).ok, division).toBe(true);
    }
  });

  it('keeps division optional: empty and missing values validate to null', () => {
    for (const division of ['', null, undefined]) {
      const result = validate(profilePayload(division), profileUpdateSchema);
      expect(result.ok, String(division)).toBe(true);
      expect(result.data.division).toBeNull();
    }
    const missing = profilePayload('A');
    delete missing.division;
    expect(validate(missing, profileUpdateSchema).data.division).toBeNull();
  });

  it('rejects values outside A–R under the existing enum rules', () => {
    for (const division of ['S', 'Z', 'AA', 'a', 'r', 'Division A', 'Not applicable', '1', ' A ']) {
      const result = validate(profilePayload(division), profileUpdateSchema);
      expect(result.ok, JSON.stringify(division)).toBe(false);
      expect(result.errors.division, JSON.stringify(division)).toBeTruthy();
    }
  });
});
