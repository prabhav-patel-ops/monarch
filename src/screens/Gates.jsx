import React, { useState } from "react";
import { Win } from "../ui.jsx";
import { GateSigil } from "../art.jsx";
import { GATE_RANKS, gateStatus, sortGates, daysBetween, parseKey } from "../engine.js";
import { MISSION } from "../data.js";

const STATUS_LABEL = {
  open: "Open now",
  imminent: "Opening soon",
  dormant: "Dormant",
  collapsed: "Collapsed",
  cleared: "Cleared",
};

const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function when(dateKey, todayKey) {
  const d = parseKey(dateKey);
  const diff = daysBetween(todayKey, dateKey);
  const label = `${d.getDate()} ${MO[d.getMonth()]} ${d.getFullYear()}`;
  if (diff === 0) return `${label} — today`;
  if (diff > 0) return `${label} — ${diff} day${diff === 1 ? "" : "s"} out`;
  return `${label} — ${-diff} day${diff === -1 ? "" : "s"} ago`;
}

export default function Gates({ state, todayKey, onAddGate, onClearGate, onDeleteGate, onLogRating }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", rank: "C", date: todayKey, note: "" });
  const [rating, setRating] = useState("");

  const gates = sortGates(state.gates || [], todayKey);

  const submit = () => {
    if (!form.name.trim()) return;
    onAddGate({ ...form, id: `g_${Date.now()}`, cleared: false });
    setForm({ name: "", rank: "C", date: todayKey, note: "" });
    setAdding(false);
  };

  const submitRating = () => {
    const n = parseInt(rating, 10);
    if (!Number.isFinite(n) || n < 0 || n > 4000) return;
    onLogRating(n);
    setRating("");
  };

  return (
    <>
      <Win tone="accent" title="Gates" right={`${gates.filter((g) => !g.cleared).length} standing`}>
        {gates.length === 0 && <div className="empty">No gates. Add contests, deadlines and interviews as they land.</div>}
        {gates.map((g) => {
          const st = gateStatus(g, todayKey);
          return (
            <div className="gate mn-rise" data-status={st} key={g.id}>
              <GateSigil rank={g.rank} size={34} className="mn-gate-sigil" />
              <div className="gate-rank" data-rank={g.rank}>{g.rank}</div>
              <div className="gate-body">
                <div className="gate-name">{g.name}</div>
                <div className="gate-when">
                  {when(g.date, todayKey)} · {STATUS_LABEL[st]}
                </div>
                {g.note && <div className="qdetail">{g.note}</div>}
              </div>
              <button
                className="ghost none"
                style={{ padding: "5px 9px", fontSize: 10 }}
                onClick={() => (g.cleared ? onDeleteGate(g.id) : onClearGate(g.id))}
              >
                {g.cleared ? "Remove" : "Clear"}
              </button>
            </div>
          );
        })}

        {!adding ? (
          <button className="ghost" style={{ marginTop: 12, width: "100%" }} onClick={() => setAdding(true)}>
            Add a gate
          </button>
        ) : (
          <div style={{ marginTop: 14, borderTop: "1px solid var(--line-soft)", paddingTop: 12 }}>
            <label className="field">
              <span>What is it</span>
              <input
                value={form.name}
                placeholder="Div 2 Round 1024"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <div className="row">
              <label className="field">
                <span>Date</span>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </label>
              <label className="field">
                <span>Rank</span>
                <select value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value })}>
                  {GATE_RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Note</span>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Optional" />
            </label>
            <div className="row">
              <button className="ghost" onClick={() => setAdding(false)}>Cancel</button>
              <button className="solid" onClick={submit}>Add gate</button>
            </div>
          </div>
        )}
      </Win>

      <Win title="Rating log" right={`Goal ${MISSION.cfGoal}`}>
        <p className="faint" style={{ marginTop: 0 }}>
          Enter your Codeforces rating after each rated round. Practice moves the band; only contests move this.
        </p>
        <div className="row">
          <input
            type="number"
            inputMode="numeric"
            placeholder="1327"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
          />
          <button className="solid none" onClick={submitRating}>Log</button>
        </div>
        {state.cfHistory && state.cfHistory.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {[...state.cfHistory].reverse().slice(0, 8).map((h, i, arr) => {
              const prev = arr[i + 1];
              const delta = prev ? h.rating - prev.rating : null;
              return (
                <div className="kv" key={h.date + i}>
                  <span className="faint">{h.date}</span>
                  <b>
                    {h.rating}
                    {delta != null && (
                      <span style={{ color: delta >= 0 ? "var(--agi)" : "var(--blood)", marginLeft: 8 }}>
                        {delta >= 0 ? "+" : ""}{delta}
                      </span>
                    )}
                  </b>
                </div>
              );
            })}
          </div>
        )}
      </Win>

      <Win title="Gate ranks">
        <div className="qdetail" style={{ lineHeight: 1.7 }}>
          E and D for practice rounds and small checkpoints. C for a rated Div 2.
          B for a milestone that takes months. A for an interview or a shipped project.
          S for the ones that change what happens next.
        </div>
      </Win>
    </>
  );
}
