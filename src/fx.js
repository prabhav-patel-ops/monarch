/* ===================================================================
   fx.js — the game layer.

   Everything in here is feedback, and nothing in here is state. No
   screen has to import it to work; the app runs identically with
   `fx: "off"` and the whole file inert. That is the deal: flair never
   becomes load bearing.

   Three jobs.

   1. A particle field on one shared canvas. One canvas, one rAF loop,
      and the loop stops dead when the last particle dies — an idle
      board costs nothing.
   2. A DOM overlay for the things text does better than canvas: XP
      numbers that float, orbs that fly to the level glyph, a screen
      flash.
   3. One global pointer handler, so "every touch answers" is written
      once here instead of three hundred times across the screens.

   Rules it keeps:
   - Only transform and opacity animate. Nothing per-frame touches
     layout, and the canvas never reads back.
   - `prefers-reduced-motion` wins over the app's own setting. It is
     the person's phone, not ours.
   - Every entry point is safe to call during SSR, before mount, and
     with a target that is not on screen. It returns quietly.
   =================================================================== */

const isDom = typeof window !== "undefined" && typeof document !== "undefined";

/* "full" | "lite" | "off" — mirrored onto <html data-fx> so CSS can
   branch on the same switch without prop-drilling it anywhere. */
let level = "full";
let haptics = true;

let canvas = null;
let g = null;
let layer = null;
let dpr = 1;
let raf = 0;
let last = 0;

const parts = [];
const MAX_PARTS = 170;

/* Where the last finger went down. The quest tick fires from a state
   commit that never saw the event, so it reads the point from here
   rather than every screen threading coordinates up. */
export const lastPoint = { x: 0, y: 0, at: 0 };

let reduceMq = null;
function reduced() {
  if (!isDom) return true;
  if (!reduceMq) reduceMq = window.matchMedia?.("(prefers-reduced-motion: reduce)") || { matches: false };
  return !!reduceMq.matches;
}

export function fxOn() { return isDom && level !== "off" && !reduced(); }
export function fxFull() { return fxOn() && level === "full"; }
export function fxLevel() { return level; }

export function setFxLevel(next) {
  level = ["full", "lite", "off"].includes(next) ? next : "full";
  if (isDom) document.documentElement.dataset.fx = reduced() ? "off" : level;
  if (level === "off") clear();
}

export function setHaptics(on) { haptics = !!on; }

/** A short buzz. Absent on iOS Safari, which is why nothing depends on it. */
export function haptic(pattern = 8) {
  if (!isDom || !haptics || level === "off" || reduced()) return;
  try { navigator.vibrate?.(pattern); } catch { /* not supported; fine */ }
}

/* ---------- the shared surfaces ---------- */

function ensure() {
  if (!isDom || canvas) return;
  canvas = document.createElement("canvas");
  canvas.className = "fx-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  g = canvas.getContext("2d");

  layer = document.createElement("div");
  layer.className = "fx-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.appendChild(layer);

  resize();
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("orientationchange", resize, { passive: true });
}

function resize() {
  if (!canvas) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function clear() {
  parts.length = 0;
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  last = 0;
  if (g) g.clearRect(0, 0, window.innerWidth, window.innerHeight);
  if (layer) layer.textContent = "";
}

/* ---------- the loop ---------- */

function loop(now) {
  const dt = Math.min(0.048, (now - (last || now)) / 1000);
  last = now;

  const w = window.innerWidth;
  const h = window.innerHeight;
  g.clearRect(0, 0, w, h);
  g.globalCompositeOperation = "lighter";

  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.t += dt;
    if (p.t >= p.life) { parts.splice(i, 1); continue; }

    p.vy += p.gy * dt;
    const k = 1 - Math.min(1, p.drag * dt);
    p.vx *= k;
    p.vy *= k;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;

    draw(p, p.t / p.life);
  }

  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;

  if (parts.length) raf = requestAnimationFrame(loop);
  else { raf = 0; last = 0; g.clearRect(0, 0, w, h); }
}

