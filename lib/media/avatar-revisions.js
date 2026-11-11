// UI invalidation tokens, not image bytes or authorization results. Keeping the
// token shared means every mounted instance uses the same URL after an update.
const revisions = new Map();
const listeners = new Map();
export function avatarRevision(username) { return revisions.get(username) || 0; }
export function subscribeAvatar(username, listener) {
  let subscribers = listeners.get(username);
  if (!subscribers) { subscribers = new Set(); listeners.set(username, subscribers); }
  subscribers.add(listener);
  return () => { subscribers.delete(listener); if (!subscribers.size) listeners.delete(username); };
}
export function invalidateAvatar(username) {
  revisions.set(username, avatarRevision(username) + 1);
  for (const listener of listeners.get(username) || []) listener();
}
