'use client';

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  BUILDING_DIRECTORY,
  CAMPUS_CONTEXT,
  CAMPUS_FOOTPRINTS,
  CAMPUS_GATES,
  CAMPUS_GROUNDS,
  CAMPUS_HATCHES,
  CAMPUS_LANDMARKS,
  CAMPUS_PERIMETER,
  CAMPUS_ROADS,
  CAMPUS_VIEWBOX,
  CAMPUS_WALKWAY,
} from '@/lib/map/campusBuildings';

/**
 * The interactive digital reconstruction of the PCCOE campus plan.
 *
 * The geography lives in `lib/map/campusBuildings.js`; this component only
 * draws it and owns the view transform (wheel/pinch zoom, drag pan, program
 * matic focus + reset). Buildings are individually selectable, mirror the
 * directory's hover state, and report selections upward — the map never
 * invents data of its own.
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

const ENTRY_OF_FOOTPRINT = Object.fromEntries(
  BUILDING_DIRECTORY.flatMap((entry) => entry.footprints.map((id) => [id, entry.no])),
);

const pointsAttr = (points) => points.map(([x, y]) => `${x},${y}`).join(' ');

function footprintBounds(footprint) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of footprint.polys) {
    for (const [x, y] of poly) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

export function CampusMap({
  ref = null,
  selectedNo = null,
  hoverNo = null,
  onSelect = () => {},
  onHover = () => {},
}) {
  const stageRef = useRef(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });

  const pointers = useRef(new Map());
  const gesture = useRef(null);

  const { width: VBW, height: VBH } = CAMPUS_VIEWBOX;

  /** Client pixels → plan user units (the svg letterboxes with `meet`). */
  const toUser = useCallback((clientX, clientY) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const scale = Math.min(rect.width / VBW, rect.height / VBH);
    const offsetX = (rect.width - VBW * scale) / 2;
    const offsetY = (rect.height - VBH * scale) / 2;
    return { x: (clientX - rect.left - offsetX) / scale, y: (clientY - rect.top - offsetY) / scale };
  }, [VBW, VBH]);

  const clampView = useCallback((next) => {
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next.k));
    // Keep the plan covering the frame: no dragging the campus off-screen.
    const limit = 400;
    const x = Math.min(limit, Math.max(VBW - VBW * k - limit, next.x));
    const y = Math.min(limit, Math.max(VBH - VBH * k - limit, next.y));
    return { k, x, y };
  }, [VBW, VBH]);

  const zoomAt = useCallback((userX, userY, factor) => {
    setView((current) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.k * factor));
      const ratio = k / current.k;
      return clampView({ k, x: userX - (userX - current.x) * ratio, y: userY - (userY - current.y) * ratio });
    });
  }, [clampView]);

  const zoomBy = useCallback((factor) => zoomAt(VBW / 2, VBH / 2, factor), [VBH, VBW, zoomAt]);

  const reset = useCallback(() => setView({ k: 1, x: 0, y: 0 }), []);

  const focusEntry = useCallback((no) => {
    const entry = BUILDING_DIRECTORY.find((item) => item.no === no);
    if (!entry) return;
    const footprints = CAMPUS_FOOTPRINTS.filter((footprint) => entry.footprints.includes(footprint.id));
    if (footprints.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const footprint of footprints) {
      const bounds = footprintBounds(footprint);
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const k = Math.min(4.2, Math.max(1.8, Math.min(VBW / ((maxX - minX) * 3.1), VBH / ((maxY - minY) * 3.1))));
    setView(clampView({ k, x: VBW / 2 - k * cx, y: VBH / 2 - k * cy }));
  }, [VBH, VBW, clampView]);

  // The controls, directory and info panel drive the view imperatively —
  // one handle, no command queue, no effects.
  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomBy(1.35),
      zoomOut: () => zoomBy(1 / 1.35),
      reset,
      focus: focusEntry,
    }),
    [zoomBy, reset, focusEntry],
  );

  const onWheel = useCallback((event) => {
    event.preventDefault();
    const user = toUser(event.clientX, event.clientY);
    zoomAt(user.x, user.y, Math.exp(-event.deltaY * 0.0016));
  }, [toUser, zoomAt]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const onPointerDown = useCallback((event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      // Remember what the press started on: pointer capture retargets the
      // matching click, so the selection is resolved here on pointer-up.
      const building = event.target instanceof Element ? event.target.closest('.cm-building') : null;
      const label = building?.getAttribute('aria-label') ?? '';
      gesture.current = {
        mode: 'pan',
        moved: 0,
        start: { x: event.clientX, y: event.clientY },
        picked: label.startsWith('Building ') ? label.slice('Building '.length) : null,
      };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { mode: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  }, []);

  const onPointerMove = useCallback((event) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    if (!current) return;
    if (current.mode === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = toUser((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (current.distance > 0) zoomAt(mid.x, mid.y, distance / current.distance);
      current.distance = distance;
      return;
    }
    if (current.mode === 'pan') {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const scale = Math.min(rect.width / VBW, rect.height / VBH);
      const dx = (event.clientX - current.start.x) / scale;
      const dy = (event.clientY - current.start.y) / scale;
      current.moved += Math.abs(dx) + Math.abs(dy);
      current.start = { x: event.clientX, y: event.clientY };
      setView((prev) => clampView({ k: prev.k, x: prev.x + dx, y: prev.y + dy }));
    }
  }, [VBH, VBW, clampView, toUser, zoomAt]);

  const onPointerUp = useCallback((event) => {
    const current = gesture.current;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      // A press that never travelled is a pick (building) or a clear (space).
      if (current?.mode === 'pan' && current.moved <= 6) onSelect(current.picked ?? null);
    } else if (pointers.current.size === 1) {
      const [rest] = [...pointers.current.values()];
      gesture.current = { mode: 'pan', moved: 99, start: { x: rest.x, y: rest.y } };
    }
  }, [onSelect]);

  const transform = `translate(${view.x} ${view.y}) scale(${view.k})`;
  const hotFootprints = useMemo(() => {
    const entry = BUILDING_DIRECTORY.find((item) => item.no === hoverNo);
    return new Set(entry?.footprints ?? []);
  }, [hoverNo]);
  const selectedFootprints = useMemo(() => {
    const entry = BUILDING_DIRECTORY.find((item) => item.no === selectedNo);
    return new Set(entry?.footprints ?? []);
  }, [selectedNo]);

  return (
    <div
      ref={stageRef}
      className="cm-stage"
      data-zoomed={view.k > 1.01 ? 'true' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <svg
        className="cm-svg"
        viewBox={`${CAMPUS_VIEWBOX.x} ${CAMPUS_VIEWBOX.y} ${VBW} ${VBH}`}
        role="img"
        aria-label="Interactive campus map of Pimpri Chinchwad College of Engineering"
      >
        <defs>
          <linearGradient id="cm-surface" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className="cm-stop-surface-a" />
            <stop offset="1" className="cm-stop-surface-b" />
          </linearGradient>
          <linearGradient id="cm-building" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0" className="cm-stop-building-a" />
            <stop offset="1" className="cm-stop-building-b" />
          </linearGradient>
          <linearGradient id="cm-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="cm-stop-ground-a" />
            <stop offset="1" className="cm-stop-ground-b" />
          </linearGradient>
          <pattern id="cm-hatch" width="14" height="14" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="14" height="14" className="cm-hatch-bg" />
            <line x1="0" y1="0" x2="0" y2="14" className="cm-hatch-line" strokeWidth="4" />
          </pattern>
          <filter id="cm-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="10" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g transform={transform}>
          {/* Ambient halo behind the whole site */}
          <polygon className="cm-perimeter-glow" points={pointsAttr(CAMPUS_PERIMETER)} filter="url(#cm-glow)" />

          {/* Site surface inside the perimeter wall */}
          <polygon className="cm-site" points={pointsAttr(CAMPUS_PERIMETER)} fill="url(#cm-surface)" />

          {/* Internal roads */}
          <g className="cm-roads">
            {CAMPUS_ROADS.map((road) => (
              <polygon key={road.id} className="cm-road" points={pointsAttr(road.points)} />
            ))}
          </g>

          {/* Hatched paved wedges + covered walkway slats */}
          <g className="cm-hatches">
            {CAMPUS_HATCHES.map((points, index) => (
               
              <polygon key={`hatch-${index}`} points={pointsAttr(points)} fill="url(#cm-hatch)" />
            ))}
            {CAMPUS_WALKWAY.map((points, index) => (
               
              <polygon key={`walk-${index}`} className="cm-slat" points={pointsAttr(points)} />
            ))}
          </g>

          {/* The two open grounds */}
          <g className="cm-grounds">
            {CAMPUS_GROUNDS.map((ground) => (
              <g key={ground.id}>
                <polygon className="cm-ground" points={pointsAttr(ground.points)} fill="url(#cm-ground)" />
                {ground.mark ? <polygon className="cm-ground-mark" points={pointsAttr(ground.mark)} /> : null}
                <text className="cm-ground-label" x={ground.labelAt[0]} y={ground.labelAt[1]}>
                  {ground.label}
                </text>
                {ground.sublabel ? (
                  <text className="cm-ground-sublabel" x={ground.labelAt[0]} y={ground.labelAt[1] + 42}>
                    {ground.sublabel}
                  </text>
                ) : null}
              </g>
            ))}
          </g>

          {/* Unnumbered surveyed structures */}
          <g className="cm-landmarks">
            {CAMPUS_LANDMARKS.map((landmark) => (
              <g key={landmark.id}>
                <polygon className="cm-landmark" points={pointsAttr(landmark.points)} />
                <text className="cm-landmark-label" x={landmark.labelAt[0]} y={landmark.labelAt[1]}>
                  {landmark.label}
                </text>
              </g>
            ))}
          </g>

          {/* Buildings — individually selectable */}
          <g className="cm-buildings">
            {CAMPUS_FOOTPRINTS.map((footprint) => {
              const no = ENTRY_OF_FOOTPRINT[footprint.id];
              const state = selectedFootprints.has(footprint.id)
                ? 'sel'
                : hotFootprints.has(footprint.id)
                  ? 'hot'
                  : undefined;
              return (
                <g
                  key={footprint.id}
                  className="cm-building"
                  data-state={state}
                  role="button"
                  tabIndex={0}
                  aria-label={no ? `Building ${no}` : footprint.label}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(no);
                    }
                  }}
                  onPointerEnter={() => onHover(no)}
                  onPointerLeave={() => onHover(null)}
                >
                  {footprint.polys.map((points, index) => (
                     
                    <polygon key={`${footprint.id}-${index}`} className="cm-building-face" points={pointsAttr(points)} />
                  ))}
                  {footprint.small ? (
                    <g className="cm-blabel" transform={`translate(${footprint.labelAt[0]} ${footprint.labelAt[1]})`}>
                      <rect x="-46" y="-20" width="92" height="40" rx="20" />
                      <text dy="11">{footprint.label}</text>
                    </g>
                  ) : (
                    <g className="cm-blabel" transform={`translate(${footprint.labelAt[0]} ${footprint.labelAt[1]})`}>
                      <circle r="34" />
                      <text dy="13">{footprint.label}</text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>

          {/* Perimeter wall on top, so edges stay crisp while zoomed */}
          <polygon className="cm-perimeter" points={pointsAttr(CAMPUS_PERIMETER)} />

          {/* Gates + surrounding road notes, as surveyed */}
          <g className="cm-gates">
            {CAMPUS_GATES.map((gate) => (
              <g key={gate.id} transform={`translate(${gate.at[0]} ${gate.at[1]})`}>
                <circle className="cm-gate-dot" r="12" />
                <text className="cm-gate-label" y="-24">
                  {gate.label}
                </text>
              </g>
            ))}
            {CAMPUS_CONTEXT.map((note) => (
              <text
                key={note.id}
                className="cm-context"
                x={note.at[0]}
                y={note.at[1]}
                transform={note.rotate ? `rotate(${note.rotate} ${note.at[0]} ${note.at[1]})` : undefined}
              >
                {note.text}
              </text>
            ))}
          </g>

          {/* North indicator, west of the hostel column as on the board plan */}
          <g className="cm-north" transform="translate(952 602) scale(1.3)">
            <text className="cm-north-letter" y="-46">
              N
            </text>
            <path className="cm-north-arrow" d="M0 -34 L20 26 L0 12 L-20 26 Z" />
          </g>
        </g>
      </svg>
    </div>
  );
}
