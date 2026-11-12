'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/icons';

/**
 * The map's secondary control surface: building search, zoom in/out, reset
 * and the legend. Everything here stays visually quiet next to the plan —
 * small glass keys in one cluster, never competing with the campus itself.
 */
export function MapControls({
  query = '',
  results = [],
  onQuery = () => {},
  onPick = () => {},
  onZoomIn = () => {},
  onZoomOut = () => {},
  onReset = () => {},
}) {
  const [legendOpen, setLegendOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!legendOpen) return undefined;
    const dismiss = (event) => {
      if (!rootRef.current?.contains(event.target)) setLegendOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [legendOpen]);

  return (
    <div className="cm-ctrl" ref={rootRef}>
      <div className="cm-ctrl__search">
        <Icon name="search" size={14} />
        <input
          type="search"
          value={query}
          placeholder="Search buildings…"
          aria-label="Search buildings by name or number"
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && results[0]) onPick(results[0].no);
            if (event.key === 'Escape') onQuery('');
          }}
        />
        {results.length > 0 && query.trim() ? (
          <ul className="cm-ctrl__results" role="listbox" aria-label="Matching buildings">
            {results.slice(0, 6).map((entry) => (
              <li key={entry.no}>
                <button type="button" onClick={() => onPick(entry.no)}>
                  <span className="cm-ctrl__results-no">{entry.no}</span>
                  <span className="cm-ctrl__results-name">{entry.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="cm-ctrl__keys">
        <button type="button" onClick={onZoomIn} aria-label="Zoom in">
          <Icon name="plus" size={15} />
        </button>
        <button type="button" onClick={onZoomOut} aria-label="Zoom out">
          <span className="cm-ctrl__minus" aria-hidden="true" />
        </button>
        <button type="button" onClick={onReset} aria-label="Reset map view">
          <Icon name="refresh" size={14} />
        </button>
        <button
          type="button"
          onClick={() => setLegendOpen((open) => !open)}
          aria-label="Map legend"
          aria-expanded={legendOpen}
        >
          <Icon name="grid" size={14} />
        </button>
      </div>

      {legendOpen ? (
        <div className="cm-legend" role="dialog" aria-label="Map legend">
          <p className="cm-legend__title">Legend</p>
          <ul>
            <li>
              <span className="cm-legend__swatch cm-legend__swatch--building" /> Buildings
            </li>
            <li>
              <span className="cm-legend__swatch cm-legend__swatch--ground" /> Open grounds
            </li>
            <li>
              <span className="cm-legend__swatch cm-legend__swatch--road" /> Internal roads
            </li>
            <li>
              <span className="cm-legend__swatch cm-legend__swatch--wall" /> Perimeter wall
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
