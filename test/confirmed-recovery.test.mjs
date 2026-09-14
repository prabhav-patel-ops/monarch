import assert from "node:assert/strict";
import { SEED_SAVE } from "../src/seed-save.js";
import { gradeDay } from "../src/engine.js";
import {
  applyConfirmedRecovery,
  CONFIRMED_RECOVERY_ID,
} from "../src/confirmed-recovery.js";

const before = JSON.parse(JSON.stringify(SEED_SAVE));
const recovered = applyConfirmedRecovery(before);

assert.deepEqual(SEED_SAVE, before, "the verified Sep 12 export must remain untouched");
assert.deepEqual(
  Object.fromEntries(Object.entries(recovered.days).filter(([date]) => date <= "2026-09-12")),
  before.days,
  "all existing day history must be preserved exactly",
);
assert.equal(gradeDay(recovered.days["2026-09-13"]).grade, "clean");
assert.ok(recovered.days["2026-09-13"].quests.every((quest) => quest.done && !quest.excused));
assert.deepEqual(recovered.body.weights.at(-1), { date: "2026-09-13", kg: 85 });
assert.deepEqual(recovered.cfHistory.at(-1), { date: "2026-09-13", rating: 1481 });
assert.deepEqual(recovered.streak, { current: 9, best: 9 });

const facts = recovered.confirmedHistory[CONFIRMED_RECOVERY_ID];
assert.deepEqual(facts.streaks.map((item) => item.days || "ongoing"), [1, 4, "ongoing"]);
assert.equal(facts.streaks[2].through, "2026-09-14");
assert.equal(facts.streaks[2].startDate, null, "an unconfirmed start date must not be invented");

const recoveredAgain = applyConfirmedRecovery(recovered);
assert.deepEqual(recoveredAgain, recovered, "opening the recovery link twice must be harmless");

const withHostedEdits = JSON.parse(JSON.stringify(before));
withHostedEdits.days["2026-09-13"] = {
  date: "2026-09-13",
  generated: true,
  bar: 0.71,
  customField: "keep me",
  quests: [{ id: "custom", key: "custom", stat: "INT", xp: 10, done: false, excused: true }],
  extras: [{ id: "side", title: "Already logged", stat: "PER", xp: 7 }],
};
withHostedEdits.body.weights.push({ date: "2026-09-13", kg: 83 });
withHostedEdits.cfHistory.push({ date: "2026-09-13", rating: 1400 });
withHostedEdits.days["2026-09-14"] = {
  date: "2026-09-14",
  generated: true,
  bar: 0.72,
  quests: [
    { id: "2026-09-14#0#today", key: "today", stat: "INT", xp: 20, done: false, penalty: false },
    { id: "2026-09-14#p0#custom", key: "custom", stat: "INT", xp: 15, done: false, penalty: true },
    { id: "2026-09-14#p1#custom", key: "custom", stat: "INT", xp: 15, done: true, penalty: true },
  ],
  extras: [],
};
const merged = applyConfirmedRecovery(withHostedEdits);

assert.equal(merged.days["2026-09-13"].customField, "keep me");
assert.deepEqual(merged.days["2026-09-13"].extras, withHostedEdits.days["2026-09-13"].extras);
assert.deepEqual(merged.body.weights.at(-1), { date: "2026-09-13", kg: 85 });
assert.deepEqual(merged.cfHistory.at(-1), { date: "2026-09-13", rating: 1481 });
assert.equal(merged.body.weights.filter((entry) => entry.date === "2026-09-13").length, 1);
assert.equal(merged.cfHistory.filter((entry) => entry.date === "2026-09-13").length, 1);
assert.deepEqual(
  merged.days["2026-09-14"].quests.map((quest) => quest.id),
  ["2026-09-14#0#today", "2026-09-14#p1#custom"],
  "untouched stale carryovers are removed while user-completed activity stays",
);

console.log("confirmed recovery preserves history and applies only confirmed facts");
