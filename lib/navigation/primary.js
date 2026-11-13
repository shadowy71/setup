import { PRIMARY_NAV, ROUTES } from '@/lib/constants';

/** Shared campus navigation; the timetable destination can be personalized. */
/** The Timetable row, in the shape the rail renders. */
export const TIMETABLE_NAV_ITEM = Object.freeze({
  href: ROUTES.timetable,
  label: 'Timetable',
  icon: 'calendar',
  helpTopic: ROUTES.timetable,
});

/**
 * @param {string} [timetableHref] a division's timetable, or the selector
 * @returns {Array<{ href: string, label: string, icon: string, helpTopic?: string }>}
 */
export function primaryNavigation(timetableHref = ROUTES.timetable) {
  // Every existing destination keeps its own href as its help topic, exactly as
  // the rail rendered before this list was shared.
  const items = PRIMARY_NAV.map((item) => ({ ...item, helpTopic: item.href }));

  const timetable = { ...TIMETABLE_NAV_ITEM, href: timetableHref || ROUTES.timetable };
  items.push(timetable);

  // The Campus Map rides directly behind the Timetable — checking where a
  // building is on campus is the same kind of quick look as checking the
  // schedule, so the two stay adjacent on the rail.
  const mapIndex = items.findIndex((item) => item.href === ROUTES.map);
  if (mapIndex > -1) {
    const [map] = items.splice(mapIndex, 1);
    items.splice(items.findIndex((item) => item.href === timetable.href) + 1, 0, map);
  }

  return items;
}
