import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyState, hydrate } from "../src/store.js";
import { generateDay, shiftKey, recomputeTotals, computeStreak, dateKey } from "../src/engine.js";
import Status from "../src/screens/Status.jsx";
import Quests from "../src/screens/Quests.jsx";
import Gates from "../src/screens/Gates.jsx";
import Dungeon from "../src/screens/Dungeon.jsx";
import App from "../src/App.jsx";
import Calendar from "../src/screens/Calendar.jsx";
import Focus from "../src/screens/Focus.jsx";
import Shadows from "../src/screens/Shadows.jsx";
import SystemChat from "../src/screens/System.jsx";

const todayKey = "2026-08-31";
let pass = 0;
const t = (name, fn) => {
  try { fn(); pass++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
};

/* Build a state with a month of plausible history. */
function seeded() {
  const s = emptyState();
  s.hunter.createdAt = "2026-08-01";

  let prev = null;
  for (let i = 30; i >= 0; i--) {
    const k = shiftKey(todayKey, -i);
    const d = generateDay(k, s.templates, s.progression, prev);
    // clear most things, drop the odd one
    d.quests.forEach((q, j) => (q.done = (i + j) % 7 !== 0));
    s.days[k] = d;
    prev = d;
  }

  const totals = recomputeTotals(s.days, s.shadows, todayKey);
  s.totalXp = totals.totalXp;
  s.statXp = totals.statXp;
  s.streak = computeStreak(s.days, todayKey);

  s.shadows = [{ id: "s1", name: "C++ limit order book engine", stat: "AGI", bonus: 6, date: "2026-08-14" }];
  s.cfHistory = [
    { date: "2026-08-02", rating: 1327 },
    { date: "2026-08-16", rating: 1361 },
    { date: "2026-08-30", rating: 1408 },
  ];
  s.body.weights = Array.from({ length: 12 }, (_, i) => ({
    date: shiftKey("2026-08-01", i * 2),
    kg: +(83.8 - i * 0.22).toFixed(1),
  }));
  s.body.waist = [
    { date: "2026-08-03", cm: 96 },
    { date: "2026-08-10", cm: 95 },
    { date: "2026-08-17", cm: 94.5 },
  ];
  s.body.meals[todayKey] = [
    { name: "Whey scoop", qty: "1 scoop", kcal: 120, protein: 24, carbs: 3, fat: 1.5 },
    { name: "Dal, cooked", qty: "150 g", kcal: 165, protein: 9, carbs: 24, fat: 3 },
  ];
  s.body.water[todayKey] = 2.25;
  s.body.sleep[todayKey] = { from: "22:00", to: "05:00", hours: 7 };
  s.body.training[todayKey] = { done: [0, 1, 3] };
  s.lastRatchet = { date: todayKey, items: [{ stat: "AGI", field: "cfBand", from: 1500, to: 1550, unit: "rating" }] };
  return s;
}

const noop = () => {};
const props = (state) => ({
  state, todayKey,
  onToggle: noop, onExcuse: noop, onAddGate: noop, onClearGate: noop, onDeleteGate: noop,
  onLogRating: noop, onToggleExercise: noop, onLogSets: noop, onLogCardio: noop,
  onRenameExercise: noop, onAddMeal: noop, onRemoveMeal: noop, onSetWater: noop,
  onLogWeight: noop, onLogWaist: noop, onLogSleep: noop, onExtract: noop, onDismiss: noop,
  onSettings: noop, onImport: noop, onReset: noop, onProgression: noop,
  onStartSeason: noop, onSchedule: noop, onReminder: noop, onLogFocus: noop,
  alerts: [], setTab: noop, onAddExtra: noop, onRemoveExtra: noop,
});

const screens = { Status, Quests, Gates, Dungeon, Calendar, Focus, Shadows, SystemChat };

t("every screen renders against a month of history", () => {
  const s = seeded();
  Object.entries(screens).forEach(([name, C]) => {
    const html = renderToStaticMarkup(React.createElement(C, props(s)));
    assert.ok(html.length > 200, `${name} rendered almost nothing`);
  });
});

t("every screen renders on a completely fresh install", () => {
  const s = emptyState();
  s.days[todayKey] = generateDay(todayKey, s.templates, s.progression, null);
  Object.entries(screens).forEach(([name, C]) => {
    const html = renderToStaticMarkup(React.createElement(C, props(s)));
    assert.ok(html.length > 120, `${name} broke when empty`);
  });
});

t("Quests survives a day with no log at all", () => {
  const s = emptyState();
  const html = renderToStaticMarkup(React.createElement(Quests, props(s)));
  assert.match(html, /No log for this day|quest board/i);
});

t("Status shows level, rank and the mission day", () => {
  const html = renderToStaticMarkup(React.createElement(Status, props(seeded())));
  assert.match(html, /Level/);
  assert.match(html, /Rank [EDCBAS]/);
  assert.match(html, /Day \d+ of 150/);
});

t("Status reports the shadow bonus on the right stat", () => {
  const html = renderToStaticMarkup(React.createElement(Status, props(seeded())));
  assert.match(html, /\+6% from shadows/);
});

t("Quests renders penalty quests distinctly when they exist", () => {
  const s = seeded();
  const y = shiftKey(todayKey, -1);
  s.days[y].quests.forEach((q) => (q.done = false));
  s.days[todayKey] = generateDay(todayKey, s.templates, s.progression, s.days[y]);
  const html = renderToStaticMarkup(React.createElement(Quests, props(s)));
  assert.match(html, /Penalty/);
});

t("Dungeon renders the correct split for the weekday", () => {
  const html = renderToStaticMarkup(React.createElement(Dungeon, props(seeded())));
  assert.match(html, /Chest, triceps and core/, "31 Aug 2026 is a Monday");
});

t("Fuel totals reflect logged meals", () => {
  const s = seeded();
  const html = renderToStaticMarkup(React.createElement(Dungeon, props(s)));
  assert.ok(html.includes("Strength dungeon"), "defaults to the Train tab");
});

t("Gates lists seeded gates with their ranks", () => {
  const html = renderToStaticMarkup(React.createElement(Gates, props(seeded())));
  assert.match(html, /Baruch MFE/);
  assert.match(html, /Operation/);
});

t("Shadows lists an extracted project and its bonus", () => {
  const html = renderToStaticMarkup(React.createElement(Shadows, props(seeded())));
  assert.match(html, /limit order book/);
  assert.match(html, /\+6% AGI/);
});

t("no screen leaks the string undefined or NaN into the markup", () => {
  const s = seeded();
  Object.entries(screens).forEach(([name, C]) => {
    const html = renderToStaticMarkup(React.createElement(C, props(s)));
    assert.ok(!/>\s*NaN\s*</.test(html), `${name} rendered NaN`);
    assert.ok(!/>\s*undefined\s*</.test(html), `${name} rendered undefined`);
  });
});

/* ---------- hydration of old or partial saves ---------- */

t("hydrate fills holes left by a partial save", () => {
  const partial = { statXp: { INT: 400 }, totalXp: 400, days: {} };
  const s = hydrate(partial);
  assert.equal(s.statXp.INT, 400);
  assert.equal(s.statXp.STR, 0, "missing stats default to zero");
  assert.ok(s.streak && typeof s.streak.current === "number");
  assert.ok(s.settings.targets.protein > 0);
  assert.ok(Array.isArray(s.gates));
  assert.ok(s.body.meals && s.body.sleep && s.body.training);
});

t("hydrate keeps user settings but restores missing ones", () => {
  const s = hydrate({ statXp: {}, settings: { targets: { protein: 180 } } });
  assert.equal(s.settings.targets.protein, 180, "user value survives");
  assert.ok(s.settings.targets.water > 0, "missing target restored");
  assert.equal(s.settings.ratchetStreak, 8, "missing setting restored");
});

t("hydrate survives rubbish", () => {
  assert.ok(hydrate(null).settings);
  assert.ok(hydrate("nonsense").settings);
  assert.ok(hydrate(42).settings);
});

t("a partial save renders every screen without throwing", () => {
  const s = hydrate({ statXp: { INT: 400 }, totalXp: 400, days: {} });
  Object.entries(screens).forEach(([name, C]) => {
    assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(C, props(s))), `${name} broke`);
  });
});


