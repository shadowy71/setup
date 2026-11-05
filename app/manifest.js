import { THEME_PALETTES } from '@/lib/theme';

/** Campus+ install identity. Division timetables retain their own manifests. */
export default function manifest() {
  return {
    id: '/home',
    name: 'Campus+',
    short_name: 'Campus+',
    description: 'Campus+ is an independent student-built space for campus life at PCCOE.',
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    background_color: THEME_PALETTES.dark.background,
    theme_color: THEME_PALETTES.dark.background,
    icons: [
      { src: '/timetable/install/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/timetable/install/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/timetable/install/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/timetable/install/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
