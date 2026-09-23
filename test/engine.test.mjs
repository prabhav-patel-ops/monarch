import assert from "node:assert/strict";
import {
  xpForLevel, levelFromTotalXp, rankFromLevel, nextRankAt, statTier,
  shadowMultiplier, generateDay, dayAvailableXp, dayEarnedXp, isDayCleared,
  dayPenalty, gradeDay, escalationAt, PENALTY_DEPTH, missFlags, applyRatchet, computeStreak, recomputeTotals,
  macroTotals, scaleFood, smooth, dateKey, parseKey, shiftKey, daysBetween,
  gateStatus, sortGates, STATS,
  suggestNext, sessionComplete, exerciseHistory, progressionFor, DELOAD_AFTER,
  DIFFICULTY, monthCells, monthSummary, seasonProgress, seasonWindow, goalProgress,
  journeyEvents, openWindows, buildSchedule, toMins, toClock, pendingAlerts, missedDays,
  earnedBar, barLift, BAR_STEP, BAR_MAX_LIFT,
  sideXp, dayExtras, dayExtraXp, rawExtraXp, extraCeiling, extraByStat, significanceOf,
  SIDE_SIGNIFICANCE, SIDE_DAILY_SHARE,
} from "../src/engine.js";
import { dailyRemindersIcs, gatesIcs, wrapCalendar, vevent } from "../src/calendar.js";
import { DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, TRAINING, SEED_GATES } from "../src/data.js";

