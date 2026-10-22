// Routine plans live in the private save, never in the public defaults.
const localDate = (key) => new Date(`${key}T12:00:00`);
const previousKey = (key) => {
  const d = localDate(key);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Built into Monarch so existing phone installations receive the routines on
// their next reload; completion history still remains device-local.
export const DEFAULT_ROUTINE_PLAN = {
  version: 1,
  builtInRevision: 2,
  start: "2026-10-21",
  tasks: [
    {
      key: "routine_morning_prayer",
      title: "Morning prayer",
      detail: "Complete the morning prayer. Wednesday and the first Friday of each month use the special prayer.",
      time: "07:00",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      variants: [
        { weekdays: [3], title: "Wednesday special prayer", detail: "Complete the special Wednesday morning prayer." },
        { weekdays: [5], monthWeek: 1, title: "First-Friday special prayer", detail: "Complete the special prayer for the first Friday of the month." },
      ],
    },
    {
      key: "routine_vitamin_d",
      title: "Take vitamin D",
      detail: "Take the weekly vitamin D tablet on Friday morning.",
      time: "07:40",
      weekdays: [5],
      priorSchedule: { until: "2026-10-22", weekdays: [0, 1, 2, 3, 4, 5, 6] },
    },
    {
      key: "routine_thursday_mandir",
      title: "Visit mandir",
      detail: "Complete the weekly Thursday mandir visit.",
      weekdays: [4],
    },
    {
      key: "routine_sunday_moong",
      title: "Eat moong with Sunday dinner",
      detail: "Include moong in Sunday dinner.",
      weekdays: [0],
    },
    {
      key: "routine_wednesday_lasun",
      title: "Eat lasun",
      detail: "Include lasun on Wednesday.",
      weekdays: [3],
    },
    {
      key: "plan_tomorrow",
      title: "Make tomorrow's timetable",
      detail: "Before sleeping, write tomorrow's timetable. This compulsory gate decides whether the day clears.",
      time: "22:00",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      xp: 5,
      stat: "PER",
    },
  ],
};

const BUILT_IN_KEYS_V1 = [
  "routine_morning_prayer", "routine_vitamin_d", "routine_thursday_mandir",
  "routine_sunday_moong", "routine_wednesday_lasun",
];

// The first automatic release had no revision marker. Recognise only its exact
// task set so a user-imported custom plan is never silently replaced.
export function upgradeBuiltInRoutinePlan(plan) {
  if (!plan) return JSON.parse(JSON.stringify(DEFAULT_ROUTINE_PLAN));
  if (plan.builtInRevision === DEFAULT_ROUTINE_PLAN.builtInRevision) return plan;
  const keys = Array.isArray(plan.tasks) ? plan.tasks.map((task) => task.key).sort() : [];
  const original = [...BUILT_IN_KEYS_V1].sort();
  if (keys.length === original.length && keys.every((key, index) => key === original[index])) {
    return JSON.parse(JSON.stringify(DEFAULT_ROUTINE_PLAN));
  }
  return plan;
}

export function validateRoutinePlan(value) {
  if (!value || value.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(value.start || "") ||
      !Number.isFinite(localDate(value.start).getTime()) || !Array.isArray(value.tasks) || value.tasks.length > 30) {
    throw new Error("Choose a valid Monarch routine plan.");
  }
  const keys = new Set();
  for (const task of value.tasks) {
    if (!/^(routine_[a-z0-9_]+|plan_tomorrow)$/.test(task.key || "") || keys.has(task.key) ||
        typeof task.title !== "string" || !task.title.trim() || task.title.length > 160 ||
        typeof task.detail !== "string" || task.detail.length > 500 ||
        !Array.isArray(task.weekdays) || !task.weekdays.length ||
        task.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
        (task.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(task.time)) ||
        (task.xp != null && (!Number.isInteger(task.xp) || task.xp < 0 || task.xp > 100)) ||
        (task.stat != null && !["STR", "INT", "PER", "AGI", "VIT"].includes(task.stat))) {
      throw new Error("The routine plan contains an invalid task.");
    }
    keys.add(task.key);
    if (task.priorSchedule != null && (
      !/^\d{4}-\d{2}-\d{2}$/.test(task.priorSchedule.until || "") ||
      !Array.isArray(task.priorSchedule.weekdays) || !task.priorSchedule.weekdays.length ||
      task.priorSchedule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    )) throw new Error("The routine plan contains an invalid prior schedule.");
    if (task.variants != null && (!Array.isArray(task.variants) || task.variants.length > 10 || task.variants.some((v) =>
      !Array.isArray(v.weekdays) || !v.weekdays.length || v.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
      (v.monthWeek != null && (!Number.isInteger(v.monthWeek) || v.monthWeek < 1 || v.monthWeek > 5)) ||
      typeof v.title !== "string" || v.title.length > 160 || typeof v.detail !== "string" || v.detail.length > 500))) {
      throw new Error("The routine plan contains an invalid special-day rule.");
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export function routineQuests(key, plan) {
  if (!plan || key < plan.start) return [];
  const d = localDate(key);
  return plan.tasks.filter((task) => {
    const weekdays = task.priorSchedule && key <= task.priorSchedule.until
      ? task.priorSchedule.weekdays
      : task.weekdays;
    return weekdays.includes(d.getDay());
  }).map((task, i) => {
    const variant = task.variants?.find((v) => v.weekdays.includes(d.getDay()) &&
      (v.monthWeek == null || v.monthWeek === Math.ceil(d.getDate() / 7)));
    return {
      key: task.key, title: variant?.title || task.title, detail: variant?.detail || task.detail,
      time: task.time, slot: i, id: `${key}#${task.key}`,
      stat: task.stat || "VIT", xp: task.xp || 0,
      required: true, routine: true, done: false, penalty: false,
    };
  });
}

// Reconcile only today/future on installation or plan edits. Old log stays intact.
export function ensureRoutines(day, plan) {
  if (!day || !Array.isArray(day.quests)) return;
  const tasks = routineQuests(day.date, plan);
  const expected = new Set(tasks.map((q) => q.key));
  day.quests = day.quests.filter((q) => !q.routine || (!q.penalty && expected.has(q.key)));
  for (const task of tasks) {
    const existing = day.quests.find((q) => q.key === task.key && !q.penalty);
    if (existing) Object.assign(existing, task, { done: !!existing.done, excused: false });
    else day.quests.push(task);
  }
  day.quests.sort((a, b) => {
    const av = typeof a.slot === "number" ? a.slot : 99;
    const bv = typeof b.slot === "number" ? b.slot : 99;
    return av - bv;
  });
}

// A calendar day counts only when every routine due that day is complete.
// An unfinished today leaves yesterday's run visible until the day ends.
export function routineStreak(days, today, plan) {
  if (!plan) return 0;
  const complete = (key) => {
    const expected = routineQuests(key, plan);
    return expected.length > 0 && expected.every((task) =>
      days[key]?.quests?.some((q) => q.key === task.key && q.done && !q.excused && !q.penalty));
  };
  let key = complete(today) ? today : previousKey(today);
  let count = 0;
  while (key >= plan.start && complete(key)) {
    count += 1;
    key = previousKey(key);
  }
  return count;
}

