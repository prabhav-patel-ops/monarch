import assert from "node:assert/strict";
import { plan } from "./routine-fixture.mjs";
import { routineQuests, routineStreak, ensureRoutines } from "../src/routines.js";
import { generateDay, gradeDay, isDayCleared, shiftKey, dayEarnedXp, streakRecovery, dateKey } from "../src/engine.js";
import { emptyState, hydrate, validateState } from "../src/store.js";
import { dailyRemindersIcs } from "../src/calendar.js";

const template = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
const board = (key, prev = null) => generateDay(key, template, {}, prev, 0.7, plan);
const routines = (key) => routineQuests(key, plan).map((q) => q.key);

assert.deepEqual(routineQuests("2026-10-20", plan), []);
assert.equal(routineQuests("2026-10-21", plan)[0].title, "Special task");
assert.ok(routines("2026-10-21").includes("routine_task_4"));
assert.ok(routines("2026-10-22").includes("routine_task_2"));
assert.ok(routines("2026-10-25").includes("routine_task_3"));
assert.equal(routineQuests("2026-10-23", plan)[0].title, "Task 0");

// Check the first-Friday boundary for every month across a year change.
for (let i = 0; i < 400; i++) {
  const key = shiftKey("2026-10-21", i);
  const d = new Date(`${key}T12:00:00`);
  const qs = routineQuests(key, plan);
  const special = d.getDay() === 3 || (d.getDay() === 5 && d.getDate() <= 7);
  assert.equal(qs[0].title.includes("Special"), special, key);
  assert.equal(qs[0].time, "07:00");
  assert.equal(qs[1].time, "07:40");
  assert.equal(qs.some((q) => q.key === "routine_task_2"), d.getDay() === 4);
  assert.equal(qs.some((q) => q.key === "routine_task_3"), d.getDay() === 0);
  assert.equal(qs.some((q) => q.key === "routine_task_4"), d.getDay() === 3);
  assert.ok(qs.every((q) => q.required && q.xp === 0 && q.routine && !q.penalty));
  assert.equal(new Set(qs.map((q) => q.id)).size, qs.length);
}

const day = board("2026-10-21");
day.quests.push({ key: "work", id: "work", xp: 100, stat: "INT", done: true });
assert.equal(dayEarnedXp(day), 100);
assert.equal(isDayCleared(day), false);
assert.equal(gradeDay(day).grade, "slipped");
day.quests.forEach((q) => q.done = true);
assert.equal(isDayCleared(day), true);
assert.equal(dayEarnedXp(day), 100);
assert.equal(gradeDay(day).grade, "clean");
day.quests.find((q) => q.routine).done = false;
assert.equal(gradeDay(day).grade, "slipped");
assert.equal(board("2026-10-22", day).quests.filter((q) => q.routine && q.penalty).length, 0);
assert.equal(board("2026-10-22", day).quests.filter((q) => q.key === "routine_task_1").length, 1);
assert.equal(streakRecovery({ "2026-10-21": day, "2026-10-22": board("2026-10-22", day) }, "2026-10-21").eligible, false);

const today = dateKey(new Date());
const state = emptyState();
state.routinePlan = plan;
state.days[today] = { date: today, generated: true, quests: [{ key: "personal", id: "personal", xp: 10, stat: "INT", done: true }] };
state.days["2026-10-20"] = { date: "2026-10-20", quests: [] };
const upgraded = hydrate(state);
assert.equal(upgraded.days["2026-10-20"].quests.length, 0);
assert.equal(upgraded.days[today].quests.filter((q) => q.routine).length, routineQuests(today, plan).length);
upgraded.days[today].quests.find((q) => q.routine).done = true;
const roundTrip = validateState(JSON.parse(JSON.stringify(upgraded))).state;
assert.equal(roundTrip.days[today].quests.find((q) => q.routine).done, true);
assert.equal(roundTrip.days[today].quests.find((q) => q.key === "personal").done, true);
ensureRoutines(roundTrip.days[today], plan);
assert.equal(roundTrip.days[today].quests.filter((q) => q.routine).length, routineQuests(today, plan).length);

const history = {};
for (let i = 0; i < 30; i++) {
  const key = shiftKey("2026-10-21", i);
  history[key] = board(key);
  history[key].quests.forEach((q) => q.done = true);
}
assert.equal(routineStreak(history, "2026-11-19", plan), 30);
history["2026-11-20"] = board("2026-11-20");
assert.equal(routineStreak(history, "2026-11-20", plan), 30);
assert.equal(routineStreak(history, "2026-11-21", plan), 0);
history["2026-11-18"].quests[0].done = false;
assert.equal(routineStreak(history, "2026-11-19", plan), 1);

const ics = dailyRemindersIcs(today, plan.tasks.filter(q => q.time).map(q => ({id:q.key,title:q.title,body:q.detail,time:q.time,weekdays:q.weekdays,on:true})));
assert.ok(ics.includes("T070000"));
assert.ok(ics.includes("T074000"));
assert.equal((ics.match(/RRULE:FREQ=DAILY/g) || []).length, 2);
assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
console.log("Routine schedules, compulsory gating, zero XP, migration, persistence, streak and calendar checks passed.");