let pass = 0;
const t = (name, fn) => {
  try { fn(); pass++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
};

/* ---------- dates ---------- */

t("dateKey formats with zero padding", () => {
  assert.equal(dateKey(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(dateKey(new Date(2026, 11, 31)), "2026-12-31");
});

t("shiftKey crosses month and year boundaries", () => {
  assert.equal(shiftKey("2026-08-31", 1), "2026-09-01");
  assert.equal(shiftKey("2027-01-01", -1), "2026-12-31");
  assert.equal(shiftKey("2026-03-01", -1), "2026-02-28");
});

t("daysBetween is signed and correct", () => {
  assert.equal(daysBetween("2026-08-31", "2026-09-07"), 7);
  assert.equal(daysBetween("2026-09-07", "2026-08-31"), -7);
  assert.equal(daysBetween("2026-08-31", "2026-08-31"), 0);
});

t("parseKey round trips", () => {
  assert.equal(dateKey(parseKey("2026-07-22")), "2026-07-22");
});

/* ---------- levels ---------- */

t("xpForLevel rises monotonically", () => {
  for (let i = 1; i < 60; i++) assert.ok(xpForLevel(i + 1) > xpForLevel(i), `level ${i}`);
});

t("levelFromTotalXp inverts the curve exactly", () => {
  assert.deepEqual(levelFromTotalXp(0), { level: 1, xpInLevel: 0, xpNeeded: xpForLevel(1) });
  const l1 = xpForLevel(1);
  assert.equal(levelFromTotalXp(l1).level, 2);
  assert.equal(levelFromTotalXp(l1 - 1).level, 1);
  const l2 = l1 + xpForLevel(2);
  assert.equal(levelFromTotalXp(l2).level, 3);
  assert.equal(levelFromTotalXp(l2).xpInLevel, 0);
});

t("levelFromTotalXp tolerates negative input", () => {
  assert.equal(levelFromTotalXp(-500).level, 1);
});

t("a full weekday is worth roughly one early level", () => {
  const day = generateDay("2026-09-01", DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, null);
  const avail = dayAvailableXp(day);
  assert.ok(avail > 200 && avail < 400, `weekday xp was ${avail}`);
  assert.ok(levelFromTotalXp(avail).level >= 2, "first full day should reach level 2");
});

/* ---------- ranks ---------- */

t("rank boundaries land on the right letters", () => {
  assert.equal(rankFromLevel(1), "E");
  assert.equal(rankFromLevel(6), "E");
  assert.equal(rankFromLevel(7), "D", "the first promotion sits where it always did");
  assert.equal(rankFromLevel(11), "D");
  assert.equal(rankFromLevel(12), "C");
  assert.equal(rankFromLevel(16), "B");
  assert.equal(rankFromLevel(20), "A");
  assert.equal(rankFromLevel(26), "S");
  assert.equal(rankFromLevel(400), "S");
});

t("levelling gets harder, never easier", () => {
  for (let l = 1; l < 40; l++) {
    assert.ok(xpForLevel(l + 1) > xpForLevel(l), `level ${l + 1} must cost more than ${l}`);
  }
  /* The curve is deliberately not the steep part any more — the rising bar
     is. What it must still guarantee is that the climb never gets cheaper,
     and that a late level costs many times an early one. */
  const day = 376;
  assert.ok(day / xpForLevel(2) > 0.4, "the first levels are days of work, not weeks");
  assert.ok(xpForLevel(20) / xpForLevel(2) > 10, "a late level costs many times an early one");
  assert.ok(day / xpForLevel(20) < 0.06, "and no single day makes a dent in it");
});

t("nextRankAt points upward and stops at S", () => {
  assert.equal(nextRankAt(1).rank, "D");
  assert.equal(nextRankAt(16).rank, "A");
  assert.equal(nextRankAt(40), null);
});

t("statTier grows sublinearly and never goes negative", () => {
  assert.ok(statTier(0) >= 1);
  assert.ok(statTier(-99) >= 1);
  assert.ok(statTier(5000) > statTier(500));
  assert.ok(statTier(5000) < 60, "tiers should not run away");
});

/* ---------- shadows ---------- */

t("shadow bonuses stack per stat only", () => {
  const sh = [
    { stat: "INT", bonus: 6 },
    { stat: "INT", bonus: 4 },
    { stat: "AGI", bonus: 5 },
  ];
  assert.equal(shadowMultiplier(sh, "INT"), 1.1);
  assert.equal(shadowMultiplier(sh, "AGI"), 1.05);
  assert.equal(shadowMultiplier(sh, "STR"), 1);
  assert.equal(shadowMultiplier([], "STR"), 1);
  assert.equal(shadowMultiplier(null, "STR"), 1);
});

/* ---------- quest generation ---------- */

t("weekday and Sunday templates differ, and Sunday pays for rest", () => {
  const mon = generateDay("2026-08-31", DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, null); // Monday
  const sun = generateDay("2026-09-06", DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, null); // Sunday
  assert.ok(mon.quests.some((q) => q.key === "gym"), "Monday has gym");
  assert.ok(!sun.quests.some((q) => q.key === "gym"), "Sunday has no gym");
  const rest = sun.quests.find((q) => q.key === "rest");
  assert.ok(rest && rest.xp > 0, "resting is worth xp");
});

t("routine details are generated for Whood, Hull and teasers", () => {
  const day = generateDay("2026-09-01", DEFAULT_TEMPLATES, { cfBand: 1650, hullPages: 21, teasers: 4 }, null);
  assert.match(day.quests.find((q) => q.key === "whood").detail, /focused hour/);
  assert.match(day.quests.find((q) => q.key === "hull_eve").detail, /21/);
  assert.match(day.quests.find((q) => q.key === "teasers").detail, /4/);
});

t("quest ids are unique within a day", () => {
  const day = generateDay("2026-09-01", DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, null);
  assert.equal(new Set(day.quests.map((q) => q.id)).size, day.quests.length);
});

/* ---------- penalty carry-forward ---------- */

t("a missed quest not in today's template carries over at 1.5x", () => {
  const sat = generateDay("2026-09-05", DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, null);
  const virt = sat.quests.find((q) => q.key === "gym");
  sat.quests.forEach((q) => (q.done = q.key !== "gym"));
  const sun = generateDay("2026-09-06", DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, sat);
  const carried = sun.quests.find((q) => q.key === "gym");
  assert.ok(carried, "missed gym carried into Sunday");
  assert.equal(carried.penalty, true);
  assert.equal(carried.xp, Math.round(virt.xp * 1.5));
  assert.equal(carried.done, false);
});

t("a missed quest already in today's template is not duplicated", () => {
  const mon = generateDay("2026-08-31", DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, null);
  mon.quests.forEach((q) => (q.done = false));
  const tue = generateDay("2026-09-01", DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, mon);
  const gyms = tue.quests.filter((q) => q.key === "gym");
  assert.equal(gyms.length, 1, "gym should appear once, not twice");
  assert.equal(gyms[0].penalty, false);
});

t("excused quests do not carry over and are not penalised", () => {
  const mon = generateDay("2026-08-31", DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, null);
  mon.quests.forEach((q) => { q.done = true; });
  const v = mon.quests.find((q) => q.key === "whood");
  v.done = false;
  v.excused = true;
  const owed = dayPenalty(mon, 1).byStat;
  assert.equal(owed.AGI, 0, "excused quest owes nothing");
});

t("an abandoned day is charged across every stat that was left short", () => {
  const day = generateDay("2026-09-01", DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, null);
  day.quests.forEach((q) => (q.done = false));
  const charge = dayPenalty(day, 1);
  assert.equal(charge.days, PENALTY_DEPTH, "a zero day costs the full penalty depth");
  assert.ok(charge.byStat.STR > 0 && charge.byStat.AGI > 0 && charge.byStat.INT > 0);
  const summed = Object.values(charge.byStat).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(summed - charge.total) <= 5, "per-stat charges must sum to the total");
});

/* ---------- clearing and streaks ---------- */

const buildDays = (startKey, n, fill) => {
  const days = {};
  let prev = null;
  for (let i = 0; i < n; i++) {
    const k = shiftKey(startKey, i);
    const d = generateDay(k, DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, prev);
    fill(d, i);
    days[k] = d;
    prev = d;
  }
  return days;
};

t("a day clears at 70 percent, not 100", () => {
  const day = generateDay("2026-09-01", DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, null);
  const total = dayAvailableXp(day);
  let acc = 0;
  day.quests.forEach((q) => {
    if (acc / total < 0.72) { q.done = true; acc += q.xp; }
  });
  assert.ok(dayEarnedXp(day) < total, "not everything done");
  assert.equal(isDayCleared(day), true);
});

t("a mostly empty day does not clear", () => {
  const day = generateDay("2026-09-01", DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, null);
  day.quests[0].done = true;
  assert.equal(isDayCleared(day), false);
});

t("streak counts back from today and stops at the first miss", () => {
  const days = buildDays("2026-08-25", 7, (d, i) => {
    d.quests.forEach((q) => (q.done = i !== 2));
  });
  const s = computeStreak(days, "2026-08-31");
  assert.equal(s.current, 4, "25,26 then miss on 27, then 28-31 is four");
  assert.ok(s.best >= 4);
});

t("today still in progress does not break the streak", () => {
  const days = buildDays("2026-08-28", 4, (d, i) => {
    d.quests.forEach((q) => (q.done = i < 3));
  });
  const s = computeStreak(days, "2026-08-31");
  assert.equal(s.current, 3, "an unfinished today should not zero the run");
});

/* ---------- ratchet ---------- */

t("eight clean runs raise the band, seven do not", () => {
  const seven = buildDays("2026-08-25", 7, (d) => d.quests.forEach((q) => (q.done = true)));
  const r7 = applyRatchet(seven, "2026-08-31", { ...DEFAULT_PROGRESSION });
  assert.equal(r7.raised.length, 0);
  assert.equal(r7.prog.cfBand, DEFAULT_PROGRESSION.cfBand);

  const eight = buildDays("2026-08-24", 8, (d) => d.quests.forEach((q) => (q.done = true)));
  const r8 = applyRatchet(eight, "2026-08-31", { ...DEFAULT_PROGRESSION });
  assert.equal(r8.prog.cfBand, DEFAULT_PROGRESSION.cfBand + 25);
  assert.equal(r8.prog.hullPages, DEFAULT_PROGRESSION.hullPages + 1);
  assert.equal(r8.prog.teasers, DEFAULT_PROGRESSION.teasers + 1);
  assert.equal(r8.raised.length, 3);
});

t("one bad day inside the run blocks the ratchet", () => {
  const days = buildDays("2026-08-22", 10, (d, i) => {
    d.quests.forEach((q) => (q.done = i !== 8));
  });
  const r = applyRatchet(days, "2026-08-31", { ...DEFAULT_PROGRESSION });
  assert.equal(r.prog.cfBand, DEFAULT_PROGRESSION.cfBand);
});

t("the band stops at its cap", () => {
  const days = buildDays("2026-08-24", 8, (d) => d.quests.forEach((q) => (q.done = true)));
  const r = applyRatchet(days, "2026-08-31", { cfBand: 2100, hullPages: 35, teasers: 6 });
  assert.equal(r.prog.cfBand, 2100);
  assert.equal(r.prog.hullPages, 35);
  assert.equal(r.raised.length, 0);
});

t("the ratchet cannot fire twice in one day", () => {
  const days = buildDays("2026-08-24", 8, (d) => d.quests.forEach((q) => (q.done = true)));
  let prog = { ...DEFAULT_PROGRESSION };
  const first = applyRatchet(days, "2026-08-31", prog);
  assert.equal(first.raised.length, 3);
  prog = first.prog;
  // ten more saves on the same day, as tapping quests would produce
  for (let i = 0; i < 10; i++) {
    const again = applyRatchet(days, "2026-08-31", prog);
    assert.equal(again.raised.length, 0, `save ${i + 2} should not raise again`);
    prog = again.prog;
  }
  assert.equal(prog.cfBand, DEFAULT_PROGRESSION.cfBand + 25, "band moved exactly one step");
  assert.equal(prog.hullPages, DEFAULT_PROGRESSION.hullPages + 1);
});

t("the run restarts after a raise instead of firing daily", () => {
  // sixteen clean days: enough for exactly two raises, not sixteen
  const days = buildDays("2026-08-16", 16, (d) => d.quests.forEach((q) => (q.done = true)));
  let prog = { ...DEFAULT_PROGRESSION };
  for (let i = 0; i < 16; i++) {
    prog = applyRatchet(days, shiftKey("2026-08-16", i), prog, {}).prog;
  }
  assert.equal(prog.cfBand, DEFAULT_PROGRESSION.cfBand + 50, `band was ${prog.cfBand}, wanted two steps`);
});

t("a longer required streak slows progression", () => {
  const days = buildDays("2026-08-24", 8, (d) => d.quests.forEach((q) => (q.done = true)));
  const r = applyRatchet(days, "2026-08-31", { ...DEFAULT_PROGRESSION }, { ratchetStreak: 14 });
  assert.equal(r.raised.length, 0);
});

/* ---------- totals ---------- */

t("totals award shadow-multiplied xp and deduct for past misses", () => {
  const days = buildDays("2026-08-30", 2, (d, i) => d.quests.forEach((q) => (q.done = i === 1)));
  const plain = recomputeTotals(days, [], "2026-08-31");
  const boosted = recomputeTotals(days, [{ stat: "INT", bonus: 10 }], "2026-08-31");
  assert.ok(boosted.statXp.INT > plain.statXp.INT, "shadow raises INT");
  assert.equal(boosted.statXp.STR, plain.statXp.STR, "shadow leaves other stats alone");
  assert.ok(plain.statXp.INT >= 0, "never negative");
});

t("today's undone quests are not yet penalised", () => {
  const days = buildDays("2026-08-31", 1, (d) => d.quests.forEach((q) => (q.done = false)));
  const totals = recomputeTotals(days, [], "2026-08-31");
  assert.equal(totals.totalXp, 0, "an unfinished today costs nothing yet");
});

t("yesterday's undone quests do cost", () => {
  const days = buildDays("2026-08-30", 1, (d) => d.quests.forEach((q) => (q.done = false)));
  const totals = recomputeTotals(days, [], "2026-08-31");
  assert.equal(totals.totalXp, 0, "floor at zero");
  const withBank = buildDays("2026-08-29", 2, (d, i) => d.quests.forEach((q) => (q.done = i === 0)));
  const a = recomputeTotals(withBank, [], "2026-08-31");
  const allDone = buildDays("2026-08-29", 2, (d) => d.quests.forEach((q) => (q.done = true)));
  const b = recomputeTotals(allDone, [], "2026-08-31");
  assert.ok(a.totalXp < b.totalXp, "missing a day should cost relative to clearing it");
});

t("miss flags raise at three in the trailing week", () => {
  const days = buildDays("2026-08-25", 7, (d, i) => {
    d.quests.forEach((q) => (q.done = !(q.stat === "AGI" && i < 3)));
  });
  const flags = missFlags(days, "2026-09-01");
  assert.equal(flags.AGI.flagged, true);
  assert.equal(flags.STR.flagged, false);
});

/* ---------- nutrition ---------- */

t("macroTotals sums and handles empties", () => {
  assert.deepEqual(macroTotals([]), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  assert.deepEqual(macroTotals(undefined), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const sum = macroTotals([
    { kcal: 100, protein: 10, carbs: 5, fat: 2 },
    { kcal: 250, protein: 24, carbs: 8, fat: 3 },
  ]);
  assert.equal(sum.kcal, 350);
  assert.equal(sum.protein, 34);
});

t("scaleFood scales every macro and labels the amount", () => {
  const whey = { name: "Whey scoop", base: 1, unit: "scoop", kcal: 120, protein: 24, carbs: 3, fat: 1.5 };
  const two = scaleFood(whey, 2);
  assert.equal(two.kcal, 240);
  assert.equal(two.protein, 48);
  assert.equal(two.qty, "2 scoop");
  const half = scaleFood(whey, 0.5);
  assert.equal(half.kcal, 60);
  assert.equal(half.protein, 12);
});

t("smooth averages over a trailing window", () => {
  const s = smooth([10, 20, 30, 40], 2);
  assert.equal(s[0], 10);
  assert.equal(s[1], 15);
  assert.equal(s[3], 35);
});

/* ---------- gates ---------- */

t("gate status reflects distance and clearing", () => {
  assert.equal(gateStatus({ date: "2026-08-31" }, "2026-08-31"), "open");
  assert.equal(gateStatus({ date: "2026-09-02" }, "2026-08-31"), "imminent");
  assert.equal(gateStatus({ date: "2026-10-30" }, "2026-08-31"), "dormant");
  assert.equal(gateStatus({ date: "2026-08-01" }, "2026-08-31"), "collapsed");
  assert.equal(gateStatus({ date: "2026-08-01", cleared: true }, "2026-08-31"), "cleared");
});

t("sortGates puts open first and cleared last", () => {
  const g = [
    { id: "a", date: "2027-01-01" },
    { id: "b", date: "2026-08-31" },
    { id: "c", date: "2026-01-01", cleared: true },
    { id: "d", date: "2026-09-02" },
  ];
  assert.deepEqual(sortGates(g, "2026-08-31").map((x) => x.id), ["b", "d", "a", "c"]);
});

/* ---------- integrity ---------- */

t("every template quest names a real stat and positive xp", () => {
  Object.values(DEFAULT_TEMPLATES).flat().forEach((q) => {
    assert.ok(STATS.includes(q.stat), `${q.key} has bad stat ${q.stat}`);
    assert.ok(q.xp > 0, `${q.key} has no xp`);
    assert.ok(q.title && q.key, "quest needs a key and title");
  });
});

t("every weekday is covered by a template", () => {
  for (let i = 0; i < 7; i++) assert.ok(DEFAULT_TEMPLATES[i]?.length, `weekday ${i} missing`);
});


/* ---- regression: dynamic detail lines must survive serialisation ---- */
{
  const { resolveDetail, generateDay } = await import("../src/engine.js");
  const { emptyState, hydrate, TEMPLATES_VERSION } = await import("../src/store.js");

  t("resolveDetail fills placeholders from progression", () => {
    const out = resolveDetail("band {cfBand}–{cfBandTop}, {teasers} teasers", { cfBand: 1500, teasers: 2 });
    assert.equal(out, "band 1500–1700, 2 teasers");
  });

  t("unknown placeholders are left intact rather than blanked", () => {
    assert.equal(resolveDetail("{nope} here", {}), "{nope} here");
  });

  t("templates survive a JSON round-trip with details intact", () => {
    const s = emptyState();
    const cloned = JSON.parse(JSON.stringify(s));
    const mon = cloned.templates[1];
    const whood = mon.find((q) => q.key === "whood");
    assert.ok(whood.detail && whood.detail.includes("focused hour"));
  });

  t("generated weekday quests show the Whood block, teaser count and page target", () => {
    const s = emptyState();
    const day = generateDay("2026-08-31", s.templates, s.progression, null);
    const find = (k) => day.quests.find((q) => q.key === k);
    assert.match(find("whood").detail, /focused hour/);
    assert.match(find("teasers").detail, /2 from Brainstellar/);
    assert.match(find("hull_eve").detail, /15 pages/);
    day.quests.forEach((q) => assert.ok(q.detail.length > 0, `${q.key} has no detail`));
  });

  t("a pre-v2 save is migrated and its blank details repaired", () => {
    const broken = emptyState();
    delete broken.templatesVersion;
    broken.days["2026-08-31"] = {
      date: "2026-08-31",
      quests: [{ id: "x", key: "whood", title: "Whood product block", detail: "", stat: "AGI", xp: 55, slot: 4, done: true }],
      generated: true,
    };
    broken.templates[1].forEach((q) => (q.detail = undefined));

    const fixed = hydrate(JSON.parse(JSON.stringify(broken)));
    assert.equal(fixed.templatesVersion, TEMPLATES_VERSION, "migrated up to the current version");
    assert.match(fixed.days["2026-08-31"].quests[0].detail, /focused hour/);
    assert.equal(fixed.days["2026-08-31"].quests[0].done, true, "progress must be preserved");
  });

  t("a quest added to the template appears on today and ahead, never on a closed day", () => {
    const today = dateKey(new Date());
    const past = shiftKey(today, -2);
    const ahead = shiftKey(today, 1);

    /* A board generated before office existed: the key is simply absent, so a
       reprice alone would never surface it. */
    const day = (k) => ({
      date: k, generated: true,
      quests: [{ id: k + "-w", key: "wake", title: "Wake at 05:00", detail: "d", stat: "VIT", xp: 10, slot: 1, done: true }],
    });

    const old = emptyState();
    delete old.templatesVersion;
    [past, today, ahead].forEach((k) => (old.days[k] = day(k)));

    const fixed = hydrate(JSON.parse(JSON.stringify(old)));
    const has = (k) => fixed.days[k].quests.some((q) => q.key === "office");

    assert.equal(has(past), false, "a day already graded is left exactly as it was");
    assert.equal(dayAvailableXp(fixed.days[past]), 10, "so its denominator cannot move either");

    const weekday = (k) => [1, 2, 3, 4, 5].includes(parseKey(k).getDay());
    if (weekday(today)) assert.ok(has(today), "today picks it up");
    if (weekday(ahead)) assert.ok(has(ahead), "and so does tomorrow");

    const office = fixed.days[weekday(today) ? today : ahead].quests.find((q) => q.key === "office");
    if (office) assert.equal(office.done, false, "it arrives undone, to be earned");
    assert.equal(fixed.days[today].quests.find((q) => q.key === "wake").done, true, "progress is untouched");
  });

  t("an inserted board still sorts, penalty quests last", () => {
    const today = dateKey(new Date());
    const old = emptyState();
    delete old.templatesVersion;
    old.days[today] = {
      date: today, generated: true,
      quests: [
        { id: "p", key: "carried", title: "Carried", detail: "", stat: "INT", xp: 30, slot: "penalty", done: false, penalty: true },
        { id: "s", key: "sleep", title: "Lights out by 22:00", detail: "", stat: "VIT", xp: 15, slot: 9, done: false },
      ],
    };

    const fixed = hydrate(JSON.parse(JSON.stringify(old)));
    const slots = fixed.days[today].quests.map((q) => q.slot);
    const numeric = slots.filter((x) => typeof x === "number");
    assert.deepEqual(numeric, [...numeric].sort((a, b) => a - b), "numbered slots are in order");
    assert.equal(fixed.days[today].quests[fixed.days[today].quests.length - 1].slot, "penalty",
      "a carried quest sorts to the end rather than breaking the comparison");
  });

  t("a reprice reaches today and ahead, and never a day already graded", () => {
    const today = dateKey(new Date());
    const past = shiftKey(today, -3);
    const ahead = shiftKey(today, 2);
    const day = (k) => ({
      date: k, generated: true,
      quests: [
        { id: k + "-cf", key: "cf", title: "Codeforces, one problem", detail: "d", stat: "AGI", xp: 55, slot: 4, done: true },
        { id: k + "-h", key: "hull_eve", title: "Options block", detail: "d", stat: "INT", xp: 45, slot: 6, done: false },
      ],
    });

    const old = emptyState();
    delete old.templatesVersion;
    [past, today, ahead].forEach((k) => (old.days[k] = day(k)));

    const fixed = hydrate(JSON.parse(JSON.stringify(old)));
    const xp = (k, key) => fixed.days[k].quests.find((q) => q.key === key).xp;

    assert.equal(xp(past, "cf"), 55, "a closed day keeps the price it was graded under");
    assert.equal(xp(past, "hull_eve"), 45, "rewriting it would move penalties already taken");

    const liveCf = DEFAULT_TEMPLATES[1].find((q) => q.key === "whood").xp;
    const liveHull = DEFAULT_TEMPLATES[1].find((q) => q.key === "hull_eve").xp;
    assert.equal(xp(today, "whood"), liveCf, "today follows the current price");
    assert.equal(xp(ahead, "hull_eve"), liveHull, "so does a day not yet reached");
    const doneWake = fixed.days[today].quests.find((q) => q.key === "wake");
    assert.equal(doneWake.done, true, "progress survives the reprice");
  });

  t("Whood is optional to Codeforces and the placeholder block is absent", () => {
    Object.entries(DEFAULT_TEMPLATES).forEach(([d, quests]) => {
      const keys = quests.map((q) => q.key);
      assert.ok(keys.some((k) => k.startsWith("whood")), `day ${d} has Whood`);
      assert.ok(!keys.some((k) => k === "cf" || k.startsWith("cf_")), `day ${d} has no compulsory Codeforces`);
      assert.ok(!keys.includes("projects_maths"), `day ${d} has no placeholder block`);
    });
  });

  t("Monday has no third study session", () => {
    assert.ok(!DEFAULT_TEMPLATES[1].some((q) => q.key === "study_third"));
  });

  t("migration renames Night block without touching penalty quests", () => {
    const old = emptyState();
    delete old.templatesVersion;
    old.days["2026-08-30"] = {
      date: "2026-08-30",
      quests: [
        { id: "a", key: "maths_night", title: "Night block", detail: "", stat: "INT", xp: 45, done: false },
        { id: "b", key: "cf", title: "Codeforces, one problem", detail: "", stat: "AGI", xp: 82, penalty: true, done: false },
      ],
      generated: true,
    };
    const fixed = hydrate(JSON.parse(JSON.stringify(old)));
    assert.equal(fixed.days["2026-08-30"].quests[0].title, "Night block");
    assert.equal(fixed.days["2026-08-30"].quests[1].xp, 82, "penalty xp must not be reset");
  });
}



/* ---- meal scanning ---- */
{
  const { extractJson, reconcile } = await import("../src/lib/vision.js");
  const { FOODS } = await import("../src/data.js");

  t("extractJson tolerates code fences and surrounding prose", () => {
    const out = extractJson('Here you go:\n```json\n{"items":[],"note":null}\n```');
    assert.deepEqual(out, { items: [], note: null });
  });

  t("extractJson throws rather than returning junk", () => {
    assert.throws(() => extractJson("no json at all"));
  });

  t("a matched food is re-costed from the library, not the model guess", () => {
    const roti = FOODS.find((f) => f.name === "Roti / chapati");
    // model lowballs the macros; library numbers must win
    const out = reconcile({ name: "chapati", match: "Roti / chapati", portion: 3, unit: "piece", kcal: 10, protein: 0.1, confidence: "high" });
    assert.equal(out.source, "library");
    assert.equal(out.kcal, roti.kcal * 3);
    assert.equal(out.protein, +(roti.protein * 3).toFixed(1));
  });

  t("gram-based library items scale off their base quantity", () => {
    const paneer = FOODS.find((f) => f.name === "Paneer");   // base 100 g
    const out = reconcile({ name: "paneer", match: "Paneer", portion: 150, unit: "g", confidence: "medium" });
    assert.equal(out.kcal, Math.round(paneer.kcal * 1.5));
  });

  t("an unmatched food keeps the estimate and is flagged as such", () => {
    const out = reconcile({ name: "unknown curry", match: null, portion: 1, unit: "bowl", kcal: 240, protein: 8, carbs: 20, fat: 12 });
    assert.equal(out.source, "estimate");
    assert.equal(out.kcal, 240);
    assert.equal(out.confidence, "low");
  });

  t("a bogus match name falls back to estimate instead of throwing", () => {
    const out = reconcile({ name: "x", match: "Not A Real Food", portion: 2, unit: "piece", kcal: 100 });
    assert.equal(out.source, "estimate");
  });

  t("negative or missing numbers are clamped, never logged as negative", () => {
    const out = reconcile({ name: "x", match: null, portion: -5, kcal: -100, protein: undefined });
    assert.ok(out.kcal >= 0 && out.protein >= 0);
    assert.match(out.qty, /^1 /);
  });
}


/* ---- discipline model ---- */
{
  const E = await import("../src/engine.js");
  const { emptyState } = await import("../src/store.js");
  const st = emptyState();

  const mk = (k, frac, opts = {}) => {
    const d = E.generateDay(k, st.templates, st.progression, null);
    const avail = d.quests.reduce((a, q) => a + q.xp, 0);
    let got = 0;
    d.quests.forEach((q) => { if (got + q.xp <= avail * frac) { q.done = true; got += q.xp; } });
    if (opts.excuseAll) d.quests.forEach((q) => { if (!q.done) q.excused = true; });
    return d;
  };
  const run = (fracs, start = 10) => {
    const days = {};
    fracs.forEach((f, i) => { const k = `2026-08-${String(start + i).padStart(2, "0")}`; days[k] = mk(k, f); });
    return days;
  };

  t("a perfect day is clean and costs nothing", () => {
    const d = mk("2026-08-10", 1);
    assert.equal(E.gradeDay(d).grade, "clean");
    assert.equal(E.dayPenalty(d, 1).total, 0);
  });

  t("a day that cleared the bar costs nothing, however much is left", () => {
    const d = E.generateDay("2026-08-10", st.templates, st.progression, null);
    d.quests.forEach((q, i) => (q.done = i !== 0));
    const g = E.gradeDay(d);
    assert.ok(g.ratio >= g.bar, "one miss still clears a full board");
    assert.equal(E.dayPenalty(d, 1, undefined, "normal").total, 0,
      "a day you already won must not also be charged for");
    assert.equal(g.needed, 0);
  });

  t("the charge starts exactly at the bar, not before it", () => {
    const under = mk("2026-08-10", 0.6);
    const over = mk("2026-08-10", 0.9);
    assert.ok(E.gradeDay(under, "normal").ratio < 0.7, "the fixture really is under the bar");
    assert.ok(E.gradeDay(over, "normal").ratio >= 0.7, "and this one really is over it");
    assert.equal(E.dayPenalty(over, 1, undefined, "normal").total, 0, "over the bar costs nothing");
    assert.ok(E.dayPenalty(under, 1, undefined, "normal").total > 0, "under it does");
  });

  t("the same day is free or charged depending on the standard", () => {
    const d = mk("2026-08-10", 0.8);
    const cost = (m) => E.dayPenalty(d, 1, E.difficultyOf(m).depth, m).total;
    assert.equal(cost("normal"), 0, "clears at 70%");
    assert.ok(cost("hard") > 0, "does not clear at the harder bar");
    assert.ok(cost("monarch") > cost("hard"), "and monarch charges it harder still");
  });

  t("an abandoned day still costs the full depth", () => {
    const d = mk("2026-08-10", 0);
    const g = E.gradeDay(d, "normal");
    assert.equal(g.shortfall, 1, "measuring against the bar must not soften a total collapse");
    assert.equal(E.dayPenalty(d, 1, undefined, "normal").days, E.PENALTY_DEPTH);
  });

  t("a cleared day is not a lapse and does not escalate the next one", () => {
    const days = {};
    ["2026-08-10", "2026-08-11", "2026-08-12"].forEach((k) => { days[k] = mk(k, 0.9); });
    Object.values(days).forEach((d) => assert.equal(E.gradeDay(d, "normal").grade, "held"));
    const esc = E.escalationAt(days, "2026-08-13", null, "normal");
    assert.equal(esc.lapses, 0, "three cleared days are not a spiral");
    assert.equal(esc.multiplier, 1);
  });

  t("the board reports how much more clears the day", () => {
    const d = mk("2026-08-10", 0.5);
    const g = E.gradeDay(d, "normal");
    const avail = E.dayAvailableXp(d);
    const earned = E.dayEarnedXp(d);
    assert.ok(g.needed > 0);
    assert.ok(earned + g.needed >= Math.ceil(avail * g.bar), "topping up by that much clears it");

    d.quests.forEach((q) => (q.done = true));
    assert.equal(E.gradeDay(d, "normal").needed, 0);
  });

  t("less work means a steeper charge", () => {
    const light = E.dayPenalty(mk("2026-08-10", 0.6), 1, undefined, "normal").total;
    const heavy = E.dayPenalty(mk("2026-08-10", 0.2), 1, undefined, "normal").total;
    assert.ok(heavy > light * 2, `${heavy} should far exceed ${light}`);
  });

  t("an abandoned day costs the full penalty depth in days of work", () => {
    assert.equal(E.dayPenalty(mk("2026-08-10", 0), 1).days, E.PENALTY_DEPTH);
  });

  t("repeat lapses escalate the same shortfall", () => {
    const days = run([0.5, 0.5, 0.5, 0.5]);
    const keys = Object.keys(days).sort();
    const costs = keys.map((k) => E.dayPenalty(days[k], E.escalationAt(days, k).multiplier).total);
    for (let i = 1; i < costs.length; i++) {
      assert.ok(costs[i] > costs[i - 1], `lapse ${i} must cost more than ${i - 1}`);
    }
  });

  t("escalation is capped so the hole stays finite", () => {
    const days = run(new Array(14).fill(0));
    const last = Object.keys(days).sort().pop();
    assert.equal(E.escalationAt(days, last).multiplier, E.ESCALATION_CAP);
  });

  t("an isolated slip between clean days does not escalate", () => {
    // 10 clean, 11-13 clean, slip on 14 → run of 1, paid off by the clean streak
    const days = run([1, 1, 1, 1]);
    days["2026-08-14"] = mk("2026-08-14", 0.5);
    days["2026-08-15"] = mk("2026-08-15", 0.5);
    const e = E.escalationAt(days, "2026-08-15");
    assert.equal(e.lapses, 1, "one consecutive lapse behind it");
    assert.ok(e.forgiven >= 1, "a clean streak before it pays the lapse off");
    assert.equal(e.multiplier, 1, "noise must not escalate");
  });

  t("a run still escalates, one step at a time", () => {
    const days = run([1, 1, 1, 0.5, 0.5, 0.5, 0.5]);
    const e = E.escalationAt(days, "2026-08-16");
    assert.equal(e.lapses, 3, "three consecutive lapses behind it");
    assert.ok(e.multiplier > 1, "a spiral must still cost more than a single slip");

    // Monotonic: deeper into a run is never cheaper than earlier in it.
    const shallow = E.escalationAt(days, "2026-08-15").multiplier;
    assert.ok(e.multiplier >= shallow, "escalation must not go backwards mid-run");
    assert.ok(e.multiplier <= E.ESCALATION_CAP, "and must never pass the cap");
  });

  /* The rule the owner asked for: covering the work the next day has to be
     worth something. Before this, climbing out of a slump forgave nothing —
     the forgiveness loop only ever looked at clean days BEFORE it. */

  t("a clean day afterwards pays down the lapse it answered", () => {
    const days = run([1, 0.5, 0.5, 0.5, 1]);   // clean, three lapses, clean
    const lastLapse = "2026-08-13";

    const blind = E.escalationAt({ ...days, "2026-08-14": undefined }, lastLapse);
    const answered = E.escalationAt(days, lastLapse);

    assert.ok(answered.recovered >= 1, "the clean day after it counts");
    assert.ok(
      answered.multiplier < blind.multiplier,
      `recovery must reduce the charge (${answered.multiplier} vs ${blind.multiplier})`
    );
  });

  t("recovery lowers what a slump finally cost", () => {
    const slump = run([1, 0.5, 0.5, 0.5]);
    const recovered = { ...slump };
    ["2026-08-14", "2026-08-15"].forEach((k) => (recovered[k] = mk(k, 1)));

    const a = E.recomputeTotals(slump, [], "2026-08-14").charged;
    const b = E.recomputeTotals(recovered, [], "2026-08-16").charged;
    assert.ok(b < a, `climbing out must cost less than staying down (${b} vs ${a})`);
  });

  t("an unfinished day is never counted as recovery", () => {
    const days = run([1, 0.5, 0.5, 0.5, 1]);
    const lastLapse = "2026-08-13";
    // With today set to the clean day, that day has not closed yet.
    const midDay = E.escalationAt(days, lastLapse, "2026-08-14");
    const closed = E.escalationAt(days, lastLapse, "2026-08-15");
    assert.equal(midDay.recovered, 0, "a day still in progress proves nothing");
    assert.ok(closed.recovered >= 1, "once it closes clean, it counts");
  });

  t("abandoning the system is still expensive", () => {
    const days = run([1, 1, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]);
    const e = E.escalationAt(days, "2026-08-17");
    assert.ok(e.multiplier > 1.5, "a sustained collapse must still bite");
    const charged = E.recomputeTotals(days, [], "2026-08-18").charged;
    assert.ok(charged > 0, "and must actually be charged");
  });

  t("excused quests leave the denominator entirely", () => {
    const d = mk("2026-08-10", 0.4, { excuseAll: true });
    assert.equal(E.gradeDay(d).grade, "clean");
    assert.equal(E.dayPenalty(d, 3).total, 0, "an excused day must never be charged");
  });

  t("sustained lapses drive the level down", () => {
    const good = run(new Array(6).fill(1));
    const before = E.levelFromTotalXp(E.recomputeTotals(good, [], "2026-08-20").totalXp).level;
    const bad = { ...good };
    for (let i = 0; i < 6; i++) { const k = `2026-08-${16 + i}`; bad[k] = mk(k, 0.1); }
    const after = E.levelFromTotalXp(E.recomputeTotals(bad, [], "2026-08-25").totalXp).level;
    assert.ok(after < before, `level should fall from ${before}, got ${after}`);
  });

  t("xp and every stat are floored at zero, never negative", () => {
    const days = run(new Array(20).fill(0));
    const tot = E.recomputeTotals(days, [], "2026-09-30");
    assert.ok(tot.totalXp >= 0);
    E.STATS.forEach((s) => assert.ok(tot.statXp[s] >= 0, `${s} went negative`));
    assert.equal(E.levelFromTotalXp(tot.totalXp).level, 1, "level floors at 1");
  });

  t("today is never charged while it is still winnable", () => {
    const days = run([0]);
    const only = Object.keys(days)[0];
    const tot = E.recomputeTotals(days, [], only);
    assert.equal(tot.charged, 0);
  });

  t("recovery is possible: clean days climb back out", () => {
    const days = run([0, 0, 0]);
    const sunk = E.recomputeTotals(days, [], "2026-08-13").totalXp;
    for (let i = 0; i < 10; i++) { const k = `2026-08-${13 + i}`; days[k] = mk(k, 1); }
    const back = E.recomputeTotals(days, [], "2026-08-24").totalXp;
    assert.ok(back > sunk, "clean days must recover ground");
  });
}

/* ---------- strength progression ---------- */

const BENCH = { key: "bench", kind: "load", sets: 3, repRange: [8, 12], step: 2.5, start: { kg: 55 } };
const PLANK = { key: "plank", kind: "hold", sets: 2, secRange: [45, 90], step: 5, start: { sec: 45 } };
const TWIST = { key: "twist", kind: "reps", sets: 2, repRange: [20, 30], step: 2, start: { reps: 20 } };
const TREAD = {
  key: "tread", kind: "cardio",
  start: { min: 10, incline: 11, speed: 4.7 },
  caps: { min: 20, incline: 15, speed: 6 },
  steps: { min: 1, incline: 0.5, speed: 0.1 },
};
const hist = (...sessions) => sessions.map((entry, i) => ({ date: `2026-08-0${i + 1}`, entry }));

t("a set missing its reps is a gap, not a failure", () => {
  assert.equal(sessionComplete(BENCH, [{ kg: 55, reps: null }]), false);
  assert.equal(sessionComplete(BENCH, [{ kg: 55, reps: 10 }]), true);
  assert.equal(sessionComplete(BENCH, []), false);
});

t("an incomplete session asks for the numbers instead of guessing a target", () => {
  const s = suggestNext(BENCH, hist([{ kg: 55, reps: null }, { kg: 55, reps: null }]));
  assert.equal(s.change, "unknown");
  assert.match(s.reason, /missing/i);
});

t("no history at all falls back to the planned baseline", () => {
  const s = suggestNext(BENCH, []);
  assert.equal(s.change, "seed");
  assert.equal(s.target.kg, 55);
  assert.equal(s.target.reps, 8, "reps start at the bottom of the range");
});

t("topping the range on every set adds one load step and resets the reps", () => {
  const s = suggestNext(BENCH, hist([{ kg: 55, reps: 12 }, { kg: 55, reps: 12 }, { kg: 55, reps: 12 }]));
  assert.equal(s.change, "up");
  assert.equal(s.target.kg, 57.5);
  assert.equal(s.target.reps, 8);
});

t("one set short of the top holds the load and asks for a rep", () => {
  const s = suggestNext(BENCH, hist([{ kg: 55, reps: 12 }, { kg: 55, reps: 12 }, { kg: 55, reps: 10 }]));
  assert.equal(s.change, "hold");
  assert.equal(s.target.kg, 55, "the load must not move on the weakest set alone");
  assert.equal(s.target.reps, 11);
});

t("load and reps never move in the same session", () => {
  const s = suggestNext(BENCH, hist([{ kg: 55, reps: 12 }, { kg: 55, reps: 12 }, { kg: 55, reps: 12 }]));
  assert.ok(s.target.kg > 55 && s.target.reps === 8, "reps go down when the load goes up");
});

t("a session under the range repeats rather than climbing", () => {
  const s = suggestNext(BENCH, hist([{ kg: 60, reps: 6 }, { kg: 60, reps: 5 }, { kg: 60, reps: 5 }]));
  assert.equal(s.change, "hold");
  assert.equal(s.target.kg, 60);
});

t("three stalled sessions back the load off instead of grinding it", () => {
  const short = [{ kg: 60, reps: 6 }, { kg: 60, reps: 6 }, { kg: 60, reps: 5 }];
  const s = suggestNext(BENCH, hist(short, short, short));
  assert.equal(s.change, "down");
  assert.equal(s.target.kg, 55, "10% off 60, rounded to the 2.5 kg the rack holds");
  assert.ok(DELOAD_AFTER === 3);
});

t("a set past the ceiling means the load was too light, whatever the range says", () => {
  const decline = { key: "d", kind: "load", sets: 2, repRange: [10, 12], ceiling: 15, step: 2.5, start: {} };
  const s = suggestNext(decline, hist([{ kg: 30, reps: 11 }, { kg: 30, reps: 15 }]));
  assert.equal(s.change, "up");
  assert.equal(s.target.kg, 32.5);
});

t("holds and bodyweight reps progress on time and count, not load", () => {
  const held = suggestNext(PLANK, hist([{ sec: 45 }, { sec: 45 }]));
  assert.equal(held.change, "hold");
  assert.equal(held.target.sec, 50, "a hold climbs in five second steps");

  const cleared = suggestNext(PLANK, hist([{ sec: 90 }, { sec: 90 }]));
  assert.equal(cleared.change, "up");
  assert.equal(cleared.target.sec, 95);
  assert.equal(cleared.target.kg, undefined, "bodyweight work carries no load");

  const twists = suggestNext(TWIST, hist([{ reps: 30 }, { reps: 30 }]));
  assert.equal(twists.target.reps, 32);
});

t("the treadmill moves one dial per session and rotates which", () => {
  const done = { min: 10, incline: 11, speed: 4.7, nonstop: true };
  const first = suggestNext(TREAD, hist({ cardio: done }));
  assert.equal(first.change, "up");
  const moved = ["min", "incline", "speed"].filter((k) => first.target[k] !== done[k]);
  assert.equal(moved.length, 1, "exactly one dial may move");

  const second = suggestNext(TREAD, hist({ cardio: done }, { cardio: { ...first.target, nonstop: true } }));
  assert.notEqual(second.moved, first.moved, "the next session advances a different dial");
});

t("breaking the walk repeats it before anything advances", () => {
  const s = suggestNext(TREAD, hist({ cardio: { min: 12, incline: 11, speed: 4.7, nonstop: false } }));
  assert.equal(s.change, "hold");
  assert.deepEqual(s.target, { min: 12, incline: 11, speed: 4.7 });
});

t("a dial at its cap is skipped rather than pushed past it", () => {
  const maxed = { min: 20, incline: 15, speed: 6, nonstop: true };
  const s = suggestNext(TREAD, hist({ cardio: maxed }));
  assert.equal(s.change, "hold");
  assert.match(s.reason, /cap/);
});

t("today's own log never feeds the target it is being measured against", () => {
  const training = {
    "2026-08-24": { sets: { bench: [{ kg: 55, reps: 12 }, { kg: 55, reps: 12 }, { kg: 55, reps: 12 }] } },
    "2026-08-31": { sets: { bench: [{ kg: 57.5, reps: 8 }, { kg: 57.5, reps: 8 }, { kg: 57.5, reps: 8 }] } },
  };
  const { suggestion, history } = progressionFor(BENCH, training, "2026-08-31");
  assert.equal(history.length, 2);
  assert.equal(suggestion.target.kg, 57.5, "the target comes from last week, not from what was just typed");
});

t("history is ordered oldest first and stops at the cutoff", () => {
  const training = {
    "2026-09-07": { sets: { bench: [{ kg: 60, reps: 8 }] } },
    "2026-08-24": { sets: { bench: [{ kg: 55, reps: 8 }] } },
    "2026-08-31": { sets: {} },
  };
  const h = exerciseHistory(training, "bench", "2026-08-31");
  assert.deepEqual(h.map((x) => x.date), ["2026-08-24"], "later days and empty days are left out");
});

t("Monday's split is fully described and every exercise key is unique", () => {
  const ex = TRAINING[1].exercises;
  assert.ok(ex && ex.length, "Monday runs in logged mode");
  assert.equal(new Set(ex.map((e) => e.key)).size, ex.length, "keys are the history's identity");
  ex.forEach((e) => {
    assert.ok(["load", "reps", "hold", "cardio"].includes(e.kind), `${e.key} has a known kind`);
    if (e.kind === "cardio") { assert.ok(e.start && e.caps && e.steps); return; }
    assert.ok(e.sets > 0, `${e.key} states its set count`);
    const range = e.kind === "hold" ? e.secRange : e.repRange;
    assert.ok(range && range[0] < range[1], `${e.key} has a working range`);
  });
});

t("every Monday exercise yields a usable suggestion from an empty log", () => {
  TRAINING[1].exercises.forEach((e) => {
    const s = suggestNext(e, []);
    assert.ok(s && s.target && s.reason, `${e.key} produces a target`);
  });
});

/* ---------- difficulty ---------- */

const mkDay = (dk, ratio) => {
  const quests = [];
  for (let i = 0; i < 10; i++) quests.push({ id: `${dk}-${i}`, title: "q", stat: "INT", xp: 10, done: i < ratio * 10 });
  return { key: dk, generated: true, quests };
};

t("hard mode raises the bar a day has to clear", () => {
  const d = mkDay("2026-08-31", 0.75);
  assert.equal(isDayCleared(d, "normal"), true, "75% clears at the 70% bar");
  assert.equal(isDayCleared(d, "hard"), false, "the same day does not clear at 85%");
  assert.equal(isDayCleared(d, "monarch"), false);
});

t("an unknown difficulty falls back to normal rather than throwing", () => {
  const d = mkDay("2026-08-31", 0.75);
  assert.equal(isDayCleared(d, "nonsense"), isDayCleared(d, "normal"));
  assert.equal(isDayCleared(d), isDayCleared(d, "normal"), "omitting it keeps the original behaviour");
});

t("hard mode charges a shortfall more deeply", () => {
  const d = mkDay("2026-08-31", 0.5);
  const soft = dayPenalty(d, 1, DIFFICULTY.normal.depth).total;
  const hard = dayPenalty(d, 1, DIFFICULTY.hard.depth).total;
  assert.ok(hard > soft, "the same half-done day must cost more on hard");
});

t("switching difficulty re-grades history rather than only new days", () => {
  const days = {};
  for (let i = 1; i <= 6; i++) days[`2026-08-0${i}`] = mkDay(`2026-08-0${i}`, 0.8);
  const soft = recomputeTotals(days, [], "2026-08-10", "normal").totalXp;
  const hard = recomputeTotals(days, [], "2026-08-10", "hard").totalXp;
  assert.ok(hard < soft, "the same log is worth less under a harder standard");
});

/* ---------- calendar grid ---------- */

t("a month grid is always six weeks and starts on the right weekday", () => {
  const g = monthCells(2026, 7, {}, "2026-08-31");
  assert.equal(g.cells.length, 42, "the grid must not reflow between months");
  assert.equal(g.days, 31);
  assert.equal(g.cells[g.startWeekday].dayOfMonth, 1, "the 1st sits under its own weekday");
  assert.equal(g.cells[g.startWeekday].inMonth, true);
  assert.equal(g.cells[0].inMonth, g.startWeekday === 0);
});

t("days the app was not running are blank, never failures", () => {
  const g = monthCells(2026, 7, { "2026-08-31": mkDay("2026-08-31", 1) }, "2026-08-31");
  const logged = g.cells.find((c) => c.key === "2026-08-31");
  const never = g.cells.find((c) => c.key === "2026-08-05");
  assert.equal(logged.grade, "clean");
  assert.equal(never.grade, "none", "an unlogged day is not a broken day");
  assert.equal(never.ratio, null);
});

t("the month summary counts only days inside the month", () => {
  const days = { "2026-08-31": mkDay("2026-08-31", 1), "2026-09-01": mkDay("2026-09-01", 0.2) };
  const g = monthCells(2026, 7, days, "2026-09-05");
  const sum = monthSummary(g.cells);
  assert.equal(sum.clean, 1);
  assert.equal(sum.logged, 1, "September's day is visible in the grid but not in August's count");
});

/* ---------- seasons ---------- */

const SEASON = {
  id: "s1", name: "Season I", startKey: "2026-08-01", endKey: "2026-10-29",
  goals: [
    { key: "a", type: "clearedDays", label: "Clear 60", target: 60 },
    { key: "b", type: "shadows", label: "Ship 2", target: 2 },
  ],
};

t("a season window counts inclusively from both ends", () => {
  const w = seasonWindow(SEASON, "2026-08-01");
  assert.equal(w.total, 90);
  assert.equal(w.elapsed, 1, "the opening day counts as elapsed");
  assert.equal(w.started, true);
  assert.equal(w.done, false);
});

t("goals only count what happened inside the window", () => {
  const state = {
    days: {}, shadows: [
      { id: 1, date: "2026-07-30", stat: "INT", bonus: 5 },
      { id: 2, date: "2026-08-15", stat: "INT", bonus: 5 },
    ],
    statXp: {}, streak: {}, settings: {},
  };
  const g = goalProgress(SEASON.goals[1], state, SEASON, "2026-09-01");
  assert.equal(g.value, 1, "a shadow extracted before the season opened does not count");
  assert.equal(g.met, false);
});

t("a season is not won or lost until its window closes", () => {
  const state = { days: {}, shadows: [], statXp: {}, streak: {}, settings: {} };
  assert.equal(seasonProgress(SEASON, state, "2026-09-01").status, "running");
  assert.equal(seasonProgress(SEASON, state, "2026-10-30").status, "lost", "an unmet season closes as lost");

  const won = { ...SEASON, goals: [{ key: "a", type: "shadows", label: "Ship 1", target: 1 }] };
  const withShip = { ...state, shadows: [{ id: 1, date: "2026-08-15" }] };
  assert.equal(seasonProgress(won, withShip, "2026-09-01").status, "clinched", "met early, but the window is still open");
  assert.equal(seasonProgress(won, withShip, "2026-10-30").status, "won");
});

/* ---------- journey ---------- */

t("the journey is derived from the log, newest first", () => {
  const state = {
    hunter: { createdAt: "2026-08-01" }, days: {}, statXp: {}, streak: { best: 0 },
    shadows: [{ id: 1, name: "Order book", date: "2026-08-20", stat: "INT", bonus: 5 }],
    gates: [{ id: "g", name: "Baruch", rank: "S", date: "2026-09-01", cleared: true, clearedOn: "2026-08-25" }],
    seasons: [],
  };
  const ev = journeyEvents(state, "2026-08-31");
  assert.equal(ev[ev.length - 1].kind, "start", "awakening is the oldest entry");
  assert.deepEqual(ev.map((e) => e.date), [...ev.map((e) => e.date)].sort().reverse(), "newest first");
  assert.ok(ev.some((e) => e.kind === "shadow" && e.title === "Order book"));
  assert.ok(ev.some((e) => e.kind === "gate" && e.title === "Baruch"));
});

/* ---------- schedule ---------- */

t("clock helpers round-trip and wrap past midnight", () => {
  assert.equal(toMins("06:30"), 390);
  assert.equal(toClock(390), "06:30");
  assert.equal(toClock(1500), "01:00", "past midnight wraps rather than reading 25:00");
  assert.equal(toClock(-30), "23:30");
});

t("open windows are the gaps between fixed blocks", () => {
  const gaps = openWindows({ wake: "05:00", sleep: "22:00", fixed: [{ start: "06:00", mins: 60 }] });
  assert.equal(gaps.length, 2);
  assert.deepEqual(gaps[0], { start: 300, end: 360 });
  assert.equal(gaps[1].start, 420);
});

t("overlapping fixed blocks are merged, not rejected", () => {
  const gaps = openWindows({
    wake: "05:00", sleep: "22:00",
    fixed: [{ start: "09:00", mins: 120 }, { start: "10:00", mins: 120 }],
  });
  assert.equal(gaps.length, 2, "two overlapping commitments are one busy stretch");
  assert.equal(gaps[1].start, toMins("12:00"));
});

t("quests are placed into gaps and the overflow is reported, not dropped", () => {
  const day = { quests: Array.from({ length: 12 }, (_, i) => ({ id: `q${i}`, title: `Q${i}`, stat: "INT", xp: 10, done: false })) };
  const plan = buildSchedule(day, { wake: "05:00", sleep: "08:00", fixed: [], questMins: 60 }, false);
  assert.ok(plan.blocks.length > 0);
  assert.ok(plan.unplaced.length > 0, "a day that cannot fit must say so");
  assert.equal(plan.blocks.length + plan.unplaced.length, 12, "nothing vanishes");
});

t("done and excused quests are not scheduled", () => {
  const day = { quests: [
    { id: "a", title: "A", stat: "INT", xp: 10, done: true },
    { id: "b", title: "B", stat: "INT", xp: 10, excused: true },
    { id: "c", title: "C", stat: "INT", xp: 10, done: false },
  ] };
  const plan = buildSchedule(day, { wake: "05:00", sleep: "22:00", fixed: [], questMins: 45 }, false);
  assert.equal(plan.blocks.filter((b) => b.kind === "quest").length, 1);
  assert.equal(plan.blocks.find((b) => b.kind === "quest").label, "C");
});

/* ---------- alerts ---------- */

/* Training is logged by default so the quest-board assertions are not answered
   by an unrelated dungeon alert. The training alert has its own test. */
const alertState = (over) => ({
  days: { "2026-08-31": mkDay("2026-08-31", over) },
  gates: [], streak: { current: 0 },
  body: { training: { "2026-08-31": { done: [0], sets: {} } } },
  settings: { difficulty: "normal" },
});

t("nothing is raised in the morning about a day still in progress", () => {
  assert.equal(pendingAlerts(alertState(0.2), "2026-08-31", 9 * 60).length, 0);
});

t("an unfinished day is raised in the evening and escalates late", () => {
  const evening = pendingAlerts(alertState(0.2), "2026-08-31", 18 * 60);
  assert.ok(evening.some((a) => a.id === "today-evening"));
  const late = pendingAlerts(alertState(0.2), "2026-08-31", 21 * 60);
  assert.ok(late.some((a) => a.id === "today-late" && a.level === "urgent"));
});

t("a day already past the bar raises nothing, however late it is", () => {
  assert.equal(pendingAlerts(alertState(1), "2026-08-31", 23 * 60).length, 0);
});

t("every alert names a tab that can actually close it", () => {
  const s = alertState(0.2);
  s.gates = [{ id: "g1", name: "Baruch", rank: "S", date: "2026-09-01" }];
  const out = pendingAlerts(s, "2026-08-31", 21 * 60);
  assert.ok(out.length >= 2);
  out.forEach((a) => assert.ok(a.action && a.title && a.body, `${a.id} is actionable`));
  assert.equal(out[0].level, "urgent", "urgent sorts first");
});

t("an untouched dungeon is raised in the evening, but not on a rest day", () => {
  const s = alertState(1);
  s.body.training = {};
  assert.ok(pendingAlerts(s, "2026-08-31", 20 * 60).some((a) => a.id === "training"), "Monday with nothing logged");
  assert.equal(pendingAlerts(s, "2026-08-31", 12 * 60).length, 0, "not before the evening");
  assert.equal(pendingAlerts(s, "2026-08-30", 20 * 60).length, 0, "Sunday is a rest day");
});

t("missed days looks backwards only, and skips days never generated", () => {
  const state = { days: { "2026-08-30": mkDay("2026-08-30", 0.2), "2026-08-31": mkDay("2026-08-31", 0.1) } };
  const missed = missedDays(state, "2026-08-31");
  assert.equal(missed.length, 1, "today is not a missed day yet");
  assert.equal(missed[0].key, "2026-08-30");
});

/* ---------- ics ---------- */

t("ics uses CRLF and carries the fields a calendar refuses to import without", () => {
  const ics = dailyRemindersIcs("2026-09-01", [{ id: "t", title: "Dungeon", body: "Log every set", time: "06:00", mins: 75, on: true }]);
  assert.ok(ics.includes("\r\n"), "RFC 5545 requires CRLF");
  assert.ok(!/[^\r]\n/.test(ics), "no bare newlines anywhere");
  ["BEGIN:VCALENDAR", "VERSION:2.0", "UID:", "DTSTAMP:", "DTSTART:20260901T060000", "RRULE:FREQ=DAILY", "BEGIN:VALARM", "END:VCALENDAR"]
    .forEach((needle) => assert.ok(ics.includes(needle), `missing ${needle}`));
});

t("reminders that are switched off are not exported", () => {
  const ics = dailyRemindersIcs("2026-09-01", [
    { id: "a", title: "On", time: "06:00", on: true },
    { id: "b", title: "Off", time: "07:00", on: false },
  ]);
  assert.ok(ics.includes("SUMMARY:On"));
  assert.ok(!ics.includes("SUMMARY:Off"));
});

t("commas and semicolons in a title are escaped rather than splitting the field", () => {
  const ics = wrapCalendar(vevent({ date: "2026-09-01", title: "Lift, then read; then sleep" }));
  assert.ok(ics.includes("SUMMARY:Lift\\, then read\\; then sleep"));
});

t("a gate export warns the day before, not on the morning it is due", () => {
  const ics = gatesIcs([{ id: "g", name: "Baruch", rank: "S", date: "2026-09-30" }]);
  assert.ok(ics.includes("TRIGGER:-PT1440M"));
  assert.ok(ics.includes("SUMMARY:Gate closes: Baruch"));
});

t("an event crossing an hour boundary still ends at a real time", () => {
  const lines = vevent({ date: "2026-09-01", time: "23:30", mins: 45, title: "Late" });
  const end = lines.find((l) => l.startsWith("DTEND:"));
  assert.equal(end, "DTEND:20260902T001500".replace("20260902", "20260901"), "minutes roll over the hour correctly");
});

/* Regression. Alerts and the ics export originally read `due` and `clearedOn`
   off a gate; the model has always used `date` and `cleared`. parseKey got
   undefined and the entire app threw on first render. Anything that reads a
   gate is checked against the real seed data from now on. */

t("everything that reads a gate reads the real gate shape", () => {
  SEED_GATES.forEach((g) => {
    assert.ok(g.date, `${g.id} has a date`);
    assert.equal(typeof g.cleared, "boolean", `${g.id} has a cleared flag`);
    assert.equal(g.due, undefined, "there is no such field as due");
  });

  const state = {
    days: {}, gates: SEED_GATES.map((g) => ({ ...g })), streak: { current: 0 },
    body: { training: { "2026-08-31": { done: [1], sets: {} } } }, settings: {},
  };
  assert.doesNotThrow(() => pendingAlerts(state, "2026-08-31", 21 * 60), "alerts must survive the seed gates");
  assert.doesNotThrow(() => gatesIcs(state.gates), "the ics export must survive them too");

  const soon = [{ id: "x", name: "Soon", rank: "A", date: "2026-09-02", cleared: false }];
  const out = pendingAlerts({ ...state, gates: soon }, "2026-08-31", 12 * 60);
  assert.ok(out.some((a) => a.id === "gate-x"), "a gate two days out is raised");

  const done = [{ id: "x", name: "Done", rank: "A", date: "2026-09-02", cleared: true }];
  assert.equal(
    pendingAlerts({ ...state, gates: done }, "2026-08-31", 12 * 60).filter((a) => a.id === "gate-x").length,
    0,
    "a cleared gate is never chased"
  );
});

/* ---------- side quests ---------- */

const withExtras = (ratio, extras) => {
  const quests = [];
  for (let i = 0; i < 10; i++) {
    quests.push({ id: "q" + i, key: "k" + i, title: "q", stat: "INT", xp: 10, done: i < ratio * 10 });
  }
  return { key: "2026-09-04", generated: true, quests, extras };
};

t("side quests never move the bar a day is graded against", () => {
  const bare = withExtras(0.7, []);
  const loaded = withExtras(0.7, [{ id: "x", title: "Portfolio analysis", stat: "INT", sig: "gate", mins: 120, xp: 36 }]);

  assert.equal(dayAvailableXp(loaded), dayAvailableXp(bare), "the denominator must not grow");
  assert.equal(dayEarnedXp(loaded), dayEarnedXp(bare), "nor may it paper over unfinished quests");
  assert.equal(gradeDay(loaded).ratio, gradeDay(bare).ratio, "the grade is the board, and only the board");
  assert.equal(isDayCleared(loaded), isDayCleared(bare));
});

t("side work is credited on top of the board", () => {
  const days = { "2026-09-04": withExtras(1, [{ id: "x", title: "t", stat: "INT", sig: "useful", mins: 60, xp: 18 }]) };
  const bare = { "2026-09-04": withExtras(1, []) };
  const a = recomputeTotals(bare, [], "2026-09-05").totalXp;
  const b = recomputeTotals(days, [], "2026-09-05").totalXp;
  assert.ok(b > a, "logging real work must be worth something");
  assert.equal(b - a, 18, "and worth exactly what it was priced at");
});

t("significance sets the price; time barely moves it", () => {
  const minorShort = sideXp("minor", 15);
  const minorLong = sideXp("minor", 240);
  const gateShort = sideXp("gate", 15);

  assert.ok(gateShort > minorLong * 2,
    "an hour that moves a gate must beat four that move nothing");
  assert.ok(minorLong / minorShort < 1.5,
    "working slowly must not be a way to level up");
  assert.ok(sideXp("gate", 600) === sideXp("gate", 120),
    "duration stops counting past two hours");
});

t("a side quest is always worth less than a board quest", () => {
  const dearest = Math.max(...SIDE_SIGNIFICANCE.map((o) => sideXp(o.key, 600)));
  const cheapestBoardStudy = 30;
  assert.ok(dearest <= 40, `side work topped out at ${dearest}`);
  assert.ok(dearest > cheapestBoardStudy * 0.5, "but must still be worth logging");
});

t("side xp is capped at a share of the board", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: "x" + i, title: "t", stat: "INT", sig: "gate", mins: 120, xp: 36 }));
  const day = withExtras(1, many);
  assert.equal(rawExtraXp(day), 12 * 36);
  assert.equal(extraCeiling(day), Math.round(dayAvailableXp(day) * SIDE_DAILY_SHARE));
  assert.equal(dayExtraXp(day), extraCeiling(day), "the ceiling holds");
  assert.ok(dayExtraXp(day) < rawExtraXp(day), "and it actually bites");
});

