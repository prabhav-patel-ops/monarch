import React, { useState, useMemo } from "react";
import { Win, Spark } from "../ui.jsx";
import { FOODS, TRAINING, MISSION } from "../data.js";
import { macroTotals, scaleFood, parseKey, smooth, daysBetween, progressionFor, sessionComplete } from "../engine.js";
import ScanMeal from "./ScanMeal.jsx";

const MULTS = [0.5, 1, 1.5, 2, 3];

/* ---------------- Train ---------------- */

const CHANGE = {
  up: { mark: "▲", color: "var(--agi)", label: "Move up" },
  hold: { mark: "=", color: "var(--gold)", label: "Hold" },
  down: { mark: "▼", color: "#ff7a4a", label: "Back off" },
  seed: { mark: "•", color: "var(--text-faint)", label: "Baseline" },
  unknown: { mark: "?", color: "var(--text-faint)", label: "Needs numbers" },
};

/* A number field that keeps its own text while it is being typed. Parsing on
   every keystroke and writing the result straight back would swallow a
   half-typed decimal, so the string stays local and only the parsed value is
   committed. */
function NumCell({ value, onCommit, placeholder, step = 1, width = 58 }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [typing, setTyping] = useState(false);
  const [seen, setSeen] = useState(value);

  /* Resync to the stored value only while the field is idle. Doing it during
     render rather than in an effect keeps a value changed elsewhere from
     flashing the old text for a frame, and leaves half-typed input alone. */
  if (!typing && value !== seen) {
    setSeen(value);
    setText(value == null ? "" : String(value));
  }
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      placeholder={placeholder}
      value={text}
      onFocus={() => setTyping(true)}
      onBlur={() => setTyping(false)}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const v = parseFloat(raw);
        onCommit(raw.trim() === "" || !isFinite(v) ? null : v);
      }}
      style={{ width, textAlign: "center", padding: "6px 4px", fontSize: 13 }}
    />
  );
}

function targetLine(ex, t) {
  if (!t) return "—";
  if (ex.kind === "cardio") return `${t.min} min · incline ${t.incline} · ${t.speed} km/h`;
  const n = ex.sets;
  if (ex.kind === "hold") return `${n} × ${t.sec}s`;
  if (ex.kind === "reps") return `${n} × ${t.reps}`;
  return `${n} × ${t.reps == null ? "?" : t.reps} @ ${t.kg == null ? "?" : t.kg} kg${ex.unit ? ` ${ex.unit}` : ""}`;
}

function blankSet(ex) {
  if (ex.kind === "hold") return { sec: null };
  if (ex.kind === "reps") return { reps: null };
  return { kg: null, reps: null };
}

