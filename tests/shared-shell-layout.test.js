import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(file, 'utf8');

describe('shared application shell route boundary', () => {
  it('keeps app, public discovery and map below the same optional frame', () => {
    expect(read('app/(shell)/layout.js')).toContain('<OptionalAppFrame>{children}</OptionalAppFrame>');
    for (const route of ['(app)', '(public)', 'map']) {
      expect(existsSync(`app/(shell)/${route}/layout.js`)).toBe(true);
      expect(read(`app/(shell)/${route}/layout.js`)).not.toContain('<OptionalAppFrame>');
    }
  });

  it('preserves the protected account gate and the static offline boundary', () => {
    expect(read('app/(shell)/(app)/layout.js')).toContain('await requireUser()');
    expect(read('app/timetable/offline/page.js')).toContain("dynamic = 'force-static'");
    expect(existsSync('app/(shell)/timetable/offline/page.js')).toBe(false);
  });
});
