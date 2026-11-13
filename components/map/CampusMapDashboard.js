'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { BUILDING_DIRECTORY, searchDirectory } from '@/lib/map/campusBuildings';
import { CampusMap } from '@/components/map/CampusMap';
import { BuildingDirectory } from '@/components/map/BuildingDirectory';
import { BuildingInformation } from '@/components/map/BuildingInformation';
import { MapControls } from '@/components/map/MapControls';
import { CampusFeatureCards } from '@/components/map/CampusFeatureCards';
import { Icon } from '@/components/ui/icons';

/**
 * The Campus Map dashboard: the illuminated two-column shell that holds the
 * reconstructed plan (left) and the buildings directory plus feature strip
 * (right), wiring selection, hover, search and view commands between them.
 */
export function CampusMapDashboard() {
  const [selectedNo, setSelectedNo] = useState(null);
  const [hoverNo, setHoverNo] = useState(null);
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const mapRef = useRef(null);

  const results = useMemo(() => searchDirectory(query), [query]);
  const selectedEntry = useMemo(() => BUILDING_DIRECTORY.find((entry) => entry.no === selectedNo) ?? null, [selectedNo]);

  /** Selecting from the plan keeps the view; selecting elsewhere also flies to it. */
  const pick = useCallback((no) => {
    setSelectedNo(no);
    if (no) mapRef.current?.focus(no);
  }, []);

  const clear = useCallback(() => setSelectedNo(null), []);

  return (
    <div className="cm-shell">
      <div className="cm-grid">
        <section className="cm-mapcard" aria-label="Campus map">
          <header className="cm-maphead">
            <span
              className="cm-maphead__crest cm-logo cm-logo--crest"
              role="img"
              aria-label="Pimpri Chinchwad Education Trust crest"
            />
            <div className="cm-maphead__titles">
              <p>Pimpri Chinchwad Education Trust&apos;s</p>
              <h2>Pimpri Chinchwad College of Engineering</h2>
            </div>
            <span className="cm-maphead__logo cm-logo cm-logo--pccoe" role="img" aria-label="PCCOE logo" />
          </header>

          <div className="cm-mapbody">
            <CampusMap ref={mapRef} selectedNo={selectedNo} hoverNo={hoverNo} onSelect={setSelectedNo} onHover={setHoverNo} />

            <div className="cm-chip" aria-hidden="true">
              <span className="cm-chip__icon">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14" />
                </svg>
              </span>
              <span className="cm-chip__text">
                <strong>Interactive Map</strong>
                <small>Navigate through our campus</small>
              </span>
            </div>

            <MapControls
              query={query}
              results={results}
              onQuery={setQuery}
              onPick={(no) => {
                pick(no);
                setQuery('');
              }}
              onZoomIn={() => mapRef.current?.zoomIn()}
              onZoomOut={() => mapRef.current?.zoomOut()}
              onReset={() => {
                mapRef.current?.reset();
                clear();
              }}
            />

            <BuildingInformation entry={selectedEntry} onClose={clear} onLocate={() => selectedNo && mapRef.current?.focus(selectedNo)} />
          </div>
        </section>

        <div className="cm-side">
          <BuildingDirectory
            entries={BUILDING_DIRECTORY}
            selectedNo={selectedNo}
            hoverNo={hoverNo}
            onHover={setHoverNo}
            onSelect={pick}
            onViewComplete={() => setListOpen(true)}
          />
          <CampusFeatureCards />
        </div>
      </div>

      {listOpen ? (
        <div className="cm-modal" role="dialog" aria-modal="true" aria-label="Complete building list">
          <button type="button" className="cm-modal__scrim" aria-label="Close complete list" onClick={() => setListOpen(false)} />
          <div className="cm-modal__panel">
            <header>
              <h3>Complete Building List</h3>
              <button type="button" onClick={() => setListOpen(false)} aria-label="Close complete list">
                <Icon name="close" size={16} />
              </button>
            </header>
            <ul>
              {BUILDING_DIRECTORY.map((entry) => (
                <li key={entry.no}>
                  <button
                    type="button"
                    onClick={() => {
                      pick(entry.no);
                      setListOpen(false);
                    }}
                  >
                    <span className="cm-modal__no">{entry.no}</span>
                    <span className="cm-modal__name">{entry.name}</span>
                    <Icon name="mapPin" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
