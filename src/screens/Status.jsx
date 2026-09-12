import React from "react";
import { Win, StatRadar, Spark, useCountUp } from "../ui.jsx";
import { RuneRing, MonarchCrest } from "../art.jsx";
import { MISSION, quoteFor } from "../data.js";
import {
  STATS, STAT_META, levelFromTotalXp, rankFromLevel, nextRankAt,
  statTier, missFlags, daysBetween, dateKey, isDayCleared,
} from "../engine.js";

export default function Status({ state, todayKey }) {
  const { level, xpInLevel, xpNeeded } = levelFromTotalXp(state.totalXp);

  /* The numbers that move when you tick something roll to their new value.
     Everything else on this screen is static and stays static — a page where
     every figure animates reads as noise, not feedback. */
  const shownLevel = useCountUp(level, 420);
  const shownXpIn = useCountUp(xpInLevel);
  const shownTotal = useCountUp(state.totalXp);
  const numbers = state.settings.showNumbers;
  const shownStreak = useCountUp(state.streak.current, 380);
  const rank = rankFromLevel(level);
  const next = nextRankAt(level);
  const tiers = Object.fromEntries(STATS.map((s) => [s, statTier(state.statXp[s] || 0)]));
  const flags = missFlags(state.days, todayKey);
  const maxTier = Math.max(...Object.values(tiers), 1);

  const missionDay = daysBetween(MISSION.bodyStart, todayKey) + 1;
  const missionPct = Math.max(0, Math.min(100, (missionDay / MISSION.bodyDays) * 100));

  const weights = state.body.weights || [];
  const latest = weights.length ? weights[weights.length - 1].kg : null;
  const lost = latest != null ? +(MISSION.startWeight - latest).toFixed(1) : null;

  const shadowBonus = {};
  STATS.forEach((s) => {
    shadowBonus[s] = (state.shadows || [])
      .filter((x) => x.stat === s)
      .reduce((a, b) => a + (b.bonus || 0), 0);
  });

  return (
    <>
      <div className="mn-quote mn-rise">
        {quoteFor(
          state.days[todayKey] && state.days[todayKey].generated
            ? (isDayCleared(state.days[todayKey], state.settings.difficulty) ? "cleared" : "daily")
            : "daily",
          todayKey
        )}
      </div>

      <Win tone="accent" title="Hunter" right={numbers ? `${shownTotal} xp` : `Rank ${rank}`}>
        <div className="mn-hero">
          <RuneRing size={168} className="mn-hero-ring" />
          <div className="mn-hero-face">
            <MonarchCrest size={54} />
            <div className="rank-glyph mn-hero-rank" data-rank={rank}>{rank}</div>
          </div>
        </div>
        <div className="xp-row">
          <div className="xp-level stat-num mn-count">
            <small>Level</small>
            {shownLevel}
          </div>
          <div className="xp-frac mn-count">
            {shownXpIn} / {xpNeeded} xp
          </div>
        </div>
        <div className="bar">
          <i style={{ width: `${(xpInLevel / xpNeeded) * 100}%` }} />
        </div>
        <p className="faint" style={{ marginTop: 8, marginBottom: 0 }}>
          {next
            ? `Rank ${next.rank} at level ${next.min}. ${next.min - level} to go.`
            : "Top rank reached. Nothing above this."}
        </p>
      </Win>

      <Win title="Stat window" right={numbers ? `${shownTotal} total xp` : ""}>
        <StatRadar tiers={tiers} />
        <div className="stat-grid" style={{ marginTop: 14 }}>
          {STATS.map((s) => {
            const meta = STAT_META[s];
            const tier = tiers[s];
            return (
              <div key={s}>
                <div className="stat-line">
                  <div className="stat-key" style={{ color: meta.color }}>{s}</div>
                  <div className="stat-bar">
                    <i style={{ width: `${(tier / maxTier) * 100}%`, background: meta.color }} />
                  </div>
                  <div className="stat-val" style={{ color: meta.color }}>{tier}</div>
                </div>
                <div className="stat-feeds" style={{ paddingLeft: 44 }}>
                  {meta.feeds}
                  {shadowBonus[s] > 0 && (
                    <span style={{ color: meta.color }}> · +{shadowBonus[s]}% from shadows</span>
                  )}
                  {flags[s].flagged && (
                    <span className="flagged"> · {flags[s].misses} misses this week</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Win>

      <Win title="Streak">
        <div className="row" style={{ textAlign: "center" }}>
          <div>
            <div className="stat-num mn-count" style={{ fontSize: 30, color: "var(--rune)" }}>{shownStreak}</div>
            <div className="faint">current</div>
          </div>
          <div>
            <div className="stat-num" style={{ fontSize: 30 }}>{state.streak.best}</div>
            <div className="faint">best</div>
          </div>
          <div>
            <div className="stat-num" style={{ fontSize: 30 }}>{Object.keys(state.days).length}</div>
            <div className="faint">days logged</div>
          </div>
        </div>
        <p className="faint" style={{ marginTop: 10, marginBottom: 0 }}>
          A day counts once you clear 70% of its quests. Sunday rest counts like any other day.
        </p>
      </Win>

      <Win title="Codeforces" right={`${MISSION.cfStart} → ${MISSION.cfGoal}`}>
        {state.cfHistory && state.cfHistory.length > 1 ? (
          <>
            <Spark values={state.cfHistory.map((h) => h.rating)} color="#3fe0a8" />
            <div className="kv">
              <span>Current</span>
              <b>{state.cfHistory[state.cfHistory.length - 1].rating}</b>
            </div>
            <div className="kv">
              <span>Gain since start</span>
              <b style={{ color: "var(--agi)" }}>
                +{state.cfHistory[state.cfHistory.length - 1].rating - MISSION.cfStart}
              </b>
            </div>
          </>
        ) : (
          <div className="empty">Log a rating after your next rated round, on the Gates screen.</div>
        )}
        <div className="kv">
          <span>Current practice band</span>
          <b>{state.progression.cfBand}</b>
        </div>
      </Win>

      <Win title="Operation −12 kg" right={`Day ${missionDay} of ${MISSION.bodyDays}`}>
        <div className="bar">
          <i style={{ width: `${missionPct}%` }} />
        </div>
        <div style={{ marginTop: 10 }}>
          <div className="kv">
            <span>Weight</span>
            <b>{latest != null ? `${latest} kg` : "not logged"}</b>
          </div>
          <div className="kv">
            <span>Down from start</span>
            <b style={{ color: lost > 0 ? "var(--agi)" : "var(--text)" }}>
              {lost != null ? `${lost} kg` : "—"}
            </b>
          </div>
          <div className="kv">
            <span>Target</span>
            <b>{MISSION.goalWeight} kg</b>
          </div>
        </div>
      </Win>
    </>
  );
}
