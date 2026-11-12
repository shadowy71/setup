import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

describe('deployment toolchain', () => {
  it('keeps the lockfile, local Node selection, and Vercel on the same major', () => {
    expect(readJson('package.json').engines.node).toBe('24.x');
    expect(readJson('package-lock.json').packages[''].engines.node).toBe('24.x');
    expect(readFileSync('.nvmrc', 'utf8').trim()).toBe('24');
  });

  it('only approves reviewed, version-pinned Linux install scripts', () => {
    const pkg = readJson('package.json');
    const lock = readJson('package-lock.json');
    expect(pkg.allowScripts).toEqual({
      [`@embedded-postgres/linux-x64@${lock.packages['node_modules/@embedded-postgres/linux-x64'].version}`]: true,
      [`esbuild@${lock.packages['node_modules/esbuild'].version}`]: true,
      [`unrs-resolver@${lock.packages['node_modules/unrs-resolver'].version}`]: true,
    });
  });

  it('removes only the unsupported cache-dir env setting from Vercel npm invocations', () => {
    const config = readJson('vercel.json');
    expect(config.installCommand).toBe('env -u npm_config_cache_dir -u NPM_CONFIG_CACHE_DIR npm ci --include=dev');
    expect(config.buildCommand).toBe('env -u npm_config_cache_dir -u NPM_CONFIG_CACHE_DIR npm run build');
    expect(readJson('package.json').scripts.prebuild).toBe('node scripts/check-proxy-routes.mjs && node scripts/build-sw.mjs');
    expect(readJson('lib/auth/package.json').type).toBe('module');
  });
});
