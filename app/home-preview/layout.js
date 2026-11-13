import { preload } from 'react-dom';

/**
 * The demo Home preview wears exactly the signed-in Home's own stylesheets
 * and font preloads (mirroring `app/(app)/home/layout.js`), so what is
 * reviewed here is the real Home surface — not a mock-up of it.
 */
import '@/app/styles/home.css';
import '@/app/styles/lumen.css';
import '@/app/styles/aurora.css';
import '@/app/styles/home-dashboard.css';

export default function HomePreviewLayout({ children }) {
  preload('/fonts/Syne.ttf', {
    as: 'font',
    type: 'font/ttf',
    crossOrigin: 'anonymous',
  });
  preload('/fonts/SpaceGrotesk.ttf', {
    as: 'font',
    type: 'font/ttf',
    crossOrigin: 'anonymous',
  });

  return children;
}
