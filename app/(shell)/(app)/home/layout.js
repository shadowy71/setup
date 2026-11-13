import { preload } from 'react-dom';

/**
 * Home owns its route stylesheet, the shared Lumen material overrides, and the
 * two original faces used only by the restored landing sequence. Preloading
 * them here keeps that cost off Login, Setup, and every other application
 * route; the root's route gate decides whether the intro actually plays.
 */
import '@/app/styles/home.css';
import '@/app/styles/lumen.css';
import '@/app/styles/aurora.css';
import '@/app/styles/home-dashboard.css';

export default function HomeLayout({ children }) {
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
