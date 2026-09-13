/* Handing a file to the user, wherever the app happens to be running.

   On a normal host — localhost, Netlify, a phone browser — an anchor with a
   `download` attribute is the whole story.

   Inside the claude.ai artifact viewer it is not: the frame is sandboxed and a
   plain download link does nothing at all, silently. The viewer mediates saves
   through a capability instead, and it only accepts an allowlist of
   extensions. `.json` is on that list, so backups work. `.ics` is not, so the
   calendar export cannot complete there.

   That last point is the reason this file returns a result instead of just
   doing the deed. A backup button that quietly fails is the worst button in
   the app — the whole point of it is that you can trust it ran. So every
   caller gets back what actually happened and says so on screen.            */

let capability;

/** Resolved once. `null` means we are not in a viewer that mediates saves. */
function hostSaver() {
  if (capability !== undefined) return capability;
  const c = typeof window !== "undefined" ? window.claude : null;
  capability = c && typeof c.use === "function"
    ? Promise.resolve(c.use("downloads")).catch(() => null)
    : Promise.resolve(null);
  return capability;
}

function anchorSave(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const REASON = {
  declined: "Save cancelled.",
  rejected_extension: "This viewer will not save that file type. Open the app on its own host for calendar files.",
  extension_not_enabled: "This viewer will not save that file type right now.",
  rate_limited: "A save prompt is already open. Finish it and try again.",
  too_large: "The file is too large for the chosen destination.",
};

/**
 * Returns `{ ok }`, and on failure a `reason` written for a person rather than
 * an error code. Never throws into a click handler.
 */
export async function saveFile(text, filename, mime = "text/plain;charset=utf-8") {
  const saver = await hostSaver();

  if (saver) {
    try {
      await saver.save({ filename, data: text });
      return { ok: true, via: "host", verified: true };
    } catch (err) {
      const code = (err && err.code) || "unavailable";
      return { ok: false, code, reason: REASON[code] || "This viewer could not save the file." };
    }
  }

  try {
    anchorSave(text, filename, mime);
    /* An anchor click proves only that the browser accepted the request. It
       cannot prove the user kept the file or where the browser placed it. */
    return { ok: true, via: "browser", verified: false };
  } catch {
    return { ok: false, code: "unavailable", reason: "The browser refused the download." };
  }
}

/** True when calendar files can actually be saved here. */
export async function canSaveCalendar() {
  return (await hostSaver()) === null;
}
