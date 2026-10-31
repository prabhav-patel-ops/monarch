import assert from "node:assert/strict";
import {
  computeStreak, dayPenalty, generateDay, isDayCleared, streakRecovery,
  reconcileDayCarry, reconcileCarryovers,
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
  quest("second-penalty", 50),
  quest("completed", 20, true),
]);
const today = day("2026-10-13", [
  quest("recurring", 50, false, { recoveryFor: missed.date }),
  quest("one-off", 75, false, { penalty: true, recoveryFor: missed.date }),
  quest("second-penalty", 75, false, { penalty: true, recoveryFor: missed.date }),
  quest("own-work", 300),
]);
const days = Object.fromEntries([first, second, missed, today].map((d) => [d.date, d]));

assert.equal(streakRecovery(days, missed.date).total, 2);
assert.equal(streakRecovery(days, missed.date).complete, false);
assert.equal(computeStreak(days, today.date).current, 0, "unfinished catch-up cannot preserve the streak");

today.quests[0].done = true;
assert.equal(streakRecovery(days, missed.date).done, 0,
  "a recurring normal task is not a requirement when penalty rows exist");

today.quests[1].done = true;
assert.equal(streakRecovery(days, missed.date).done, 1);
assert.equal(computeStreak(days, today.date).current, 0, "one of two visible penalties is insufficient");

today.quests[2].done = true;
assert.equal(streakRecovery(days, missed.date).complete, true);
assert.equal(isDayCleared(today), false, "catch-up need not clear the current day");
assert.equal(computeStreak(days, today.date).current, 3, "yesterday is restored while today is still in progress");
assert.equal(computeStreak(days, today.date).best, 3);
assert.ok(dayPenalty(missed).total > 0, "streak recovery does not erase the original XP charge");

today.quests[3].done = true;
assert.equal(computeStreak(days, today.date).current, 4, "clearing today extends the restored streak");

const tooLate = day("2026-10-14", [quest("recurring", 50, true), quest("one-off", 75, true), quest("second-penalty", 75, true)]);
today.quests[1].done = false;
today.quests[3].done = false;
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
assert.equal(generated.quests.find((q) => q.key === "second-penalty").penalty, true);
generated.quests.find((q) => q.key === "one-off").done = true;
generated.quests.find((q) => q.key === "second-penalty").done = true;
assert.equal(streakRecovery({ [missed.date]: missed, [generated.date]: generated }, missed.date).complete, true);

const legacy = day("2026-10-13", [
  quest("recurring", 50, true),
  quest("one-off", 75, true, { penalty: true }),
  quest("second-penalty", 75, true, { penalty: true }),
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

const oct8 = day("2026-10-08", [quest("routine", 100, true)]);
const oct9 = day("2026-10-09", [quest("make-up", 100)]);
const oct10 = day("2026-10-10", [
  quest("make-up", 150, true, { penalty: true }),
  quest("new-work", 300),
]);
const boundaryDays = {
  [oct8.date]: oct8,
  [oct9.date]: oct9,
  [oct10.date]: oct10,
};
assert.equal(streakRecovery(boundaryDays, oct9.date).complete, true,
  "an Oct 9 miss is recoverable by work completed on Oct 10");
assert.equal(computeStreak(boundaryDays, oct10.date).current, 2,
  "Oct 9 joins the earlier run even while Oct 10 is unfinished");

// Reproduce the October 9/10 screenshot: Whood and Options were the two
// visible carried Penalty quests, and both were done. Brainteasers was an
// ordinary October 10 quest left undone; it must not silently block recovery.
const oct9Screenshot = day("2026-10-09", [
  quest("wake", 10, true),
  quest("gym", 45, true),
  quest("protein", 25, true),
  quest("whood", 70),
  quest("brainteaser", 25),
  quest("office", 45, true),
  quest("career", 30, true),
  quest("options", 60),
  quest("projects", 70, true),
  quest("lights-out", 15),
]);
const oct10Screenshot = day("2026-10-10", [
  quest("wake", 10, false, { excused: true }),
  quest("gym", 45, true),
  quest("protein", 25, true),
  quest("whood-weekend", 70, true),
  quest("brainteaser", 30),
  quest("projects", 70, true),
  quest("lights-out", 15, true),
  quest("whood", 105, true, { penalty: true }),
  quest("options", 90, true, { penalty: true }),
]);
const picturedDays = { [oct9Screenshot.date]: oct9Screenshot, [oct10Screenshot.date]: oct10Screenshot };
assert.equal(oct9Screenshot.quests.filter((q) => q.done).reduce((sum, q) => sum + q.xp, 0), 225);
assert.equal(oct10Screenshot.quests.filter((q) => q.done).reduce((sum, q) => sum + q.xp, 0), 420);
assert.equal(streakRecovery(picturedDays, oct9Screenshot.date).total, 2);
assert.equal(streakRecovery(picturedDays, oct9Screenshot.date).complete, true,
  "both visible penalties restore October 9 even with a normal Brainteasers quest undone");

// Correcting a closed day after the next board was generated must retract the
// obsolete penalty and immediately restore the run.
const beforeCorrection = day("2026-10-28", [quest("base", 100, true)]);
const correctedDay = day("2026-10-29", [quest("finished", 100, true), quest("late-mark", 100)]);
const afterCorrection = day("2026-10-30", [
  quest("today", 100),
  quest("late-mark", 150, false, { penalty: true, recoveryFor: correctedDay.date, slot: "penalty" }),
]);
const correctedDays = {
  [beforeCorrection.date]: beforeCorrection,
  [correctedDay.date]: correctedDay,
  [afterCorrection.date]: afterCorrection,
};
correctedDay.quests.find((q) => q.key === "late-mark").done = true;
reconcileCarryovers(correctedDays, afterCorrection.date);
assert.equal(afterCorrection.quests.some((q) => q.penalty), false,
  "late completion removes the already-generated penalty row");
assert.equal(computeStreak(correctedDays, afterCorrection.date).current, 2,
  "late completion restores the historical streak while today is in progress");

// The inverse stays honest and recurring tasks use their normal row instead
// of creating a duplicate penalty.
correctedDay.quests.find((q) => q.key === "late-mark").done = false;
reconcileDayCarry(afterCorrection, correctedDay);
assert.equal(afterCorrection.quests.filter((q) => q.penalty && q.key === "late-mark").length, 1,
  "unmarking the historical task recreates one carry-over");
const recurringPrev = day("2026-10-30", [quest("repeat", 40)]);
const recurringNext = day("2026-10-31", [quest("repeat", 40)]);
reconcileDayCarry(recurringNext, recurringPrev);
assert.equal(recurringNext.quests.length, 1, "a recurring task is not duplicated");
assert.equal(recurringNext.quests[0].recoveryFor, recurringPrev.date);
recurringPrev.quests[0].done = true;
reconcileDayCarry(recurringNext, recurringPrev);
assert.equal("recoveryFor" in recurringNext.quests[0], false,
  "correcting the prior day clears the recurring catch-up marker");

console.log("next-day streak recovery keeps missed work, expiry, and historic saves consistent");