t("the capped total is split across the stats that earned it", () => {
  const day = withExtras(1, [
    { id: "a", title: "a", stat: "INT", sig: "gate", mins: 120, xp: 36 },
    { id: "b", title: "b", stat: "STR", sig: "minor", mins: 30, xp: 9 },
  ]);
  const split = extraByStat(day);
  assert.ok(split.INT > split.STR, "credit follows where the work went");
  assert.equal(split.AGI, 0, "and nowhere else");
  const sum = Object.values(split).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - dayExtraXp(day)) <= 2, "the split adds up to what was credited");
});

t("a day with no extras behaves exactly as before", () => {
  const day = withExtras(0.8, undefined);
  assert.deepEqual(dayExtras(day), []);
  assert.equal(dayExtraXp(day), 0);
  assert.equal(extraByStat(day).INT, 0);
});

t("an unknown significance falls back rather than throwing", () => {
  assert.equal(significanceOf("nonsense").key, SIDE_SIGNIFICANCE[0].key);
  assert.ok(sideXp("nonsense", 60) > 0);
  assert.ok(sideXp("gate", -5) > 0, "a negative duration is clamped, not crashed on");
});

/* ---------- the office block ---------- */

t("office sits on working days only", () => {
  const on = (dk) => generateDay(dk, DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, null)
    .quests.some((q) => q.key === "office");
  ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]
    .forEach((dk) => assert.ok(on(dk), `${dk} is a working day`));
  assert.ok(!on("2026-09-12"), "not Saturday");
  assert.ok(!on("2026-09-13"), "not Sunday");
});

