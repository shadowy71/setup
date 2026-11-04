// Fail production builds if a new route has not been classified by the proxy.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PROXY_ROUTES } from '../lib/auth/proxy-routes.js';

function routes(dir, parts = []) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      const segment = entry.name;
      if (segment.startsWith('@') || segment.startsWith('[') && !/^\[[^.[\]]+\]$/.test(segment)) {
        throw new Error(`Unsupported proxy route segment: ${segment}`);
      }
      return routes(join(dir, segment), segment.startsWith('(') ? parts : [...parts, segment]);
    }
    return /^(page|route)\.(js|jsx|ts|tsx)$/.test(entry.name) ? [`/${parts.join('/')}`] : [];
  });
}

const actual = routes('app').sort();
const expected = [...PROXY_ROUTES].sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error('Proxy route inventory is out of date. Update lib/auth/proxy-routes.js before building.');
}
