import React, { useState, useMemo } from "react";
import { Win } from "../ui.jsx";
import {
  monthCells, monthSummary, GRADE_TONE, buildSchedule, journeyEvents,
  seasonProgress, parseKey, shiftKey, daysBetween, levelFromTotalXp, rankFromLevel,
} from "../engine.js";
import { defaultSeason, SEASON_LENGTH, SEASON_GOAL_TYPES } from "../data.js";
import { dailyRemindersIcs, gatesIcs, scheduleIcs, downloadIcs } from "../calendar.js";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const GRADE_LABEL = {
  clean: "Clean", held: "Held", slipped: "Slipped", broken: "Broken", void: "Excused", none: "Not logged",
};

/* ---------------- journal ----------------
   Attached to a day rather than kept as a separate stream, because the entry
   worth reading back is the one sitting next to the grade it was written
   about. */

function JournalEntry({ dayKey, state, onJournal }) {
  const saved = state.body.journal?.[dayKey];
  const [text, setText] = useState(saved?.text || "");
  const [seen, setSeen] = useState(dayKey);

  /* Switching days must swap the draft, or you write into yesterday. */
  if (seen !== dayKey) {
    setSeen(dayKey);
    setText(saved?.text || "");
  }

  const dirty = text.trim() !== (saved?.text || "");
  const written = Object.keys(state.body.journal || {}).length;

  return (
    <Win title="Journal" right={written ? `${written} written` : ""}>
      <textarea
        rows={4}
        value={text}
        placeholder="What actually happened. What it cost. What tomorrow needs."
        onChange={(e) => setText(e.target.value)}
        style={{ width: "100%", resize: "vertical", fontSize: 13, lineHeight: 1.5, padding: 10 }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="solid none" disabled={!dirty} onClick={() => onJournal(dayKey, text)}>
          {saved ? "Update" : "Save"}
        </button>
        {saved && (
          <button className="ghost" onClick={() => { setText(""); onJournal(dayKey, ""); }}>Clear</button>
        )}
        {saved && !dirty && <span className="faint" style={{ marginLeft: "auto", fontSize: 10 }}>saved</span>}
      </div>
    </Win>
  );
}

/* ---------------- Month ---------------- */

function Month({ state, todayKey, flash, onJournal }) {
  const today = parseKey(todayKey);
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [picked, setPicked] = useState(todayKey);

  const grid = useMemo(
    () => monthCells(cursor.y, cursor.m, state.days, todayKey, state.settings.difficulty),
    [cursor, state.days, todayKey, state.settings.difficulty]
  );
  const summary = useMemo(() => monthSummary(grid.cells), [grid]);

  const step = (n) => {
    const d = new Date(cursor.y, cursor.m + n, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };

  const day = state.days[picked];
  const cell = grid.cells.find((c) => c.key === picked);

  return (
    <>
      <Win tone="accent" title="The log" right={grid.label}>
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="ghost" onClick={() => step(-1)}>‹ Prev</button>
          <button className="ghost" onClick={() => { setCursor({ y: today.getFullYear(), m: today.getMonth() }); setPicked(todayKey); }}>
            Today
          </button>
          <button className="ghost" onClick={() => step(1)}>Next ›</button>
        </div>

        <div className="mn-cal-head">
          {WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}
        </div>
        <div className="mn-cal-grid">
          {grid.cells.map((c) => (
            <button
              key={c.key}
              className="mn-cal-cell"
              data-in={c.inMonth}
              data-today={c.isToday}
              data-picked={c.key === picked}
              onClick={() => setPicked(c.key)}
              aria-label={`${c.key}, ${GRADE_LABEL[c.grade]}`}
            >
              <span className="mn-cal-num">{c.dayOfMonth}</span>
              <span
                className="mn-cal-dot"
                style={{ background: c.grade === "none" ? "transparent" : GRADE_TONE[c.grade] }}
              />
            </button>
          ))}
        </div>

        <div className="mn-cal-legend">
          {["clean", "held", "slipped", "broken"].map((g) => (
            <span key={g}>
              <i style={{ background: GRADE_TONE[g] }} />
              {GRADE_LABEL[g]} <b>{summary[g] || 0}</b>
            </span>
          ))}
        </div>
        <p className="faint" style={{ margin: "8px 0 0", fontSize: 11 }}>
          {summary.logged} day{summary.logged === 1 ? "" : "s"} logged this month. Days before the System came online are
          left blank rather than counted as failures.
        </p>
      </Win>

      <Win title={picked} right={cell ? GRADE_LABEL[cell.grade] : ""}>
        {!day || !day.generated ? (
          <div className="empty">Nothing was logged on this day.</div>
        ) : (
          <>
            <div className="xp-row">
              <div className="stat-num" style={{ fontSize: 24, color: GRADE_TONE[cell.grade] }}>
                {Math.round((cell.ratio || 0) * 100)}%
              </div>
              <div className="xp-frac">
                {cell.earned} of {cell.available} xp ·{" "}
                {day.quests.filter((q) => q.done).length} of {day.quests.length} done
              </div>
            </div>
            <div className="bar">
              <i style={{ width: `${(cell.ratio || 0) * 100}%`, background: GRADE_TONE[cell.grade] }} />
            </div>
            <div style={{ marginTop: 10 }}>
              {day.quests.map((q) => (
                <div className="kv" key={q.id}>
                  <span style={{ opacity: q.done ? 1 : 0.55, textDecoration: q.excused ? "line-through" : "none" }}>
                    {q.done ? "✓" : q.excused ? "—" : "✗"} {q.title}
                  </span>
                  <b className="faint">{q.stat} · {q.xp}</b>
                </div>
              ))}
            </div>
          </>
        )}
      </Win>

      <JournalEntry dayKey={picked} state={state} onJournal={onJournal} />

      <Win title="Send to your phone's calendar">
        <p className="faint" style={{ marginTop: 0 }}>
          This app cannot ring while it is closed — no web app can, and the browser API that would have allowed it was
          abandoned before it shipped. Your phone's Calendar can. These download a standard <code>.ics</code> file;
          opening it adds the events, with alarms, to the calendar that already wakes you.
        </p>
        <div className="row">
          <button
            className="solid none"
            onClick={async () => {
              const r = await downloadIcs(dailyRemindersIcs(todayKey, state.settings.reminders), "monarch-daily.ics");
              flash(r.ok ? "Daily reminders exported" : r.reason);
            }}
          >
            Daily reminders
          </button>
          <button
            className="ghost"
            onClick={() => {
              const open = (state.gates || []).filter((g) => !g.clearedOn);
              if (!open.length) return flash("No open gates");
              downloadIcs(gatesIcs(state.gates), "monarch-gates.ics");
              flash(`${open.length} gate${open.length === 1 ? "" : "s"} exported`);
            }}
          >
            Gate deadlines
          </button>
        </div>
        <p className="faint" style={{ marginBottom: 0, marginTop: 10, fontSize: 11 }}>
          Re-export after changing your reminder times — the calendar keeps whatever it imported last.
        </p>
      </Win>
    </>
  );
}

/* ---------------- Today: the smart schedule ---------------- */

function Schedule({ state, todayKey, onSchedule, flash }) {
  const sched = state.settings.schedule;
  const day = state.days[todayKey];
  const restDay = parseKey(todayKey).getDay() === 0;

  const plan = useMemo(
    () => buildSchedule(day, sched, !restDay),
    [day, sched, restDay]
  );

  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();

  return (
    <>
      <Win tone="accent" title="Today's plan" right={`${Math.round(plan.freeMins / 60)} h open`}>
        <p className="faint" style={{ marginTop: 0 }}>
          Everything still open, laid into the gaps between what is already fixed. This plans time — it never marks
          anything done, and the log does not depend on it.
        </p>
        {plan.blocks.length === 0 && <div className="empty">Nothing left to place. The day is clear.</div>}
        <div className="mn-timeline">
          {plan.blocks.map((b, i) => {
            const live = nowMins >= b.startMins && nowMins < b.endMins;
            return (
              <div key={`${b.id}-${i}`} className="mn-block" data-fixed={!!b.fixed} data-live={live}>
                <div className="mn-block-time">{b.start}<span>{b.end}</span></div>
                <div className="mn-block-body">
                  <div className="qtitle">{b.label}</div>
                  <div className="faint" style={{ fontSize: 11 }}>
                    {b.mins} min{b.stat ? ` · ${b.stat} · ${b.xp} XP` : " · fixed"}
                    {live ? " · now" : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {plan.unplaced.length > 0 && (
          <p className="faint" style={{ marginBottom: 0, color: "var(--gold)" }}>
            {plan.unplaced.length} quest{plan.unplaced.length === 1 ? "" : "s"} would not fit before lights out:{" "}
            {plan.unplaced.map((q) => q.title).join(", ")}. Either the day is overcommitted or the fixed blocks are too wide.
          </p>
        )}
        {plan.blocks.length > 0 && (
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="solid none"
              onClick={async () => {
                const r = await downloadIcs(scheduleIcs(todayKey, plan.blocks), `monarch-${todayKey}.ics`);
                flash(r.ok ? "Day exported" : r.reason);
              }}
            >
              Send today to calendar
            </button>
          </div>
        )}
      </Win>

      <Win title="Waking hours">
        <div className="row">
          <label className="field"><span>Wake</span>
            <input type="time" value={sched.wake} onChange={(e) => onSchedule({ wake: e.target.value })} />
          </label>
          <label className="field"><span>Lights out</span>
            <input type="time" value={sched.sleep} onChange={(e) => onSchedule({ sleep: e.target.value })} />
          </label>
          <label className="field"><span>Per quest</span>
            <input
              type="number" min="10" max="240" step="5" value={sched.questMins}
              onChange={(e) => onSchedule({ questMins: Math.max(10, +e.target.value || 45) })}
            />
          </label>
        </div>
      </Win>

      <Win title="Fixed blocks" right={`${sched.fixed.length}`}>
        <p className="faint" style={{ marginTop: 0 }}>
          What is already committed. Quests are placed around these, never on top of them.
        </p>
        {sched.fixed.map((f, i) => (
          <div className="row" key={f.id} style={{ marginBottom: 6, alignItems: "center" }}>
            <input
              value={f.label}
              onChange={(e) => onSchedule({ fixed: sched.fixed.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
              style={{ flex: 2 }}
            />
            <input
              type="time" value={f.start}
              onChange={(e) => onSchedule({ fixed: sched.fixed.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })}
              style={{ flex: 1 }}
            />
            <input
              type="number" min="5" step="5" value={f.mins}
              onChange={(e) => onSchedule({ fixed: sched.fixed.map((x, j) => (j === i ? { ...x, mins: Math.max(5, +e.target.value || 30) } : x)) })}
              style={{ width: 64 }}
            />
            <button
              className="ghost" style={{ padding: "4px 8px", fontSize: 10, clipPath: "none" }}
              onClick={() => onSchedule({ fixed: sched.fixed.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="ghost" style={{ marginTop: 6 }}
          onClick={() => onSchedule({ fixed: [...sched.fixed, { id: `f-${Date.now()}`, label: "New block", start: "15:00", mins: 60 }] })}
        >
          + block
        </button>
      </Win>
    </>
  );
}

/* ---------------- Journey ---------------- */

const JOURNEY_TONE = {
  start: "#6fa8ff", rank: "#ffd76f", level: "#6fa8ff", shadow: "#a98bff",
  gate: "#3fe0a8", season: "#6fa8ff", seasonWon: "#3fe0a8", seasonLost: "#ff5c5c", streak: "#ff7a4a",
};

function Journey({ state, todayKey }) {
  const events = useMemo(() => journeyEvents(state, todayKey), [state, todayKey]);
  const level = levelFromTotalXp(state.totalXp).level;

  return (
    <>
      <Win tone="accent" title="Journey" right={`${events.length} milestone${events.length === 1 ? "" : "s"}`}>
        <div className="xp-row">
          <div className="stat-num" style={{ fontSize: 26 }}>Rank {rankFromLevel(level)}</div>
          <div className="xp-frac">
            {state.hunter.createdAt
              ? `${daysBetween(state.hunter.createdAt, todayKey) + 1} days since awakening`
              : "Not yet awakened"}
          </div>
        </div>
        <p className="faint" style={{ marginBottom: 0 }}>
          Rebuilt from the log every time you open it, so a restored backup shows the same history. Nothing here is
          stored separately and nothing can drift out of step with the days it came from.
        </p>
      </Win>

      <Win title="Milestones">
        {events.length === 0 && <div className="empty">Nothing to show yet. Clear some days.</div>}
        <div className="mn-journey">
          {events.map((e, i) => (
            <div className="mn-journey-item mn-rise" style={{ "--i": Math.min(i, 12) }} key={`${e.date}-${e.kind}-${i}`}>
              <span className="mn-journey-dot" style={{ background: JOURNEY_TONE[e.kind] || "#6fa8ff" }} />
              <div>
                <div className="qtitle">{e.title}</div>
                <div className="faint" style={{ fontSize: 11 }}>{e.date} · {e.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </Win>
    </>
  );
}

/* ---------------- Season ---------------- */

function Season({ state, todayKey, onStartSeason, onEndSeason, flash }) {
  const seasons = state.seasons || [];
  const active = seasons.find((s) => todayKey <= s.endKey) || seasons[seasons.length - 1];
  const prog = useMemo(() => (active ? seasonProgress(active, state, todayKey) : null), [active, state, todayKey]);
  const [draft, setDraft] = useState(null);

  if (!active || draft) {
    const start = todayKey;
    const end = shiftKey(start, SEASON_LENGTH - 1);
    const seed = draft || defaultSeason(start, end);
    return (
      <Win tone="accent" title="Open a season" right={`${SEASON_LENGTH} days`}>
        <p className="faint" style={{ marginTop: 0 }}>
          A season is a fixed window with a few goals set at the start. Once it opens the window cannot be extended and
          the goals cannot be edited — the whole point is that the bar was set by someone who could not yet see how it
          was going.
        </p>
        <label className="field" style={{ marginBottom: 10 }}>
          <span>Name</span>
          <input value={seed.name} onChange={(e) => setDraft({ ...seed, name: e.target.value })} />
        </label>
        <div className="kv"><span>Runs</span><b>{start} → {end}</b></div>
        <div style={{ marginTop: 10 }}>
          {seed.goals.map((g, i) => (
            <div className="row" key={g.key} style={{ marginBottom: 6, alignItems: "center" }}>
              <select
                value={g.type}
                onChange={(e) => {
                  const t = SEASON_GOAL_TYPES.find((x) => x.type === e.target.value);
                  setDraft({
                    ...seed,
                    goals: seed.goals.map((x, j) => (j === i ? { ...x, type: t.type, label: `${t.label}` } : x)),
                  });
                }}
                style={{ flex: 2 }}
              >
                {SEASON_GOAL_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
              <input
                type="number" min="1" value={g.target} style={{ width: 76 }}
                onChange={(e) => setDraft({ ...seed, goals: seed.goals.map((x, j) => (j === i ? { ...x, target: Math.max(1, +e.target.value || 1) } : x)) })}
              />
              {seed.goals.length > 1 && (
                <button
                  className="ghost" style={{ padding: "4px 8px", fontSize: 10, clipPath: "none" }}
                  onClick={() => setDraft({ ...seed, goals: seed.goals.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          {seed.goals.length < 6 && (
            <button
              className="ghost"
              onClick={() => setDraft({ ...seed, goals: [...seed.goals, { key: `g${Date.now()}`, type: "cleanDays", label: "Clean days", target: 30 }] })}
            >
              + goal
            </button>
          )}
          <button
            className="solid none" style={{ marginLeft: "auto" }}
            onClick={() => { onStartSeason({ ...seed, startKey: start, endKey: end }); setDraft(null); flash("Season opened"); }}
          >
            Open season
          </button>
        </div>
      </Win>
    );
  }

  const tone = { won: "var(--agi)", lost: "#ff5c5c", clinched: "var(--agi)", running: "var(--gold)", upcoming: "var(--text-faint)" }[prog.status];

  return (
    <>
      <Win tone="accent" title={active.name} right={prog.done ? prog.status.toUpperCase() : `${prog.left} days left`}>
        <div className="xp-row">
          <div className="stat-num" style={{ fontSize: 26, color: tone }}>{prog.met}<span style={{ fontSize: 15, color: "var(--text-faint)" }}> / {prog.of}</span></div>
          <div className="xp-frac">{prog.elapsed} of {prog.total} days elapsed</div>
        </div>
        <div className="bar"><i style={{ width: `${prog.ratio * 100}%`, background: tone }} /></div>
        <div className="mn-pace">
          <span className="mn-pace-mark" style={{ left: `${prog.pace * 100}%` }} />
        </div>
        <p className="faint" style={{ margin: "8px 0 0", fontSize: 11 }}>
          {prog.done
            ? prog.status === "won" ? "Season taken. Every goal met inside the window." : "Season closed short. It stands as it finished."
            : prog.onPace
              ? "On pace. The marker is where the clock is; the bar is where you are."
              : "Behind pace. The bar is short of the clock."}
        </p>
      </Win>

      <Win title="Goals">
        {prog.goals.map((g) => (
          <div key={g.key} style={{ marginBottom: 12 }}>
            <div className="stat-line" style={{ marginBottom: 3 }}>
              <div className="stat-key" style={{ width: "auto", flex: 1, fontSize: 12, color: g.met ? "var(--agi)" : undefined }}>
                {g.met ? "✓ " : ""}{g.label}
              </div>
              <div className="stat-num" style={{ fontSize: 13 }}>
                {Math.round(g.value)}<span style={{ color: "var(--text-faint)" }}>/{g.target}</span>
              </div>
            </div>
            <div className="stat-bar"><i style={{ width: `${g.ratio * 100}%`, background: g.met ? "var(--agi)" : "#6fa8ff" }} /></div>
          </div>
        ))}
      </Win>

      {prog.done && (
        <Win title="Next season">
          <p className="faint" style={{ marginTop: 0 }}>
            This one is closed and stays on the record either way. Set the next window.
          </p>
          <button className="solid none" onClick={() => setDraft(defaultSeason(todayKey, shiftKey(todayKey, SEASON_LENGTH - 1)))}>
            Open a new season
          </button>
        </Win>
      )}

      {seasons.length > 1 && (
        <Win title="Past seasons">
          {seasons.filter((s) => s.id !== active.id).map((s) => {
            const p = seasonProgress(s, state, todayKey);
            return (
              <div className="kv" key={s.id}>
                <span>{s.name}</span>
                <b style={{ color: p.status === "won" ? "var(--agi)" : "#ff5c5c" }}>{p.met}/{p.of}</b>
              </div>
            );
          })}
        </Win>
      )}
    </>
  );
}

/* ---------------- shell ---------------- */

export default function Calendar(props) {
  const [tab, setTab] = useState("month");
  return (
    <>
      <div className="seg">
        {[["month", "Month"], ["today", "Today"], ["journey", "Journey"], ["season", "Season"]].map(([id, label]) => (
          <button key={id} data-on={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === "month" && <Month {...props} />}
      {tab === "today" && <Schedule {...props} />}
      {tab === "journey" && <Journey {...props} />}
      {tab === "season" && <Season {...props} />}
    </>
  );
}
