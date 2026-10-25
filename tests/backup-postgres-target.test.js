import { describe, expect, it } from 'vitest';

import { PgTarget, serialiseSnapshotValue } from '../lib/backup/postgres-target.js';

describe('Postgres restore target value serialisation', () => {
  it('keeps json/jsonb objects and Postgres arrays in their bindable form', () => {
    expect(serialiseSnapshotValue({ a: 1 }, 'jsonb')).toBe('{"a":1}');
    expect(serialiseSnapshotValue({ a: 1 }, 'json')).toBe('{"a":1}');
    expect(serialiseSnapshotValue(['hello', 'world'], 'ARRAY')).toEqual(['hello', 'world']);
    expect(serialiseSnapshotValue(['a', 'b'], 'text')).toBe('["a","b"]');
    expect(serialiseSnapshotValue(null, 'text')).toBeNull();
    expect(serialiseSnapshotValue('42', 'bigint')).toBe('42');
    expect(serialiseSnapshotValue(new Date('2026-10-25T00:00:00.000Z'), 'timestamp with time zone'))
      .toBe('2026-10-25T00:00:00.000Z');
  });

  it('requires a target connection string', () => {
    expect(() => new PgTarget({})).toThrow(/connection string/);
    expect(new PgTarget({ connectionString: 'postgresql://example' }).manifestTables).toEqual([]);
  });
});
