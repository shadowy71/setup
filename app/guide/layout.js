/**
 * The first-visit guide owns its own stylesheet, the way Home owns `home.css`:
 * `/guide` is the only route that needs the notebook sheet, and every other page
 * in the product keeps a smaller stylesheet for it.
 *
 * No application frame here on purpose. `/legal` and `/rules` are standalone
 * public documents and so is this — wrapping the guide in the app shell would
 * either force a session on a page that must work signed out, or duplicate the
 * navigation inside a page whose whole job is to point at it.
 */
import '@/app/styles/guide.css';

export default function GuideLayout({ children }) {
  return children;
}