function ExerciseCard({ ex, name, entry, suggestion, onSets, onCardio, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const badge = CHANGE[suggestion.change] || CHANGE.hold;
  const target = suggestion.target;

  const commitName = () => {
    setEditing(false);
    if (draftName.trim() && draftName.trim() !== name) onRename(draftName);
    else setDraftName(name);
  };

  /* ---- treadmill ---- */
  if (ex.kind === "cardio") {
    const c = (entry && entry.cardio) || {};
    const patch = (k, v) =>
      onCardio({ min: null, incline: null, speed: null, nonstop: true, ...c, [k]: v });
    return (
      <div className="quest" style={{ display: "block", cursor: "default" }}>
        <div className="qtitle">{name}</div>
        <div className="faint" style={{ fontSize: 11, margin: "4px 0 8px" }}>
          <b style={{ color: badge.color }}>{badge.mark} {targetLine(ex, target)}</b> — {suggestion.reason}
        </div>
        <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Minutes</span>
            <NumCell value={c.min ?? null} step={0.5} placeholder={String(target.min)} onCommit={(v) => patch("min", v)} width="100%" />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Incline</span>
            <NumCell value={c.incline ?? null} step={0.5} placeholder={String(target.incline)} onCommit={(v) => patch("incline", v)} width="100%" />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>km/h</span>
            <NumCell value={c.speed ?? null} step={0.1} placeholder={String(target.speed)} onCommit={(v) => patch("speed", v)} width="100%" />
          </label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="pill" data-on={c.nonstop !== false} onClick={() => patch("nonstop", true)}>Unbroken</button>
          <button className="pill" data-on={c.nonstop === false} onClick={() => patch("nonstop", false)}>Had to stop</button>
          <button
            className="ghost"
            style={{ marginLeft: "auto", fontSize: 10, padding: "4px 8px" }}
            onClick={() => onCardio({ ...target, nonstop: true })}
          >
            Use target
          </button>
        </div>
        {ex.note && <p className="faint" style={{ fontSize: 10, margin: "8px 0 0" }}>{ex.note}</p>}
      </div>
    );
  }

  /* ---- loads, rep work and holds ---- */
  const sets = Array.isArray(entry) ? entry : [];
  const rows = sets.length ? sets : Array.from({ length: ex.sets }, () => blankSet(ex));
  const field = ex.kind === "hold" ? "sec" : "reps";

  const patchSet = (i, k, v) => onSets(rows.map((s, j) => (j === i ? { ...s, [k]: v } : { ...s })));

  const useTarget = () =>
    onSets(
      rows.map((s) => ({
        ...s,
        ...(ex.kind === "load" ? { kg: target.kg ?? s.kg ?? null } : {}),
        [field]: target[field] ?? s[field] ?? null,
      }))
    );

  return (
    <div className="quest" style={{ display: "block", cursor: "default" }}>
      {editing ? (
        <input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitName();
            if (e.key === "Escape") { setDraftName(name); setEditing(false); }
          }}
          style={{ fontSize: 13, padding: "4px 6px" }}
        />
      ) : (
        <div className="qtitle" onClick={() => setEditing(true)} title="Tap to rename" style={{ cursor: "text" }}>
          {name}
          <span className="faint" style={{ fontSize: 10, marginLeft: 6 }}>edit</span>
        </div>
      )}

      <div className="faint" style={{ fontSize: 11, margin: "4px 0 8px" }}>
        <b style={{ color: badge.color }}>{badge.mark} {targetLine(ex, target)}</b> — {suggestion.reason}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        {rows.map((s, i) => (
          <div key={i} className="row" style={{ gap: 8, alignItems: "center" }}>
            <span className="faint" style={{ fontSize: 10, width: 34 }}>Set {i + 1}</span>
            {ex.kind === "load" && (
              <>
                <NumCell value={s.kg ?? null} step={0.5} placeholder="kg" onCommit={(v) => patchSet(i, "kg", v)} />
                <span className="faint" style={{ fontSize: 10 }}>kg{ex.unit ? " ea" : ""}</span>
              </>
            )}
            <NumCell
              value={s[field] ?? null}
              step={ex.kind === "hold" ? 5 : 1}
              placeholder={ex.kind === "hold" ? "sec" : "reps"}
              onCommit={(v) => patchSet(i, field, v)}
            />
            <span className="faint" style={{ fontSize: 10 }}>{ex.kind === "hold" ? "sec" : "reps"}</span>
            {rows.length > 1 && (
              <button
                className="ghost"
                style={{ marginLeft: "auto", padding: "2px 7px", fontSize: 10, clipPath: "none" }}
                onClick={() => onSets(rows.filter((_, j) => j !== i))}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <button className="ghost" style={{ fontSize: 10, padding: "4px 8px" }} onClick={() => onSets([...rows, blankSet(ex)])}>
          + set
        </button>
        <button className="ghost" style={{ fontSize: 10, padding: "4px 8px" }} onClick={useTarget}>
          Use target
        </button>
      </div>
    </div>
  );
}

function LoggedTrain({ state, todayKey, onLogSets, onLogCardio, onRenameExercise, split }) {
  const training = state.body.training || {};
  const log = training[todayKey] || { done: [], sets: {} };
  const names = state.body.exNames || {};

  const cards = useMemo(
    () => split.exercises.map((ex) => ({ ex, ...progressionFor(ex, training, todayKey) })),
    [split, training, todayKey]
  );

  const doneCount = cards.filter(({ ex }) => {
    const entry = (log.sets || {})[ex.key];
    if (ex.kind === "cardio") return !!(entry && entry.cardio && entry.cardio.min != null);
    return sessionComplete(ex, entry);
  }).length;

  const moves = cards.filter((c) => c.suggestion.change === "up").length;
  const headers = cards.map((c, i) => (i === 0 || c.ex.group !== cards[i - 1].ex.group ? c.ex.group : null));

  return (
    <Win tone="accent" title="Strength dungeon" right={split.name}>
      <div className="xp-row">
        <div className="stat-num" style={{ fontSize: 24 }}>
          {doneCount}
          <span style={{ fontSize: 14, color: "var(--text-faint)" }}> / {cards.length}</span>
        </div>
        <div className="xp-frac">
          {moves ? `${moves} lift${moves === 1 ? "" : "s"} earned a step up` : "Logged in full"}
        </div>
      </div>
      <div className="bar">
        <i style={{ width: `${(doneCount / cards.length) * 100}%`, background: "linear-gradient(90deg,#a8442a,#ff7a4a)" }} />
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        {cards.map(({ ex, suggestion }, i) => {
          const header = headers[i];
          return (
            <React.Fragment key={ex.key}>
              {header && (
                <div
                  className="faint"
                  style={{ fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 4 }}
                >
                  {header}
                </div>
              )}
              <ExerciseCard
                ex={ex}
                name={names[ex.key] || ex.name}
                entry={(log.sets || {})[ex.key]}
                suggestion={suggestion}
                onSets={(next) => onLogSets(todayKey, ex.key, next)}
                onCardio={(c) => onLogCardio(todayKey, ex.key, c)}
                onRename={(n) => onRenameExercise(ex.key, n)}
              />
            </React.Fragment>
          );
        })}
      </div>

      <p className="faint" style={{ marginBottom: 0, marginTop: 10 }}>
        Every target is read from what you actually logged last time, never from a plan written in advance. Reps climb
        inside the range at the same load; when every set reaches the top, the load moves one step and the reps reset to
        the bottom. A session that fell short repeats instead. Fill every box — a missing number is treated as a gap in
        the record rather than a zero, and no target is offered until it is there.
      </p>
    </Win>
  );
}

function ChecklistTrain({ state, todayKey, onToggleExercise, split }) {
  const log = state.body.training[todayKey] || { done: [] };
  const doneCount = (log.done || []).length;

  return (
    <Win tone="accent" title="Strength dungeon" right={split.name}>
      <div className="xp-row">
        <div className="stat-num" style={{ fontSize: 24 }}>
          {doneCount}
          <span style={{ fontSize: 14, color: "var(--text-faint)" }}> / {split.items.length}</span>
        </div>
        <div className="xp-frac">{parseKey(todayKey).getDay() === 0 ? "Recovery day" : "Sets logged"}</div>
      </div>
      <div className="bar">
        <i style={{ width: `${(doneCount / split.items.length) * 100}%`, background: "linear-gradient(90deg,#a8442a,#ff7a4a)" }} />
      </div>

      <div style={{ marginTop: 12 }}>
        {split.items.map((item, i) => {
          const on = (log.done || []).includes(i);
          return (
            <div
              key={i}
              className="quest"
              data-done={on}
              onClick={() => onToggleExercise(todayKey, i)}
              role="checkbox"
              aria-checked={on}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleExercise(todayKey, i); }
              }}
            >
              <div className="qbox" style={on ? { background: "#ff7a4a", borderColor: "#ff7a4a" } : undefined}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#060a14" strokeWidth="3.4" strokeLinecap="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <div className="qbody"><div className="qtitle">{item}</div></div>
            </div>
          );
        })}
      </div>
      <p className="faint" style={{ marginBottom: 0, marginTop: 10 }}>
        Tick honestly. If you gave everything and fell short of the target reps, it still counts — note the gap and move on.
      </p>
    </Win>
  );
}

function Train(props) {
  const weekday = parseKey(props.todayKey).getDay();
  const split = TRAINING[weekday];
  return split.exercises ? <LoggedTrain {...props} split={split} /> : <ChecklistTrain {...props} split={split} />;
}

/* ---------------- Fuel ---------------- */

function Fuel({ state, todayKey, onAddMeal, onRemoveMeal, onSetWater, flash }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null);
  const [mult, setMult] = useState(1);

  const meals = state.body.meals[todayKey] || [];
  const totals = macroTotals(meals);
  const t = state.settings.targets;
  const water = state.body.water[todayKey] || 0;

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return FOODS.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query]);

  const preview = picked ? scaleFood(picked, mult) : null;

  const Ring = ({ label, value, target, color }) => {
    const pct = Math.min(100, (value / target) * 100);
    return (
      <div style={{ flex: 1 }}>
        <div className="stat-line" style={{ marginBottom: 3 }}>
          <div className="stat-key" style={{ color, width: "auto", flex: 1, fontSize: 12 }}>{label}</div>
          <div className="stat-num" style={{ fontSize: 13 }}>{Math.round(value)}<span style={{ color: "var(--text-faint)" }}>/{target}</span></div>
        </div>
        <div className="stat-bar"><i style={{ width: `${pct}%`, background: color }} /></div>
      </div>
    );
  };

  return (
    <>
      <Win tone="accent" title="Fuel" right={`${Math.round(totals.kcal)} kcal`}>
        <div style={{ display: "grid", gap: 10 }}>
          <Ring label="Protein g" value={totals.protein} target={t.protein} color="#3fe0a8" />
          <Ring label="Calories" value={totals.kcal} target={t.kcal} color="#6fa8ff" />
          <Ring label="Carbs g" value={totals.carbs} target={230} color="#a98bff" />
          <Ring label="Fat g" value={totals.fat} target={65} color="#ff7a4a" />
        </div>
        {totals.protein >= t.proteinTick && (
          <p className="faint" style={{ color: "var(--agi)", marginBottom: 0, marginTop: 10 }}>
            Protein floor cleared. Tick the quest on the board.
          </p>
        )}
      </Win>

      <Win title="Water" right={`${water.toFixed(1)} of ${t.water} L`}>
        <div className="bar"><i style={{ width: `${Math.min(100, (water / t.water) * 100)}%` }} /></div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="ghost" onClick={() => onSetWater(todayKey, Math.max(0, water - 0.25))}>−250 ml</button>
          <button className="ghost" onClick={() => onSetWater(todayKey, water + 0.25)}>+250 ml</button>
          <button className="ghost" onClick={() => onSetWater(todayKey, water + 1)}>+1 L</button>
        </div>
      </Win>

      <ScanMeal todayKey={todayKey} onAddMeal={onAddMeal} flash={flash} />

      <Win title="Add food">
        <input
          placeholder="Search dal, paneer, whey…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPicked(null); }}
        />
        {results.length > 0 && !picked && (
          <div style={{ marginTop: 10 }}>
            {results.map((f) => (
              <div className="kv" key={f.name} style={{ cursor: "pointer" }} onClick={() => { setPicked(f); setMult(1); }}>
                <span>{f.name}</span>
                <b className="faint">{f.base} {f.unit} · {f.kcal} kcal</b>
              </div>
            ))}
          </div>
        )}
        {picked && (
          <div style={{ marginTop: 12, borderTop: "1px solid var(--line-soft)", paddingTop: 12 }}>
            <div className="qtitle">{picked.name}</div>
            <div className="pill-row" style={{ margin: "10px 0" }}>
              {MULTS.map((m) => (
                <button key={m} className="pill" data-on={mult === m} onClick={() => setMult(m)}>{m}×</button>
              ))}
              <button className="pill" onClick={() => setMult(+(Math.max(0.1, mult - 0.1)).toFixed(1))}>−</button>
              <button className="pill" onClick={() => setMult(+(mult + 0.1).toFixed(1))}>+</button>
            </div>
            <div className="kv"><span>Amount</span><b>{preview.qty}</b></div>
            <div className="kv"><span>Energy</span><b>{preview.kcal} kcal</b></div>
            <div className="kv"><span>Protein</span><b style={{ color: "var(--agi)" }}>{preview.protein} g</b></div>
            <div className="kv"><span>Carbs / fat</span><b>{preview.carbs} / {preview.fat} g</b></div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="ghost" onClick={() => setPicked(null)}>Back</button>
              <button className="solid" onClick={() => { onAddMeal(todayKey, preview); setPicked(null); setQuery(""); }}>
                Add to today
              </button>
            </div>
          </div>
        )}
        {query && results.length === 0 && !picked && (
          <div className="empty">
            Nothing matching. The list covers common Indian vegetarian items — for anything else, add the closest
            match and adjust the multiplier.
          </div>
        )}
      </Win>

      <Win title="Eaten today" right={`${meals.length} item${meals.length === 1 ? "" : "s"}`}>
        {meals.length === 0 && <div className="empty">Nothing logged yet.</div>}
        {meals.map((m, i) => (
          <div className="kv" key={i}>
            <span>{m.name} <span className="faint">{m.qty}</span></span>
            <b>
              {m.kcal} kcal
              <button
                className="ghost"
                style={{ padding: "0 6px", marginLeft: 8, fontSize: 10, clipPath: "none" }}
                onClick={() => onRemoveMeal(todayKey, i)}
              >
                ×
              </button>
            </b>
          </div>
        ))}
      </Win>
    </>
  );
}

