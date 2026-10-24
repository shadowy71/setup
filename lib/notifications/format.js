/**
 * Unread-count formatting, shared by every surface that shows it.
 *
 * The header bell, the sidebar row and the mobile menu all read the *same*
 * count (the single RLS-scoped query in `app/(app)/layout.js`) and must render
 * it identically: nothing for zero, the exact number up to 99, `99+` beyond,
 * and an accessible name that states the real number rather than the capped
 * one. This module is client-safe on purpose — it imports nothing.
 */

/** Largest count shown verbatim; beyond this the badge caps at `99+`. */
export const UNREAD_CAP = 99;

/**
 * @param {number|null|undefined} count
 * @param {string} subject navigation destination used in the accessible label
 * @returns {{count: number, text: string, visible: boolean, aria: string, label: string}}
 */
export function formatUnread(count, subject = 'Notifications') {
  const value = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return {
    count: value,
    text: value > UNREAD_CAP ? `${UNREAD_CAP}+` : String(value),
    visible: value > 0,
    // The accessible name always carries the true number, so screen-reader
    // users are not told "99+" when there are 140.
    aria: value > 0 ? `${value} unread` : 'no unread',
    label: value > 0 ? `${subject}, ${value} unread` : subject,
  };
}
