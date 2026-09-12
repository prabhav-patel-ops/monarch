/* ============================================================
   MONARCH · meal scanning

   A photo tells you reliably WHAT is on the plate and unreliably
   HOW MUCH. Portion size is where nearly all the error lives,
   because a single image has poor scale and depth cues.

   So this module splits the job:
     - the model identifies foods and estimates portions
     - known foods are re-costed from FOODS, which holds real
       numbers, rather than trusting the model's macro guesses
     - everything lands in an editable draft, never straight into
       the log

   The result is still an estimate. It is a good starting point,
   not a measurement.
   ============================================================ */

import { FOODS } from "../data.js";
import { scaleFood } from "../engine.js";

const ENDPOINT = "/.netlify/functions/claude";
const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.8;

/**
 * Downscale and re-encode before upload. A straight iPhone photo is several
 * megabytes; on mobile data that is a slow request for no extra accuracy.
 */
export function prepareImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not a readable image."));
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);

        const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        const base64 = dataUrl.split(",")[1];
        if (!base64) return reject(new Error("Could not encode that image."));
        resolve({ base64, width: w, height: h, bytes: Math.round(base64.length * 0.75) });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const FOOD_NAMES = FOODS.map((f) => f.name).join("\n");

const PROMPT = `You are estimating the contents of a meal from a photograph, for an Indian vegetarian who is tracking protein.

Return ONLY a JSON object. No prose, no markdown, no code fences.

{
  "items": [
    {
      "name": "short food name",
      "match": "exact name from the known list below, or null",
      "portion": 2,
      "unit": "piece",
      "kcal": 208, "protein": 6.2, "carbs": 40, "fat": 2.8,
      "confidence": "high" | "medium" | "low"
    }
  ],
  "note": "one short sentence on what is hardest to judge here, or null"
}

Rules:
- If a food clearly corresponds to an entry in the known list, put that exact string in "match". Its macros will be recalculated from reference data, so your macro numbers for it are a fallback only.
- "portion" and "unit" must describe the amount you actually see: counts for countable items (2 roti, 1 idli), grams or millilitres for served portions. Estimating amount is the hard part — say low confidence when the angle, bowl depth or occlusion makes it a guess.
- Assume home-cooked Indian vegetarian food unless the image clearly shows otherwise. Account for visible cooking oil and ghee.
- If the image is not food, return {"items": [], "note": "not a meal"}.

Known list:
${FOOD_NAMES}`;

/** Pull the first JSON object out of a reply, tolerating stray fencing. */
export function extractJson(text) {
  if (typeof text !== "string") throw new Error("Empty reply.");
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Could not read the estimate.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Re-cost an item against the food library where possible.
 * Library macros are real; only the portion stays an estimate.
 */
export function reconcile(item) {
  const ref = item.match ? FOODS.find((f) => f.name === item.match) : null;
  const portion = Number(item.portion) > 0 ? Number(item.portion) : 1;

  if (ref) {
    const scaled = scaleFood(ref, portion / ref.base);
    return {
      ...scaled,
      name: ref.name,
      source: "library",
      confidence: item.confidence || "medium",
    };
  }

  return {
    name: String(item.name || "Unnamed item").slice(0, 60),
    qty: `${portion} ${item.unit || "serving"}`,
    kcal: Math.max(0, Math.round(Number(item.kcal) || 0)),
    protein: Math.max(0, +(Number(item.protein) || 0).toFixed(1)),
    carbs: Math.max(0, +(Number(item.carbs) || 0).toFixed(1)),
    fat: Math.max(0, +(Number(item.fat) || 0).toFixed(1)),
    source: "estimate",
    confidence: item.confidence || "low",
  };
}

/** Full pipeline: photo in, editable draft rows out. */
export async function scanMeal(file) {
  const { base64 } = await prepareImage(file);

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
  });

  if (res.status === 404) throw new Error("NOT_DEPLOYED");
  if (res.status === 401 || res.status === 403) throw new Error("NO_KEY");
  if (!res.ok) throw new Error(`Estimate failed (${res.status}).`);

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = extractJson(text);
  const items = Array.isArray(parsed.items) ? parsed.items.map(reconcile) : [];
  return { items, note: parsed.note || null };
}