function kick() { if (!raf) raf = requestAnimationFrame(loop); }

function draw(p, u) {
  const fade = p.kind === "ring" ? 1 - u * u : 1 - u;
  g.globalAlpha = Math.max(0, fade) * p.alpha;

  if (p.kind === "ring") {
    const r = p.r0 + (p.r1 - p.r0) * (1 - Math.pow(1 - u, 3));
    g.beginPath();
    g.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2);
    g.strokeStyle = p.color;
    g.lineWidth = p.w * (1 - u * 0.75);
    g.stroke();
    return;
  }

  if (p.kind === "spark") {
    g.beginPath();
    g.moveTo(p.x, p.y);
    g.lineTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022);
    g.strokeStyle = p.color;
    g.lineWidth = p.w;
    g.lineCap = "round";
    g.stroke();
    return;
  }

  if (p.kind === "shard") {
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    g.fillStyle = p.color;
    g.fillRect(-p.w * 0.5, -p.w * 1.8, p.w, p.w * 3.6);
    g.restore();
    return;
  }

  g.beginPath();
  g.arc(p.x, p.y, p.w, 0, Math.PI * 2);
  g.fillStyle = p.color;
  g.fill();
}

function push(p) {
  if (parts.length >= MAX_PARTS) parts.splice(0, parts.length - MAX_PARTS + 1);
  parts.push(p);
}

/* ---------- emitters ---------- */

const RUNE = "#6fa8ff";

/**
 * A spray of light at a screen point. `count` is a wish, not a promise —
 * "lite" halves it and the hard cap trims it further.
 */
export function burst(x, y, opts = {}) {
  if (!fxOn() || !Number.isFinite(x)) return;
  ensure();

  const scale = level === "lite" ? 0.45 : 1;
  const n = Math.max(1, Math.round((opts.count ?? 14) * scale));
  const color = opts.color || RUNE;
  const speed = opts.speed ?? 210;
  const life = opts.life ?? 0.62;
  const spread = opts.spread ?? Math.PI * 2;
  const aim = opts.aim ?? -Math.PI / 2;
  const kind = opts.kind || "spark";

  for (let i = 0; i < n; i++) {
    const a = aim + (Math.random() - 0.5) * spread;
    const v = speed * (0.45 + Math.random() * 0.8);
    push({
      kind,
      x, y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      gy: opts.gravity ?? 340,
      drag: opts.drag ?? 1.5,
      t: 0,
      life: life * (0.7 + Math.random() * 0.6),
      w: (opts.size ?? 1.7) * (0.6 + Math.random() * 0.9),
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 12,
      alpha: opts.alpha ?? 0.95,
      color,
    });
  }
  kick();
}

/** One expanding hoop. The cheapest thing that reads as impact. */
export function ring(x, y, opts = {}) {
  if (!fxOn() || !Number.isFinite(x)) return;
  ensure();
  push({
    kind: "ring",
    x, y,
    vx: 0, vy: 0, gy: 0, drag: 0,
    t: 0,
    life: opts.life ?? 0.5,
    r0: opts.from ?? 4,
    r1: opts.to ?? 42,
    w: opts.width ?? 2,
    rot: 0, spin: 0,
    alpha: opts.alpha ?? 0.7,
    color: opts.color || RUNE,
  });
  kick();
}

/* ---------- the touch answer ---------- */

/**
 * What a finger gets back. Two flavours: `strong` for something that
 * commits (a tick, a primary button) and a near-subliminal ring for
 * everything else, including a tap on empty space — a surface that
 * never answers reads as dead glass.
 */
export function tap(x, y, strong = false) {
  if (!fxOn()) return;
  if (strong) {
    ring(x, y, { from: 3, to: 34, life: 0.42, width: 2, alpha: 0.8 });
    burst(x, y, { count: 7, speed: 150, life: 0.4, size: 1.4, gravity: 180, spread: Math.PI * 2 });
  } else {
    ring(x, y, { from: 2, to: 22, life: 0.34, width: 1.4, alpha: 0.42 });
  }
}