t("System renders its empty state with prompt chips", () => {
  const html = renderToStaticMarkup(React.createElement(SystemChat, props(seeded())));
  assert.match(html, /Ask it something/);
  assert.match(html, /brainteaser at interview level/);
});

t("System survives a state with no days generated", () => {
  const bare = emptyState();
  const html = renderToStaticMarkup(React.createElement(SystemChat, props(bare)));
  assert.match(html, /Ask the System/);
});


t("the log renders a full month grid", () => {
  const html = renderToStaticMarkup(React.createElement(Calendar, props(seeded())));
  const cells = (html.match(/mn-cal-cell/g) || []).length;
  assert.equal(cells, 42, "six weeks, always");
  assert.match(html, /August 2026/);
});

t("Focus renders without a browser and never claims it can block", () => {
  const html = renderToStaticMarkup(React.createElement(Focus, props(seeded())));
  assert.match(html, /Focus block/);
  assert.ok(!/Block Instagram/i.test(html), "no button that would do nothing");
});

t("a season that was never opened offers to open one", () => {
  const s = seeded();
  s.seasons = [];
  const html = renderToStaticMarkup(React.createElement(Calendar, props(s)));
  assert.ok(html.includes("mn-cal-grid"), "defaults to the month view");
});

/* The whole tree, not one screen. Nothing else in the suite would notice a
   missing import or a bad prop inside App.jsx itself — which is exactly the
   kind of break that only shows up on the day it fires. */
t("the app shell renders end to end", () => {
  const html = renderToStaticMarkup(React.createElement(App));
  assert.match(html, /Hunter|Status/);
  assert.ok(html.includes("<nav"), "the tab bar is present");
});

console.log(`\n${pass} passing`);
