import { cn } from '@/lib/utils';

const BEAM_PATHS = Array.from({ length: 48 }, (_, index) => {
  const x0 = -380 + index * 12;
  const y0 = -189 - index * 6;
  return `M${x0} ${y0}C${x0} ${y0} ${x0 + 68} ${y0 + 405} ${x0 + 532} ${y0 + 532}C${x0 + 996} ${y0 + 659} ${x0 + 1064} ${y0 + 1064} ${x0 + 1064} ${y0 + 1064}`;
});

const ACTIVE_TRAILS = [
  { index: 3, grad: 'a', dur: '13s', delay: '-2s' },
  { index: 6, grad: 'b', dur: '17s', delay: '-9s' },
  { index: 9, grad: 'c', dur: '14s', delay: '-5s' },
  { index: 12, grad: 'a', dur: '19s', delay: '-11s' },
  { index: 15, grad: 'b', dur: '12s', delay: '-4s' },
  { index: 18, grad: 'c', dur: '16s', delay: '-13s' },
  { index: 21, grad: 'a', dur: '15s', delay: '-7s' },
  { index: 24, grad: 'b', dur: '11s', delay: '-1s' },
  { index: 27, grad: 'c', dur: '18s', delay: '-10s' },
  { index: 30, grad: 'a', dur: '13.5s', delay: '-6s' },
  { index: 33, grad: 'b', dur: '16.5s', delay: '-14s' },
  { index: 36, grad: 'c', dur: '12.5s', delay: '-3s' },
  { index: 39, grad: 'a', dur: '20s', delay: '-15s' },
  { index: 42, grad: 'b', dur: '14.5s', delay: '-8s' },
  { index: 45, grad: 'c', dur: '17.5s', delay: '-12s' },
];

/**
 * Global ambient background beams layer.
 *
 * Fixed and non-interactive (`pointer-events-none z-0`) so it sits cleanly
 * behind all interactive content (`relative z-10`) without altering layout or
 * reading contrast. Colors and theme opacities resolve via CSS tokens in
 * `app/styles/background-beams.css` for both dark and light themes.
 */
export function BackgroundBeams({ className = '' }) {
  return (
    <div
      className={cn(
        'background-beams fixed inset-0 pointer-events-none z-0 overflow-hidden opacity-20 dark:opacity-45',
        className,
      )}
      aria-hidden="true"
    >
      <svg
        className="background-beams__svg pointer-events-none absolute inset-0 h-full w-full"
        width="100%"
        height="100%"
        viewBox="0 0 696 316"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <radialGradient id="beams-radial-fade" cx="50%" cy="45%" r="65%">
            <stop offset="0%" stopColor="white" stopOpacity="1" />
            <stop offset="72%" stopColor="white" stopOpacity="0.65" />
            <stop offset="100%" stopColor="white" stopOpacity="0.08" />
          </radialGradient>

          <mask id="beams-edge-mask">
            <rect x="0" y="0" width="696" height="316" fill="url(#beams-radial-fade)" />
          </mask>

          <linearGradient id="beams-mesh-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--beam-mesh-color)" stopOpacity="0" />
            <stop offset="35%" stopColor="var(--beam-mesh-color)" stopOpacity="1" />
            <stop offset="70%" stopColor="var(--beam-mesh-color)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--beam-mesh-color)" stopOpacity="0" />
          </linearGradient>

          <linearGradient id="beams-glow-a" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--beam-glow-1)" stopOpacity="0" />
            <stop offset="30%" stopColor="var(--beam-glow-1)" stopOpacity="1" />
            <stop offset="65%" stopColor="var(--beam-glow-2)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--beam-glow-3)" stopOpacity="0" />
          </linearGradient>

          <linearGradient id="beams-glow-b" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--beam-glow-2)" stopOpacity="0" />
            <stop offset="35%" stopColor="var(--beam-glow-1)" stopOpacity="0.95" />
            <stop offset="70%" stopColor="var(--beam-glow-3)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--beam-glow-2)" stopOpacity="0" />
          </linearGradient>

          <linearGradient id="beams-glow-c" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--beam-glow-3)" stopOpacity="0" />
            <stop offset="40%" stopColor="var(--beam-glow-2)" stopOpacity="0.9" />
            <stop offset="75%" stopColor="var(--beam-glow-1)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--beam-glow-3)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g mask="url(#beams-edge-mask)">
          <g className="background-beams__mesh">
            {BEAM_PATHS.map((d, index) => (
              <path
                key={`mesh-${index}`}
                d={d}
                stroke="url(#beams-mesh-grad)"
                strokeWidth="0.55"
                strokeLinecap="round"
              />
            ))}
          </g>

          <g className="background-beams__trails">
            {ACTIVE_TRAILS.map(({ index, grad, dur, delay }) => (
              <path
                key={`trail-${index}`}
                d={BEAM_PATHS[index]}
                pathLength={1}
                stroke={`url(#beams-glow-${grad})`}
                strokeWidth="1.25"
                strokeLinecap="round"
                className="background-beams__trail"
                style={{ '--beam-dur': dur, '--beam-delay': delay }}
              />
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}
