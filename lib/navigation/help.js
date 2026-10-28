import { ROUTES } from '@/lib/constants';

/**
 * Short, contextual explanations for destinations that already exist.
 *
 * Help is deliberately data, not another navigation tree. The trigger is
 * rendered beside a link and the popover explains that link; it never changes
 * the destination, permissions, or the five-tab mobile dock.
 */
export const NAVIGATION_HELP = {
  [ROUTES.home]: 'Home is the campus feed for discussions, questions and announcements. Open a post to read or join its conversation.',
  [ROUTES.explore]: 'Explore searches across campus boards, people and content. Use its filters to narrow the result instead of opening every section.',
  [ROUTES.market]: 'Market is for buying, selling, giving away and hiring. Each listing keeps its own price, condition and pickup details.',
  [ROUTES.gigs]: 'Gigs are short paid or unpaid pieces of work offered by students. Compensation is stated on each listing.',
  [ROUTES.communities]: 'Communities are student-created spaces for batches, subjects and study groups. This is separate from the official club catalogue.',
  [ROUTES.clubs]: 'Clubs is the reconciled organization catalogue. Students can request membership where available or request a missing club; only authorized staff can approve official clubs.',
  [ROUTES.campus]: 'Campus brings together events, notices, lost and found, housing, rides and practical student services.',
  [ROUTES.study]: 'Study finder helps you ask for peers around a subject or exam. Nothing is listed until you publish a request.',
  [ROUTES.timetable]: 'Timetable shows the week for your selected division. Without a saved division, it opens the public division selector.',
  [ROUTES.chat]: 'Messages are your direct conversations. Club administration does not give anyone access to these private messages.',
  [ROUTES.notifications]: 'Notifications collect replies, mentions, request outcomes and other activity directed to your account.',
  [ROUTES.moderator]: 'Moderation is available only to accounts with the relevant platform permission. Club owner and moderator roles do not open this queue.',
  [ROUTES.admin]: 'Admin contains platform-level tools for authorized staff. Club managers can administer only the specific clubs assigned to them.',
};

export function navigationHelpFor(topic) {
  return NAVIGATION_HELP[topic] || null;
}
