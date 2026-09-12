import {
  DEFAULT_PROGRESSION, DEFAULT_TEMPLATES, MISSION,
  SEED_GATES, SEED_SHADOWS, SEED_SESSIONS, SEEDS_VERSION,
  DEFAULT_REMINDERS, FOCUS_TARGETS,
} from "./data.js";
import { STATS, resolveDetail, DEFAULT_SCHEDULE, dateKey, parseKey } from "./engine.js";
import { SEED_SAVE } from "./seed-save.js";

const KEY = "monarch.v1";

/* Bump when DEFAULT_TEMPLATES changes shape OR when quest XP is repriced.
   Saved templates below this are replaced on load, because an old save can
   carry stale quest copy and stale prices. */
export const TEMPLATES_VERSION = 5;

const DIFFICULTY_KEYS = ["normal", "hard", "monarch"];

export function emptyState() {
  const statXp = {};
  STATS.forEach((s) => (statXp[s] = 0));
  return {
    version: 1,
    templatesVersion: TEMPLATES_VERSION,
    seedsVersion: SEEDS_VERSION,
    hunter: { name: MISSION.hunter, createdAt: null },
    totalXp: 0,
    statXp,
    seenLevel: 1,
    progression: { ...DEFAULT_PROGRESSION },
    templates: JSON.parse(JSON.stringify(DEFAULT_TEMPLATES)),
    days: {},
    streak: { current: 0, best: 0 },
    cfHistory: [],
    lastRatchet: null,
    gates: SEED_GATES.map((g) => ({ ...g })),
    seasons: [],
    shadows: SEED_SHADOWS.map((s) => ({ ...s })),
    body: {
      weights: [],
      waist: [],
      meals: {},
      water: {},
      sleep: {},
      training: {},
      exNames: {},
      focus: {},
      journal: {},
      photos: [],
    },
    settings: {
      targets: { ...MISSION.targets },
      ratchetStreak: 8,
      soundOn: true,
      difficulty: "normal",
      /* Governs the earned figures only — what today is worth, what the
         log adds up to. The distance to the next level is never shown, so a
         promotion still arrives rather than being counted down to. */
      showNumbers: true,
      notifyOn: false,
      reminders: DEFAULT_REMINDERS.map((r) => ({ ...r })),
      schedule: JSON.parse(JSON.stringify(DEFAULT_SCHEDULE)),
      focusCaps: FOCUS_TARGETS.map((f) => ({ ...f })),
    },
  };
}

/**
 * Backfill sessions that were trained before the app logged loads. Anything
 * already recorded for that day wins — a seed never overwrites real input.
 */
function applySeeds(state) {
  Object.keys(SEED_SESSIONS).forEach((dk) => {
    const seed = JSON.parse(JSON.stringify(SEED_SESSIONS[dk]));
    const cur = state.body.training[dk] || { done: [], sets: {} };
    state.body.training[dk] = { ...cur, done: cur.done || [], sets: { ...seed, ...(cur.sets || {}) } };
  });
  state.seedsVersion = SEEDS_VERSION;
}

/**
 * Merge a saved blob over a fresh state. Nested sections are merged one level
 * deeper so a backup written by an older version cannot leave a hole that
 * crashes a screen.
 */
