import '@/app/styles/campus-map.css';
import { MapTopNav } from '@/components/map/MapTopNav';
import { CommandPaletteHost } from '@/components/search/CommandPalette';

export const metadata = {
  title: 'Campus Map',
  description: 'Explore the layout of the Pimpri Chinchwad College of Engineering campus — an interactive, surveyed plan of every building, ground and gate.',
};

/** The quick-actions palette on the map page navigates the real routes. */
const PALETTE_ACTIONS = [
  { section: 'Navigation', label: 'Home', href: '/home', icon: 'home' },
  { section: 'Navigation', label: 'Timetable', href: '/timetable', icon: 'calendar' },
  { section: 'Navigation', label: 'Map', href: '/map', icon: 'mapPin' },
  { section: 'Navigation', label: 'Noticeboard', href: '/campus/noticeboard', icon: 'megaphone' },
  { section: 'Navigation', label: 'Events', href: '/campus/events', icon: 'calendar' },
  { section: 'Navigation', label: 'Clubs', href: '/clubs', icon: 'star' },
  { section: 'Navigation', label: 'Profile', href: '/profile', icon: 'user' },
];

/**
 * The Campus Map viewport: the dashboard's own horizontal navigation over a
 * deep-navy field. The page keeps the site's shared theme toggle and search
 * palette; everything below the bar is the map dashboard.
 */
export default function MapLayout({ children }) {
  return (
    <div className="cm-page">
      <MapTopNav />
      <CommandPaletteHost actions={PALETTE_ACTIONS} />
      {children}
    </div>
  );
}