t("office is real work but never outranks the evening blocks", () => {
  const day = generateDay("2026-09-07", DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, null);
  const xp = (k) => day.quests.find((q) => q.key === k).xp;
  assert.ok(xp("office") < xp("hull_eve"), "the discretionary study still outranks the job");
  assert.ok(xp("whood") > xp("office"), "the product block carries more weight than office work");
  assert.equal(xp("office"), xp("gym"), "priced level with the other fixed block of the day");
});

t("office is ordered between the commute and the evening", () => {
  const day = generateDay("2026-09-07", DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, null);
  const at = (k) => day.quests.findIndex((q) => q.key === k);
  assert.ok(at("teasers") < at("office"), "the commute comes first");
  assert.ok(at("office") < at("hull_eve"), "and the evening block after");
});

/* ---------- the rising bar ----------
   Growth is the point: the share of the board a day has to clear climbs with
   sustained clearing, and cannot climb off weeks that were not earned. */

const START = "2026-01-01";

/* A day at a given ratio, carrying the bar it was generated under. */
const barDay = (ratio, bar) => {
  const quests = [];
  for (let i = 0; i < 20; i++) quests.push({ id: "q" + i, stat: "INT", xp: 10, done: i < ratio * 20 });
  return { generated: true, quests, bar };
};

