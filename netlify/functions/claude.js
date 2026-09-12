/* ============================================================
   MONARCH · Claude proxy
   The API key lives here, as a Netlify environment variable.
   It is never sent to the browser. The client posts a system
   prompt and a message list; this forwards them and returns
   the reply untouched.
   ============================================================ */

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1200;

export default async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Use POST." }, 405);
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return json({ error: "ANTHROPIC_API_KEY is not set on this site." }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body was not valid JSON." }, 400);
  }

  const { system, messages } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "messages must be a non-empty array." }, 400);
  }

  // Keep the context bounded: the last 20 turns is plenty and stops a long
  // session from quietly becoming an expensive one.
  //
  // Content is either a plain string or an array of blocks (text, image).
  // Array content must be passed through structurally — stringifying it would
  // turn an image block into "[object Object]" and silently break vision.
  const trimText = (s) => String(s ?? "").slice(0, 8000);

  const trimmed = messages.slice(-20).map((m) => {
    const role = m.role === "assistant" ? "assistant" : "user";
    if (Array.isArray(m.content)) {
      return {
        role,
        content: m.content
          .filter((b) => b && (b.type === "text" || b.type === "image"))
          .map((b) => (b.type === "text" ? { type: "text", text: trimText(b.text) } : b)),
      };
    }
    return { role, content: trimText(m.content) };
  });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: typeof system === "string" ? system.slice(0, 20000) : undefined,
        messages: trimmed,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const detail = data?.error?.message || "Anthropic rejected the request.";
      return json({ error: detail }, res.status === 401 ? 401 : 502);
    }

    return json(data, 200);
  } catch (e) {
    return json({ error: `Upstream call failed: ${e.message}` }, 502);
  }
};

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const config = { path: "/.netlify/functions/claude" };
