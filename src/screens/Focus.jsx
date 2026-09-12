import React, { useState, useEffect, useRef, useMemo } from "react";
import { Win, chime } from "../ui.jsx";
import { shiftKey } from "../engine.js";
import { quoteFor } from "../data.js";
import { dailyRemindersIcs, downloadIcs } from "../calendar.js";
import { capabilities, requestNotifications, notify, BLOCKING_REALITY } from "../platform.js";

/* ---------------- focus timer ---------------- */

const PRESETS = [25, 50, 90];

function Timer({ onDone, soundOn }) {
  const [mins, setMins] = useState(50);
  const [left, setLeft] = useState(0);
  const [running, setRunning] = useState(false);
  const endRef = useRef(0);

  /* Count from a wall-clock end time rather than decrementing a counter. A
     background tab is throttled to roughly one tick a minute, so a timer built
     on interval counting silently runs long — the one thing a focus timer
     must never do. */
  useEffect(() => {
    if (!running) return undefined;
    const tick = () => {
      const remaining = Math.max(0, Math.round((endRef.current - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining === 0) {
        setRunning(false);
        if (soundOn) chime("quest");
        notify("Block complete", `${mins} minutes held.`, "focus");
        onDone(mins);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [running, mins, onDone, soundOn]);

  const start = () => { endRef.current = Date.now() + mins * 60000; setLeft(mins * 60); setRunning(true); };
  const stop = () => { setRunning(false); setLeft(0); };

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const pct = running && mins ? 1 - left / (mins * 60) : 0;

  return (
    <Win tone="accent" title="Focus block" right={running ? "sealed" : "idle"}>
      <div className={running ? "mn-sealed" : undefined}>
        <div className="xp-row">
          <div className="stat-num" style={{ fontSize: 40, letterSpacing: 2 }}>{running ? `${mm}:${ss}` : `${mins}:00`}</div>
          <div className="xp-frac">{running ? "in the gate" : "choose a length"}</div>
        </div>
        <div className="bar"><i style={{ width: `${pct * 100}%` }} /></div>
      </div>

      {!running ? (
        <>
          <div className="pill-row" style={{ margin: "12px 0" }}>
            {PRESETS.map((m) => (
              <button key={m} className="pill" data-on={mins === m} onClick={() => setMins(m)}>{m} min</button>
            ))}
          </div>
          <button className="solid none" onClick={start}>Enter the gate</button>
        </>
      ) : (
        <>
          <p className="faint" style={{ margin: "12px 0" }}>
            The app cannot stop you leaving. Nothing can, from inside a web page. What it can do is record that you did.
          </p>
          <button className="ghost" onClick={stop}>Break the block</button>
        </>
      )}
    </Win>
  );
}

/* ---------------- breathing ----------------
   Box breathing, four counts a side. The only reason it is in a discipline app
   is that it is the fastest thing that works when the alternative is opening
   the phone. Four minutes is the whole feature. */

const BOX = [
  { label: "In", secs: 4 }, { label: "Hold", secs: 4 },
  { label: "Out", secs: 4 }, { label: "Hold", secs: 4 },
];

function Breathe() {
  const [on, setOn] = useState(false);
  const [phase, setPhase] = useState(0);
  const [left, setLeft] = useState(BOX[0].secs);
  const [rounds, setRounds] = useState(0);

  useEffect(() => {
    if (!on) return undefined;
    const id = setInterval(() => {
      setLeft((prev) => {
        if (prev > 1) return prev - 1;
        setPhase((ph) => {
          const next = (ph + 1) % BOX.length;
          if (next === 0) setRounds((r) => r + 1);
          setLeft(BOX[next].secs);
          return next;
        });
        return BOX[(phase + 1) % BOX.length].secs;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [on, phase]);

  const step = BOX[phase];
  const expanding = step.label === "In" || (step.label === "Hold" && phase === 1);

  return (
    <Win title="Box breathing" right={rounds ? `${rounds} round${rounds === 1 ? "" : "s"}` : "4-4-4-4"}>
      <div className="mn-breathe" data-on={on} data-expand={expanding}>
        <div className="mn-breathe-orb" />
        <div className="mn-breathe-label">
          <div className="stat-num" style={{ fontSize: 22 }}>{on ? step.label : "Ready"}</div>
          <div className="faint" style={{ fontSize: 11 }}>{on ? `${left}` : "four counts a side"}</div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="solid none" onClick={() => { setOn(!on); if (!on) { setPhase(0); setLeft(BOX[0].secs); } }}>
          {on ? "Stop" : "Start"}
        </button>
        {rounds > 0 && <button className="ghost" onClick={() => setRounds(0)}>Reset count</button>}
      </div>
      <p className="faint" style={{ marginBottom: 0, marginTop: 10 }}>
        Four in, four held, four out, four held. Six rounds is about a minute and a half and is usually enough.
      </p>
    </Win>
  );
}

/* ---------------- the honest blocker ---------------- */

function Leak({ state, todayKey, onLogFocus }) {
  const caps = state.settings.focusCaps || [];
  const today = state.body.focus?.[todayKey] || {};

  const week = useMemo(() => {
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const d = state.body.focus?.[shiftKey(todayKey, -i)] || {};
      total += Object.values(d).reduce((s, v) => s + (Number(v) || 0), 0);
    }
    return total;
  }, [state.body.focus, todayKey]);

  const spent = Object.values(today).reduce((s, v) => s + (Number(v) || 0), 0);
  const capTotal = caps.reduce((s, c) => s + c.cap, 0);

  return (
    <>
      <Win tone={spent > capTotal ? undefined : "accent"} title="Where the day went" right={`${spent} min today`}>
        <p className="faint" style={{ marginTop: 0 }}>
          Log it honestly after the fact. This is the part that actually changes behaviour — not a wall you will route
          around in ten seconds, but a number you have to write down and then look at on the calendar.
        </p>
        {caps.map((c) => {
          const v = Number(today[c.id]) || 0;
          const over = v > c.cap;
          return (
            <div key={c.id} style={{ marginBottom: 10 }}>
              <div className="stat-line" style={{ marginBottom: 3 }}>
                <div className="stat-key" style={{ width: "auto", flex: 1, fontSize: 12, color: over ? "#ff5c5c" : undefined }}>
                  {c.label}
                </div>
                <div className="row" style={{ flex: "0 0 auto", gap: 4 }}>
                  <button className="ghost" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => onLogFocus(todayKey, c.id, Math.max(0, v - 5))}>−5</button>
                  <span className="stat-num" style={{ fontSize: 13, minWidth: 44, textAlign: "center" }}>{v} m</span>
                  <button className="ghost" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => onLogFocus(todayKey, c.id, v + 5)}>+5</button>
                  <button className="ghost" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => onLogFocus(todayKey, c.id, v + 30)}>+30</button>
                </div>
              </div>
              <div className="stat-bar">
                <i style={{ width: `${Math.min(100, (v / Math.max(1, c.cap)) * 100)}%`, background: over ? "#ff5c5c" : "#6fa8ff" }} />
              </div>
              <div className="faint" style={{ fontSize: 10, marginTop: 2 }}>
                cap {c.cap} min{over ? ` · ${v - c.cap} over` : ""}
              </div>
            </div>
          );
        })}
      </Win>

      <Win title="The cost" right={`${Math.round(week / 60)} h this week`}>
        <div className="kv"><span>Last seven days</span><b>{week} min</b></div>
        <div className="kv"><span>Across a year at this rate</span><b>{Math.round((week / 7) * 365 / 60)} h</b></div>
        <div className="kv"><span>Deep work blocks that buys</span><b>{Math.round((week / 7) * 365 / 50)} × 50 min</b></div>
        <p className="faint" style={{ marginBottom: 0, marginTop: 10 }}>
          {quoteFor("focus", todayKey)}
        </p>
      </Win>
    </>
  );
}

/* ---------------- reminders ---------------- */

function Reminders({ state, onReminder, flash }) {
  const caps = capabilities();
  const [perm, setPerm] = useState(caps.notificationState);
  const reminders = state.settings.reminders || [];

  return (
    <>
      <Win tone="accent" title="What can actually reach you">
        <div className="kv">
          <span>Notifications while open</span>
          <b style={{ color: caps.whileOpen ? "var(--agi)" : "var(--gold)" }}>{caps.whileOpen ? "Yes" : "Not granted"}</b>
        </div>
        <div className="kv">
          <span>Alerts while app is closed</span>
          <b style={{ color: "#ff5c5c" }}>No</b>
        </div>
        <div className="kv">
          <span>Calendar export</span>
          <b style={{ color: "var(--agi)" }}>Yes</b>
        </div>
        <p className="faint" style={{ marginTop: 10 }}>{caps.note}</p>

        {caps.needsInstallForNotifications && (
          <p className="faint" style={{ color: "var(--gold)" }}>
            Add this to your Home Screen first: Share → Add to Home Screen. iOS gives a web app no notification API at
            all until you do.
          </p>
        )}
        {caps.notifications && perm !== "granted" && (
          <button
            className="solid none"
            onClick={async () => {
              const r = await requestNotifications();
              setPerm(r);
              if (r === "granted") { notify("System online", "Alerts will reach you while the app is open."); flash("Notifications on"); }
              else flash("Notifications refused");
            }}
          >
            Allow notifications
          </button>
        )}
      </Win>

      <Win title="Daily reminders" right={`${reminders.filter((r) => r.on).length} on`}>
        <p className="faint" style={{ marginTop: 0 }}>
          Set the times here, then export them into the calendar that already rings on your phone — that is what makes
          them fire when the app is shut. Check the first import: iOS sometimes replaces an event alarm with your own
          default alert setting, so confirm the time on one event before trusting the rest.
        </p>
        {reminders.map((r) => (
          <div className="row" key={r.id} style={{ marginBottom: 8, alignItems: "center", gap: 8 }}>
            <button
              className="pill"
              data-on={r.on}
              style={{ flex: "0 0 auto" }}
              onClick={() => onReminder(r.id, { on: !r.on })}
              aria-pressed={r.on}
            >
              {r.on ? "on" : "off"}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="qtitle" style={{ fontSize: 13 }}>{r.title}</div>
              <div className="faint" style={{ fontSize: 10 }}>{r.body}</div>
            </div>
            <input
              type="time"
              value={r.time}
              onChange={(e) => onReminder(r.id, { time: e.target.value })}
              style={{ width: 104, flex: "0 0 auto" }}
            />
          </div>
        ))}
        <button
          className="solid none"
          style={{ marginTop: 8 }}
          onClick={async () => {
            const r = await downloadIcs(dailyRemindersIcs(state.hunter.createdAt || "2026-01-01", reminders), "monarch-daily.ics");
            flash(r.ok ? "Exported — open the file to import" : r.reason);
          }}
        >
          Export to calendar
        </button>
      </Win>
    </>
  );
}

/* ---------------- real blocking ---------------- */

function Blocking() {
  const caps = capabilities();

  return (
    <>
      <Win title="Why there is no block button here">
        <p className="faint" style={{ marginTop: 0 }}>
          {BLOCKING_REALITY.web.why} A button here that claimed to block Instagram would do nothing, and you would
          find that out at the worst possible moment.
        </p>
        <p className="faint">
          {caps.ios
            ? `On iOS it is genuinely possible, but not from this. ${BLOCKING_REALITY.ios.how} ${BLOCKING_REALITY.ios.catch}`
            : "On a phone the operating system owns this, and it will not delegate it to a web page."}
        </p>
      </Win>

      <Win tone="accent" title="Set it up where it works — five minutes">
        <div className="mn-steps">
          <div><b>1</b><div><div className="qtitle">Screen Time → App Limits</div><div className="faint">{BLOCKING_REALITY.stopgap.ios}</div></div></div>
          <div><b>2</b><div><div className="qtitle">Downtime</div><div className="faint">Schedule a hard window over your deep-work block and your sleep. Only what you allow gets through.</div></div></div>
          <div><b>3</b><div><div className="qtitle">Turn off the notifications first</div><div className="faint">A limit you can dismiss loses to a badge that pulls you in. Kill the pull before the wall.</div></div></div>
          <div><b>4</b><div><div className="qtitle">Log the leak here</div><div className="faint">The limit stops the easy half. This screen is for the half that gets through it.</div></div></div>
        </div>
        <p className="faint" style={{ marginBottom: 0 }}>
          When this becomes a native app, Apple's Screen Time frameworks can enforce it from inside MONARCH — the same
          mechanism Opal and one sec use. That needs an entitlement from Apple and a Swift layer. It is on the list.
        </p>
      </Win>
    </>
  );
}

/* ---------------- shell ---------------- */

export default function Focus(props) {
  const [tab, setTab] = useState("focus");
  const soundOn = props.state.settings.soundOn;

  return (
    <>
      <div className="seg">
        {[["focus", "Focus"], ["leak", "Screen time"], ["remind", "Reminders"], ["block", "Blocking"]].map(([id, label]) => (
          <button key={id} data-on={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === "focus" && (
        <>
          <Timer soundOn={soundOn} onDone={(m) => props.flash(`${m} minute block held`)} />
          <Breathe />
          <Win title="What a block is for">
            <p className="faint" style={{ margin: 0 }}>
              One thing, for one stretch, with the phone somewhere else. The timer is not the mechanism — putting the
              phone in another room is. The timer only tells you whether it worked.
            </p>
          </Win>
        </>
      )}
      {tab === "leak" && <Leak {...props} />}
      {tab === "remind" && <Reminders {...props} />}
      {tab === "block" && <Blocking />}
    </>
  );
}
