// Routine plans live in the private save, never in the public defaults.
const localDate = (key) => new Date(`${key}T12:00:00`);
const previousKey = (key) => {
  const d = localDate(key);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function validateRoutinePlan(value) {
  if (!value || value.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(value.start || "") ||
      !Number.isFinite(localDate(value.start).getTime()) || !Array.isArray(value.tasks) || value.tasks.length > 30) {
    throw new Error("Choose a valid Monarch routine plan.");
  }
  const keys = new Set();
  for (const task of value.tasks) {
    if (!/^routine_[a-z0-9_]+$/.test(task.key || "") || keys.has(task.key) ||
        typeof task.title !== "string" || !task.title.trim() || task.title.length > 160 ||
        typeof task.detail !== "string" || task.detail.length > 500 ||
        !Array.isArray(task.weekdays) || !task.weekdays.length ||
        task.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
        (task.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(task.time))) {
      throw new Error("The routine plan contains an invalid task.");
    }
    keys.add(task.key);
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
  return plan.tasks.filter((task) => task.weekdays.includes(d.getDay())).map((task, i) => {
    const variant = task.variants?.find((v) => v.weekdays.includes(d.getDay()) &&
      (v.monthWeek == null || v.monthWeek === Math.ceil(d.getDate() / 7)));
    return {
      key: task.key, title: variant?.title || task.title, detail: variant?.detail || task.detail,
      time: task.time, slot: i, id: `${key}#${task.key}`, stat: "VIT", xp: 0,
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
