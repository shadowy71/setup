/**
 * Clubs' own stylesheet, scoped to `/clubs` and `/clubs/[id]`.
 *
 * `sections.css` styles the club cards, monograms and hero surfaces that exist
 * only in this tree. The gigs tree imports the same file for its own cards;
 * neither ships it to the rest of the app.
 */
import '@/app/styles/sections.css';

export default function ClubsLayout({ children }) {
  return children;
}
