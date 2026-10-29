/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The framework's floating development badge is not part of the product
  // surface; it overlaps the bottom-left of the rail in local preview.
  devIndicators: false,
  // Campus+ is text-first: user uploads do not exist and the only external media
  // is a GIF from GIPHY, whose URL is validated against this same host list
  // before it is ever stored (lib/giphy). `unoptimized` keeps GIF animation and
  // avoids proxying third-party media through the deployment.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'media.giphy.com' },
      { protocol: 'https', hostname: 'media0.giphy.com' },
      { protocol: 'https', hostname: 'media1.giphy.com' },
      { protocol: 'https', hostname: 'media2.giphy.com' },
      { protocol: 'https', hostname: 'media3.giphy.com' },
      { protocol: 'https', hostname: 'media4.giphy.com' },
    ],
  },
  // `next dev` refuses cross-origin requests to its own /_next/* resources and
  // only trusts localhost by default. The preview proxy serves the app from a
  // *.e2b.app origin while the dev server listens on localhost, so that origin
  // has to be named here or every script and style is answered with a 403. The
  // list is read in development only; production builds never consult it.
  allowedDevOrigins: ['*.e2b.app', '127.0.0.1'],
  // Opt-in sandbox fixture backend; never expose this route in production.
  // The backend defaults to the documented harness port (3111). When the
  // preview proxy owns that port instead — the browser then talks to the app on
  // 3111 and the stub lives elsewhere — PREVIEW_BACKEND_ORIGIN moves it without
  // touching the default workflow.
  async rewrites() {
    if (process.env.NODE_ENV !== 'development' || process.env.NEXT_PUBLIC_LOCAL_PREVIEW !== '1') return [];
    const backend = process.env.PREVIEW_BACKEND_ORIGIN || 'http://127.0.0.1:3111';
    return [{ source: '/api/preview-supabase/:path*', destination: `${backend}/:path*` }];
  },
  // Local tooling (the sandbox preview proxy) frames the dev server, so the
  // clickjacking guard is only sent by real deployments — `next dev` runs with
  // NODE_ENV=development, `next build`/Vercel always with production.
  async headers() {
    const headers = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ];
    if (process.env.NODE_ENV === 'production') {
      headers.push({ key: 'X-Frame-Options', value: 'DENY' });
    }
    return [
      { source: '/:path*', headers },
      // A service worker may only control paths at or above its own directory
      // unless the response says otherwise. The timetable worker lives at
      // /timetable/sw.js — beside the pages it exists for, so it needs no
      // change to the auth proxy's public paths — and this header is what lets
      // it *ask* for scope '/', which is how it can also keep the shell's
      // /_next/static chunks for an offline launch. Browsers that ignore the
      // header (Safari) simply get the narrower /timetable/ scope, where the
      // documents are still cached and the chunks come from the HTTP cache
      // instead; the client treats that as success, not as an error.
      {
        source: '/timetable/sw.js',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/' },
          // Never cached: a worker that cannot be replaced is a worker that
          // can strand an offline page on an old bundle.
          { key: 'Cache-Control', value: 'no-cache, no-store, max-age=0, must-revalidate' },
          { key: 'Content-Type', value: 'text/javascript; charset=utf-8' },
        ],
      },
    ];
  },
};

export default nextConfig;
