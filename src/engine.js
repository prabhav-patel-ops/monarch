/* ============================================================
   MONARCH — engine
   Pure functions only. No React, no storage, no DOM.
   Everything here is unit-testable in plain node.
   ============================================================ */

export const STATS = ["STR", "AGI", "INT", "PER", "VIT"];

export const STAT_META = {
  STR: { label: "Strength", feeds: "Gym and calisthenics", color: "#FF7A4A" },
  AGI: { label: "Agility", feeds: "Codeforces and shipping", color: "#3FE0A8" },
  INT: { label: "Intelligence", feeds: "Maths and finance", color: "#A98BFF" },
  PER: { label: "Perception", feeds: "Brainteasers", color: "#FFC24B" },
  VIT: { label: "Vitality", feeds: "Sleep, food, recovery", color: "#6FA8FF" },
};

/* ---------- dates ---------- */

export function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseKey(k) {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function shiftKey(k, days) {
  const d = parseKey(k);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

export function daysBetween(a, b) {
  return Math.round((parseKey(b) - parseKey(a)) / 86400000);
}

/* ---------- levels and rank ---------- */

// XP required to advance FROM `level` to level+1.
/* E -> D used to arrive in five days, which made the first promotion feel
   like nothing. The cause was a curve that was almost free at the bottom and
   steep only later. This one is expensive from level one: each level costs
   roughly a fifth more than the last rather than several times more, so the
   early climb is real work and the top still stays reachable. The escalating
   part of the difficulty lives in the rising bar, not here. */
export const LEVEL_BASE = 280;
export const LEVEL_EXP = 1.15;

export function xpForLevel(level) {
  return Math.round(LEVEL_BASE * Math.pow(level, LEVEL_EXP));
}

export function levelFromTotalXp(totalXp) {
  let level = 1;
  let remaining = Math.max(0, totalXp);
  let need = xpForLevel(level);
  while (remaining >= need && level < 999) {
    remaining -= need;
    level += 1;
    need = xpForLevel(level);
  }
  return { level, xpInLevel: remaining, xpNeeded: need };
}

/* Held against sustained 95% play on the current board: D inside a week,
   C at a month, B at three months, A at just under seven, S beyond a year.
   D sits at 7 where it always did — the first promotion should be reachable,
   and everything after it should not.

   The ranks only pace the climb. The difficulty is in the bar a day has to
   clear, which rises with you — see earnedBar below. */
const RANK_TABLE = [
  { min: 26, rank: "S" },
  { min: 20, rank: "A" },
  { min: 16, rank: "B" },
  { min: 12, rank: "C" },
  { min: 7, rank: "D" },
  { min: 0, rank: "E" },
];

export function rankFromLevel(level) {
  return RANK_TABLE.find((r) => level >= r.min).rank;
}

export function nextRankAt(level) {
  const ordered = [...RANK_TABLE].sort((a, b) => a.min - b.min);
  const next = ordered.find((r) => r.min > level);
  return next ? next : null;
}

// Stat tiers are derived from accumulated stat XP, independently of hunter level.
export function statTier(statXp) {
  const t = Math.floor(Math.pow(Math.max(0, statXp) / 120, 0.62)) + 1;
  return Math.min(99, t);
}

/* ---------- shadows (permanent passive bonuses) ---------- */

export function shadowMultiplier(shadows, stat) {
  if (!shadows || !shadows.length) return 1;
  const bonus = shadows
    .filter((s) => s.stat === stat)
    .reduce((sum, s) => sum + (s.bonus || 0), 0);
  return 1 + bonus / 100;
}

/* ---------- quest generation ---------- */

/*
  A generated quest:
  { id, title, detail, stat, xp, done, penalty, slot }
*/

/**
 * Resolve {placeholder} tokens in a detail line against current progression.
 * Details are plain strings, not functions, so they survive the JSON round-trip
 * used to clone templates into saved state and stay editable in the app.
 */
export function resolveDetail(detail, prog = {}) {
  if (typeof detail !== "string") return "";
  const vals = {
    ...prog,
    cfBandTop: (prog.cfBand ?? 0) + 200,
  };
  return detail.replace(/\{(\w+)\}/g, (whole, key) =>
    vals[key] === undefined ? whole : String(vals[key])
  );
}

function instantiate(template, prog, idx, dk) {
  const detail = resolveDetail(template.detail, prog);
  return {
    id: `${dk}#${idx}#${template.key}`,
    key: template.key,
    title: template.title,
    detail: detail || "",
    stat: template.stat,
    xp: template.xp,
    slot: template.slot,
    done: false,
    penalty: false,
  };
}

/**
 * Build the quest list for a date.
 * Carries forward any quest missed the previous day as a penalty quest.
 */
export function generateDay(dk, templatesByWeekday, prog, prevDay, bar) {
  const weekday = parseKey(dk).getDay();
  const templates = templatesByWeekday[weekday] || [];
  const quests = templates.map((t, i) => instantiate(t, prog, i, dk));

  if (prevDay && Array.isArray(prevDay.quests)) {
    const missed = prevDay.quests.filter((q) => !q.done && !q.excused);
    missed.forEach((q, i) => {
      // Only carry it forward if today does not already contain the same key.
      if (quests.some((x) => x.key === q.key)) return;
      quests.push({
        ...q,
        id: `${dk}#p${i}#${q.key}`,
        xp: Math.round(q.xp * 1.5),
        done: false,
        penalty: true,
        slot: "penalty",
      });
    });
  }

  const out = { date: dk, quests, generated: true, levelUpSeen: false };
  if (typeof bar === "number") out.bar = bar;
  return out;
}

export function dayAvailableXp(day) {
  return day.quests.reduce((s, q) => s + q.xp, 0);
}

export function dayEarnedXp(day) {
  return day.quests.filter((q) => q.done).reduce((s, q) => s + q.xp, 0);
}

// A day is "cleared" at 70% of available XP — deliberately not all-or-nothing.
export const CLEAR_THRESHOLD = 0.7;

export function isDayCleared(day, mode) {
  const avail = dayAvailableXp(day);
  if (avail === 0) return false;
  const bar = typeof day.bar === "number"
    ? day.bar
    : ((DIFFICULTY[mode] || {}).clearBar ?? CLEAR_THRESHOLD);
  return dayEarnedXp(day) / avail >= bar;
}

/* ---------- penalties ----------

   Discipline model. Three ideas, in order of importance:

   1. A day is graded continuously, not pass/fail. The penalty scales with
      how far short you fell, so one missed quest stings a little and an
      abandoned day hurts a lot.
   2. Cost is denominated in DAYS OF WORK, not raw XP. Losing "one day" means
      losing that day's own available XP, which is what makes the number
      legible: a slip you can see the price of.
   3. Repeat lapses escalate. The same shortfall costs more the fourth time
      in a fortnight than the first.

   Three floors stop it becoming unrecoverable, because a system you abandon
   teaches nothing:
     - excused quests leave the denominator (illness, travel)
     - escalation is capped
     - clean days forgive past lapses
*/

// Full marks. Below this a day is short and is charged for.
export const CLEAN_BAR = 1.0;
// A shortfall of 100% costs this many days of work, before escalation.
export const PENALTY_DEPTH = 1.25;
// Escalation added per unforgiven lapse in the window.
export const ESCALATION_STEP = 0.4;
export const ESCALATION_CAP = 3;
export const LAPSE_WINDOW = 14;
// Clean days needed to forgive one past lapse.
export const FORGIVE_EVERY = 2;
/* Kept for saves and difficulty rows that still name it. The boundary that
   decides a lapse is now each difficulty's own clear bar, so that a day which
   cleared is never also a lapse. */
export const LAPSE_BAR = 0.95;

/** Available XP for a day, ignoring anything excused. */
export function dayChargeableXp(day) {
  return day.quests.filter((q) => !q.excused).reduce((s, q) => s + q.xp, 0);
}

/**
 * Grade a day: ratio of what was earned against what was chargeable.
 * A day with everything excused is neutral — neither clean nor a lapse.
 */
export function gradeDay(day, mode) {
  const avail = dayChargeableXp(day);
  if (avail === 0) return { ratio: 1, shortfall: 0, grade: "void", bar: 1, needed: 0 };
  const earned = day.quests.filter((q) => q.done && !q.excused).reduce((s, q) => s + q.xp, 0);
  const ratio = Math.min(1, earned / avail);
  // A day carries the bar it was generated under, so raising the standard
  // tomorrow can never retroactively fail a day already won.
  const bar = typeof day.bar === "number" ? day.bar : difficultyOf(mode).clearBar;

  // Clear the day and you owe nothing, however much of the board is left.
  // Below the bar, a total collapse still reads as a full shortfall of 1.
  const shortfall = ratio >= bar ? 0 : (bar - ratio) / bar;

  let grade;
  if (ratio >= CLEAN_BAR) grade = "clean";
  else if (ratio >= bar) grade = "held";
  else if (ratio >= bar * 0.5) grade = "slipped";
  else grade = "broken";

  return { ratio, shortfall, grade, bar, needed: Math.max(0, Math.ceil(avail * bar) - earned) };
}

/**
 * Escalation multiplier for a date, from lapses in the trailing window
 * minus forgiveness earned by consecutive clean days immediately before it.
 */
export function escalationAt(days, dk, todayKey, mode) {
  // Escalation keys off CONSECUTIVE lapses, not a count in a window.
  // A run of bad days compounds hard; an isolated slip between good days does
  // not. This is the difference between measuring a spiral and punishing noise.
  let run = 0;
  for (let i = 1; i <= LAPSE_WINDOW; i++) {
    const d = days[shiftKey(dk, -i)];
    if (!d || !d.generated) break;
    const g = gradeDay(d, mode).grade;
    if (g === "slipped" || g === "broken") run += 1;
    else break;
  }

  // Clean days before that run pay part of it down rather than wiping it.
  let cleanRun = 0;
  for (let i = run + 1; i <= LAPSE_WINDOW; i++) {
    const d = days[shiftKey(dk, -i)];
    if (!d || !d.generated) break;
    if (gradeDay(d, mode).grade === "clean") cleanRun += 1;
    else break;
  }

  // Days that ANSWERED this one. Each clean or held day immediately after a
  // lapse pays off one step of its escalation, which is what makes covering
  // the work the next day worth doing. An unfinished day proves nothing yet,
  // so today never counts as recovery for the day before it.
  let recovered = 0;
  for (let i = 1; i <= LAPSE_WINDOW; i++) {
    const k = shiftKey(dk, i);
    if (todayKey && k >= todayKey) break;
    const d = days[k];
    if (!d || !d.generated) break;
    const g = gradeDay(d, mode).grade;
    if (g === "clean" || g === "held") recovered += 1;
    else break;
  }

  const forgiven = Math.floor(cleanRun / FORGIVE_EVERY);
  const effective = Math.max(0, run - forgiven - recovered);
  return {
    lapses: run,
    forgiven,
    recovered,
    effective,
    multiplier: Math.min(ESCALATION_CAP, 1 + ESCALATION_STEP * effective),
  };
}

/**
 * XP charged for a past day, split across stats in proportion to where the
 * work was left undone. Returns { total, byStat, days } where `days` is the
 * cost expressed in days of work.
 */
export function dayPenalty(day, multiplier = 1, depth = PENALTY_DEPTH, mode) {
  const out = {};
  STATS.forEach((s) => (out[s] = 0));
  const { shortfall } = gradeDay(day, mode);
  if (shortfall <= 0) return { total: 0, byStat: out, days: 0 };

  const avail = dayChargeableXp(day);
  const costDays = shortfall * depth * multiplier;
  const total = Math.round(costDays * avail);

  // Attribute the charge to the stats actually left short.
  const missed = day.quests.filter((q) => !q.done && !q.excused);
  const missedXp = missed.reduce((s, q) => s + q.xp, 0) || 1;
  missed.forEach((q) => {
    out[q.stat] += Math.round(total * (q.xp / missedXp));
  });

  return { total, byStat: out, days: +costDays.toFixed(2) };
}

/** What today would cost right now if the day ended here. */
export function projectedPenalty(days, dk, mode) {
  const day = days[dk];
  if (!day) return null;
  const esc = escalationAt(days, dk, null, mode);
  const rules = difficultyOf(mode);
  return { ...dayPenalty(day, esc.multiplier, rules.depth, mode), escalation: esc, grade: gradeDay(day, mode) };
}

/**
 * Count misses per stat across a trailing window. 3+ in a stat raises a flag.
 */
export function missFlags(days, endKey, window = 7) {
  const counts = {};
  STATS.forEach((s) => (counts[s] = 0));
  for (let i = 1; i <= window; i++) {
    const k = shiftKey(endKey, -i);
    const d = days[k];
    if (!d) continue;
    d.quests
      .filter((q) => !q.done && !q.excused)
      .forEach((q) => (counts[q.stat] += 1));
  }
  return Object.fromEntries(
    STATS.map((s) => [s, { misses: counts[s], flagged: counts[s] >= 3 }])
  );
}

/* ---------- ratchet (difficulty progression) ---------- */

export const RATCHET_RULES = {
  AGI: { field: "cfBand", step: 25, cap: 2100, unit: "rating" },
  INT: { field: "hullPages", step: 1, cap: 35, unit: "pages" },
  PER: { field: "teasers", step: 1, cap: 6, unit: "puzzles" },
};

export const RATCHET_STREAK = 8;

/**
 * A stat ratchets up after RATCHET_STREAK consecutive occurrences in which
 * every quest of that stat was completed. Returns { prog, raised: [...] }.
 */
export function applyRatchet(days, endKey, prog, settings = {}) {
  const streakNeeded = settings.ratchetStreak || RATCHET_STREAK;
  const next = { ...prog };
  const stamped = { ...(prog.ratchetedOn || {}) };
  next.ratchetedOn = stamped;
  const raised = [];

  Object.entries(RATCHET_RULES).forEach(([stat, rule]) => {
    // At most one step per stat per day. Without this, every save after a
    // clean run would raise the bar again and the band would run away.
    if (stamped[stat] === endKey) return;

    let run = 0;
    for (let i = 0; i < 60; i++) {
      const k = shiftKey(endKey, -i);
      // Days at or before the last raise are already spent; the run restarts
      // afterwards, otherwise a clean stretch would ratchet every single day.
      if (stamped[stat] && k <= stamped[stat]) break;
      const d = days[k];
      if (!d) continue;
      const qs = d.quests.filter((q) => q.stat === stat);
      if (!qs.length) continue;
      if (qs.every((q) => q.done)) run += 1;
      else break;
      if (run >= streakNeeded) break;
    }
    if (run >= streakNeeded && next[rule.field] < rule.cap) {
      const before = next[rule.field];
      next[rule.field] = Math.min(rule.cap, before + rule.step);
      if (next[rule.field] !== before) {
        stamped[stat] = endKey;
        raised.push({ stat, field: rule.field, from: before, to: next[rule.field], unit: rule.unit });
      }
    }
  });

  return { prog: next, raised };
}

/* ---------- streak ---------- */

export function computeStreak(days, todayKey) {
  let current = 0;
  // today only counts once cleared; yesterday backwards always counts
  for (let i = 0; i < 400; i++) {
    const k = shiftKey(todayKey, -i);
    const d = days[k];
    if (!d) {
      if (i === 0) continue;
      break;
    }
    if (isDayCleared(d)) current += 1;
    else if (i === 0) continue; // today still in progress
    else break;
  }

  let best = 0;
  let run = 0;
  const keys = Object.keys(days).sort();
  let prev = null;
  keys.forEach((k) => {
    const cleared = isDayCleared(days[k]);
    if (cleared && prev && daysBetween(prev, k) === 1) run += 1;
    else if (cleared) run = 1;
    else run = 0;
    best = Math.max(best, run);
    prev = k;
  });

  return { current, best: Math.max(best, current) };
}

/* ---------- totals ---------- */

/**
 * Recompute hunter XP and per-stat XP from the full day log.
 * Recomputing from source beats incrementing counters — no drift.
 */
export function recomputeTotals(days, shadows, todayKey, mode) {
  const rules = DIFFICULTY[mode] || DIFFICULTY.normal;
  const statXp = {};
  STATS.forEach((s) => (statXp[s] = 0));
  let total = 0;
  let charged = 0;      // total XP lost to penalties, for display
  let chargedDays = 0;  // same, expressed in days of work

  const keys = Object.keys(days).sort();

  keys.forEach((k) => {
    const d = days[k];

    // Credit everything done, on any day including today.
    d.quests.forEach((q) => {
      if (!q.done) return;
      const gain = Math.round(q.xp * shadowMultiplier(shadows, q.stat));
      statXp[q.stat] += gain;
      total += gain;
    });

    // Side work is credited the same way but was never part of the day's
    // available XP, so it lifts the total without moving the bar.
    const extra = extraByStat(d);
    STATS.forEach((st) => {
      if (!extra[st]) return;
      const gain = Math.round(extra[st] * shadowMultiplier(shadows, st));
      statXp[st] += gain;
      total += gain;
    });

    // Charge only days that have closed. Today is still winnable.
    if (k >= todayKey) return;

    const esc = escalationAt(days, k, todayKey, mode);
    const pen = dayPenalty(d, esc.multiplier, rules.depth, mode);
    if (pen.total === 0) return;

    STATS.forEach((s) => {
      statXp[s] = Math.max(0, statXp[s] - (pen.byStat[s] || 0));
    });
    total = Math.max(0, total - pen.total);
    charged += pen.total;
    chargedDays += pen.days;
  });

  return { totalXp: total, statXp, charged, chargedDays: +chargedDays.toFixed(1) };
}

/* ---------- nutrition (carried over from APEX) ---------- */

export function macroTotals(entries) {
  return (entries || []).reduce(
    (a, e) => ({
      kcal: a.kcal + (e.kcal || 0),
      protein: a.protein + (e.protein || 0),
      carbs: a.carbs + (e.carbs || 0),
      fat: a.fat + (e.fat || 0),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

export function scaleFood(food, mult) {
  return {
    name: food.name,
    qty: `${+(food.base * mult).toFixed(2)} ${food.unit}`,
    kcal: Math.round(food.kcal * mult),
    protein: +(food.protein * mult).toFixed(1),
    carbs: +(food.carbs * mult).toFixed(1),
    fat: +(food.fat * mult).toFixed(1),
  };
}

export function smooth(series, window = 7) {
  return series.map((_, i) => {
    const slice = series.slice(Math.max(0, i - window + 1), i + 1);
    return +(slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(2);
  });
}

/* ---------- gates ---------- */

export const GATE_RANKS = ["E", "D", "C", "B", "A", "S"];

export function gateStatus(gate, todayKey) {
  if (gate.cleared) return "cleared";
  if (gate.date < todayKey) return "collapsed";
  const d = daysBetween(todayKey, gate.date);
  if (d === 0) return "open";
  if (d <= 3) return "imminent";
  return "dormant";
}

export function sortGates(gates, todayKey) {
  const order = { open: 0, imminent: 1, dormant: 2, collapsed: 3, cleared: 4 };
  return [...gates].sort((a, b) => {
    const sa = order[gateStatus(a, todayKey)];
    const sb = order[gateStatus(b, todayKey)];
    if (sa !== sb) return sa - sb;
    return a.date < b.date ? -1 : 1;
  });
}

/* ---------- strength progression ----------
   Double progression, which is the reason the numbers are worth logging at
   all. Reps climb inside a range at a fixed load; once every working set
   reaches the top of the range the load goes up one step and the reps reset
   to the bottom. Nothing moves after a session that missed the range, and
   only one thing moves at a time — never load and reps together, never two
   treadmill dials together. A load that stalls three sessions running gets
   backed off rather than ground against.                                    */

export const DELOAD_AFTER = 3;
export const DELOAD_FRACTION = 0.9;
export const CARDIO_ROTATION = ["min", "speed", "incline"];

function num(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

function roundStep(x, step) {
  return +(Math.round(x / step) * step).toFixed(2);
}

/** Which field carries the count for this kind, and the range it lives in. */
export function repFieldOf(ex) {
  return ex.kind === "hold" ? "sec" : "reps";
}

export function rangeOf(ex) {
  return (ex.kind === "hold" ? ex.secRange : ex.repRange) || [8, 12];
}

/** Every logged session for one exercise, oldest first, on or before endKey. */
export function exerciseHistory(training = {}, exKey, endKey) {
  return Object.keys(training)
    .filter((k) => !endKey || k <= endKey)
    .sort()
    .map((k) => ({ date: k, entry: (training[k] && training[k].sets ? training[k].sets : {})[exKey] }))
    .filter((x) => x.entry != null);
}

/**
 * A session only counts once every set carries the numbers its kind needs.
 * A half-filled row is a gap in the record, not a failed set, and reading it
 * as a failure would push the next target down for no reason.
 */
export function sessionComplete(ex, sets) {
  if (!Array.isArray(sets) || sets.length === 0) return false;
  return sets.every((s) => {
    if (ex.kind === "hold") return num(s.sec) != null;
    if (ex.kind === "reps") return num(s.reps) != null;
    return num(s.reps) != null && num(s.kg) != null;
  });
}

/** Consecutive complete sessions, most recent first, that fell short of the range. */
function stallStreak(ex, history, field, range) {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const sets = history[i].entry;
    if (!sessionComplete(ex, sets)) continue;
    if (Math.min(...sets.map((s) => s[field])) < range[0]) n++;
    else break;
  }
  return n;
}

function suggestCardio(ex, history) {
  const logged = history.map((h) => h.entry && h.entry.cardio).filter(Boolean);
  const last = logged.length ? logged[logged.length - 1] : null;

  if (!last) {
    return { kind: "cardio", change: "seed", target: { ...ex.start }, reason: "First session sets the baseline." };
  }
  const cur = { min: last.min, incline: last.incline, speed: last.speed };
  if (last.nonstop === false) {
    return { kind: "cardio", change: "hold", target: cur, reason: "Last one broke before the end. Repeat it unbroken first." };
  }

  /* Rotate which dial moves so duration, pace and gradient all advance and no
     single one runs away. Skip any dial already at its cap. */
  const done = logged.filter((c) => c.nonstop !== false).length;
  const target = { ...cur };
  let moved = null;
  for (let i = 0; i < CARDIO_ROTATION.length; i++) {
    const dial = CARDIO_ROTATION[(done - 1 + i) % CARDIO_ROTATION.length];
    const next = +(cur[dial] + ex.steps[dial]).toFixed(2);
    if (next <= ex.caps[dial]) { target[dial] = next; moved = dial; break; }
  }
  if (!moved) {
    return { kind: "cardio", change: "hold", target: cur, reason: "Every dial is at its cap. Hold here or raise the caps." };
  }
  const label = { min: "one more minute", speed: `speed to ${target.speed}`, incline: `incline to ${target.incline}` };
  return { kind: "cardio", change: "up", moved, target, reason: `Held it unbroken, so ${label[moved]}. Nothing else changes.` };
}

/**
 * What to aim for next, given everything logged so far. Returns the target and
 * the reason for it, so the number on screen is never unexplained.
 */
export function suggestNext(ex, history = []) {
  if (ex.kind === "cardio") return suggestCardio(ex, history);

  const field = repFieldOf(ex);
  const range = rangeOf(ex);
  const step = ex.step || 2.5;
  const complete = history.filter((h) => sessionComplete(ex, h.entry));
  const last = complete.length ? complete[complete.length - 1].entry : null;

  if (!last) {
    const seeded = { ...(ex.start || {}) };
    if (seeded[field] == null) seeded[field] = range[0];
    const partial = history.length > 0;
    return {
      kind: ex.kind,
      change: partial ? "unknown" : "seed",
      target: seeded,
      reason: partial
        ? "Some numbers are missing from the last session. Fill them in and a target appears."
        : "First logged session sets the baseline.",
    };
  }

  const counts = last.map((s) => s[field]);
  const lo = Math.min(...counts);
  const hi = Math.max(...counts);
  const kg = ex.kind === "load" ? num(last[last.length - 1].kg) : null;
  const unit = ex.kind === "hold" ? "s" : "reps";

  /* A set that ran past the ceiling means the load was too light to be a
     working set, whatever the range says. */
  if (ex.ceiling && hi >= ex.ceiling && ex.kind === "load" && kg != null) {
    const next = roundStep(kg + step, step);
    return {
      kind: ex.kind, change: "up", target: { kg: next, [field]: range[0] },
      reason: `A set ran to ${hi}, past the ${ex.ceiling} ceiling. ${next} kg from ${range[0]}.`,
    };
  }

  if (lo >= range[1]) {
    if (ex.kind === "load" && kg != null) {
      const next = roundStep(kg + step, step);
      return {
        kind: ex.kind, change: "up", target: { kg: next, [field]: range[0] },
        reason: `Every set hit ${range[1]}. Load goes to ${next} kg, reps back to ${range[0]}.`,
      };
    }
    const next = lo + step;
    return {
      kind: ex.kind, change: "up", target: { [field]: next },
      reason: `Cleared ${lo} on every set. Take it to ${next} ${unit}.`,
    };
  }

  if (lo >= range[0]) {
    /* Inside the range, climb by one rep — or by the whole step on a timed
       hold, where a single second is not something anyone can feel. */
    const bump = ex.kind === "hold" ? step : 1;
    const next = Math.min(lo + bump, range[1]);
    const loaded = ex.kind === "load" && kg != null;
    return {
      kind: ex.kind, change: "hold", target: { ...(loaded ? { kg } : {}), [field]: next },
      reason: loaded
        ? `In range at ${lo}. Same ${kg} kg until every set reaches ${next} ${unit}.`
        : `In range at ${lo}. Take every set to ${next} ${unit} before it moves again.`,
    };
  }

  const stalled = stallStreak(ex, history, field, range);
  if (stalled >= DELOAD_AFTER && ex.kind === "load" && kg != null) {
    const next = roundStep(kg * DELOAD_FRACTION, step);
    return {
      kind: ex.kind, change: "down", target: { kg: next, [field]: range[0] },
      reason: `${stalled} sessions short of ${range[0]}. Drop to ${next} kg and build back.`,
    };
  }
  const base = ex.kind === "load" && kg != null ? { kg } : {};
  return {
    kind: ex.kind, change: "hold", target: { ...base, [field]: range[0] },
    reason: `Short of ${range[0]} last time. Repeat the same and clear the range first.`,
  };
}

/** Convenience for the screen: history plus suggestion for one exercise. */
export function progressionFor(ex, training, endKey) {
  const history = exerciseHistory(training, ex.key, endKey);
  const prior = endKey ? history.filter((h) => h.date < endKey) : history;
  return { history, prior, suggestion: suggestNext(ex, prior) };
}

/* ---------- difficulty ----------
   Hard mode is not a cosmetic label. It raises the bar a day must clear, deepens
   what a shortfall costs, and slows how fast clean days forgive past lapses.
   Every existing caller that passes no mode gets exactly the old numbers, so a
   save made on normal grades identically after this shipped.                   */

export const DIFFICULTY = {
  normal: {
    key: "normal", label: "Normal", clearBar: 0.7, depth: PENALTY_DEPTH,
    lapseBar: LAPSE_BAR, forgiveEvery: FORGIVE_EVERY,
    blurb: "A day clears at 70%. Slips are charged gently and three clean days forgive one.",
  },
  hard: {
    key: "hard", label: "Hard", clearBar: 0.85, depth: 1.75,
    lapseBar: 0.98, forgiveEvery: 5,
    blurb: "85% to clear, shortfalls cost 40% more, and it takes five clean days to forgive one lapse.",
  },
  monarch: {
    key: "monarch", label: "Monarch", clearBar: 1, depth: 2.25,
    lapseBar: 1, forgiveEvery: 8,
    blurb: "Everything, every day. Anything less is a lapse and it takes eight clean days to work one off.",
  },
};

export function difficultyOf(mode) {
  return DIFFICULTY[mode] || DIFFICULTY.normal;
}

/* ---------- the rising bar ----------
   A fixed standard stops being a standard once you can meet it without
   trying. So the share of the board a day has to clear climbs: it holds for
   the first week, then goes up a point for every week you actually clear.

   Two things keep it honest. It only rises off weeks you EARNED — five days
   cleared out of seven — so a bad week costs you the increase rather than
   burying you. And the bar a day was graded under is stamped onto that day
   when it is generated, so raising the standard tomorrow never retroactively
   fails a day you already won.                                             */

export const BAR_STEP = 0.01;
export const BAR_MAX_LIFT = 0.2;
export const BAR_WEEK_CLEARED = 5;

/**
 * The bar this person has earned by the given date. Weeks are counted from
 * the day they started, and only completed ones count.
 */
export function earnedBar(days = {}, dk, mode, createdAt) {
  const base = difficultyOf(mode).clearBar;
  if (!createdAt || !dk || dk < createdAt) return base;

  const weeks = Math.floor(daysBetween(createdAt, dk) / 7);
  let earned = 0;

  for (let w = 0; w < weeks; w++) {
    let cleared = 0;
    for (let d = 0; d < 7; d++) {
      const day = days[shiftKey(createdAt, w * 7 + d)];
      if (!day || !day.generated) continue;
      const g = gradeDay(day, mode);
      if (g.ratio >= (typeof day.bar === "number" ? day.bar : base)) cleared += 1;
    }
    if (cleared >= BAR_WEEK_CLEARED) earned += 1;
  }

  return Math.min(1, base + Math.min(BAR_MAX_LIFT, earned * BAR_STEP));
}

/** How far the bar has climbed above the floor, for the screen to show. */
export function barLift(days, dk, mode, createdAt) {
  const base = difficultyOf(mode).clearBar;
  const bar = earnedBar(days, dk, mode, createdAt);
  return { base, bar, lift: +(bar - base).toFixed(4), atCap: bar - base >= BAR_MAX_LIFT - 1e-9 };
}

/* ---------- calendar ----------
   The month grid is the honest view of the log: one square per day, coloured by
   what the day actually graded, with days that were never generated left blank
   rather than shown as failures. Nothing here invents a grade for a day the app
   was not yet running.                                                          */

export const GRADE_TONE = {
  clean: "#3fe0a8",
  held: "#6fa8ff",
  slipped: "#ffc857",
  broken: "#ff5c5c",
  void: "#4a5878",
  none: "transparent",
};

export function monthMeta(year, month) {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  return { first, days, startWeekday: first.getDay(), label: first.toLocaleString("en", { month: "long", year: "numeric" }) };
}

/**
 * Six weeks of cells covering the month, Sunday first, so the grid never
 * reflows between months. Cells outside the month are marked, not omitted.
 */
export function monthCells(year, month, days = {}, todayKey, mode) {
  const meta = monthMeta(year, month);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const offset = i - meta.startWeekday;
    const d = new Date(year, month, 1 + offset);
    const key = dateKey(d);
    const day = days[key];
    const graded = day && day.generated ? gradeDay(day, mode) : null;
    cells.push({
      key,
      dayOfMonth: d.getDate(),
      inMonth: d.getMonth() === month,
      isToday: key === todayKey,
      future: todayKey ? key > todayKey : false,
      grade: graded ? graded.grade : "none",
      ratio: graded ? graded.ratio : null,
      cleared: day ? isDayCleared(day, mode) : false,
      earned: day ? dayEarnedXp(day) : 0,
      available: day ? dayAvailableXp(day) : 0,
      quests: day ? day.quests.length : 0,
    });
  }
  return { ...meta, cells };
}

/** Per-grade counts for a month, for the summary line above the grid. */
export function monthSummary(cells) {
  const out = { clean: 0, held: 0, slipped: 0, broken: 0, void: 0, logged: 0 };
  cells.forEach((c) => {
    if (!c.inMonth || c.grade === "none") return;
    out[c.grade] = (out[c.grade] || 0) + 1;
    out.logged++;
  });
  return out;
}

/* ---------- seasons ----------
   A season is a fixed window with a small set of goals fixed at the start. It
   cannot be extended and its goals cannot be edited once it is running — the
   whole value is that the deadline and the bar were set by someone who could
   not yet see how the attempt was going.                                       */

export function seasonWindow(season, todayKey) {
  const total = Math.max(1, daysBetween(season.startKey, season.endKey) + 1);
  const elapsed = Math.min(total, Math.max(0, daysBetween(season.startKey, todayKey) + 1));
  const left = Math.max(0, daysBetween(todayKey, season.endKey));
  return { total, elapsed, left, done: todayKey > season.endKey, started: todayKey >= season.startKey };
}

/**
 * Measure one goal against the log. Returns the raw numbers as well as the
 * ratio so a screen can say "31 of 60" rather than only a percentage.
 */
export function goalProgress(goal, state, season, todayKey) {
  const days = state.days || {};
  const inWindow = (k) => k >= season.startKey && k <= season.endKey && k <= todayKey;
  const keys = Object.keys(days).filter(inWindow).sort();
  let value = 0;

  switch (goal.type) {
    case "cleanDays":
      value = keys.filter((k) => days[k].generated && gradeDay(days[k], state.settings?.difficulty).grade === "clean").length;
      break;
    case "clearedDays":
      value = keys.filter((k) => isDayCleared(days[k], state.settings?.difficulty)).length;
      break;
    case "streak":
      value = state.streak?.best || 0;
      break;
    case "level":
      value = levelFromTotalXp(state.totalXp).level;
      break;
    case "statXp":
      value = state.statXp?.[goal.stat] || 0;
      break;
    case "shadows":
      value = (state.shadows || []).filter((s) => inWindow(s.date)).length;
      break;
    case "training":
      value = Object.keys(state.body?.training || {}).filter((k) => {
        if (!inWindow(k)) return false;
        const e = state.body.training[k] || {};
        return (e.done || []).length > 0 || Object.keys(e.sets || {}).length > 0;
      }).length;
      break;
    case "gates":
      value = (state.gates || []).filter((g) => g.cleared && g.clearedOn && inWindow(g.clearedOn)).length;
      break;
    case "manual":
      value = goal.value || 0;
      break;
    default:
      value = 0;
  }

  const target = goal.target || 1;
  return { value, target, ratio: Math.min(1, value / target), met: value >= target };
}

export function seasonProgress(season, state, todayKey) {
  if (!season) return null;
  const win = seasonWindow(season, todayKey);
  const goals = (season.goals || []).map((g) => ({ ...g, ...goalProgress(g, state, season, todayKey) }));
  const met = goals.filter((g) => g.met).length;
  const ratio = goals.length ? goals.reduce((s, g) => s + g.ratio, 0) / goals.length : 0;

  /* A season is only won or lost when its window closes. While it is running
     the honest answer is "on pace" or "behind", never a verdict. */
  let status = "running";
  if (!win.started) status = "upcoming";
  else if (win.done) status = met === goals.length ? "won" : "lost";
  else if (met === goals.length) status = "clinched";

  const pace = win.total ? win.elapsed / win.total : 0;
  return { ...win, goals, met, of: goals.length, ratio, status, pace, onPace: ratio >= pace - 0.05 };
}

/* ---------- journey ----------
   Derived, never stored. Every milestone is recomputed from the log, so an
   imported backup shows the same history and nothing can drift out of sync
   with the days it was built from.                                            */

export function journeyEvents(state, todayKey) {
  const out = [];
  const days = state.days || {};
  const keys = Object.keys(days).sort();

  if (state.hunter?.createdAt) {
    out.push({ date: state.hunter.createdAt, kind: "start", title: "Awakened", detail: "The System came online." });
  }

  /* Walk the log forward and mark the day each level and rank was first
     reached, using only days that had closed by then. */
  let running = 0;
  let lastLevel = 1;
  let lastRank = "E";
  keys.forEach((k) => {
    const d = days[k];
    if (!d.generated) return;
    d.quests.forEach((q) => { if (q.done) running += q.xp; });
    const lvl = levelFromTotalXp(running).level;
    if (lvl > lastLevel) {
      const rank = rankFromLevel(lvl);
      if (rank !== lastRank) {
        out.push({ date: k, kind: "rank", title: `Rank ${rank}`, detail: `Promoted from ${lastRank} at level ${lvl}.`, rank });
        lastRank = rank;
      } else if (lvl % 5 === 0) {
        out.push({ date: k, kind: "level", title: `Level ${lvl}`, detail: "Five more levels of ground taken." });
      }
      lastLevel = lvl;
    }
  });

  (state.shadows || []).forEach((s) => {
    if (!s.date) return;
    out.push({ date: s.date, kind: "shadow", title: s.name, detail: `Extracted. +${s.bonus}% ${s.stat} for good.`, stat: s.stat });
  });

  (state.gates || []).forEach((g) => {
    const on = g.clearedOn || (g.cleared ? g.date : null);
    if (on) out.push({ date: on, kind: "gate", title: g.name, detail: `Rank ${g.rank} gate cleared.`, rank: g.rank });
  });

  (state.seasons || []).forEach((s) => {
    out.push({ date: s.startKey, kind: "season", title: s.name, detail: "Season opened." });
    if (todayKey > s.endKey) {
      const p = seasonProgress(s, state, todayKey);
      out.push({
        date: s.endKey, kind: p.status === "won" ? "seasonWon" : "seasonLost",
        title: s.name, detail: p.status === "won" ? `Season taken, ${p.met} of ${p.of}.` : `Season closed at ${p.met} of ${p.of}.`,
      });
    }
  });

  const best = state.streak?.best || 0;
  if (best >= 7) out.push({ date: todayKey, kind: "streak", title: `${best} day best streak`, detail: "The longest unbroken run so far." });

  return out.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

/* ---------- smart schedule ----------
   Lays the day's quests into the waking hours around whatever is already fixed.
   It plans time; it never marks anything done. The schedule is a suggestion the
   log does not depend on.                                                      */

export const DEFAULT_SCHEDULE = {
  wake: "05:00",
  sleep: "22:00",
  fixed: [
    { id: "f-train", label: "Train", start: "06:00", mins: 75, kind: "train" },
    { id: "f-work", label: "Desk block", start: "09:30", mins: 240, kind: "work" },
  ],
  questMins: 45,
};

export function toMins(hhmm) {
  const [h, m] = String(hhmm || "0:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function toClock(mins) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Free stretches between the fixed blocks, inside waking hours. Overlapping or
 * out-of-order fixed blocks are merged rather than rejected — a schedule that
 * refuses to render because two entries touch is worse than one that copes.
 */
export function openWindows(sched) {
  const wake = toMins(sched.wake);
  const sleep = toMins(sched.sleep);
  const end = sleep <= wake ? sleep + 1440 : sleep;

  const busy = (sched.fixed || [])
    .map((f) => {
      let s = toMins(f.start);
      if (s < wake) s += 1440;
      return { start: s, end: s + (f.mins || 30) };
    })
    .sort((a, b) => a.start - b.start);

  const merged = [];
  busy.forEach((b) => {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else merged.push({ ...b });
  });

  const gaps = [];
  let cursor = wake;
  merged.forEach((b) => {
    if (b.start > cursor) gaps.push({ start: cursor, end: Math.min(b.start, end) });
    cursor = Math.max(cursor, b.end);
  });
  if (cursor < end) gaps.push({ start: cursor, end });
  return gaps.filter((g) => g.end - g.start >= 15);
}

export function buildSchedule(day, sched = DEFAULT_SCHEDULE, todayIsTrainingDay = true) {
  const fixed = (sched.fixed || [])
    .filter((f) => f.kind !== "train" || todayIsTrainingDay)
    .map((f) => ({ ...f, startMins: toMins(f.start), endMins: toMins(f.start) + (f.mins || 30), fixed: true }));

  const pending = ((day && day.quests) || []).filter((q) => !q.done && !q.excused);
  const gaps = openWindows({ ...sched, fixed: fixed.map((f) => ({ start: f.start, mins: f.mins })) });

  const placed = [];
  const unplaced = [];
  let gi = 0;
  let cursor = gaps.length ? gaps[0].start : null;

  pending.forEach((q) => {
    const mins = q.mins || sched.questMins || 45;
    while (gi < gaps.length && cursor + mins > gaps[gi].end) {
      gi++;
      cursor = gi < gaps.length ? gaps[gi].start : null;
    }
    if (gi >= gaps.length || cursor == null) { unplaced.push(q); return; }
    placed.push({
      id: q.id, label: q.title, stat: q.stat, xp: q.xp,
      startMins: cursor, endMins: cursor + mins, mins, kind: "quest",
    });
    cursor += mins + 10;
  });

  const blocks = [...fixed, ...placed].sort((a, b) => a.startMins - b.startMins);
  return {
    blocks: blocks.map((b) => ({ ...b, start: toClock(b.startMins), end: toClock(b.endMins) })),
    unplaced,
    freeMins: gaps.reduce((s, g) => s + (g.end - g.start), 0),
  };
}

/* ---------- alerts ----------
   What the app should be telling you right now, ranked. Every alert states the
   thing that is actually wrong and what closes it — an alert you cannot act on
   is just noise that teaches you to ignore the next one.                       */

export function pendingAlerts(state, todayKey, nowMins = 0) {
  const out = [];
  const days = state.days || {};
  const today = days[todayKey];
  const mode = state.settings?.difficulty;

  if (today && today.generated) {
    const left = today.quests.filter((q) => !q.done && !q.excused);
    const g = gradeDay(today, mode);
    const bar = difficultyOf(mode).clearBar;
    if (left.length && nowMins >= 20 * 60 && g.ratio < bar) {
      out.push({
        id: "today-late", level: "urgent", title: `${left.length} quest${left.length === 1 ? "" : "s"} still open`,
        body: `It is past ${toClock(nowMins)} and today grades at ${Math.round(g.ratio * 100)}%. ${Math.round(bar * 100)}% clears it.`,
        action: "quests",
      });
    } else if (left.length && nowMins >= 17 * 60) {
      out.push({
        id: "today-evening", level: "warn", title: `${left.length} left today`,
        body: left.slice(0, 3).map((q) => q.title).join(" · "),
        action: "quests",
      });
    }
  }

  const y = days[shiftKey(todayKey, -1)];
  if (y && y.generated) {
    const g = gradeDay(y, mode);
    if (g.grade !== "clean" && g.grade !== "void") {
      out.push({
        id: "yesterday", level: g.grade === "broken" ? "urgent" : "warn",
        title: `Yesterday graded ${g.grade}`,
        body: `${Math.round(g.ratio * 100)}% of what was chargeable. It has already been charged — today is where it gets answered.`,
        action: "calendar",
      });
    }
  }

  const streak = state.streak?.current || 0;
  if (streak >= 3 && today && !isDayCleared(today, mode)) {
    out.push({
      id: "streak", level: "warn", title: `${streak} day streak at risk`,
      body: "Today has not cleared yet. Clearing it keeps the run alive.",
      action: "quests",
    });
  }

  (state.gates || []).forEach((g) => {
    if (g.cleared || !g.date) return;
    const left = daysBetween(todayKey, g.date);
    if (left < 0) {
      out.push({ id: `gate-${g.id}`, level: "urgent", title: `${g.name} is overdue`, body: `Due ${g.date}. ${-left} day${left === -1 ? "" : "s"} past.`, action: "gates" });
    } else if (left <= 3) {
      out.push({ id: `gate-${g.id}`, level: "warn", title: `${g.name} closes in ${left} day${left === 1 ? "" : "s"}`, body: `Rank ${g.rank} gate, due ${g.date}.`, action: "gates" });
    }
  });

  const t = state.body?.training?.[todayKey];
  const trained = t && ((t.done || []).length > 0 || Object.keys(t.sets || {}).length > 0);
  if (!trained && nowMins >= 19 * 60 && parseKey(todayKey).getDay() !== 0) {
    out.push({ id: "training", level: "warn", title: "Nothing logged in the dungeon", body: "No sets recorded today.", action: "dungeon" });
  }

  const order = { urgent: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/** Days that closed short and were never answered, most recent first. */
export function missedDays(state, todayKey, window = 14) {
  const out = [];
  for (let i = 1; i <= window; i++) {
    const k = shiftKey(todayKey, -i);
    const d = state.days?.[k];
    if (!d || !d.generated) continue;
    const g = gradeDay(d, state.settings?.difficulty);
    if (g.grade === "slipped" || g.grade === "broken") {
      out.push({ key: k, ...g, missed: d.quests.filter((q) => !q.done && !q.excused).length });
    }
  }
  return out;
}


/* ---------- side quests ----------
   Real work that was not on the board. Portfolio analysis, a piece of reading
   nobody set, a script written because it needed writing.

   Three rules hold the economy together.

   1. Significance drives the price, not duration. A task is worth what it
      moves, so an hour that advances a gate beats three that advance nothing.
      Time is a modifier and a small one — otherwise the way to level is to
      work slowly, which is the opposite of the point.
   2. A side quest is always worth less than a board quest. The board is the
      commitment; this supplements it and must never replace it.
   3. It is pure credit. Side work never enters the denominator a day is
      graded against, so logging it can never make the day harder to clear —
      and never lets an unfinished board be papered over either.            */

export const SIDE_BASE = 12;

export const SIDE_SIGNIFICANCE = [
  { key: "minor", label: "Minor", weight: 1, hint: "Worth doing. Nothing depends on it." },
  { key: "useful", label: "Useful", weight: 1.8, hint: "Real work that feeds something you are building." },
  { key: "gate", label: "Moves a gate", weight: 3, hint: "Directly advances a deadline you are measured on." },
];

/* Side work tops out at a quarter of the day's board. Past that the board is
   what needs doing. */
export const SIDE_DAILY_SHARE = 0.25;

export function significanceOf(key) {
  return SIDE_SIGNIFICANCE.find((s) => s.key === key) || SIDE_SIGNIFICANCE[0];
}

/**
 * Price one task. Duration bends the number by at most 30% across two hours;
 * significance moves it threefold.
 */
export function sideXp(sigKey, mins) {
  const weight = significanceOf(sigKey).weight;
  const minutes = Math.max(0, Math.min(600, Number(mins) || 0));
  const timeFactor = 0.7 + 0.3 * Math.min(1, minutes / 120);
  return Math.max(1, Math.round(SIDE_BASE * weight * timeFactor));
}

export function dayExtras(day) {
  return (day && Array.isArray(day.extras)) ? day.extras : [];
}

/** Raw sum, before the daily ceiling. */
export function rawExtraXp(day) {
  return dayExtras(day).reduce((s, x) => s + (Number(x.xp) || 0), 0);
}

export function extraCeiling(day) {
  return Math.round(dayAvailableXp(day) * SIDE_DAILY_SHARE);
}

/** What actually counts today, after the ceiling. */
export function dayExtraXp(day) {
  return Math.min(rawExtraXp(day), extraCeiling(day));
}

/** Per-stat split of the credited total, in proportion to what was logged. */
export function extraByStat(day) {
  const out = {};
  STATS.forEach((s) => (out[s] = 0));
  const raw = rawExtraXp(day);
  if (raw === 0) return out;
  const credited = dayExtraXp(day);
  dayExtras(day).forEach((x) => {
    if (!out.hasOwnProperty(x.stat)) return;
    out[x.stat] += Math.round(credited * ((Number(x.xp) || 0) / raw));
  });
  return out;
}
