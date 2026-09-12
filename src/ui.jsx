import React, { useState, useEffect, useRef } from "react";
import { STATS, STAT_META } from "./engine.js";

/* ---------- system window ---------- */

export function Win({ title, right, tone, animate = true, children, className = "" }) {
  const toneClass = tone ? ` win--${tone}` : "";
  return (
    <div className={`win-wrap${animate ? " anim-open" : ""} ${className}`}>
      <div className={`win${toneClass}`}>
        <div className="win__in">
          {title && (
            <h3 className="win-title">
              <span>{title}</span>
              {right && <span className="mute">{right}</span>}
            </h3>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

/* ---------- icons (inline, no dependency) ---------- */

export const Ico = {
  check: (p) => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#060a14" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  status: (p) => (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M12 2 3 7v10l9 5 9-5V7z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  quest: (p) => (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}>
      <path d="M4 6h16M4 12h16M4 18h10" /><path d="M18.5 17.5l1.6 1.6 3-3.2" />
    </svg>
  ),
  gate: (p) => (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M12 2 21 8v8l-9 6-9-6V8z" /><path d="M12 8v8" /><path d="M8 10.5v3M16 10.5v3" />
    </svg>
  ),
  body: (p) => (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}>
      <circle cx="12" cy="4.5" r="2.2" /><path d="M12 7v7M7 10h10M9 21l3-7 3 7" />
    </svg>
  ),
  shadow: (p) => (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" {...p}>
      <path d="M12 3l7 4v6c0 4-3 7-7 8-4-1-7-4-7-8V7z" /><path d="M9 12l2 2 4-4" />
    </svg>
  ),
  system: (p) => (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" {...p}>
      <rect x="3" y="4" width="18" height="13" rx="1.5" /><path d="M8 21h8M12 17v4" />
      <path d="M7.5 8.5l2.2 2.2-2.2 2.2M12.5 12.7h4" strokeLinecap="round" />
    </svg>
  ),
  cog: (p) => (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </svg>
  ),
};

/* ---------- stat radar (hand-drawn SVG pentagon) ---------- */

export function StatRadar({ tiers, size = 190 }) {
  const cx = size / 2;
  const cy = size / 2 + 4;
  const r = size * 0.36;
  const n = STATS.length;
  const maxTier = Math.max(6, ...STATS.map((s) => tiers[s] || 1));

  const pt = (i, frac) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(a) * r * frac, cy + Math.sin(a) * r * frac];
  };

  const rings = [0.25, 0.5, 0.75, 1].map((f) =>
    STATS.map((_, i) => pt(i, f).join(",")).join(" ")
  );

  const shape = STATS.map((s, i) => pt(i, Math.max(0.09, (tiers[s] || 1) / maxTier)).join(",")).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${size} ${size + 8}`} style={{ display: "block" }}>
      {rings.map((p, i) => (
        <polygon key={i} points={p} fill="none" stroke="rgba(111,168,255,.16)" strokeWidth="1" />
      ))}
      {STATS.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(111,168,255,.13)" strokeWidth="1" />;
      })}
      <polygon points={shape} fill="rgba(111,168,255,.22)" stroke="#6fa8ff" strokeWidth="1.6"
        style={{ filter: "drop-shadow(0 0 6px rgba(111,168,255,.6))" }} />
      {STATS.map((s, i) => {
        const [x, y] = pt(i, Math.max(0.09, (tiers[s] || 1) / maxTier));
        return <circle key={s} cx={x} cy={y} r="3" fill={STAT_META[s].color} />;
      })}
      {STATS.map((s, i) => {
        const [x, y] = pt(i, 1.24);
        return (
          <text key={s} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            fill={STAT_META[s].color} fontSize="11.5" fontWeight="700"
            fontFamily="Rajdhani, sans-serif" letterSpacing="1">
            {s}
          </text>
        );
      })}
    </svg>
  );
}

/* ---------- sparkline ---------- */

export function Spark({ values, color = "#6fa8ff", height = 74, invert = false }) {
  if (!values || values.length < 2) {
    return <div className="empty">Not enough entries yet to draw a line.</div>;
  }
  const w = 320;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 8) + 4;
    const y = height - 8 - ((v - min) / span) * (height - 18);
    return [x, y];
  });
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${d} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;

  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      <path d={area} fill={color} opacity="0.13" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 4px ${color}88)` }} />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3.2" fill={color} />
    </svg>
  );
}

/* ---------- audio ---------- */

let ctx = null;
export function chime(kind = "quest") {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    const notes =
      kind === "level" ? [523.25, 659.25, 783.99, 1046.5]
      : kind === "penalty" ? [329.63, 261.63, 196]      // falling, deliberately sour
      : [880, 1174.7];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = f;
      const t = now + i * (kind === "level" ? 0.1 : kind === "penalty" ? 0.16 : 0.055);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(kind === "level" ? 0.14 : 0.08, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.36);
    });
  } catch {
    /* audio blocked; silence is fine */
  }
}


/* Rolls a number to its new value rather than snapping. Eases out over
   ~520ms, driven by rAF against a wall clock so a throttled tab lands on the
   right number instead of stopping partway. Returns the target unchanged when
   the viewer has asked for reduced motion, and on the very first render, so a
   board never counts up from zero just because you opened it. */
export function useCountUp(value, ms = 520) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const first = useRef(true);

  useEffect(() => {
    const target = Number(value) || 0;
    if (first.current) { first.current = false; from.current = target; setShown(target); return undefined; }

    const reduce = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || from.current === target) { from.current = target; setShown(target); return undefined; }

    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(a + (target - a) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);

  return shown;
}
