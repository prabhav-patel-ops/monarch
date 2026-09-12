/* iCalendar export.

   This is the only route a web build has to a real alarm on a real phone. The
   browser cannot ring at 06:00 while the tab is closed, but the phone's own
   Calendar app can, and it will import a file. So the app writes .ics and lets
   the OS own the ringing.

   The format is unforgiving in ways that fail silently — a lone \n instead of
   CRLF, an unescaped comma, a line over 75 octets, a missing UID — and the
   symptom is a file the Calendar app refuses without saying why. Everything
   below exists because of one of those.                                       */

import { saveFile } from "./download.js";

const CRLF = "\r\n";

/** RFC 5545 wants CRLF line endings and no line longer than 75 octets. */
function fold(line) {
  if (line.length <= 74) return line;
  const parts = [line.slice(0, 74)];
  let rest = line.slice(74);
  while (rest.length > 73) {
    parts.push(" " + rest.slice(0, 73));
    rest = rest.slice(73);
  }
  if (rest) parts.push(" " + rest);
  return parts.join(CRLF);
}

/** Commas, semicolons and backslashes are separators in this format. */
function esc(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

const pad = (n) => String(n).padStart(2, "0");

/** Floating local time — no Z, no TZID. The event stays at 06:00 wherever you are. */
export function localStamp(dateKeyStr, hhmm = "00:00") {
  const [y, m, d] = dateKeyStr.split("-").map(Number);
  const [hh, mm] = String(hhmm).split(":").map(Number);
  return `${y}${pad(m)}${pad(d)}T${pad(hh || 0)}${pad(mm || 0)}00`;
}

/** UTC stamp, required for DTSTAMP. */
export function utcStamp(d = new Date()) {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

let seq = 0;
function uid(tag) {
  seq += 1;
  return `monarch-${tag}-${Date.now().toString(36)}-${seq}@local`;
}

/**
 * One VEVENT. `alarmMins` adds a VALARM that many minutes before the start;
 * pass 0 for an alarm exactly at the start time, or null for no alarm.
 *
 * A DISPLAY alarm is used deliberately: iOS and Android both honour it, while
 * AUDIO and EMAIL alarms are widely ignored or stripped on import.
 */
export function vevent({ tag = "e", date, time = "06:00", mins = 30, title, description = "", rrule = null, alarmMins = 0 }) {
  const start = localStamp(date, time);
  const [h, m] = String(time).split(":").map(Number);
  const endMins = (h || 0) * 60 + (m || 0) + mins;
  const end = localStamp(date, `${Math.floor(endMins / 60) % 24}:${endMins % 60}`);

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid(tag)}`,
    `DTSTAMP:${utcStamp()}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${esc(title)}`,
  ];
  if (description) lines.push(`DESCRIPTION:${esc(description)}`);
  if (rrule) lines.push(`RRULE:${rrule}`);
  if (alarmMins != null) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(title)}`,
      `TRIGGER:-PT${Math.max(0, alarmMins)}M`,
      "END:VALARM"
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

export function wrapCalendar(eventLines, name = "MONARCH") {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MONARCH//Hunter System//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    ...eventLines,
    "END:VCALENDAR",
  ]
    .map(fold)
    .join(CRLF) + CRLF;
}

/**
 * The standing daily reminders: a fixed set of repeating events with alarms.
 * Imported once, these ring every day without the app being open at all —
 * which is the entire point of exporting them.
 */
export function dailyRemindersIcs(startKey, reminders) {
  const events = reminders
    .filter((r) => r.on)
    .flatMap((r) =>
      vevent({
        tag: r.id,
        date: startKey,
        time: r.time,
        mins: r.mins || 30,
        title: r.title,
        description: r.body || "",
        rrule: r.rrule || "FREQ=DAILY",
        alarmMins: 0,
      })
    );
  return wrapCalendar(events, "MONARCH — daily");
}

/** Every open gate as a dated event, with a warning alarm the day before. */
export function gatesIcs(gates) {
  const open = (gates || []).filter((g) => !g.cleared && g.date);
  const events = open.flatMap((g) =>
    vevent({
      tag: `gate-${g.id}`,
      date: g.date,
      time: "09:00",
      mins: 60,
      title: `Gate closes: ${g.name}`,
      description: `Rank ${g.rank}. ${g.note || ""}`.trim(),
      alarmMins: 24 * 60,
    })
  );
  return wrapCalendar(events, "MONARCH — gates");
}

/** A single day's plan, written out as timed blocks. */
export function scheduleIcs(dateKeyStr, blocks) {
  const events = (blocks || []).flatMap((b) =>
    vevent({
      tag: b.id || "block",
      date: dateKeyStr,
      time: b.start,
      mins: b.mins || 30,
      title: b.label,
      description: b.stat ? `${b.stat} · ${b.xp} XP` : "",
      alarmMins: 5,
    })
  );
  return wrapCalendar(events, `MONARCH — ${dateKeyStr}`);
}

/**
 * Hand the file to the OS. On iOS this opens the Calendar import sheet, which
 * is the step that turns an event into an actual alarm on the device.
 *
 * Resolves with whether the save actually happened — see download.js for why
 * that is not a given everywhere this app runs.
 */
export function downloadIcs(text, filename) {
  return saveFile(text, filename, "text/calendar;charset=utf-8");
}
