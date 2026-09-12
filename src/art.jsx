/* ==========================================================================
   MONARCH - art.jsx
   Original decorative SVG. Presentational only: props in, SVG out.
   No hooks, no engine/store imports, no external assets.

   Every component takes `className` and `style`, paints with `currentColor`
   or a CSS custom property so it themes with the rest of the System panel,
   and is aria-hidden because it is decoration, not information.
   Geometry is generated from primitives - no long path dumps.
   ========================================================================== */

import React from "react";

/* ---------- tiny geometry helpers ---------- */

const RANK_ORDER = ["E", "D", "C", "B", "A", "S"];

/** 0 for E through 5 for S. Unknown ranks fall back to E. */
function tierOf(rank) {
  const i = RANK_ORDER.indexOf(String(rank || "E").toUpperCase());
  return i < 0 ? 0 : i;
}

/** n points evenly spaced on a circle. rot is degrees, -90 puts one at the top. */
function ring(cx, cy, r, n, rot = -90) {
  return Array.from({ length: n }, (_, i) => {
    const a = ((360 / n) * i + rot) * (Math.PI / 180);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

const points = (list) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

/** dash pattern that turns a circle into n evenly spaced tick marks */
const ticks = (r, n, w = 1.4) => `${w} ${((2 * Math.PI * r) / n - w).toFixed(2)}`;

const svgBase = { display: "block", overflow: "visible" };

/* ==========================================================================
   GateSigil - a rune/portal sigil. Complexity climbs with rank.
   <GateSigil rank="A" size={72} />
   ========================================================================== */

export function GateSigil({ rank = "E", size = 72, strokeWidth = 1.2, className = "", style }) {
  const t = tierOf(rank);
  const spokes = 4 + t;                       // 4 at E, 9 at S
  const tickCount = 12 + t * 6;               // 12 at E, 42 at S
  const hex = points(ring(50, 50, 38, 6));
  const inner = points(ring(50, 50, 29, 6, -60));
  const core = points(ring(50, 50, t >= 4 ? 11 : 9, 4));

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      data-rank={String(rank).toUpperCase()}
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ ...svgBase, color: "var(--mn-heat, var(--rune))", ...style }}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinejoin="miter"
    >
      {/* tick ring - a dashed circle, so the tick count is one attribute */}
      <circle cx="50" cy="50" r="46" strokeDasharray={ticks(46, tickCount)} opacity="0.6" />

      {/* outer hex */}
      <polygon points={hex} opacity="0.85" />

      {/* second, rotated hex from D upward */}
      {t >= 1 && <polygon points={inner} opacity="0.45" />}

      {/* radial spokes, from the core out to the tick ring */}
      {ring(50, 50, 1, spokes, -90).map(([ux, uy], i) => (
        <line
          key={i}
          x1={(50 + (ux - 50) * 20).toFixed(1)}
          y1={(50 + (uy - 50) * 20).toFixed(1)}
          x2={(50 + (ux - 50) * 43).toFixed(1)}
          y2={(50 + (uy - 50) * 43).toFixed(1)}
          opacity="0.3"
        />
      ))}

      {/* core diamond - fills in from A upward */}
      <polygon points={core} fill={t >= 4 ? "currentColor" : "none"} opacity={t >= 4 ? 0.9 : 0.7} />

      {/* S only: an extra containment ring and a hot core */}
      {t >= 5 && (
        <>
          <circle cx="50" cy="50" r="50" opacity="0.35" />
          <circle cx="50" cy="50" r="3.4" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

/* ==========================================================================
   MonarchCrest - the app emblem. Angular, heraldic, built from strokes.
   <MonarchCrest size={120} />
   ========================================================================== */

export function MonarchCrest({ size = 120, className = "", style, title }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      aria-hidden={title ? undefined : "true"}
      role={title ? "img" : undefined}
      focusable="false"
      style={{ ...svgBase, color: "var(--rune)", ...style }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="miter"
      strokeLinecap="square"
    >
      {title && <title>{title}</title>}

      {/* shield, cut at the shoulders */}
      <path d="M50 4 88 20v30L50 96 12 50V20z" opacity="0.9" />
      <path d="M50 13 80 26v22L50 84 20 48V26z" opacity="0.35" />

      {/* crown: two chevrons over a rising point */}
      <path d="M30 44 50 26l20 18" strokeWidth="2" />
      <path d="M34 57 50 42l16 15" opacity="0.6" />

      {/* central blade */}
      <path d="M50 30 56 48 50 80 44 48z" fill="currentColor" opacity="0.18" stroke="none" />
      <path d="M50 30v50" opacity="0.8" />

      {/* apex mark */}
      <polygon points={points(ring(50, 10, 5.5, 6))} fill="currentColor" opacity="0.9" stroke="none" />

      {/* flanking wing ticks */}
      <path d="M12 30 3 36l9 6" opacity="0.5" />
      <path d="M88 30l9 6-9 6" opacity="0.5" />
    </svg>
  );
}

/* ==========================================================================
   PanelFrame - cut corners and hairline brackets, overlaid on a card.
   The parent needs position:relative (use .mn-framed from theme.css).
   <div className="win-wrap mn-framed"> ... <PanelFrame /> </div>
   The top-left and bottom-right corners carry the same diagonal cut as .win.
   ========================================================================== */

export function PanelFrame({ size = 15, inset = 0, strokeWidth = 1, className = "", style }) {
  const s = size;
  const c = Math.round(size * 0.55);
  const k = s - c;

  // top-left is cut, top-right is square, bottom-right is cut, bottom-left is square
  const corners = [
    { d: `M0 ${s}V${c}L${c} 0H${s}`, pos: { top: inset, left: inset } },
    { d: `M0 0H${s}V${s}`, pos: { top: inset, right: inset } },
    { d: `M${s} 0V${k}L${k} ${s}H0`, pos: { bottom: inset, right: inset } },
    { d: `M0 0V${s}H${s}`, pos: { bottom: inset, left: inset } },
  ];

  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        pointerEvents: "none",
        color: "var(--rune)",
        ...style,
      }}
    >
      {corners.map((k, i) => (
        <svg
          key={i}
          viewBox={`0 0 ${s} ${s}`}
          width={s}
          height={s}
          focusable="false"
          style={{ position: "absolute", display: "block", ...k.pos }}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="square"
        >
          <path d={k.d} />
        </svg>
      ))}
    </span>
  );
}

/* ==========================================================================
   ShadowSoldier - abstract geometric silhouette. Original, not a likeness.
   <ShadowSoldier size={64} />
   ========================================================================== */

export function ShadowSoldier({ size = 64, className = "", style }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ ...svgBase, color: "var(--void-2)", ...style }}
    >
      {/* body: shoulders flaring to a base */}
      <path d="M32 37 52 47l4 17H8l4-17z" fill="currentColor" opacity="0.95" />
      {/* hood */}
      <path d="M32 4l11 9-1 19-10 7-10-7-1-19z" fill="currentColor" />
      {/* facet highlight down the left of the hood */}
      <path d="M32 4l-11 9 1 19 10 7z" fill="var(--rune-dim)" opacity="0.22" />
      {/* eye slits */}
      <path d="M23.5 22.5l7 2.2-.6 3.2-7-2.2z" fill="var(--rune-bright)" opacity="0.92" />
      <path d="M40.5 22.5l-7 2.2.6 3.2 7-2.2z" fill="var(--rune-bright)" opacity="0.92" />
      {/* seam and shoulder edges */}
      <path
        d="M32 39v22M14 51l6-3M50 51l-6-3"
        fill="none"
        stroke="var(--rune)"
        strokeWidth="1.1"
        opacity="0.3"
      />
    </svg>
  );
}

