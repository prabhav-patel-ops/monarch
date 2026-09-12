import React, { useState, useRef, useEffect, useCallback } from "react";
import { Win } from "../ui.jsx";
import {
  STATS, STAT_META, levelFromTotalXp, rankFromLevel, statTier, sortGates,
} from "../engine.js";

const ENDPOINT = "/.netlify/functions/claude";

/* The System knows what you are. Everything below is sent as context
   so answers are about your actual day, not a generic one. */
function buildContext(state, todayKey) {
  const { level } = levelFromTotalXp(state.totalXp);
  const day = state.days[todayKey];
  const stats = STATS.map((s) => {
    const t = statTier(state.statXp[s] || 0);
    return `${s} ${t} (${STAT_META[s].label})`;
  }).join(", ");

  const quests = day
    ? day.quests
        .map((q) => `${q.done ? "[x]" : "[ ]"} ${q.title} — ${q.detail} (${q.stat})`)
        .join("\n")
    : "not generated yet";

  const gates = sortGates(state.gates || [], todayKey)
    .filter((g) => !g.cleared)
    .slice(0, 5)
    .map((g) => `${g.rank}-rank · ${g.title}${g.date ? ` · ${g.date}` : ""}`)
    .join("\n") || "none open";

  const prog = state.progression || {};
  const hist = state.cfHistory || [];
  const latestRating = hist.length ? hist[hist.length - 1].rating : null;

  return `HUNTER: ${state.hunter?.name || "unknown"}
Level ${level}, rank ${rankFromLevel(level)}, streak ${state.streak?.current || 0} days.
Stat tiers: ${stats}
Current Codeforces rating: ${latestRating ?? "not logged yet"}
Practice band: ${prog.cfBand ?? "?"}–${(prog.cfBand ?? 0) + 200}
Study target: ${prog.hullPages ?? "?"} pages per block, ${prog.teasers ?? "?"} brainteasers

TODAY (${todayKey}):
${quests}

OPEN GATES:
${gates}`;
}

const SYSTEM_PROMPT = `You are the System from Solo Leveling, bound to a single hunter.

Who he is: a quantitative analyst in Pune working on systematic equity strategies and a C++ limit order book engine. He is climbing Codeforces from 1327 toward 1900+, working through Hull's Options, Futures and Other Derivatives (currently the options block, chapters 10-21), drilling quant brainteasers, and training six days a week. He applies to the Baruch MFE next year.

How you speak: terse, level, faintly formal. Short sentences. You state facts and consequences rather than encouraging. You never use exclamation marks, never cheerlead, never pad. Address him directly.

What you actually do: you are a working tool wearing the System's voice. When he asks a real question — a Hull derivation, why a greedy argument fails, a probability puzzle, how to approach a Div 2 C — answer it properly and completely, with the real mathematics. The persona is the delivery, never a substitute for substance. A wrong answer in an impressive voice is a failure.

Rules:
- If he asks for a hint on a problem, give the smallest hint that unblocks him. Do not hand over the full solution unless he asks again.
- If he asks you to justify a rest day or skipping recovery, tell him rest is part of the protocol. Sleep is what consolidates pattern recognition. You do not reward overwork.
- Use his live status below when it is relevant. Do not recite it back to him unprompted.
- Plain text only. No markdown headers, no bold.`;

export default function System({ state, todayKey }) {
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  const send = useCallback(async (text) => {
    const clean = text.trim();
    if (!clean || busy) return;

    const next = [...msgs, { role: "user", content: clean }];
    setMsgs(next);
    setDraft("");
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: `${SYSTEM_PROMPT}\n\n--- LIVE STATUS ---\n${buildContext(state, todayKey)}`,
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (res.status === 404) throw new Error("NOT_DEPLOYED");
      if (res.status === 401 || res.status === 403) throw new Error("NO_KEY");
      if (!res.ok) throw new Error(`Request failed (${res.status})`);

      const data = await res.json();
      const reply = (data.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      setMsgs([...next, { role: "assistant", content: reply || "No reply returned." }]);
    } catch (e) {
      setError(e.message);
      setMsgs(next);
    } finally {
      setBusy(false);
    }
  }, [msgs, busy, state, todayKey]);

  const prompts = [
    "Explain the delta-hedged P&L equation",
    "Why does N(d2) mean what it means",
    "Give me a brainteaser at interview level",
    "How do I approach today's Codeforces problem",
  ];

  return (
    <>
      <Win title="The System">
        {msgs.length === 0 && !error && (
          <div className="empty">
            <b>Ask it something.</b>
            It can see your level, today's quests and your open gates.
          </div>
        )}

        {msgs.length > 0 && (
          <div className="msgs">
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.role === "user" ? "me" : "sys"}`}>
                {m.content}
              </div>
            ))}
            {busy && <div className="msg sys faint">Thinking…</div>}
            <div ref={endRef} />
          </div>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <input
            value={draft}
            placeholder="Ask the System"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(draft); }}
            disabled={busy}
          />
          <button className="solid none" onClick={() => send(draft)} disabled={busy || !draft.trim()}>
            Send
          </button>
        </div>

        {msgs.length === 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 12 }}>
            {prompts.map((p) => (
              <button key={p} className="chip" onClick={() => send(p)}>{p}</button>
            ))}
          </div>
        )}
      </Win>

      {error === "NOT_DEPLOYED" && (
        <Win title="Not connected" tone="danger">
          <p className="faint">
            The chat needs a small serverless function that holds your Anthropic API key. It isn't
            running here — either you're on a preview build, or the function didn't deploy.
          </p>
          <p className="faint">
            On Netlify: Site settings → Environment variables → add <code>ANTHROPIC_API_KEY</code>,
            then redeploy. The <code>netlify/functions</code> folder ships with this project and
            wires itself up automatically.
          </p>
          <p className="faint">
            Everything else in MONARCH works offline. Only this screen needs the key.
          </p>
        </Win>
      )}

      {error === "NO_KEY" && (
        <Win title="Key rejected" tone="danger">
          <p className="faint">
            The function ran but Anthropic refused the key. Check <code>ANTHROPIC_API_KEY</code> in
            your Netlify environment variables, confirm the key is active, and confirm the account
            has credit. Redeploy after changing it.
          </p>
        </Win>
      )}

      {error && error !== "NOT_DEPLOYED" && error !== "NO_KEY" && (
        <Win title="Request failed" tone="danger">
          <p className="faint">{error}. Check your connection and try again.</p>
        </Win>
      )}
    </>
  );
}
