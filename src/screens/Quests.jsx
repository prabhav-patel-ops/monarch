import React, { useState, useMemo } from "react";
import { Win, Ico } from "../ui.jsx";
import {
  DIFFICULTY, STAT_META, dayAvailableXp, dayEarnedXp, isDayCleared,
  dayExtras, rawExtraXp, extraCeiling, dayExtraXp, sideXp,
  SIDE_SIGNIFICANCE, significanceOf,
  CLEAR_THRESHOLD, shiftKey, parseKey, STATS,
  gradeDay, dayPenalty, escalationAt, projectedPenalty,
} from "../engine.js";

const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pretty(k) {
  const d = parseKey(k);
  return `${WD[d.getDay()]} ${d.getDate()} ${MO[d.getMonth()]}`;
}

/* ---------------- side quests ----------------
   Work that was not on the board. Priced by significance first and duration
   second, and capped for the day, so it supplements the board rather than
   becoming a way around it. */

function SideQuests({ day, viewKey, isToday, onAddExtra, onRemoveExtra }) {
  const [title, setTitle] = useState("");
  const [stat, setStat] = useState("INT");
  const [sig, setSig] = useState("useful");
  const [mins, setMins] = useState(60);
  const [open, setOpen] = useState(false);

  const extras = dayExtras(day);
  const raw = rawExtraXp(day);
  const ceiling = extraCeiling(day);
  const credited = dayExtraXp(day);
  const capped = raw > ceiling;

  const preview = useMemo(() => sideXp(sig, mins), [sig, mins]);
  const canAdd = title.trim().length > 0;

  const add = () => {
    if (!canAdd) return;
    onAddExtra(viewKey, { title, stat, sig, mins });
    setTitle("");
    setMins(60);
    setOpen(false);
  };

  return (
    <Win title="Side quests" right={credited ? `+${credited} xp` : `${extras.length || "none"}`}>
      {extras.length === 0 && !open && (
        <p className="faint" style={{ marginTop: 0 }}>
          Anything real you did that the board did not ask for. Worth less than a board quest, and never counted
          against the day you are being graded on.
        </p>
      )}

      {extras.map((x) => (
        <div className="kv" key={x.id}>
          <span>
            {x.title}
            <span className="faint" style={{ fontSize: 10, marginLeft: 6 }}>
              {significanceOf(x.sig).label.toLowerCase()} · {x.mins} min
            </span>
          </span>
          <b style={{ color: STAT_META[x.stat].color }}>
            +{x.xp}
            {isToday && (
              <button
                className="ghost"
                style={{ padding: "0 6px", marginLeft: 8, fontSize: 10, clipPath: "none" }}
                onClick={() => onRemoveExtra(viewKey, x.id)}
                aria-label={`Remove ${x.title}`}
              >
                ×
              </button>
            )}
          </b>
        </div>
      ))}

      {capped && (
        <p className="faint" style={{ color: "var(--gold)", marginBottom: 0, marginTop: 8 }}>
          {raw} logged, {credited} credited. Side work stops at a quarter of the board — past that, the board is what
          needs doing.
        </p>
      )}

      {isToday && !open && (
        <button className="ghost" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>+ Log something</button>
      )}

      {isToday && open && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--line-soft)", paddingTop: 12 }}>
          <input
            autoFocus
            placeholder="Demat and mutual fund portfolio analysis"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          />

          <div className="faint" style={{ fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", margin: "12px 0 5px" }}>
            What it moves
          </div>
          <div className="pill-row">
            {SIDE_SIGNIFICANCE.map((o) => (
              <button key={o.key} className="pill" data-on={sig === o.key} onClick={() => setSig(o.key)}>{o.label}</button>
            ))}
          </div>
          <p className="faint" style={{ fontSize: 10, margin: "5px 0 0" }}>{significanceOf(sig).hint}</p>

          <div className="faint" style={{ fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", margin: "12px 0 5px" }}>
            Which stat
          </div>
          <div className="pill-row">
            {STATS.map((st) => (
              <button key={st} className="pill" data-on={stat === st} onClick={() => setStat(st)}>{st}</button>
            ))}
          </div>

          <div className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
            <label className="field" style={{ flex: 1 }}>
              <span>Minutes</span>
              <input
                type="number" min="0" max="600" step="5" value={mins}
                onChange={(e) => setMins(Math.max(0, Math.min(600, +e.target.value || 0)))}
              />
            </label>
            <div style={{ flex: 1, textAlign: "right" }}>
              <div className="stat-num" style={{ fontSize: 26, color: "var(--agi)" }}>+{preview}</div>
              <div className="faint" style={{ fontSize: 10 }}>xp for this</div>
            </div>
          </div>

          <p className="faint" style={{ fontSize: 10, margin: "8px 0 0" }}>
            Significance sets the price. Time barely moves it — otherwise the way to level up would be to work slowly.
          </p>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="ghost" onClick={() => { setOpen(false); setTitle(""); }}>Cancel</button>
            <button className="solid none" disabled={!canAdd} onClick={add}>Log it</button>
          </div>
        </div>
      )}
    </Win>
  );
}

export default function Quests({ state, todayKey, onToggle, onExcuse, onAddExtra, onRemoveExtra }) {
  const [viewKey, setViewKey] = useState(todayKey);
  const day = state.days[viewKey];
  const isToday = viewKey === todayKey;
  const isFuture = viewKey > todayKey;

  if (!day) {
    return (
      <Win title="Quest board" right={pretty(viewKey)}>
        <div className="empty">
          {isFuture
            ? "Tomorrow's quests are written the morning they begin."
            : "No log for this day."}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="ghost" onClick={() => setViewKey(shiftKey(viewKey, -1))}>Earlier</button>
          <button className="ghost" onClick={() => setViewKey(todayKey)}>Today</button>
        </div>
      </Win>
    );
  }

  const avail = dayAvailableXp(day);
  const earned = dayEarnedXp(day);
  const pct = avail ? (earned / avail) * 100 : 0;
  const cleared = isDayCleared(day, state.settings.difficulty);
  const normal = day.quests.filter((q) => !q.penalty).sort((a, b) => a.slot - b.slot);
  const penalties = day.quests.filter((q) => q.penalty);
  const mode = state.settings.difficulty;
  const numbers = state.settings.showNumbers;
  const grade = gradeDay(day, mode);
  const esc = escalationAt(state.days, viewKey, isToday ? viewKey : null, mode);
  const charge = dayPenalty(day, esc.multiplier, DIFFICULTY[mode || "normal"].depth, mode);
  const owed = charge.byStat;
  const owedTotal = charge.total;

  const QuestRow = ({ q }) => (
    <div
      className="quest"
      data-done={q.done}
      role="checkbox"
      aria-checked={q.done}
      tabIndex={0}
      onClick={() => !isFuture && onToggle(viewKey, q.id)}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !isFuture) {
          e.preventDefault();
          onToggle(viewKey, q.id);
        }
      }}
    >
      <div className="qbox"><Ico.check /></div>
      <div className="qbody">
        <div className="qtitle">{q.title}</div>
        {q.detail && <div className="qdetail">{q.detail}</div>}
        <div className="qmeta">
          <span className="chip" style={{ color: STAT_META[q.stat].color }}>{q.stat}</span>
          {q.penalty && <span className="chip chip--pen">Penalty</span>}
          <span className="qxp">{q.xp} xp</span>
          {!q.done && !isFuture && (
            <button
              className="ghost"
              style={{ padding: "1px 7px", fontSize: 10, clipPath: "none" }}
              onClick={(e) => { e.stopPropagation(); onExcuse(viewKey, q.id); }}
            >
              Excuse
            </button>
          )}
          {q.excused && <span className="qxp" style={{ color: "var(--text-faint)" }}>excused</span>}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <Win tone={cleared ? "accent" : undefined} title="Daily quest" right={pretty(viewKey)}>
        <div className="xp-row">
          <div className="xp-level stat-num" style={{ fontSize: 26, color: cleared ? "var(--rune)" : "var(--text)" }}>
            {earned}
            <span style={{ fontSize: 14, color: "var(--text-faint)" }}> / {avail} xp</span>
          </div>
          <div className="xp-frac">
            {cleared ? "Day cleared" : `${Math.round(CLEAR_THRESHOLD * 100 - pct)}% to clear`}
          </div>
        </div>
        <div className="bar"><i style={{ width: `${pct}%` }} /></div>

        <div style={{ marginTop: 12 }}>
          {normal.map((q) => <QuestRow key={q.id} q={q} />)}
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <button className="ghost" onClick={() => setViewKey(shiftKey(viewKey, -1))}>Earlier</button>
          {!isToday && <button className="ghost" onClick={() => setViewKey(todayKey)}>Today</button>}
          <button className="ghost" onClick={() => setViewKey(shiftKey(viewKey, 1))} disabled={viewKey >= todayKey}>
            Later
          </button>
        </div>
      </Win>

      {penalties.length > 0 && (
        <Win tone="danger" title="Penalty quests" right={`${penalties.length} carried over`}>
          <p className="faint" style={{ marginTop: 0 }}>
            Left undone yesterday. Worth one and a half times face value if you clear them today.
          </p>
          {penalties.map((q) => <QuestRow key={q.id} q={q} />)}
        </Win>
      )}

      {isToday && owedTotal > 0 && (
        <Win title="At stake" tone="danger" right={`${grade.needed} xp short`}>
          <p className="faint" style={{ marginTop: 0 }}>
            {grade.needed} xp short of clearing the day — {Math.round(grade.ratio * 100)}% of the{" "}
            {Math.round(grade.bar * 100)}% you need. If it ended now it would cost {owedTotal} xp,{" "}
            {charge.days} days of work
            {esc.multiplier > 1 && ` at ${esc.multiplier.toFixed(2)}× escalation`}. Clear the day and it costs
            nothing at all.
          </p>
          {esc.effective > 0 && (
            <p className="faint">
              {esc.lapses} lapse{esc.lapses === 1 ? "" : "s"} in the last fortnight
              {esc.forgiven > 0 && `, ${esc.forgiven} forgiven by clean days`}.
              {esc.multiplier >= 6 && " Escalation is capped."}
            </p>
          )}
        </Win>
      )}

      {!isToday && !isFuture && owedTotal > 0 && (
        <Win title="Charged" tone="danger" right={`−${charge.days} days`}>
          <p className="faint" style={{ marginTop: 0 }}>
            Closed at {Math.round(grade.ratio * 100)}%, under the {Math.round(grade.bar * 100)}% bar, at{" "}
            {esc.multiplier.toFixed(2)}× escalation.
            That cost {owedTotal} xp, or {charge.days} days of work.
          </p>
          {STATS.filter((s) => owed[s] > 0).map((s) => (
            <div className="kv" key={s}>
              <span style={{ color: STAT_META[s].color }}>{s}</span>
              <b className="flagged">−{owed[s]}</b>
            </div>
          ))}
        </Win>
      )}

      {day && (
        <SideQuests
          day={day}
          viewKey={viewKey}
          isToday={isToday}
          onAddExtra={onAddExtra}
          onRemoveExtra={onRemoveExtra}
        />
      )}

      {isToday && state.lastRatchet?.date === todayKey && state.lastRatchet.items?.length > 0 && (
        <Win tone="gold" title="Difficulty raised">
          {state.lastRatchet.items.map((r, i) => (
            <div className="kv" key={i}>
              <span style={{ color: STAT_META[r.stat].color }}>{r.stat}</span>
              <b>{r.from} → {r.to} {r.unit}</b>
            </div>
          ))}
          <p className="faint" style={{ marginBottom: 0, marginTop: 8 }}>
            Five clean runs in a row. The System raised the bar. Adjust the rate in settings if it moved too fast.
          </p>
        </Win>
      )}
    </>
  );
}
