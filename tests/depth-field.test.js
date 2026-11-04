import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file) => fs.readFileSync(file, 'utf8');

function sourceFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:js|css)$/.test(entry.name) ? [target] : [];
  });
}

describe('Home sea/depth-field removal', () => {
  it('deletes the component, shader scene, render loop, and exclusive probe', () => {
    for (const file of [
      'components/atmosphere/DepthField.js',
      'components/atmosphere/depth/createDepthField.js',
      'scripts/dev/field-probe.mjs',
    ]) {
      expect(fs.existsSync(file), file).toBe(false);
    }
  });

  it('has no mount, depth CSS, keyframes, tokens, or scene references anywhere in the app', () => {
    const offenders = ['app', 'components']
      .flatMap(sourceFiles)
      .filter((file) => /DepthField|createDepthField|depth-field|depth-drift|--cp-depth-/i.test(read(file)));
    expect(offenders).toEqual([]);

    const home = read('app/(app)/home/page.js');
    expect(home).toContain('<HomeFeedClient');
    expect(home).not.toContain('<canvas');
  });

  it('keeps the paper stage without substituting another animated sea', () => {
    expect(read('app/styles/lumen.css')).toMatch(/:root \.home-stage\s*\{\s*background-color: var\(--color-paper\);/);
    expect(read('app/styles/lumen.css')).toContain('var(--ambient-accent)');
    const islands = read('app/styles/islands.css');
    expect(islands).toContain('.home-stage {');
    expect(islands).not.toMatch(/canvas|ridge|horizon|depth-drift/i);
  });

  it('preserves the independent Login ghost, intro, and unrelated Home motion', () => {
    for (const file of [
      'components/atmosphere/GhostScene.js',
      'components/atmosphere/ghost/createGhostScene.js',
      'components/layout/GalacticIntro.js',
      'components/home/IslandMotion.js',
    ]) {
      expect(fs.existsSync(file), file).toBe(true);
    }
    expect(read('package.json')).toContain('"three"');
    expect(read('app/styles/home.css')).toContain('@keyframes aurora-breathe');
  });
});
