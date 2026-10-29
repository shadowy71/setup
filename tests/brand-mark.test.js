import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative));

describe('Campus+ display mark delivery', () => {
  it('uses a 256px WebP derivative while retaining the original icon source', () => {
    const source = read('logo.jpeg');
    const mark = read('public/brand/campus-mark.webp');
    expect(source.length).toBeGreaterThan(100_000);
    expect(mark.length).toBeLessThan(10_000);
    expect(mark.length).toBeLessThan(source.length / 10);
    expect(mark.toString('ascii', 0, 4)).toBe('RIFF');
    expect(mark.toString('ascii', 8, 12)).toBe('WEBP');
    expect(mark.toString('ascii', 12, 16)).toBe('VP8X');
    // VP8X stores canvas width/height minus one as unsigned 24-bit values.
    const width = 1 + mark[24] + (mark[25] << 8) + (mark[26] << 16);
    const height = 1 + mark[27] + (mark[28] << 8) + (mark[29] << 16);
    expect({ width, height }).toEqual({ width: 256, height: 256 });
    expect(read('components/brand/Brand.js').toString()).toContain("@/public/brand/campus-mark.webp");
  });

  it('keeps ordinary marks lazy but lets the measured Login LCP mark opt in', () => {
    const brand = read('components/brand/Brand.js').toString();
    expect(brand).toContain("loading={priority ? 'eager' : 'lazy'}");
    expect(brand).toContain("fetchPriority={priority ? 'high' : 'low'}");
    expect(brand).toContain('<BrandMark size={size} priority={markPriority} />');
    expect(read('app/login/page.js').toString()).toMatch(/<BrandLockup[^>]+markPriority\s*\/>/u);
    expect(read('components/layout/ShellHeader.js').toString()).not.toContain('markPriority');
  });
});
