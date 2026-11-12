import { Icon } from '@/components/ui/icons';
import { CampusMapDashboard } from '@/components/map/CampusMapDashboard';

/**
 * Campus Map — the interactive reconstruction of the PCCOE site plan.
 *
 * The heading block follows the dashboard design: pin glyph, white display
 * type with the word "Map" in the orange gradient, muted subtitle and a short
 * lit rule. The dashboard below is the two-column illuminated shell.
 */
export default function CampusMapPage() {
  return (
    <main className="cm-main">
      <header className="cm-head">
        <h1 className="cm-head__title">
          <span className="cm-head__pin" aria-hidden="true">
            <Icon name="mapPin" size={40} />
          </span>
          Campus <span className="cm-head__accent">Map</span>
        </h1>
        <p className="cm-head__sub">Explore the layout of our college campus</p>
        <span className="cm-head__rule" aria-hidden="true" />
      </header>

      <CampusMapDashboard />
    </main>
  );
}
