/**
 * Realtime join failures that cannot be repaired by rejoining with the same
 * session and channel configuration.
 *
 * Phoenix automatically rejoins an errored channel (1s, 2s, 5s, then every
 * 10s). That is useful for a dropped socket, but an RLS/permission rejection is
 * permanent until the session or database authorization changes. Callers use
 * this predicate to remove only that channel and retain their slow HTTP gap
 * recovery. Expired/invalid-token failures stay on the normal retry path so a
 * refreshed session can recover without a reload.
 */
export function isPermanentRealtimeAuthorizationError(error) {
  const texts = [];
  const seen = new Set();

  const collect = (value) => {
    if (value == null || seen.has(value)) return;
    if (typeof value === 'string' || typeof value === 'number') {
      texts.push(String(value));
      return;
    }
    if (typeof value !== 'object') return;

    seen.add(value);
    // realtime-js preserves the server reply on Error.cause. Read only the
    // diagnostic fields, not arbitrary event payloads or circular structures.
    for (const key of ['message', 'reason', 'error', 'code', 'details', 'hint']) {
      const item = value[key];
      if (typeof item === 'string' || typeof item === 'number') texts.push(String(item));
    }
    if (value.cause) collect(value.cause);
  };

  collect(error);
  if (!texts.length) return false;

  const diagnostic = texts.join('\n');
  // A token refresh is an explicit recovery path, not a permanent RLS denial.
  if (/(?:jwt|token)[\s\S]*(?:expired|invalid|malformed)|(?:expired|invalid|malformed)[\s\S]*(?:jwt|token)/i.test(diagnostic)) {
    return false;
  }

  return /(?:\bunauthori[sz]ed\b|\bnot authorized\b|\bpermission denied\b|\b42501\b|\brlspolicyerror\b|\brls\s+policy\s+error\b)/i
    .test(diagnostic);
}
