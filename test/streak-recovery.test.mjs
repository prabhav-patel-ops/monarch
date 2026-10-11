import assert from "node:assert/strict";
import {
  computeStreak, dayPenalty, generateDay, isDayCleared, streakRecovery,
} from "../src/engine.js";

function quest(key, xp, done = false, extra = {}) {
  return { id: key, key, title: key, stat: "INT", xp, done, penalty: false, ...extra };
}
function day(date, quests) {
  return { date, generated: true, quests };
}

const first = day("2026-10-10", [quest("a", 100, true)]);
const second = day("2026-10-11", [quest("b", 100, true)]);
const missed = day("2026-10-12", [
  quest("recurring", 50),
  quest("one-off", 50),
  quest("completed", 20, true),
]);
const today = day("2026-10-13", [
  quest("recurring", 50, false, { recoveryFor: missed.date }),
  quest("one-off", 75, false, { penalty: true, recoveryFor: missed.date }),
  quest("own-work", 300),
]);
const days = Object.fromEntries([first, second, missed, today].map((d) => [d.date, d]));

assert.equal(streakRecovery(days, missed.date).total, 2);
assert.equal(streakRecovery(days, missed.date).complete, false);
assert.equal(computeStreak(days, today.date).current, 0, "unfinished catch-up cannot preserve the streak");

today.quests[0].done = true;
assert.equal(streakRecovery(days, missed.date).done, 1);
assert.equal(computeStreak(days, today.date).current, 0, "one of two missed tasks is insufficient");

today.quests[1].done = true;
assert.equal(streakRecovery(days, missed.date).complete, true);
assert.equal(isDayCleared(today), false, "catch-up need not clear the current day");
assert.equal(computeStreak(days, today.date).current, 3, "yesterday is restored while today is still in progress");
assert.equal(computeStreak(days, today.date).best, 3);
assert.ok(dayPenalty(missed).total > 0, "streak recovery does not erase the original XP charge");

today.quests[2].done = true;
assert.equal(computeStreak(days, today.date).current, 4, "clearing today extends the restored streak");

const tooLate = day("2026-10-14", [quest("recurring", 50, true), quest("one-off", 75, true)]);
today.quests[0].done = false;
today.quests[2].done = false;
days[tooLate.date] = tooLate;
assert.equal(streakRecovery(days, missed.date).complete, false, "completing it two days later cannot repair the miss");
assert.equal(computeStreak(days, tooLate.date).current, 1, "later success starts a new run");

const templates = { 2: [
  { key: "recurring", title: "Daily", stat: "INT", xp: 50, slot: 1 },
  { key: "own-work", title: "Today", stat: "INT", xp: 300, slot: 2 },
] };
const generated = generateDay("2026-10-13", templates, {}, missed);
assert.equal(generated.quests.filter((q) => q.key === "recurring").length, 1, "a recurring task has one row");
assert.equal(generated.quests.find((q) => q.key === "recurring").recoveryFor, missed.date);
assert.equal(generated.quests.find((q) => q.key === "one-off").penalty, true);
assert.equal(generated.quests.find((q) => q.key === "one-off").recoveryFor, missed.date);
generated.quests.find((q) => q.key === "recurring").done = true;
generated.quests.find((q) => q.key === "one-off").done = true;
assert.equal(streakRecovery({ [missed.date]: missed, [generated.date]: generated }, missed.date).complete, true);

const legacy = day("2026-10-13", [
  quest("recurring", 50, true),
  quest("one-off", 75, true, { penalty: true }),
]);
assert.equal(streakRecovery({ [missed.date]: missed, [legacy.date]: legacy }, missed.date).complete, true,
  "existing saved boards without recovery metadata still qualify");

const excused = day("2026-10-12", [quest("required", 50), quest("excused", 50, false, { excused: true })]);
const afterExcused = day("2026-10-13", [quest("required", 50, true)]);
assert.deepEqual(streakRecovery({ [excused.date]: excused, [afterExcused.date]: afterExcused }, excused.date),
  { eligible: true, total: 1, done: 1, complete: true }, "excused tasks do not become recovery requirements");

const future = day("2026-10-14", [quest("required", 50, true)]);
const futureDays = {
  [first.date]: first,
  [second.date]: second,
  [missed.date]: missed,
  [today.date]: day(today.date, [quest("recurring", 50), quest("one-off", 50)]),
  [future.date]: future,
};
assert.equal(computeStreak(futureDays, missed.date).current, 2,
  "a future board cannot recover today's miss early");

console.log("next-day streak recovery keeps missed work, expiry, and historic saves consistent");