/* ---------------- Metrics ---------------- */

function Metrics({ state, todayKey, onLogWeight, onLogWaist, onLogSleep }) {
  const [w, setW] = useState("");
  const [waist, setWaist] = useState("");
  const [from, setFrom] = useState("22:00");
  const [to, setTo] = useState("05:00");

  const weights = state.body.weights || [];
  const waists = state.body.waist || [];
  const sleep = state.body.sleep[todayKey];

  const kgs = weights.map((x) => x.kg);
  const smoothed = kgs.length >= 3 ? smooth(kgs, 7) : null;
  const latest = kgs.length ? kgs[kgs.length - 1] : null;

  const rate = useMemo(() => {
    if (weights.length < 7) return null;
    const first = weights[0];
    const last = weights[weights.length - 1];
    const days = daysBetween(first.date, last.date);
    if (days < 7) return null;
    return +(((first.kg - last.kg) / days) * 7).toFixed(2);
  }, [weights]);

  const hours = useMemo(() => {
    const [fh, fm] = from.split(":").map(Number);
    const [th, tm] = to.split(":").map(Number);
    let mins = th * 60 + tm - (fh * 60 + fm);
    if (mins <= 0) mins += 1440;
    return +(mins / 60).toFixed(1);
  }, [from, to]);

  return (
    <>
      <Win tone="accent" title="Weight" right={latest != null ? `${latest} kg` : "not logged"}>
        {kgs.length >= 2 ? <Spark values={smoothed || kgs} color="#6fa8ff" /> : <div className="empty">Log a few days to draw the trend.</div>}
        <div className="row" style={{ marginTop: 10 }}>
          <input type="number" step="0.1" inputMode="decimal" placeholder="83.4" value={w} onChange={(e) => setW(e.target.value)} />
          <button className="solid none" onClick={() => { const v = parseFloat(w); if (v > 30 && v < 250) { onLogWeight(todayKey, v); setW(""); } }}>
            Save
          </button>
        </div>
        {rate != null ? (
          <div className="kv" style={{ marginTop: 10 }}>
            <span>Seven day rate</span>
            <b style={{ color: rate > 0 ? "var(--agi)" : "var(--text)" }}>
              {rate > 0 ? "−" : "+"}{Math.abs(rate)} kg / week
            </b>
          </div>
        ) : (
          <p className="faint" style={{ marginBottom: 0, marginTop: 10 }}>
            Rate appears once there are seven days of entries. Daily numbers swing on water and salt; the line is what matters.
          </p>
        )}
      </Win>

      <Win title="Waist" right={waists.length ? `${waists[waists.length - 1].cm} cm` : "not logged"}>
        {waists.length >= 2 && <Spark values={waists.map((x) => x.cm)} color="#3fe0a8" />}
        <div className="row" style={{ marginTop: 10 }}>
          <input type="number" step="0.5" inputMode="decimal" placeholder="94" value={waist} onChange={(e) => setWaist(e.target.value)} />
          <button className="solid none" onClick={() => { const v = parseFloat(waist); if (v > 40 && v < 200) { onLogWaist(todayKey, v); setWaist(""); } }}>
            Save
          </button>
        </div>
        <p className="faint" style={{ marginBottom: 0, marginTop: 10 }}>
          At the navel, morning, empty stomach, same day each week, without pulling in. When the scale stalls this keeps moving.
        </p>
      </Win>

      <Win title="Sleep" right={sleep ? `${sleep.hours} h` : "not logged"}>
        <div className="row">
          <label className="field"><span>Lights out</span><input type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field"><span>Awake</span><input type="time" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="xp-row">
          <div className="stat-num" style={{ fontSize: 28, color: hours >= 7 ? "var(--agi)" : "var(--gold)" }}>{hours} h</div>
          <button className="solid none" onClick={() => onLogSleep(todayKey, { from, to, hours })}>Save</button>
        </div>
        <p className="faint" style={{ marginBottom: 0 }}>
          Seven hours is where pattern recognition consolidates. Cutting sleep to add study hours trades away the thing
          the study is meant to build.
        </p>
      </Win>
    </>
  );
}

/* ---------------- shell ---------------- */

export default function Dungeon(props) {
  const [tab, setTab] = useState("train");
  return (
    <>
      <div className="seg">
        {[["train", "Train"], ["fuel", "Fuel"], ["metrics", "Metrics"]].map(([id, label]) => (
          <button key={id} data-on={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === "train" && <Train {...props} />}
      {tab === "fuel" && <Fuel {...props} />}
      {tab === "metrics" && <Metrics {...props} />}
    </>
  );
}