export function hydrate(parsed) {
  const base = emptyState();
  if (!parsed || typeof parsed !== "object") return base;
  const merged = { ...base, ...parsed };
  ["hunter", "progression", "body", "settings", "statXp"].forEach((k) => {
    merged[k] = { ...base[k], ...(parsed[k] || {}) };
  });
  merged.settings.targets = { ...base.settings.targets, ...(parsed.settings?.targets || {}) };
  ["days", "gates", "shadows", "cfHistory"].forEach((k) => {
    if (merged[k] == null) merged[k] = base[k];
  });
  merged.streak = { ...base.streak, ...(parsed.streak || {}) };

  /* Every training entry carries both shapes: `done` for the legacy checklist
     days and `sets` for the days that log real loads. */
  Object.keys(merged.body.training || {}).forEach((dk) => {
    const e = merged.body.training[dk] || {};
    merged.body.training[dk] = {
      ...e,
      done: Array.isArray(e.done) ? e.done : [],
      sets: e.sets && typeof e.sets === "object" ? e.sets : {},
    };
  });
  if ((parsed.seedsVersion || 0) < SEEDS_VERSION) applySeeds(merged);

  /* Sections that arrived after the first release. A save written before them
     has no key at all, so each needs a floor rather than a shallow merge. */
  if (!Array.isArray(merged.seasons)) merged.seasons = [];

  /* Days written before side quests existed have no extras array, and every
     screen that reads one maps over it. */
  Object.values(merged.days || {}).forEach((day) => {
    if (!Array.isArray(day.extras)) day.extras = [];
  });
  if (!merged.body.focus || typeof merged.body.focus !== "object") merged.body.focus = {};
  if (!merged.body.journal || typeof merged.body.journal !== "object") merged.body.journal = {};
  if (!merged.body.exNames || typeof merged.body.exNames !== "object") merged.body.exNames = {};
  if (!DIFFICULTY_KEYS.includes(merged.settings.difficulty)) merged.settings.difficulty = "normal";
  if (typeof merged.settings.showNumbers !== "boolean") merged.settings.showNumbers = true;
  merged.settings.schedule = {
    ...base.settings.schedule,
    ...(parsed.settings?.schedule || {}),
    fixed: Array.isArray(parsed.settings?.schedule?.fixed)
      ? parsed.settings.schedule.fixed
      : base.settings.schedule.fixed,
  };

  /* Reminders merge by id so a new default reminder added in a later release
     appears for existing users, while their edited times and toggles survive. */
  const saved = new Map((parsed.settings?.reminders || []).map((r) => [r.id, r]));
  merged.settings.reminders = DEFAULT_REMINDERS.map((d) => ({ ...d, ...(saved.get(d.id) || {}) }));
  (parsed.settings?.reminders || []).forEach((r) => {
    if (!DEFAULT_REMINDERS.some((d) => d.id === r.id)) merged.settings.reminders.push({ ...r });
  });

  const caps = new Map((parsed.settings?.focusCaps || []).map((c) => [c.id, c]));
  merged.settings.focusCaps = FOCUS_TARGETS.map((f) => ({ ...f, ...(caps.get(f.id) || {}) }));

  /* --- migration ---
     Templates saved before v2 were cloned with JSON.stringify, which drops
     function values. Every dynamic detail line came back undefined, so quests
     rendered with no rating band, page count or time. Replace those templates
     and repair the detail lines on days already generated from them. */
  if ((parsed.templatesVersion || 0) < TEMPLATES_VERSION) {
    merged.templates = JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
    merged.templatesVersion = TEMPLATES_VERSION;

    const byKey = new Map();
    Object.values(DEFAULT_TEMPLATES).forEach((list) =>
      list.forEach((t) => byKey.set(t.key, t))
    );

    /* Reprice today and anything ahead of it, never a day that has closed. A
       finished day was graded and charged against the prices in force at the
       time; rewriting those would move penalties that were already taken and
       make the calendar disagree with the levels it produced. */
    const today = dateKey(new Date());

    Object.entries(merged.days || {}).forEach(([dk, day]) => {
      (day.quests || []).forEach((q) => {
        const t = byKey.get(q.key);
        if (!t) return;
        if (!q.detail) q.detail = resolveDetail(t.detail, merged.progression);
        if (t.title && q.title !== t.title && !q.penalty) q.title = t.title;
        if (dk >= today && !q.penalty && typeof t.xp === "number") q.xp = t.xp;
        if (dk >= today && !q.penalty && typeof t.slot === "number") q.slot = t.slot;
      });

      /* A quest added to the template after a board was generated is missing
         from it entirely, so repricing alone would never surface it. Today
         and anything ahead pick it up; a day that has closed is left exactly
         as it was graded. */
      if (dk < today) return;
      const weekday = parseKey(dk).getDay();
      const template = merged.templates[weekday] || [];
      const present = new Set((day.quests || []).map((q) => q.key));

      template.forEach((t, i) => {
        if (present.has(t.key)) return;
        day.quests.push({
          id: `${dk}#new${i}#${t.key}`,
          key: t.key,
          title: t.title,
          detail: resolveDetail(t.detail, merged.progression),
          stat: t.stat,
          xp: t.xp,
          slot: t.slot,
          done: false,
          penalty: false,
        });
      });

      /* Carried-over penalty quests keep a "penalty" slot rather than a
         number, so they sort to the end instead of NaN-ing the comparison. */
      day.quests.sort((a, b) => {
        const av = typeof a.slot === "number" ? a.slot : 99;
        const bv = typeof b.slot === "number" ? b.slot : 99;
        return av - bv;
      });
    });
  }

  return merged;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    /* A device with no save of its own opens on the exported log rather than an
       empty board, so the app is usable the moment it loads anywhere. A real
       save always wins; this is only ever the starting point. */
    if (!raw) return hydrate(JSON.parse(JSON.stringify(SEED_SAVE)));
    return hydrate(JSON.parse(raw));
  } catch (err) {
    console.warn("Could not read saved data, starting fresh.", err);
    return emptyState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn("Could not save.", err);
    return false;
  }
}

export function exportJson(state) {
  return JSON.stringify(state, null, 2);
}

export function importJson(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || !("statXp" in parsed)) {
    throw new Error("That file is not a MONARCH backup.");
  }
  return hydrate(parsed);
}
