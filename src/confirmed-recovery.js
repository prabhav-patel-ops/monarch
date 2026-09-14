import {
  computeStreak,
  earnedBar,
  generateDay,
  recomputeTotals,
} from "./engine.js";

export const CONFIRMED_RECOVERY_ID = "confirmed-2026-09-14";
export const CONFIRMED_DAY = "2026-09-13";
export const CONFIRMED_THROUGH = "2026-09-14";

const clone = (value) => JSON.parse(JSON.stringify(value));

function upsertByDate(entries, date, value) {
  const next = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.date !== date)
    .map((entry) => ({ ...entry }));
  next.push({ date, ...value });
  next.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return next;
}

/**
 * Apply only the facts Prabhav confirmed on 14 Sep 2026. The function is
 * deliberately idempotent and retains every unmentioned day and field.
 * Unknown streak dates stay null rather than being reconstructed from a
 * duration alone.
 */
export function applyConfirmedRecovery(input) {
  const state = clone(input);
  state.days = state.days && typeof state.days === "object" ? state.days : {};
  state.body = state.body && typeof state.body === "object" ? state.body : {};

  let day = state.days[CONFIRMED_DAY];
  if (!day) {
    day = generateDay(
      CONFIRMED_DAY,
      state.templates,
      state.progression,
      state.days["2026-09-12"],
      earnedBar(
        state.days,
        CONFIRMED_DAY,
        state.settings?.difficulty,
        state.hunter?.createdAt,
      ),
    );
  }

  state.days[CONFIRMED_DAY] = {
    ...day,
    quests: (Array.isArray(day.quests) ? day.quests : []).map((quest) => ({
      ...quest,
      done: true,
      excused: false,
    })),
    extras: Array.isArray(day.extras) ? day.extras.map((entry) => ({ ...entry })) : [],
  };

  /* A stale first visit generated Sep 14 while Sep 13 still looked broken,
     carrying missed quests forward as penalties. Remove only those untouched
     synthetic carryovers; any quest the user acted on remains history. */
  const followingDay = state.days[CONFIRMED_THROUGH];
  if (followingDay && Array.isArray(followingDay.quests)) {
    const completedKeys = new Set(state.days[CONFIRMED_DAY].quests.map((quest) => quest.key));
    followingDay.quests = followingDay.quests.filter((quest) => !(
      quest.penalty
      && quest.done !== true
      && String(quest.id || "").startsWith(`${CONFIRMED_THROUGH}#p`)
      && completedKeys.has(quest.key)
    ));
  }

  state.body.weights = upsertByDate(state.body.weights, CONFIRMED_DAY, { kg: 85 });
  state.cfHistory = upsertByDate(state.cfHistory, CONFIRMED_DAY, { rating: 1481 });

  state.confirmedHistory = {
    ...(state.confirmedHistory || {}),
    [CONFIRMED_RECOVERY_ID]: {
      through: CONFIRMED_THROUGH,
      yesterday: { date: CONFIRMED_DAY, fullyCompleted: true },
      weight: { date: CONFIRMED_DAY, kg: 85 },
      codeforces: { date: CONFIRMED_DAY, rating: 1481 },
      streaks: [
        { days: 1, startDate: null, endDate: null },
        { days: 4, startDate: null, endDate: null },
        { ongoing: true, through: CONFIRMED_THROUGH, startDate: null },
      ],
    },
  };

  const totals = recomputeTotals(
    state.days,
    state.shadows || [],
    CONFIRMED_THROUGH,
    state.settings?.difficulty,
  );
  state.totalXp = totals.totalXp;
  state.statXp = totals.statXp;
  state.streak = computeStreak(state.days, CONFIRMED_THROUGH);

  return state;
}