const weeksOf = (ratios, bar = 0.7) => {
  const days = {};
  ratios.forEach((r, i) => { days[shiftKey(START, i)] = barDay(r, bar); });
  return days;
};

t("the bar holds for the first week", () => {
  const days = weeksOf(Array(6).fill(1));
  assert.equal(earnedBar(days, shiftKey(START, 6), "normal", START), 0.7,
    "nothing has been earned before a week is complete");
});

t("a cleared week raises the bar by one step", () => {
  const days = weeksOf(Array(14).fill(1));
  const after1 = earnedBar(days, shiftKey(START, 7), "normal", START);
  const after2 = earnedBar(days, shiftKey(START, 14), "normal", START);
  assert.equal(+(after1 - 0.7).toFixed(4), BAR_STEP);
  assert.equal(+(after2 - 0.7).toFixed(4), +(BAR_STEP * 2).toFixed(4), "and again the week after");
});

t("a week you did not clear earns nothing, and does not bury you either", () => {
  // Five days cleared is the threshold; four is not.
  const good = weeksOf([1, 1, 1, 1, 1, 0.2, 0.2]);
  const bad = weeksOf([1, 1, 1, 1, 0.2, 0.2, 0.2]);
  assert.ok(earnedBar(good, shiftKey(START, 7), "normal", START) > 0.7, "five of seven earns it");
  assert.equal(earnedBar(bad, shiftKey(START, 7), "normal", START), 0.7, "four does not");
  assert.ok(earnedBar(bad, shiftKey(START, 7), "normal", START) >= 0.7, "and never drops below the floor");
});

