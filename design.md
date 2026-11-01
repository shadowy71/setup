# Design: Campus+

The locked Hallmark system. Every redesigned route reads this first and shares it. Change it on purpose; this file is the rule.

## System
- Genre: atmospheric
- Shape: App Screen; existing public document flows remain document flows
- Theme: Lumen, night
- Axes: dark/roman-serif/warm · posture: restrained
- Redesign: full, presentational only; the existing Campus+ product and behavior are preserved

## Tokens
`app/tokens.css` is the source of truth. `app/globals.css` maps its roles into the established Campus+ semantic names. The core roles are:
```css
:root {
  --color-paper: oklch(12.5% 0.027 290); --color-paper-2: oklch(16% 0.03 290); --color-paper-3: oklch(20% 0.032 290);
  --color-ink: oklch(96% 0.01 300); --color-ink-2: oklch(85% 0.017 298); --color-muted: oklch(69% 0.026 295);
  --color-rule: oklch(27% 0.034 290); --color-rule-2: oklch(36% 0.04 292);
  --color-accent: oklch(80% 0.15 62); --color-accent-2: oklch(72% 0.15 12); --color-accent-ink: oklch(14% 0.028 290);
  --color-focus: oklch(80% 0.15 62); --color-live: oklch(80% 0.13 155);
  --font-display: "Instrument Serif", ui-serif, Georgia, serif; --font-body: "Geist", ui-sans-serif, system-ui, sans-serif;
  --font-outlier: "Geist Mono", ui-monospace, monospace;
  --radius-card: 10px; --radius-pill: 999px; --rule-hair: 1px;
  --shadow-card: 0 28px 64px -30px oklch(4% 0.02 290 / 0.8);
}
```
The fixed app type scale, spacing scale, easings and durations live in `app/tokens.css`.

## Controls
- Primary: solid brass fill · pill radius · 48px height; 44px small height
- Secondary: transparent with a hairline inset rule · same radius and height
- Fields: near-paper fill, muted edge, Geist text, brass focus ring
- Cards and wells: opaque violet surfaces, 1px rule, 10px radius; no glass or glow

## Type
- Page and section headings: Instrument Serif 400, lowercase, restrained app sizes
- Interface, labels, buttons and reading copy: Geist 400/500
- Home refinement: the personalized name uses locally hosted Geist 700 with a proportional, centered inline hand; card titles use Geist 600. Greeting case is preserved. Brand and editorial section headings retain Instrument Serif, and all existing theme/material tokens stay unchanged.
- Figures, code and technical readouts: Geist Mono 400, tabular numerals
- Actual font binaries are self-hosted through `next/font/local` in `app/layout.js`

## Motion
The signed-in product otherwise stays at rest: state-only color/background transitions and a 0.98 active press, without new load reveals or pointer-depth movement. Login retains its mouse/touch-interactive ghost; it stops when hidden, cleans up on unmount, has a static no-WebGL fallback, and renders one still frame under reduced motion. Home keeps its static paper background and one-time, route-gated Campus+ landing sequence; the former sea/depth-field canvas, fallback ridges, and continuous animation are removed. The intro's original timing, Skip intro/Escape exits, once-per-document behavior, cleanup, and reduced-motion fallbacks remain intact.

## Imagery and texture
Keep existing brand and content imagery. Use the blueprint grid only inside a real diagram/chart/figures well, never behind running prose. Home’s live statistics are its single figures-well use.

## Exports
- `app/tokens.css`: canonical Hallmark token set and Tailwind v4 static utilities
- `app/globals.css`: existing semantic-role compatibility mapping
- `app/styles/lumen.css`: shared application materials; imported after route-specific sheets
- No DTCG or shadcn export was requested
