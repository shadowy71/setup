'use client';

import { Icon } from '@/components/ui/icons';

/**
 * The compact buildings directory beside the plan.
 *
 * Rows carry only what the campus board states — the surveyed building
 * number and its name — never invented statistics. Hovering a row lights the
 * matching footprint on the plan; selecting one opens its information panel.
 */
export function BuildingDirectory({ entries, selectedNo = null, hoverNo = null, onHover = () => {}, onSelect = () => {}, onViewComplete = () => {} }) {
  return (
    <section className="cm-dir" aria-label="Buildings overview">
      <header className="cm-dir__head">
        <span className="cm-dir__icon" aria-hidden="true">
          <Icon name="building" size={22} />
        </span>
        <h2 className="cm-dir__title">
          Buildings <span>Overview</span>
        </h2>
      </header>

      <table className="cm-table">
        <thead>
          <tr>
            <th scope="col">S.No.</th>
            <th scope="col">Building</th>
            <th scope="col" className="cm-table__action-col">
              Details
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const state = entry.no === selectedNo ? 'sel' : entry.no === hoverNo ? 'hot' : undefined;
            return (
              <tr
                key={entry.no}
                className="cm-table__row"
                data-state={state}
                onMouseEnter={() => onHover(entry.no)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onSelect(entry.no)}
              >
                <th scope="row" className="cm-table__no">
                  {entry.no}
                </th>
                <td className="cm-table__name">{entry.name}</td>
                <td className="cm-table__action">
                  <button
                    type="button"
                    className="cm-table__locate"
                    aria-label={`Show building ${entry.no} on the map`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(entry.no);
                    }}
                  >
                    <Icon name="mapPin" size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="cm-dir__foot">
        <button type="button" className="cm-dir__more" onClick={onViewComplete}>
          View Complete List
          <Icon name="chevronRight" size={15} />
        </button>
      </div>
    </section>
  );
}