/* ==========================================================================
   StatHex - hexagonal frame for a stat readout.
   <StatHex size={72} label="AGI" value={7} color="var(--agi)" active />
   label/value are optional; leave them off to use it as a pure frame.
   ========================================================================== */

export function StatHex({
  size = 72,
  label,
  value,
  color = "currentColor",
  active = false,
  className = "",
  style,
}) {
  // matches the pointy-top hexagon clip-path used by .rank-glyph
  const outer = points(ring(50, 50, 44, 6));
  const inner = points(ring(50, 50, 34, 6));
  const labelled = label != null || value != null;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ ...svgBase, color, ...style }}
      fill="none"
      stroke="currentColor"
      strokeLinejoin="miter"
    >
      <polygon points={outer} fill="currentColor" opacity={active ? 0.12 : 0.05} stroke="none" />
      <polygon points={outer} strokeWidth="1.4" opacity={active ? 0.95 : 0.5} />
      <polygon points={inner} strokeWidth="1" opacity="0.22" />

      {/* corner ticks at three of the six vertices */}
      {ring(50, 50, 1, 6).filter((_, i) => i % 2 === 0).map(([dx, dy], i) => (
        <line
          key={i}
          x1={(50 + (dx - 50) * 44).toFixed(1)}
          y1={(50 + (dy - 50) * 44).toFixed(1)}
          x2={(50 + (dx - 50) * 50).toFixed(1)}
          y2={(50 + (dy - 50) * 50).toFixed(1)}
          strokeWidth="1.4"
          opacity="0.65"
        />
      ))}

      {labelled && (
        <g stroke="none" fill="currentColor" fontFamily="Rajdhani, sans-serif" textAnchor="middle">
          {label != null && (
            <text x="50" y="38" fontSize="13" fontWeight="700" letterSpacing="2.2" opacity="0.75">
              {label}
            </text>
          )}
          {value != null && (
            <text x="50" y="68" fontSize="30" fontWeight="700" letterSpacing="0.5">
              {value}
            </text>
          )}
        </g>
      )}
    </svg>
  );
}

/* ==========================================================================
   RuneRing - concentric rings, tick marks and angular glyphs.
   Sits behind the level display. Pair with .mn-portal__spin to rotate it.
   <RuneRing size={200} />
   ========================================================================== */

export function RuneRing({ size = 200, tickCount = 60, glyphs = 6, className = "", style }) {
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ ...svgBase, color: "var(--rune)", ...style }}
      fill="none"
      stroke="currentColor"
      strokeLinejoin="miter"
    >
      {/* fine tick ring */}
      <circle cx="100" cy="100" r="94" strokeWidth="1" strokeDasharray={ticks(94, tickCount, 1.2)} opacity="0.45" />
      {/* hairline */}
      <circle cx="100" cy="100" r="86" strokeWidth="1" opacity="0.22" />
      {/* coarse ticks, longer marks */}
      <circle cx="100" cy="100" r="74" strokeWidth="4" strokeDasharray={ticks(74, 12, 2)} opacity="0.3" />
      {/* inner hexagon and its rotated twin */}
      <polygon points={points(ring(100, 100, 60, 6))} strokeWidth="1" opacity="0.28" />
      <polygon points={points(ring(100, 100, 60, 6, -60))} strokeWidth="1" opacity="0.14" />

      {/* angular glyph marks around the rim */}
      {Array.from({ length: glyphs }, (_, i) => (
        <g key={i} transform={`rotate(${(360 / glyphs) * i} 100 100)`} opacity="0.55">
          <path d="M93 14l7-9 7 9" strokeWidth="1.3" />
          <path d="M97 22h6" strokeWidth="1.3" />
        </g>
      ))}
    </svg>
  );
}
