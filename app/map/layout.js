import '@/app/styles/campus-map.css';
import { OptionalAppFrame } from '@/components/layout/OptionalAppFrame';

export const metadata = {
  title: 'Campus Map',
  description: 'Explore the layout of the Pimpri Chinchwad College of Engineering campus — an interactive, surveyed plan of every building, ground and gate.',
};

/** Map content uses the same session-aware chrome as other app routes. */
export default function MapLayout({ children }) {
  return <OptionalAppFrame><div className="cm-page">{children}</div></OptionalAppFrame>;
}