const TAP_SEL = "button,a,.quest,.gate,.kv,.pill,.mn-cal-cell,.mn-alert,[data-fx-tap]";
const STRONG_SEL = ".quest,.solid,.danger,.mn-cal-cell,.mn-alert";

/**
 * One listener for the whole app. Capture phase and passive, so it
 * cannot swallow a gesture or delay a scroll, and it records the point
 * whether or not effects are on.
 */
export function installTouchFx() {
  if (!isDom) return () => {};

  const down = (e) => {
    if (!Number.isFinite(e.clientX)) return;
    lastPoint.x = e.clientX;
    lastPoint.y = e.clientY;
    lastPoint.at = Date.now();
    if (!fxOn()) return;

    const el = e.target?.closest?.(TAP_SEL);
    if (el && !el.disabled) {
      tap(e.clientX, e.clientY, el.matches(STRONG_SEL));
      haptic(el.matches(".quest") ? 12 : 6);
    } else if (level === "full") {
      /* Empty space still answers, quietly. */
      ring(e.clientX, e.clientY, { from: 1, to: 15, life: 0.3, width: 1, alpha: 0.24 });
    }
  };

  document.addEventListener("pointerdown", down, { passive: true, capture: true });
  return () => document.removeEventListener("pointerdown", down, { capture: true });
}

/* ---------- overlay pieces ---------- */

