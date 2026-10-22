/**
 * The shared atmospheric environment — "the digital campus after dark".
 *
 * This is the calm, always-present sky behind the whole application shell.
 * It is a Server Component on purpose: every movement in it is a CSS
 * animation on `transform`/`opacity`, so there is no hydration, no JavaScript
 * on the client, no `requestAnimationFrame` loop and no re-render to trigger.
 * The compositor owns the motion, and the browser pauses it on a hidden tab
 * for free.
 *
 * The Teal Sand treatment lives in app/styles/night.css: teal light from the
 * upper left, a broad teal field centre-right, a sunset bloom low on the right
 * and sand at the foot — a room with two light sources, not a gradient.
 *
 * It is deliberately not one of the canvases. The sign-in stage keeps its
 * ghost scene (`./GhostScene`) and Home mounts its own depth field
 * (`./DepthField`); this layer is the environment underneath everything, and
 * stacking the two would double the cost for no gain.
 *
 * The tree is `pointer-events: none` and sits below the shell's stacking
 * context, so it can never intercept a click, a text selection or a scroll.
 * Reduced-motion users get the same composition as a still image — see
 * app/styles/night.css.
 */
export function NightSky() {
  return (
    <div className="night-sky" aria-hidden="true">
      <div className="night-sky__aurora" />
      <div className="night-sky__bloom night-sky__bloom--a" />
      <div className="night-sky__bloom night-sky__bloom--b" />
      <div className="night-sky__bloom night-sky__bloom--warm" />
    </div>
  );
}
