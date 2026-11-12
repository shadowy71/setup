'use client';

import { Icon } from '@/components/ui/icons';

/**
 * The information panel for the selected building.
 *
 * Deliberately factual: the surveyed number, the board's building name and
 * the actions that return the reader to the plan. No capacities, room counts
 * or other figures are invented here.
 */
export function BuildingInformation({ entry = null, onClose = () => {}, onLocate = () => {} }) {
  if (!entry) return null;
  return (
    <aside className="cm-info" role="dialog" aria-label={`Building ${entry.no} information`}>
      <button type="button" className="cm-info__close" onClick={onClose} aria-label="Close building information">
        <Icon name="close" size={14} />
      </button>
      <span className="cm-info__no">{entry.no}</span>
      <div className="cm-info__body">
        <p className="cm-info__eyebrow">Campus building</p>
        <h3 className="cm-info__name">{entry.name}</h3>
        <div className="cm-info__actions">
          <button type="button" className="cm-info__locate" onClick={onLocate}>
            <Icon name="mapPin" size={14} />
            Locate on map
          </button>
        </div>
      </div>
    </aside>
  );
}
