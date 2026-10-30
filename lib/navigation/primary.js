import { PRIMARY_NAV, ROUTES } from '@/lib/constants';

/**
 * The primary navigation, in reading order.
 *
 * The rail's destinations are one list, not two: `PRIMARY_NAV` carries the
 * opened sections and the Timetable is inserted *before* Profile, because
 * checking the schedule is a campus action and the account is the last thing
 * on the rail. Keeping the merge here — rather than in the component — means
 * the order can be asserted directly, and any future surface that lists the
 * same destinations inherits it instead of drifting.
 *
 * Timetable is the one destination whose href depends on the student, so it is
 * resolved by the caller (`getTimetableHref(user?.division)`) and passed in;
 * nothing here infers a division. Its help topic stays the public selector, so
 * the explanation is the same whichever division the row opens.
 *
 * Labels, icons and routes are preserved exactly as `PRIMARY_NAV` defines them,
 * so this reorders the rail without redefining a single destination.
 */

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
  const profileIndex = items.findIndex((item) => item.href === ROUTES.profile);

  // Timetable takes the slot Profile used to hold; Profile sits directly after
  // it. With no Profile in the list (a future restructure), Timetable is last.
  if (profileIndex === -1) items.push(timetable);
  else items.splice(profileIndex, 0, timetable);

  return items;
}
