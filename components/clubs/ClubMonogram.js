/**
 * A club's logo, without an upload.
 *
 * Campus+ is text-only (no image uploads anywhere, by design), so a club's
 * mark is a monogram: its initials over a colour pair derived deterministically
 * from its id. The same club always looks the same and nothing is stored.
 */
function initials(name) {
  const words = String(name || '')
    .replace(/[^\p{L}\p{N}\s&-]/gu, ' ')
    .split(/[\s&-]+/)
    .filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function hueFor(seed) {
  let hash = 0;
  const source = String(seed || 'club');
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) % 360;
  }
  return hash;
}

/**
 * The mark stays inside the Teal Sand arc.
 *
 * A free-running hue would scatter indigo, magenta and lime through a product
 * whose entire identity is teal, sand and sunset — exactly the "random
 * unrelated accents" the design system forbids. So the deterministic seed
 * picks one of two families and a narrow hue inside it: ~80% teal, ~20% warm
 * sand. Every club still has its own stable colour; none of them leaves the
 * brand.
 */
function familyHue(seed) {
  const hash = hueFor(seed);
  const warm = hash % 5 === 0;
  const hue = warm ? 20 + (hash % 18) : 166 + (hash % 28);
  return { hue, hueEnd: hue + 14 };
}

export function ClubMonogram({ name, id = '', size = 56, className = '' }) {
  const { hue, hueEnd } = familyHue(id || name);
  return (
    <span
      className={`club-monogram ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size / 3.4),
        fontSize: size <= 40 ? '0.8125rem' : size <= 64 ? '1.0625rem' : '1.375rem',
        '--club-hue-a': `${hue}`,
        '--club-hue-b': `${hueEnd}`,
      }}
      aria-hidden="true"
    >
      <span className="club-monogram__initials">{initials(name)}</span>
    </span>
  );
}
