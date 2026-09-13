import React, { useState, useRef } from "react";
import { Win } from "../ui.jsx";
import { ShadowSoldier } from "../art.jsx";
import { STATS, STAT_META, RATCHET_RULES, DIFFICULTY } from "../engine.js";
import { SHADOW_PRESETS } from "../data.js";
import { exportJson } from "../store.js";
import { saveFile } from "../download.js";

export default function Shadows({
  state, onExtract, onDismiss, onSettings, onImport, onReset, onRestoreRecovery,
  onProgression, backupStatus = {},
}) {
  const [name, setName] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [stat, setStat] = useState("INT");
  const [bonus, setBonus] = useState(5);
  const fileRef = useRef(null);

  const shadows = state.shadows || [];

  /* The one button in the app that must never fail quietly: if the save did
     not happen, say so, because the whole point of it is being able to trust
     that it ran. */
  const download = async () => {
    const name = `monarch-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const r = await saveFile(exportJson(state), name, "application/json");
    setSaveNote(r.ok
      ? r.verified ? `Verified saved ${name}` : `Download started for ${name}; check Files or Downloads.`
      : r.reason);
  };

  const downloadDamaged = async () => {
    const name = `monarch-damaged-${new Date().toISOString().slice(0, 10)}.txt`;
    const result = await saveFile(backupStatus.damagedRaw, name, "text/plain;charset=utf-8");
    setSaveNote(result.ok
      ? result.verified ? `Verified saved ${name}` : `Download started for ${name}; check Files or Downloads.`
      : result.reason);
  };

  const upload = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      try {
        await onImport(String(r.result));
      } catch (err) {
        alert(err.message);
      }
    };
    r.readAsText(f);
    e.target.value = "";
  };

  return (
    <>
      <Win tone="accent" title="Shadow army" right={`${shadows.length} extracted`}>
        <p className="faint" style={{ marginTop: 0 }}>
          Every project you finish becomes a shadow and pays a permanent bonus to the stat it trained.
          Extraction is for shipped work — something that runs, not something started.
        </p>
        {shadows.length === 0 && <div className="empty">No shadows yet. Ship something.</div>}
        {shadows.map((s) => (
          <div className="gate mn-rise" key={s.id}>
            <ShadowSoldier size={30} className="mn-shadow-figure" />
            <div className="gate-rank" style={{ background: STAT_META[s.stat].color }}>{s.stat[0]}</div>
            <div className="gate-body">
              <div className="gate-name">{s.name}</div>
              <div className="gate-when">
                Extracted {s.date} · +{s.bonus}% {s.stat} experience
              </div>
            </div>
            <button className="ghost none" style={{ padding: "5px 9px", fontSize: 10 }} onClick={() => onDismiss(s.id)}>
              Dismiss
            </button>
          </div>
        ))}
      </Win>

      <Win title="Extract a shadow">
        <label className="field">
          <span>What did you finish</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Delta-hedging simulator" />
        </label>
        <div className="pill-row" style={{ marginBottom: 12 }}>
          {SHADOW_PRESETS.map((p) => (
            <button key={p.name} className="pill" onClick={() => { setName(p.name); setStat(p.stat); setBonus(p.bonus); }}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="row">
          <label className="field">
            <span>Stat</span>
            <select value={stat} onChange={(e) => setStat(e.target.value)}>
              {STATS.map((s) => <option key={s} value={s}>{s} — {STAT_META[s].label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Bonus %</span>
            <input type="number" min="1" max="15" value={bonus} onChange={(e) => setBonus(parseInt(e.target.value, 10) || 1)} />
          </label>
        </div>
        <button
          className="solid"
          style={{ width: "100%" }}
          onClick={() => {
            if (!name.trim()) return;
            onExtract({ id: `s_${Date.now()}`, name: name.trim(), stat, bonus: Math.min(15, Math.max(1, bonus)) });
            setName("");
          }}
        >
          Arise
        </button>
      </Win>

      <Win title="Difficulty">
        <p className="faint" style={{ marginTop: 0 }}>
          Each stat steps up after {state.settings.ratchetStreak} clean runs in a row. Raise the streak to slow it down.
        </p>
        <label className="field">
          <span>Clean runs before a step up</span>
          <input
            type="number" min="2" max="20"
            value={state.settings.ratchetStreak}
            onChange={(e) => onSettings({ ratchetStreak: Math.max(2, Math.min(20, parseInt(e.target.value, 10) || 5)) })}
          />
        </label>
        {Object.entries(RATCHET_RULES).map(([s, rule]) => (
          <div className="kv" key={s}>
            <span style={{ color: STAT_META[s].color }}>{s} · {rule.field}</span>
            <b>
              {state.progression[rule.field]} {rule.unit}
              <button className="ghost" style={{ padding: "0 7px", marginLeft: 8, fontSize: 11, clipPath: "none" }}
                onClick={() => onProgression(rule.field, Math.max(0, state.progression[rule.field] - rule.step))}>−</button>
              <button className="ghost" style={{ padding: "0 7px", fontSize: 11, clipPath: "none" }}
                onClick={() => onProgression(rule.field, Math.min(rule.cap, state.progression[rule.field] + rule.step))}>+</button>
            </b>
          </div>
        ))}
      </Win>

      <Win title="Targets">
        {[["protein", "Protein target g"], ["proteinTick", "Protein floor g"], ["kcal", "Calories"], ["water", "Water L"]].map(([k, label]) => (
          <label className="field" key={k}>
            <span>{label}</span>
            <input
              type="number" step={k === "water" ? "0.1" : "1"}
              value={state.settings.targets[k]}
              onChange={(e) => onSettings({ targets: { ...state.settings.targets, [k]: parseFloat(e.target.value) || 0 } })}
            />
          </label>
        ))}
        <label className="field">
          <span>Sound on quest completion</span>
          <select value={state.settings.soundOn ? "on" : "off"} onChange={(e) => onSettings({ soundOn: e.target.value === "on" })}>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>
      </Win>

      <Win tone="accent" title="Difficulty" right={DIFFICULTY[state.settings.difficulty || "normal"].label}>
        <p className="faint" style={{ marginTop: 0 }}>
          This is not a label. It changes the bar a day has to clear, what a shortfall costs, and how many clean days
          it takes to work off a lapse. Changing it re-grades your whole history — the log is the same, the standard
          it is measured against is not.
        </p>
        <div className="pill-row" style={{ marginBottom: 10 }}>
          {Object.values(DIFFICULTY).map((d) => (
            <button
              key={d.key}
              className="pill"
              data-on={(state.settings.difficulty || "normal") === d.key}
              onClick={() => onSettings({ difficulty: d.key })}
            >
              {d.label}
            </button>
          ))}
        </div>
        <p className="faint" style={{ marginBottom: 0 }}>
          {DIFFICULTY[state.settings.difficulty || "normal"].blurb}
        </p>
      </Win>

      <Win title="Readouts">
        <p className="faint" style={{ marginTop: 0 }}>
          Totals on: the lifetime figure and the xp left in this level are both on screen. Totals off: the day still
          shows its own numbers, but the running totals behind it stay out of the way.
        </p>
        <div className="pill-row">
          <button className="pill" data-on={state.settings.showNumbers} onClick={() => onSettings({ showNumbers: true })}>
            Show totals
          </button>
          <button className="pill" data-on={!state.settings.showNumbers} onClick={() => onSettings({ showNumbers: false })}>
            Today only
          </button>
        </div>
      </Win>

      <Win title="Backup">
        <p className="faint" style={{ marginTop: 0 }}>
          Everything stays on this device. Recovery checkpoints use IndexedDB; exported files carry a checksum and
          lineage so identical, older, fast-forward and divergent imports are handled explicitly.
        </p>
        <div className="kv">
          <span>Durable browser storage</span>
          <b>{backupStatus.persistenceStatus === "granted" ? "Granted" : backupStatus.persistenceStatus === "denied" ? "Not granted" : "Unavailable"}</b>
        </div>
        {backupStatus.writeBlocked && (
          <p className="faint" style={{ color: "var(--gold)" }}>
            Writes are paused to protect a corrupt or newer save. Restore a checkpoint or reload before editing.
          </p>
        )}
        {backupStatus.damagedRaw && (
          <button className="ghost" style={{ width: "100%", marginBottom: 10 }} onClick={downloadDamaged}>
            Export damaged save for recovery
          </button>
        )}
        <div className="row">
          <button className="ghost" onClick={download}>Export</button>
          <button className="ghost" onClick={() => fileRef.current?.click()}>Import</button>
        </div>
        {saveNote && (
          <p className="faint" style={{ margin: "8px 0 0", color: saveNote.startsWith("Verified") ? "var(--agi)" : "var(--gold)" }}>
            {saveNote}
          </p>
        )}
        <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={upload} />
        <button className="ghost" style={{ width: "100%", marginTop: 10 }} onClick={onRestoreRecovery}>
          Restore latest checkpoint
        </button>
        <p className="faint" style={{ marginBottom: 0 }}>
          Clearing site data, changing origin/host, private browsing, or reinstalling the PWA can remove both the live
          save and local checkpoints. Keep an exported file elsewhere. Device time is informational; branch order uses
          revision ancestry, not clocks. Photos remain separate and are never embedded in <code>monarch.v1</code>.
        </p>
        <button
          className="danger"
          style={{ width: "100%", marginTop: 10 }}
          onClick={() => {
            if (confirm("Erase every quest, stat and log on this device? A recovery checkpoint will be kept when storage allows.")) onReset();
          }}
        >
          Erase everything
        </button>
      </Win>
    </>
  );
}