/** A number that leaves the finger and goes up. */
export function floater(x, y, text, opts = {}) {
  if (!fxOn() || !text) return;
  ensure();
  const el = document.createElement("div");
  el.className = `fx-float${opts.big ? " fx-float--big" : ""}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.setProperty("--fx-dx", `${(Math.random() - 0.5) * 34}px`);
  if (opts.color) el.style.color = opts.color;
  layer.appendChild(el);
  setTimeout(() => el.remove(), opts.ms ?? 1150);
}

/**
 * A mote of XP that flies from the tick to the rank glyph and lands.
 * The arc is a CSS animation on a translate, so the whole flight stays
 * on the compositor. Falls through to `onArrive` immediately if the
 * target is not on screen, so a caller can rely on it firing exactly
 * once either way.
 */
export function orb(x, y, target, opts = {}) {
  const el = isDom && (typeof target === "string" ? document.querySelector(target) : target);
  if (!fxOn() || !el) { opts.onArrive?.(); return; }
  ensure();

  const r = el.getBoundingClientRect();
  if (!r.width) { opts.onArrive?.(); return; }

  const tx = r.left + r.width / 2 - x;
  const ty = r.top + r.height / 2 - y;
  const color = opts.color || RUNE;

  const node = document.createElement("span");
  node.className = "fx-orb";
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  node.style.setProperty("--fx-tx", `${tx}px`);
  node.style.setProperty("--fx-ty", `${ty}px`);
  node.style.setProperty("--fx-c", color);
  layer.appendChild(node);

  const ms = opts.ms ?? 600;
  setTimeout(() => {
    node.remove();
    burst(x + tx, y + ty, { count: 9, color, speed: 130, life: 0.45, size: 1.4 });
    pulse(el);
    opts.onArrive?.();
  }, ms);
}

/** Make an element acknowledge that something landed on it. */
export function pulse(el, cls = "fx-pulse") {
  const node = isDom && (typeof el === "string" ? document.querySelector(el) : el);
  if (!fxOn() || !node) return;
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
  setTimeout(() => node.classList.remove(cls), 700);
}

/**
 * Screen shake, applied to the content column rather than `.app`.
 * Transforming `.app` would make it the containing block for the fixed
 * nav, which snaps to the 620px column for the duration of the shake —
 * invisible on a phone, obvious on a desktop.
 */
export function shake(px = 8, ms = 420) {
  if (!fxFull()) return;
  const el = document.querySelector(".content");
  if (!el) return;
  el.style.setProperty("--fx-shake", `${px}px`);
  el.classList.remove("fx-shaking");
  void el.offsetWidth;
  el.classList.add("fx-shaking");
  setTimeout(() => el.classList.remove("fx-shaking"), ms);
}

/** A single wash of colour over the whole screen. */
export function flashScreen(color = RUNE, ms = 420) {
  if (!fxFull()) return;
  ensure();
  const el = document.createElement("div");
  el.className = "fx-flash";
  el.style.setProperty("--fx-c", color);
  el.style.setProperty("--fx-ms", `${ms}ms`);
  layer.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/**
 * Chain counter. Only shown from three, because two in a row is not a
 * run — it is two taps, and calling it a combo would cheapen the word
 * by the end of the first week.
 */
export function combo(n) {
  if (!fxFull() || n < 3) return;
  ensure();
  const el = document.createElement("div");
  el.className = "fx-combo";
  el.innerHTML = "";
  const big = document.createElement("span");
  big.textContent = `${n}×`;
  const small = document.createElement("small");
  small.textContent = n >= 6 ? "unbroken" : "chain";
  el.appendChild(big);
  el.appendChild(small);
  layer.appendChild(el);
  setTimeout(() => el.remove(), 900);

  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.22;
  ring(cx, cy, { from: 12, to: 90 + n * 8, life: 0.55, width: 2, color: "#ffc24b", alpha: 0.6 });
  if (n >= 6) shake(4, 300);
}

/* ---------- set pieces ---------- */

/** Rising column of light. Used when a day clears. */
export function pillar(x, y, color = RUNE) {
  if (!fxOn()) return;
  burst(x, y, { count: 26, color, speed: 420, life: 1, spread: 0.7, aim: -Math.PI / 2, gravity: 460, size: 2 });
  ring(x, y, { from: 6, to: 120, life: 0.7, width: 2.5, color, alpha: 0.65 });
}

/** The level-up shower, fired from the middle of the screen. */
export function celebrate(color = "#ffc24b") {
  if (!fxOn()) return;
  const w = window.innerWidth;
  const cx = w / 2;
  const cy = window.innerHeight * 0.36;

  ring(cx, cy, { from: 10, to: Math.max(w, 420), life: 0.85, width: 3, color, alpha: 0.55 });
  ring(cx, cy, { from: 10, to: Math.max(w, 420) * 0.7, life: 0.7, width: 2, color: RUNE, alpha: 0.5 });
  burst(cx, cy, { count: 44, color, speed: 520, life: 1.1, size: 2.2, gravity: 300, kind: "shard" });
  burst(cx, cy, { count: 30, color: RUNE, speed: 380, life: 0.9, size: 1.8 });

  /* A second wave, so it reads as an event rather than a pop. */
  setTimeout(() => {
    if (!fxOn()) return;
    burst(cx - w * 0.28, cy + 40, { count: 16, color, speed: 380, life: 0.9, kind: "shard" });
    burst(cx + w * 0.28, cy + 40, { count: 16, color, speed: 380, life: 0.9, kind: "shard" });
  }, 180);

  shake(6, 380);
}

/** The other direction. Colder, heavier, no shards. */
export function collapse(color = "#ff4d6d") {
  if (!fxOn()) return;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.36;
  ring(cx, cy, { from: 140, to: 8, life: 0.6, width: 3, color, alpha: 0.7 });
  burst(cx, cy, { count: 22, color, speed: 150, life: 1.2, gravity: 620, size: 1.8, drag: 0.6 });
  flashScreen(color, 380);
  shake(10, 460);
}

/** Called once from the app shell. Idempotent. */
export function mountFx() {
  if (!isDom) return () => {};
  ensure();
  return installTouchFx();
}

export function fxTeardown() { clear(); }
