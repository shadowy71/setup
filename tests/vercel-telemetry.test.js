import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { shouldUseVercelTelemetry } from '../lib/vercel-telemetry';

describe('Vercel-hosted telemetry', () => {
  it('loads the fixed /_vercel scripts only on the Vercel host', () => {
    expect(shouldUseVercelTelemetry({ VERCEL: '1' })).toBe(true);
    expect(shouldUseVercelTelemetry({})).toBe(false);
    expect(shouldUseVercelTelemetry({ VERCEL: '0' })).toBe(false);
    expect(shouldUseVercelTelemetry({ NODE_ENV: 'production' })).toBe(false);
    expect(shouldUseVercelTelemetry({ VERCEL_ENV: 'production' })).toBe(false);
  });

  it('gates both optional components together in the root layout', () => {
    const layout = readFileSync('app/layout.js', 'utf8');
    expect(layout).toContain('shouldUseVercelTelemetry()');
    expect(layout).toMatch(/shouldUseVercelTelemetry\(\) \? \([\s\S]*<Analytics \/>[\s\S]*<SpeedInsights \/>/);
  });
});
