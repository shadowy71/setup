/**
 * Gigs' own stylesheet, scoped to `/gigs` and `/gigs/[id]`. See the clubs
 * layout for the shared rationale: the card vocabulary lives in this tree.
 */
import '@/app/styles/sections.css';
import '@/app/styles/lumen.css';
import '@/app/styles/aurora.css';

export default function GigsLayout({ children }) {
  return children;
}
