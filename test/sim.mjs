/* Simulate real use through the same pipeline App.jsx runs, and report pacing. */
import {
  generateDay, shiftKey, recomputeTotals, computeStreak, applyRatchet,
  levelFromTotalXp, rankFromLevel, statTier, STATS,
} from "../src/engine.js";
import { DEFAULT_TEMPLATES, DEFAULT_PROGRESSION } from "../src/data.js";

function run(label, days, complianceFor) {
  const state = {
    days: {},
    progression: { ...DEFAULT_PROGRESSION },
    shadows: [],
    settings: { ratchetStreak: 5 },
  };
  const start = "2026-09-01";
  const marks = [];

  for (let i = 0; i < days; i++) {
    const k = shiftKey(start, i);
    const prev = state.days[shiftKey(k, -1)] || null;
    const day = generateDay(k, DEFAULT_TEMPLATES, state.progression, prev);
    const p = complianceFor(i);
    day.quests.forEach((q) => (q.done = Math.random() < p));
    state.days[k] = day;

    const { prog } = applyRatchet(state.days, k, state.progression, state.settings);
    state.progression = prog;

    if ([6, 29, 89, 179, 364].includes(i)) {
      const totals = recomputeTotals(state.days, state.shadows, shiftKey(k, 1));
      const { level } = levelFromTotalXp(totals.totalXp);
      marks.push({
        day: i + 1,
        level,
        rank: rankFromLevel(level),
        band: state.progression.cfBand,
        pages: state.progression.hullPages,
        streak: computeStreak(state.days, k).current,
        tiers: Object.fromEntries(STATS.map((s) => [s, statTier(totals.statXp[s])])),
      });
    }
  }

  console.log(`\n${label}`);
  console.log("  day    level  rank   band  pages  streak  STR/AGI/INT/PER/VIT");
  marks.forEach((m) => {
    const t = STATS.map((s) => String(m.tiers[s]).padStart(2)).join("/");
    console.log(
      `  ${String(m.day).padStart(3)}    ${String(m.level).padStart(4)}   ${m.rank}    ` +
      `${String(m.band).padStart(4)}   ${String(m.pages).padStart(3)}    ${String(m.streak).padStart(4)}   ${t}`
    );
  });
  return marks;
}

const diligent = run("Diligent — clears about 92% of quests", 365, () => 0.92);
const realistic = run("Realistic — 80%, dipping to 55% in a bad fortnight", 365, (i) =>
  i > 120 && i < 135 ? 0.55 : 0.8
);
run("Struggling — about 55% throughout", 365, () => 0.55);

/* pacing assertions */
let bad = 0;
const check = (cond, msg) => { if (!cond) { console.error(`  PACING  ${msg}`); bad = 1; } };

const d30 = diligent.find((m) => m.day === 30);
const d90 = diligent.find((m) => m.day === 90);
const d365 = diligent.find((m) => m.day === 365);

console.log("");
check(d30.level >= 6 && d30.level <= 20, `month one landed at level ${d30.level}, want 6–20`);
check(d90.rank === "C" || d90.rank === "D", `three months landed at rank ${d90.rank}, want D or C`);
check(d365.rank === "A" || d365.rank === "B", `one year landed at rank ${d365.rank}, want B or A`);
check(d365.band <= 2100, "band exceeded its cap");
check(d365.band >= 1800, `band only reached ${d365.band} after a diligent year`);

const r365 = realistic.find((m) => m.day === 365);
check(r365.level < d365.level, "realistic play should trail diligent play");

console.log(bad ? "\npacing needs adjusting" : "\npacing looks sane");
process.exitCode = bad;