t("the bar stops climbing at the cap", () => {
  const days = weeksOf(Array(400).fill(1));
  const far = earnedBar(days, shiftKey(START, 371), "normal", START);
  assert.equal(+(far - 0.7).toFixed(4), BAR_MAX_LIFT, "it tops out rather than becoming impossible");
  assert.ok(far <= 1, "and never asks for more than the whole board");
});

t("a harder standard starts higher and still climbs", () => {
  const days = weeksOf(Array(21).fill(1), 0.85);
  const hard = earnedBar(days, shiftKey(START, 21), "hard", START);
  assert.ok(hard > 0.85, "hard climbs from its own floor");
  assert.ok(hard <= 1);
});

t("raising the bar never retroactively fails a day already won", () => {
  /* A day generated under a 0.70 bar and cleared at 75% stays cleared, even
     once the standard has moved to 0.80. */
  const won = barDay(0.75, 0.7);
  assert.equal(isDayCleared(won, "normal"), true);
  assert.equal(gradeDay(won, "normal").shortfall, 0);
  assert.equal(dayPenalty(won, 1, undefined, "normal").total, 0);

  const underNewBar = barDay(0.75, 0.8);
  assert.ok(gradeDay(underNewBar, "normal").shortfall > 0,
    "the same ratio does fall short once the day was set at the higher bar");
});

t("a day carries the bar it was generated under", () => {
  const day = generateDay("2026-09-07", DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, null, 0.78);
  assert.equal(day.bar, 0.78);
  assert.equal(gradeDay(day, "normal").bar, 0.78, "and grades against it, not the difficulty floor");

  const plain = generateDay("2026-09-07", DEFAULT_TEMPLATES, DEFAULT_PROGRESSION, null);
  assert.equal(plain.bar, undefined, "an unstamped day falls back to the difficulty");
  assert.equal(gradeDay(plain, "normal").bar, 0.7);
});

t("barLift reports what the screen needs and nothing it does not", () => {
  const days = weeksOf(Array(21).fill(1));
  const lift = barLift(days, shiftKey(START, 21), "normal", START);
  assert.equal(lift.base, 0.7);
  assert.ok(lift.bar > lift.base);
  assert.equal(lift.atCap, false);
  assert.equal(+lift.lift.toFixed(4), +(lift.bar - lift.base).toFixed(4));
});

t("a level always costs more than the one before it", () => {
  for (let l = 1; l < 40; l++) {
    assert.ok(xpForLevel(l + 1) > xpForLevel(l), `level ${l + 1} must cost more than ${l}`);
  }
});

console.log(`\n${pass} passing`);
