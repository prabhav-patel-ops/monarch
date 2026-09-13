import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  KEY,
  loadState,
  saveState,
  emptyState,
  hasLocalSave,
  prepareImport,
  replaceState,
  restoreLatestSnapshot,
  requestPersistentStorage,
  createRecoverySnapshot,
} from "./store.js";
import {
  dateKey, shiftKey, generateDay, recomputeTotals, computeStreak,
  levelFromTotalXp, rankFromLevel, applyRatchet, daysBetween,
  pendingAlerts,
  sideXp, STATS, earnedBar,
} from "./engine.js";
import { Ico, chime } from "./ui.jsx";
import { quoteFor } from "./data.js";
import Status from "./screens/Status.jsx";
import Quests from "./screens/Quests.jsx";
import Gates from "./screens/Gates.jsx";
import Dungeon from "./screens/Dungeon.jsx";
import Calendar from "./screens/Calendar.jsx";
import Focus from "./screens/Focus.jsx";
import Shadows from "./screens/Shadows.jsx";
import SystemChat from "./screens/System.jsx";

const MAX_BACKFILL = 7;

// structuredClone is missing on Safari before 15.4; JSON round-trip is enough
// here because the state holds nothing but plain data.
const clone = (o) =>
  typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o));

const CalIcon = () => (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

const FocusIcon = () => (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3.5" />
  </svg>
);

const TABS = [
  { id: "status", label: "Status", icon: Ico.status },
  { id: "quests", label: "Quests", icon: Ico.quest },
  { id: "calendar", label: "Log", icon: CalIcon },
  { id: "gates", label: "Gates", icon: Ico.gate },
  { id: "dungeon", label: "Body", icon: Ico.body },
  { id: "focus", label: "Focus", icon: FocusIcon },
  { id: "shadows", label: "Shadows", icon: Ico.shadow },
  { id: "system", label: "System", icon: Ico.system },
];

export default function App() {
  const initialLoad = useRef(null);
  if (initialLoad.current === null) initialLoad.current = loadState();

  const [state, setState] = useState(() => initialLoad.current.state);
  const [localSavePresent, setLocalSavePresent] = useState(() => hasLocalSave());
  const [storageStatus, setStorageStatus] = useState(() => initialLoad.current.status);
  const [writeBlocked, setWriteBlocked] = useState(() => initialLoad.current.blocked);
  const [persistenceStatus, setPersistenceStatus] = useState("checking");
  const writeHash = useRef(initialLoad.current.hash || null);
  const [tab, setTab] = useState("quests");
  const [levelUp, setLevelUp] = useState(null);
  const [levelDown, setLevelDown] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const todayKey = useMemo(() => dateKey(new Date()), []);

  const flash = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    requestPersistentStorage().then((result) => setPersistenceStatus(result.status));
  }, []);

  /* Another tab changing monarch.v1 makes this in-memory branch stale. Keep a
     recovery copy and stop writes instead of silently overwriting that tab. */
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onStorage = (event) => {
      if (event.key !== KEY || event.newValue === event.oldValue) return;
      createRecoverySnapshot(state, "stale-tab-branch").catch(() => {});
      setWriteBlocked(true);
      setStorageStatus("conflict");
      setLocalSavePresent(event.newValue !== null);
      flash("Another tab changed this save. Reload before editing.");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [state, flash]);

  /* ---- every mutation re-derives totals from the day log, then persists ---- */
  const commit = useCallback(
    (mutate) => {
      setState((prev) => {
        if (writeBlocked) {
          flash("Saving is paused until this device state is recovered or reloaded.");
          return prev;
        }
        const draft = mutate(clone(prev));

        const { prog, raised } = applyRatchet(draft.days, todayKey, draft.progression, draft.settings);
        draft.progression = prog;
        if (raised.length) draft.lastRatchet = { date: todayKey, items: raised };

        const totals = recomputeTotals(draft.days, draft.shadows, todayKey, draft.settings.difficulty);
        draft.totalXp = totals.totalXp;
        draft.statXp = totals.statXp;
        draft.streak = computeStreak(draft.days, todayKey);

        const lvl = levelFromTotalXp(draft.totalXp).level;
        const seen = draft.seenLevel || 1;
        if (lvl > seen) {
          const rank = rankFromLevel(lvl);
          const prevRank = rankFromLevel(seen);
          draft.seenLevel = lvl;
          setLevelUp({ level: lvl, rankUp: rank !== prevRank ? rank : null });
          if (draft.settings.soundOn) chime("level");
        } else if (lvl < seen) {
          // Regression is shown, not swallowed. A silent demotion teaches nothing.
          const rank = rankFromLevel(lvl);
          const prevRank = rankFromLevel(seen);
          draft.seenLevel = lvl;
          setLevelDown({
            level: lvl,
            from: seen,
            rankDown: rank !== prevRank ? rank : null,
            days: totals.chargedDays,
          });
          if (draft.settings.soundOn) chime("penalty");
        }

        const written = saveState(draft, { expectedHash: writeHash.current, reason: "mutation" });
        if (!written.ok) {
          setWriteBlocked(written.code === "conflict" || written.code === "corrupt-live");
          setStorageStatus(written.code === "conflict" ? "conflict" : "error");
          flash(written.reason);
          return prev;
        }
        writeHash.current = written.hash;
        setStorageStatus("ok");
        setLocalSavePresent(hasLocalSave());
        return draft;
      });
    },
    [todayKey, writeBlocked, flash]
  );

  /* ---- generate today, and backfill up to a week of missed days ---- */
  useEffect(() => {
    commit((d) => {
      if (!d.hunter.createdAt) d.hunter.createdAt = todayKey;

      const logged = Object.keys(d.days).sort();
      const last = logged.length ? logged[logged.length - 1] : todayKey;
      const gap = Math.min(MAX_BACKFILL, Math.max(0, daysBetween(last, todayKey)));

      for (let i = gap; i >= 0; i--) {
        const k = shiftKey(todayKey, -i);
        if (d.days[k]) continue;
        /* Each day is stamped with the bar earned by that date, so the
           standard it was graded under travels with it. */
        d.days[k] = generateDay(
          k, d.templates, d.progression, d.days[shiftKey(k, -1)],
          earnedBar(d.days, k, d.settings.difficulty, d.hunter.createdAt)
        );
      }
      return d;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- quests ---- */

  const onToggle = useCallback(
    (dk, qid) => {
      commit((d) => {
        const day = d.days[dk];
        if (!day) return d;
        const q = day.quests.find((x) => x.id === qid);
        if (!q) return d;
        q.done = !q.done;
        if (q.done) {
          q.excused = false;
          if (d.settings.soundOn) chime("quest");
          flash(`${q.stat} +${q.xp}`);
        }
        return d;
      });
    },
    [commit, flash]
  );

  const onExcuse = useCallback(
    (dk, qid) => {
      commit((d) => {
        const q = d.days[dk]?.quests.find((x) => x.id === qid);
        if (q) q.excused = !q.excused;
        return d;
      });
      flash("Excused, no penalty");
    },
    [commit, flash]
  );

  /* ---- gates ---- */

  const onAddGate = useCallback((g) => commit((d) => { d.gates.push(g); return d; }), [commit]);

  const onClearGate = useCallback((id) => {
    commit((d) => {
      const g = d.gates.find((x) => x.id === id);
      if (g) { g.cleared = true; g.clearedOn = todayKey; }
      return d;
    });
    flash("Gate cleared");
  }, [commit, flash, todayKey]);

  const onDeleteGate = useCallback(
    (id) => commit((d) => { d.gates = d.gates.filter((x) => x.id !== id); return d; }),
    [commit]
  );

  const onLogRating = useCallback((rating) => {
    commit((d) => {
      d.cfHistory = d.cfHistory || [];
      d.cfHistory = d.cfHistory.filter((h) => h.date !== todayKey);
      d.cfHistory.push({ date: todayKey, rating });
      d.cfHistory.sort((a, b) => (a.date < b.date ? -1 : 1));
      return d;
    });
    flash(`Rating logged: ${rating}`);
  }, [commit, flash, todayKey]);

  /* ---- body ---- */

  const onToggleExercise = useCallback((dk, idx) => {
    commit((d) => {
      const cur = d.body.training[dk] || { done: [] };
      cur.done = cur.done.includes(idx) ? cur.done.filter((i) => i !== idx) : [...cur.done, idx];
      d.body.training[dk] = cur;
      return d;
    });
  }, [commit]);

  /* Logged-load days write a set list per exercise key. The whole list is
     replaced on every edit so adding, removing and editing a set are one path. */
  const onLogSets = useCallback((dk, exKey, sets) => {
    commit((d) => {
      const cur = d.body.training[dk] || { done: [], sets: {} };
      d.body.training[dk] = { ...cur, done: cur.done || [], sets: { ...(cur.sets || {}), [exKey]: sets } };
      return d;
    });
  }, [commit]);

  const onLogCardio = useCallback((dk, exKey, cardio) => {
    commit((d) => {
      const cur = d.body.training[dk] || { done: [], sets: {} };
      d.body.training[dk] = { ...cur, done: cur.done || [], sets: { ...(cur.sets || {}), [exKey]: { cardio } } };
      return d;
    });
  }, [commit]);

  /* The split ships with a best guess at each exercise name. Renaming keeps the
     key, so the history and the progression built on it survive the correction. */
  const onRenameExercise = useCallback((exKey, name) => {
    commit((d) => {
      d.body.exNames = { ...(d.body.exNames || {}) };
      const clean = String(name || "").trim();
      if (clean) d.body.exNames[exKey] = clean;
      else delete d.body.exNames[exKey];
      return d;
    });
  }, [commit]);

  const onAddMeal = useCallback((dk, meal) => {
    commit((d) => {
      d.body.meals[dk] = [...(d.body.meals[dk] || []), meal];
      return d;
    });
    flash(`${meal.name} added`);
  }, [commit, flash]);

  const onRemoveMeal = useCallback((dk, i) => {
    commit((d) => {
      d.body.meals[dk] = (d.body.meals[dk] || []).filter((_, j) => j !== i);
      return d;
    });
  }, [commit]);

  const onSetWater = useCallback(
    (dk, v) => commit((d) => { d.body.water[dk] = Math.max(0, +v.toFixed(2)); return d; }),
    [commit]
  );

  const onLogWeight = useCallback((dk, kg) => {
    commit((d) => {
      const arr = d.body.weights.filter((x) => x.date !== dk);
      arr.push({ date: dk, kg });
      arr.sort((a, b) => (a.date < b.date ? -1 : 1));
      d.body.weights = arr;
      return d;
    });
    flash(`Weight logged: ${kg} kg`);
  }, [commit, flash]);

  const onLogWaist = useCallback((dk, cm) => {
    commit((d) => {
      const arr = d.body.waist.filter((x) => x.date !== dk);
      arr.push({ date: dk, cm });
      arr.sort((a, b) => (a.date < b.date ? -1 : 1));
      d.body.waist = arr;
      return d;
    });
    flash(`Waist logged: ${cm} cm`);
  }, [commit, flash]);

  const onLogSleep = useCallback((dk, s) => {
    commit((d) => { d.body.sleep[dk] = s; return d; });
    flash(`Sleep logged: ${s.hours} h`);
  }, [commit, flash]);

  /* ---- shadows and settings ---- */

  const onExtract = useCallback((s) => {
    commit((d) => { d.shadows.push({ ...s, date: todayKey }); return d; });
    flash("Arise.");
  }, [commit, flash, todayKey]);

  const onDismiss = useCallback(
    (id) => commit((d) => { d.shadows = d.shadows.filter((x) => x.id !== id); return d; }),
    [commit]
  );

  const onSettings = useCallback(
    (patch) => commit((d) => { d.settings = { ...d.settings, ...patch }; return d; }),
    [commit]
  );

  const onProgression = useCallback(
    (field, v) => commit((d) => { d.progression[field] = v; return d; }),
    [commit]
  );

  /* A day's note. Empty text removes the entry rather than storing a blank,
     so "days written" stays an honest count. */
  const onJournal = useCallback((dk, text) => {
    commit((d) => {
      const j = { ...d.body.journal };
      const clean = String(text || "").trim();
      if (clean) j[dk] = { text: clean, at: new Date().toISOString() };
      else delete j[dk];
      d.body.journal = j;
      return d;
    });
  }, [commit]);

  /* ---- side quests ----
     Priced by the engine rather than by the caller, so the board and this
     cannot drift apart on what a piece of work is worth. */
  const onAddExtra = useCallback((dk, task) => {
    commit((d) => {
      const day = d.days[dk];
      if (!day) return d;
      const entry = {
        id: `x${Date.now().toString(36)}`,
        title: String(task.title || "").trim().slice(0, 120) || "Side quest",
        stat: STATS.includes(task.stat) ? task.stat : "INT",
        sig: task.sig || "minor",
        mins: Math.max(0, Math.min(600, Math.round(Number(task.mins) || 0))),
        at: new Date().toISOString(),
      };
      entry.xp = sideXp(entry.sig, entry.mins);
      day.extras = [...(day.extras || []), entry];
      return d;
    });
    flash("Logged");
  }, [commit, flash]);

  const onRemoveExtra = useCallback((dk, id) => {
    commit((d) => {
      const day = d.days[dk];
      if (day) day.extras = (day.extras || []).filter((x) => x.id !== id);
      return d;
    });
  }, [commit]);

  /* ---- seasons, schedule, reminders, focus ---- */

  const onStartSeason = useCallback((season) => {
    commit((d) => {
      d.seasons = [...(d.seasons || []).filter((s) => s.id !== season.id), season];
      return d;
    });
  }, [commit]);

  const onSchedule = useCallback((patch) => {
    commit((d) => {
      d.settings = { ...d.settings, schedule: { ...d.settings.schedule, ...patch } };
      return d;
    });
  }, [commit]);

  const onReminder = useCallback((id, patch) => {
    commit((d) => {
      d.settings = {
        ...d.settings,
        reminders: (d.settings.reminders || []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
      };
      return d;
    });
  }, [commit]);

  /* Minutes lost, stored per day so the calendar can show what a bad week cost.
     Clamped at zero and at a day, because a typo of 3000 would poison the
     weekly average for a fortnight. */
  const onLogFocus = useCallback((dk, id, mins) => {
    commit((d) => {
      const day = { ...(d.body.focus[dk] || {}) };
      const v = Math.max(0, Math.min(1440, Math.round(Number(mins) || 0)));
      if (v === 0) delete day[id];
      else day[id] = v;
      d.body.focus = { ...d.body.focus, [dk]: day };
      return d;
    });
  }, [commit]);

  const onImport = useCallback(async (text) => {
    try {
      const plan = prepareImport(text, state);
      if (plan.relation === "identical") {
        flash("This backup is identical; nothing changed.");
        return;
      }
      if (plan.relation === "older") {
        alert("This backup is older than the current branch. It was not imported.");
        return;
      }
      if (plan.relation === "divergent") {
        const proceed = confirm(
          "This backup is a different branch. MONARCH will preserve the current branch as a recovery checkpoint before switching. Continue?"
        );
        if (!proceed) return;
      }

      const result = await replaceState(plan.state, {
        reason: "import",
        lineage: plan.lineage,
        allowCorruptReplace: writeBlocked,
        preserveBranch: plan.relation === "divergent",
      });
      if (!result.ok) {
        flash(result.reason);
        return;
      }
      writeHash.current = result.hash;
      setState(plan.state);
      setWriteBlocked(false);
      setStorageStatus("ok");
      setLocalSavePresent(hasLocalSave());
      flash(plan.relation === "descendant" ? "Backup fast-forwarded" : "Backup branch restored");
    } catch (error) {
      alert(error.message);
    }
  }, [state, writeBlocked, flash]);

  const onReset = useCallback(async () => {
    const result = await replaceState(emptyState(), { reason: "reset", allowCorruptReplace: true });
    if (!result.ok) {
      flash(result.reason);
      return;
    }
    writeHash.current = result.hash;
    setState(emptyState());
    setWriteBlocked(false);
    setStorageStatus("ok");
    setLocalSavePresent(true);
    if (typeof location !== "undefined" && typeof location.reload === "function") location.reload();
  }, [flash]);

  const onRestoreRecovery = useCallback(async () => {
    try {
      const result = await restoreLatestSnapshot();
      if (!result.ok) {
        flash(result.reason);
        return;
      }
      if (typeof location !== "undefined" && typeof location.reload === "function") location.reload();
    } catch {
      flash("Recovery storage is unavailable on this device.");
    }
  }, [flash]);

  const [nowMins, setNowMins] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());
  useEffect(() => {
    const id = setInterval(() => setNowMins(new Date().getHours() * 60 + new Date().getMinutes()), 60000);
    return () => clearInterval(id);
  }, []);

  const [muted, setMuted] = useState([]);
  const alerts = useMemo(
    () => pendingAlerts(state, todayKey, nowMins).filter((a) => !muted.includes(a.id)),
    [state, todayKey, nowMins, muted]
  );

  /* Which way the tab bar moved decides which way the page slides, so
     forward and back feel different and the app keeps a sense of place. */
  const tabIndex = Math.max(0, TABS.findIndex((t) => t.id === tab));
  const lastTab = useRef(tabIndex);
  const dir = tabIndex >= lastTab.current ? 1 : -1;
  useEffect(() => { lastTab.current = tabIndex; }, [tabIndex]);

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const level = levelFromTotalXp(state.totalXp).level;
  const rank = rankFromLevel(level);

  const shared = {
    state, todayKey, onToggle, onExcuse, onAddGate, onClearGate, onDeleteGate, onLogRating,
    onToggleExercise, onLogSets, onLogCardio, onRenameExercise,
    onAddMeal, onRemoveMeal, onSetWater, onLogWeight, onLogWaist, onLogSleep,
    onExtract, onDismiss, onSettings, onImport, onReset, onRestoreRecovery, onProgression, flash,
    onStartSeason, onSchedule, onReminder, onLogFocus, onJournal, alerts, setTab,
    onAddExtra, onRemoveExtra,
    backupStatus: {
      storageStatus,
      persistenceStatus,
      writeBlocked,
      damagedRaw: initialLoad.current.corruptRaw || null,
    },
  };

  return (
    <div className="app">
      <header className="topbar" data-scrolled={scrolled}>
        <div className="rank-glyph" data-rank={rank}>{rank}</div>
        <div className="topbar-meta">
          <div className="topbar-name">{state.hunter.name}</div>
          <div className="topbar-sub">Level {level} · {state.streak.current} day streak</div>
        </div>
        <div
          className="mn-data-status"
          data-present={localSavePresent && !writeBlocked}
          role="status"
          aria-live="polite"
          title={writeBlocked
            ? "Writes are paused to protect an invalid or newer monarch.v1 save"
            : localSavePresent ? "monarch.v1 is stored on this device" : "No monarch.v1 save is stored on this device"}
        >
          <span className="mn-data-status__dot" aria-hidden="true" />
          <span className="mn-data-status__copy">
            <span className="mn-data-status__label">Data status</span>
            <span className="mn-data-status__value">
              {writeBlocked ? "Write paused" : localSavePresent ? "Local save" : "No local save"}
            </span>
          </span>
        </div>
      </header>

      {alerts.length > 0 && (
        <div className="mn-alerts">
          {alerts.slice(0, 3).map((a) => (
            <button
              key={a.id}
              className="mn-alert mn-rise"
              data-level={a.level}
              onClick={() => { if (a.action) setTab(a.action); }}
            >
              <div className="mn-alert-body">
                <div className="mn-alert-title">{a.title}</div>
                <div className="mn-alert-text">{a.body}</div>
              </div>
              <span
                className="mn-alert-x"
                role="button"
                tabIndex={0}
                aria-label="Dismiss"
                onClick={(e) => { e.stopPropagation(); setMuted((m) => [...m, a.id]); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setMuted((m) => [...m, a.id]); } }}
              >
                ×
              </span>
            </button>
          ))}
        </div>
      )}

      <main className="content mn-page" key={tab} style={{ "--dir": dir }}>
        {tab === "status" && <Status {...shared} />}
        {tab === "quests" && <Quests {...shared} />}
        {tab === "gates" && <Gates {...shared} />}
        {tab === "dungeon" && <Dungeon {...shared} />}
        {tab === "calendar" && <Calendar {...shared} />}
        {tab === "focus" && <Focus {...shared} />}
        {tab === "shadows" && <Shadows {...shared} />}
        {tab === "system" && <SystemChat {...shared} />}
      </main>

      <nav className="nav" style={{ "--mn-tabs": TABS.length, "--mn-active": tabIndex }}>
        <span className="mn-nav-pill" aria-hidden="true" />
        {TABS.map((t) => (
          <button key={t.id} data-on={tab === t.id} onClick={() => setTab(t.id)} aria-label={t.label}>
            <t.icon />
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      {toast && <div className="toast mn-toast">{toast}</div>}

      {levelDown && (
        <div className="levelup levelup--down mn-levelup mn-levelup--down" onClick={() => setLevelDown(null)}>
          <div className="mn-levelup__stage" aria-hidden="true">
            <span className="mn-levelup__ring" />
            <span className="mn-levelup__ring mn-levelup__ring--2" />
            <span className="mn-levelup__sweep" />
          </div>
          <div className="mn-levelup__body" style={{ textAlign: "center", padding: 24 }}>
            <div className="rank-glyph mn-levelup__glyph" data-rank={levelDown.rankDown || rank}>
              {levelDown.rankDown || rank}
            </div>
            <h2 style={{ color: "var(--blood)" }}>Level Lost</h2>
            <p style={{ marginTop: 18 }}>
              Level {levelDown.from} down to {levelDown.level}
            </p>
            {levelDown.rankDown && (
              <p style={{ color: "var(--blood)", fontSize: 16 }}>Demoted to rank {levelDown.rankDown}</p>
            )}
            <p className="faint" style={{ marginTop: 14, maxWidth: 300 }}>
              {levelDown.days} days of work charged back so far. Three clean days start forgiving it.
            </p>
            <button className="solid" style={{ marginTop: 22 }} onClick={() => setLevelDown(null)}>
              Understood
            </button>
          </div>
        </div>
      )}

      {levelUp && (
        <div className="levelup mn-levelup" onClick={() => setLevelUp(null)}>
          <div className="mn-levelup__stage" aria-hidden="true">
            <span className="mn-levelup__ring" />
            <span className="mn-levelup__ring mn-levelup__ring--2" />
            <span className="mn-levelup__sweep" />
          </div>
          <div className="mn-levelup__body" style={{ textAlign: "center", padding: 24 }}>
            <div className="rank-glyph mn-levelup__glyph" data-rank={levelUp.rankUp || rank}>
              {levelUp.rankUp || rank}
            </div>
            <h2>Level Up</h2>
            <p style={{ marginTop: 18 }}>You have reached level {levelUp.level}</p>
            {levelUp.rankUp && <p style={{ color: "var(--gold)", fontSize: 16 }}>Rank {levelUp.rankUp}</p>}
            <p className="faint" style={{ marginTop: 14, maxWidth: 300 }}>
              {quoteFor(levelUp.rankUp ? "rankUp" : "levelUp", String(levelUp.level))}
            </p>
            <button className="solid" style={{ marginTop: 22 }} onClick={() => setLevelUp(null)}>Continue</button>
          </div>
        </div>
      )}
    </div>
  );
}
