import React, { useState, useRef, useCallback } from "react";
import { Win } from "../ui.jsx";
import { scanMeal } from "../lib/vision.js";
import { macroTotals } from "../engine.js";

const CONF = {
  high: { label: "confident", color: "var(--agi)" },
  medium: { label: "rough", color: "var(--gold)" },
  low: { label: "guess", color: "var(--blood)" },
};

export default function ScanMeal({ todayKey, onAddMeal, flash = () => {} }) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);   // { items, note }
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const onFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      const result = await scanMeal(file);
      if (!result.items.length) {
        setError(result.note === "not a meal" ? "NOT_FOOD" : "NOTHING_FOUND");
      } else {
        setDraft(result);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const nudge = (i, factor) =>
    setDraft((d) => {
      const items = d.items.map((it, j) => {
        if (j !== i) return it;
        const num = parseFloat(it.qty) || 1;
        const unit = it.qty.replace(/^[\d.]+\s*/, "");
        const next = Math.max(0.1, +(num * factor).toFixed(2));
        const r = next / num;
        return {
          ...it,
          qty: `${next} ${unit}`,
          kcal: Math.round(it.kcal * r),
          protein: +(it.protein * r).toFixed(1),
          carbs: +(it.carbs * r).toFixed(1),
          fat: +(it.fat * r).toFixed(1),
          confidence: "high", // corrected by hand
        };
      });
      return { ...d, items };
    });

  const drop = (i) =>
    setDraft((d) => {
      const items = d.items.filter((_, j) => j !== i);
      return items.length ? { ...d, items } : null;
    });

  const logAll = () => {
    draft.items.forEach((it) =>
      onAddMeal(todayKey, {
        name: it.name,
        qty: it.qty,
        kcal: it.kcal,
        protein: it.protein,
        carbs: it.carbs,
        fat: it.fat,
      })
    );
    flash(`${draft.items.length} item${draft.items.length === 1 ? "" : "s"} logged`);
    setDraft(null);
  };

  const totals = draft ? macroTotals(draft.items) : null;

  return (
    <Win title="Scan a meal" right={busy ? "reading…" : undefined}>
      {!draft && !busy && (
        <>
          <p className="faint" style={{ marginTop: 0 }}>
            Photograph the plate before you eat. You get a draft to correct, not a log entry —
            a photo identifies food well and judges portion size badly, so check the amounts.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFile}
            style={{ display: "none" }}
          />
          <button className="solid" style={{ width: "100%" }} onClick={() => fileRef.current?.click()}>
            Take a photo
          </button>
        </>
      )}

      {busy && <div className="empty">Reading the plate…</div>}

      {draft && (
        <>
          {draft.items.map((it, i) => (
            <div key={i} style={{ borderBottom: "1px solid var(--line-soft)", padding: "10px 0" }}>
              <div className="kv">
                <span style={{ fontWeight: 600 }}>{it.name}</span>
                <b className="faint" style={{ color: CONF[it.confidence]?.color }}>
                  {CONF[it.confidence]?.label}
                </b>
              </div>
              <div className="kv">
                <span className="faint">{it.qty}</span>
                <b className="faint">
                  {it.kcal} kcal · {it.protein} g protein
                </b>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="pill" onClick={() => nudge(i, 0.5)}>half</button>
                <button className="pill" onClick={() => nudge(i, 0.8)}>−20%</button>
                <button className="pill" onClick={() => nudge(i, 1.25)}>+25%</button>
                <button className="pill" onClick={() => nudge(i, 2)}>double</button>
                <button className="pill" onClick={() => drop(i)}>remove</button>
              </div>
              {it.source === "estimate" && (
                <p className="faint" style={{ margin: "6px 0 0" }}>
                  Not in the food list, so these macros are estimated too.
                </p>
              )}
            </div>
          ))}

          <div className="kv" style={{ marginTop: 12 }}>
            <span style={{ fontWeight: 600 }}>Total</span>
            <b>{Math.round(totals.kcal)} kcal · {totals.protein.toFixed(1)} g protein</b>
          </div>

          {draft.note && <p className="faint">{draft.note}</p>}

          <div className="row" style={{ marginTop: 12 }}>
            <button className="ghost" onClick={() => setDraft(null)}>Discard</button>
            <button className="solid" onClick={logAll}>Log these</button>
          </div>
        </>
      )}

      {error === "NOT_DEPLOYED" && (
        <p className="faint">
          Scanning needs the serverless function that holds your API key. It isn't running on this
          deploy — see the README. Manual food search below works regardless.
        </p>
      )}
      {error === "NO_KEY" && (
        <p className="faint">
          The function ran but the key was rejected. Check <code>ANTHROPIC_API_KEY</code> in your
          Netlify environment variables.
        </p>
      )}
      {error === "NOT_FOOD" && <p className="faint">That doesn't look like a meal. Try again.</p>}
      {error === "NOTHING_FOUND" && (
        <p className="faint">Nothing identifiable. A flatter angle with the whole plate in frame reads better.</p>
      )}
      {error && !["NOT_DEPLOYED", "NO_KEY", "NOT_FOOD", "NOTHING_FOUND"].includes(error) && (
        <p className="faint">{error}</p>
      )}
    </Win>
  );
}
