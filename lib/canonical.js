// The public identity is fixed, independent of request headers and deployment.
export const SITE_URL = 'https://pccoe.in';

export function absoluteUrl(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('Expected a same-origin absolute path');
  }
  return new URL(path, SITE_URL).toString();
}
