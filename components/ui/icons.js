/**
 * Inline icon set.
 *
 * Campus+ ships no icon package and no decorative imagery. These are minimal
 * 1.5px stroke glyphs on a 24×24 grid, drawn inline so they inherit
 * `currentColor`, cost no network request and stay accessible.
 */

const PATHS = {
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 4 4',
  tag: 'M4 11.5V5a1 1 0 0 1 1-1h6.5L20 12.5a1.5 1.5 0 0 1 0 2.1l-5.4 5.4a1.5 1.5 0 0 1-2.1 0L4 11.5Zm3.2-4.3h.01',
  users:
    'M8.5 11a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Zm-5.5 8c0-2.5 2.4-4.5 5.5-4.5s5.5 2 5.5 4.5M16 5.5a3 3 0 0 1 0 6M17.5 19.5c0-1.9-.8-3.4-2-4.4 2.9-.3 5 1.6 5 4.4',
  building: 'M5 20V6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v14M15 20V10h3a1 1 0 0 1 1 1v9M3 20h18M8 9h4M8 13h4M8 17h4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5',
  chat: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  bell: 'M12 4a5 5 0 0 1 5 5v3.5l1.5 3h-13L7 12.5V9a5 5 0 0 1 5-5Zm-2 14a2 2 0 0 0 4 0',
  at: 'M12 20a8 8 0 1 1 4.6-1.5M16 8v5a2.5 2.5 0 0 0 5 0v-1a9 9 0 1 0-3.6 7.2',
  comment: 'M4 5h16v10H9l-5 4V5Z',
  heart: 'M12 19s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 4.7-7 9-7 9Z',
  calendar: 'M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm3-3v4m8-4v4M4 11h16',
  shield: 'M12 3.5 19 6v6c0 4.2-3 7-7 8.5C8 19 5 16.2 5 12V6l7-2.5Z',
  flag: 'M6 20V4m0 0 5 1 4-1 3 1v8l-3-1-4 1-5-1',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 13 4 4L19 7',
  checkCircle: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-3 8.2 2.4 2.4L15.5 10',
  close: 'M6 6l12 12M18 6 6 18',
  chevronRight: 'm9 5 7 7-7 7',
  chevronLeft: 'm15 5-7 7 7 7',
  chevronDown: 'm5 9 7 7 7-7',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5v-9Zm7 3.5v2',
  mail: 'M4 6h16v12H4V6Zm0 1 8 6 8-6',
  logout: 'M15 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h9M18 12H9m9 0-3-3m3 3-3 3',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3-1.8-.6.5-1.8-1.6-1.6-1.8.5L14.7 7 14 4h-4l-.7 3-1.6 1.5-1.8-.5-1.6 1.6.5 1.8L4 12l.8.6-.5 1.8 1.6 1.6 1.8-.5L9.3 17l.7 3h4l.7-3 1.6-1.5 1.8.5 1.6-1.6-.5-1.8L20 12Z',
  sliders: 'M5 8h9m3 0h2M5 16h3m3 0h8M14 5.5v5M8 13.5v5',
  eye: 'M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Zm9.5 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  eyeOff: 'M4 4l16 16M9.9 5.2A9.9 9.9 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3 3.7M6.4 7.3C4.2 8.9 2.5 12 2.5 12s3.5 7 9.5 7c1.2 0 2.3-.2 3.2-.6',
  dots: 'M6 12h.01M12 12h.01M18 12h.01',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  send: 'M4 12 20 4l-6.5 16-2.5-6-7-2Z',
  pin: 'M12 20s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Zm0-8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  book: 'M5 4h6a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H5V4Zm14 0h-2a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H19V4Z',
  briefcase: 'M4 8h16v11H4V8Zm5 0V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M4 13h16',
  bus: 'M6 4h12a1 1 0 0 1 1 1v10H5V5a1 1 0 0 1 1-1Zm-1 7h14M7 18h.01M17 18h.01M7 15v3m10-3v3',
  utensils: 'M6 4v7a2 2 0 0 0 4 0V4M8 11v9M16 4c-1.5 1-2 2.5-2 4.5S15 12 16 12v8',
  megaphone: 'M4 10v4l3 .5V9.5L4 10Zm3-3 10-3v14L7 15V7Zm12 1a3 3 0 0 1 0 6',
  archive: 'M4 6h16v4H4V6Zm1 4h14v10H5V10Zm5 3h4',
  link: 'M10 14a4 4 0 0 1 0-5.6l2-2a4 4 0 0 1 5.6 5.6l-1 1M14 10a4 4 0 0 1 0 5.6l-2 2A4 4 0 0 1 6.4 12l1-1',
  sparkle: 'M12 4v5m0 6v5M4 12h5m6 0h5M7 7l3 3m4 4 3 3m0-10-3 3m-4 4-3 3',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4v4.5l3 1.5',
  star: 'm12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8L12 4Z',
  filter: 'M4 6h16l-6 7v5l-4 2v-7L4 6Z',
  image: 'M4 5h16v14H4V5Zm0 10 4-4 5 5m-1-2 3-3 5 5',
  file: 'M7 3h7l4 4v14H7V3Zm7 0v4h4',
  history: 'M12 5a7 7 0 1 1-6.5 4.4M12 5v0M4 5v5h5M12 8v4.5l3 1.8',
  trend: 'M4 17 10 11l3.5 3.5L20 8M20 8h-5m5 0v5',
  inbox: 'M4 13V6h16v7h-5l-1 2h-4l-1-2H4Zm0 0v5h16v-5',
  grid: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z',
  mapPin: 'M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  arrowUpRight: 'M7 17 17 7M17 7H9m8 0v8',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  monitor: 'M4 5h16v11H4V5Zm5 15h6m-3-4v4',
  alert: 'M12 4 3 20h18L12 4Zm0 6v4m0 3h.01',
  info: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4h.01M11 12h1v4h1',
  trash: 'M5 7h14M9.5 7V4.8h5V7m-7.5 0 .9 12.2h8.2L17 7M10.5 11v5.5m3-5.5v5.5',
  copy: 'M9 9h10v11H9V9Zm-4 6V4h10v2',
  /* Timetable install/offline set. Same 24×24 grid and 1.5px stroke as every
     other glyph here: a phone with an arrow going into it (add to Home
     Screen), the iOS share box (the only way iOS installs anything), and a
     struck-out arc pair (offline). No icon font, no imagery. */
  install:
    'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm4 6v5m0 0 2-2m-2 2-2-2M11 19h2',
  shareIos: 'M12 15V4m0 0L8.7 7.3M12 4l3.3 3.3M6 12v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6',
  wifiOff: 'M3 4l18 18M8.6 12.6a5 5 0 0 1 5.8-.4M5.6 9.6a9 9 0 0 1 4-2.1m6.6 1.4a9 9 0 0 1 2.2 1.2M12 17.6h.01',
};

const FILLED = new Set(['heart', 'star']);

/**
 * @param {{ name: keyof typeof PATHS, size?: number, className?: string, title?: string }} props
 */
export function Icon({ name, size = 20, className = '', title = null }) {
  const d = PATHS[name] || PATHS.dots;
  const filled = FILLED.has(name);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS);
