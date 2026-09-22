import {
  DEFAULT_PROGRESSION, DEFAULT_TEMPLATES, MISSION,
  SEED_GATES, SEED_SHADOWS, SEED_SESSIONS, SEEDS_VERSION,
  DEFAULT_REMINDERS, FOCUS_TARGETS,
} from "./data.js";
import { STATS, resolveDetail, DEFAULT_SCHEDULE, dateKey, parseKey } from "./engine.js";
import { SEED_SAVE } from "./seed-save.js";
import { applyConfirmedRecovery } from "./confirmed-recovery.js";

export const KEY = "monarch.v1";
export const META_KEY = "monarch.v1.meta";
export const LAST_GOOD_KEY = "monarch.v1.lastGood";
export const PENDING_KEY = "monarch.v1.pending";
export const BRANCH_KEY = "monarch.v1.preservedBranch";

const PORTABLE_FORMAT = "monarch.backup";
const PORTABLE_VERSION = 1;
const RECOVERY_DB = "monarch-recovery";
const RECOVERY_STORE = "snapshots";
/* localStorage writes temporarily hold live + pending + rollback copies. Keep
   the live payload well below common 5 MiB quotas so safety itself has room. */
const MAX_STATE_BYTES = 1_000_000;
const MAX_SNAPSHOTS = 30;
const MAX_LINEAGE = 100;

/* Bump when DEFAULT_TEMPLATES changes shape OR when quest XP is repriced.
   Saved templates below this are replaced on load, because an old save can
   carry stale quest copy and stale prices. */
export const TEMPLATES_VERSION = 6;

const DIFFICULTY_KEYS = ["normal", "hard", "monarch"];

function bundledState() {
  return hydrate(applyConfirmedRecovery(SEED_SAVE));
}

export function emptyState() {
  const statXp = {};
  STATS.forEach((s) => (statXp[s] = 0));
  return {
    version: 1,
    templatesVersion: TEMPLATES_VERSION,
    seedsVersion: SEEDS_VERSION,
    hunter: { name: MISSION.hunter, createdAt: null },
    totalXp: 0,
    statXp,
    seenLevel: 1,
    progression: { ...DEFAULT_PROGRESSION },
    templates: JSON.parse(JSON.stringify(DEFAULT_TEMPLATES)),
    days: {},
    streak: { current: 0, best: 0 },
    cfHistory: [],
    lastRatchet: null,
    gates: SEED_GATES.map((g) => ({ ...g })),
    seasons: [],
    shadows: SEED_SHADOWS.map((s) => ({ ...s })),
    body: {
      weights: [],
      waist: [],
      meals: {},
      water: {},
      sleep: {},
      training: {},
      exNames: {},
      focus: {},
      journal: {},
      photos: [],
    },
    settings: {
      targets: { ...MISSION.targets },
      ratchetStreak: 8,
      soundOn: true,
      difficulty: "normal",
      /* Governs the earned figures only — what today is worth, what the
         log adds up to. The distance to the next level is never shown, so a
         promotion still arrives rather than being counted down to. */
      showNumbers: true,
      notifyOn: false,
      reminders: DEFAULT_REMINDERS.map((r) => ({ ...r })),
      schedule: JSON.parse(JSON.stringify(DEFAULT_SCHEDULE)),
      focusCaps: FOCUS_TARGETS.map((f) => ({ ...f })),
    },
  };
}

/**
 * Backfill sessions that were trained before the app logged loads. Anything
 * already recorded for that day wins — a seed never overwrites real input.
 */
function applySeeds(state) {
  Object.keys(SEED_SESSIONS).forEach((dk) => {
    const seed = JSON.parse(JSON.stringify(SEED_SESSIONS[dk]));
    const cur = state.body.training[dk] || { done: [], sets: {} };
    state.body.training[dk] = { ...cur, done: cur.done || [], sets: { ...seed, ...(cur.sets || {}) } };
  });
  state.seedsVersion = SEEDS_VERSION;
}

/**
 * Merge a saved blob over a fresh state. Nested sections are merged one level
 * deeper so a backup written by an older version cannot leave a hole that
 * crashes a screen.
 */
export function hydrate(parsed) {
  const base = emptyState();
  if (!parsed || typeof parsed !== "object") return base;
  const merged = { ...base, ...parsed };
  ["hunter", "progression", "body", "settings", "statXp"].forEach((k) => {
    merged[k] = { ...base[k], ...(parsed[k] || {}) };
  });
  merged.settings.targets = { ...base.settings.targets, ...(parsed.settings?.targets || {}) };
  ["days", "gates", "shadows", "cfHistory"].forEach((k) => {
    if (merged[k] == null) merged[k] = base[k];
  });
  merged.streak = { ...base.streak, ...(parsed.streak || {}) };

  /* Every training entry carries both shapes: `done` for the legacy checklist
     days and `sets` for the days that log real loads. */
  Object.keys(merged.body.training || {}).forEach((dk) => {
    const e = merged.body.training[dk] || {};
    merged.body.training[dk] = {
      ...e,
      done: Array.isArray(e.done) ? e.done : [],
      sets: e.sets && typeof e.sets === "object" ? e.sets : {},
    };
  });
  if ((parsed.seedsVersion || 0) < SEEDS_VERSION) applySeeds(merged);

  /* Sections that arrived after the first release. A save written before them
     has no key at all, so each needs a floor rather than a shallow merge. */
  if (!Array.isArray(merged.seasons)) merged.seasons = [];

  /* Days written before side quests existed have no extras array, and every
     screen that reads one maps over it. */
  Object.values(merged.days || {}).forEach((day) => {
    if (!Array.isArray(day.extras)) day.extras = [];
  });
  if (!merged.body.focus || typeof merged.body.focus !== "object") merged.body.focus = {};
  if (!merged.body.journal || typeof merged.body.journal !== "object") merged.body.journal = {};
  if (!merged.body.exNames || typeof merged.body.exNames !== "object") merged.body.exNames = {};
  if (!DIFFICULTY_KEYS.includes(merged.settings.difficulty)) merged.settings.difficulty = "normal";
  if (typeof merged.settings.showNumbers !== "boolean") merged.settings.showNumbers = true;
  merged.settings.schedule = {
    ...base.settings.schedule,
    ...(parsed.settings?.schedule || {}),
    fixed: Array.isArray(parsed.settings?.schedule?.fixed)
      ? parsed.settings.schedule.fixed
      : base.settings.schedule.fixed,
  };

  /* Reminders merge by id so a new default reminder added in a later release
     appears for existing users, while their edited times and toggles survive. */
  const saved = new Map((parsed.settings?.reminders || []).map((r) => [r.id, r]));
  merged.settings.reminders = DEFAULT_REMINDERS.map((d) => ({ ...d, ...(saved.get(d.id) || {}) }));
  (parsed.settings?.reminders || []).forEach((r) => {
    if (!DEFAULT_REMINDERS.some((d) => d.id === r.id)) merged.settings.reminders.push({ ...r });
  });

  const caps = new Map((parsed.settings?.focusCaps || []).map((c) => [c.id, c]));
  merged.settings.focusCaps = FOCUS_TARGETS.map((f) => ({ ...f, ...(caps.get(f.id) || {}) }));

  /* --- migration ---
     Templates saved before v2 were cloned with JSON.stringify, which drops
     function values. Every dynamic detail line came back undefined, so quests
     rendered with no rating band, page count or time. Replace those templates
     and repair the detail lines on days already generated from them. */
  if ((parsed.templatesVersion || 0) < TEMPLATES_VERSION) {
    merged.templates = JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
    merged.templatesVersion = TEMPLATES_VERSION;

    const byKey = new Map();
    Object.values(DEFAULT_TEMPLATES).forEach((list) =>
      list.forEach((t) => byKey.set(t.key, t))
    );

    /* Reprice today and anything ahead of it, never a day that has closed. A
       finished day was graded and charged against the prices in force at the
       time; rewriting those would move penalties that were already taken and
       make the calendar disagree with the levels it produced. */
    const today = dateKey(new Date());

    Object.entries(merged.days || {}).forEach(([dk, day]) => {
      (day.quests || []).forEach((q) => {
        const t = byKey.get(q.key);
        if (!t) return;
        if (!q.detail) q.detail = resolveDetail(t.detail, merged.progression);
        if (t.title && q.title !== t.title && !q.penalty) q.title = t.title;
        if (dk >= today && !q.penalty && typeof t.xp === "number") q.xp = t.xp;
        if (dk >= today && !q.penalty && typeof t.slot === "number") q.slot = t.slot;
      });

      /* A quest added to the template after a board was generated is missing
         from it entirely, so repricing alone would never surface it. Today
         and anything ahead pick it up; a day that has closed is left exactly
         as it was graded. */
      if (dk < today) return;
      const weekday = parseKey(dk).getDay();
      const template = merged.templates[weekday] || [];
      const present = new Set((day.quests || []).map((q) => q.key));

      template.forEach((t, i) => {
        if (present.has(t.key)) return;
        day.quests.push({
          id: `${dk}#new${i}#${t.key}`,
          key: t.key,
          title: t.title,
          detail: resolveDetail(t.detail, merged.progression),
          stat: t.stat,
          xp: t.xp,
          slot: t.slot,
          done: false,
          penalty: false,
        });
      });

      /* Carried-over penalty quests keep a "penalty" slot rather than a
         number, so they sort to the end instead of NaN-ing the comparison. */
      day.quests.sort((a, b) => {
        const av = typeof a.slot === "number" ? a.slot : 99;
        const bv = typeof b.slot === "number" ? b.slot : 99;
        return av - bv;
      });
    });
  }

  return merged;
}

function storageArea() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function uuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `mn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/* An integrity checksum, not a security primitive. It catches truncation and
   accidental edits without adding a dependency or a paid/network service. */
export function checksum(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function hasEmbeddedPhotoBytes(value) {
  if (!value) return false;
  if (typeof value === "string") {
    return value.startsWith("data:image/") || value.startsWith("blob:") || value.length > 64_000;
  }
  if (Array.isArray(value)) return value.some(hasEmbeddedPhotoBytes);
  if (typeof value === "object") return Object.values(value).some(hasEmbeddedPhotoBytes);
  return false;
}

export function validateState(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("That file is not a MONARCH backup.");
  }
  if (!candidate.statXp || typeof candidate.statXp !== "object" || Array.isArray(candidate.statXp)) {
    throw new Error("The backup has no valid stat history.");
  }
  if (candidate.days != null && (typeof candidate.days !== "object" || Array.isArray(candidate.days))) {
    throw new Error("The backup has an invalid day log.");
  }
  if (hasEmbeddedPhotoBytes(candidate.body?.photos)) {
    throw new Error("Photo bytes cannot be stored inside monarch.v1. Keep photos as separate files.");
  }

  const normalized = hydrate(candidate);
  const raw = JSON.stringify(normalized);
  if (raw.length > MAX_STATE_BYTES) {
    throw new Error("This save is too large for safe browser storage. Export or remove large attachments first.");
  }
  return { state: normalized, raw, hash: checksum(raw) };
}

function parseObject(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid record.");
  return parsed;
}

function cleanHistory(values, stateHash) {
  return [...new Set((Array.isArray(values) ? values : []).filter((x) => typeof x === "string" && x !== stateHash))]
    .slice(-MAX_LINEAGE);
}

function baselineLineage(stateHash) {
  return {
    format: "monarch.lineage",
    version: 1,
    branchId: uuid(),
    revision: 0,
    stateHash,
    parentHash: null,
    history: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeLineage(value, stateHash) {
  if (!value || typeof value !== "object" || value.stateHash !== stateHash) {
    return baselineLineage(stateHash);
  }
  return {
    format: "monarch.lineage",
    version: 1,
    branchId: typeof value.branchId === "string" && value.branchId ? value.branchId : uuid(),
    revision: Math.max(0, Number.isFinite(value.revision) ? Math.trunc(value.revision) : 0),
    stateHash,
    parentHash: typeof value.parentHash === "string" ? value.parentHash : null,
    history: cleanHistory(value.history, stateHash),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  };
}

function readLineage(area, stateHash) {
  try {
    return normalizeLineage(parseObject(area?.getItem(META_KEY) || "null"), stateHash);
  } catch {
    return baselineLineage(stateHash);
  }
}

function nextLineage(current, currentHash, nextHash) {
  const base = normalizeLineage(current, currentHash);
  return {
    ...base,
    revision: base.revision + 1,
    stateHash: nextHash,
    parentHash: currentHash,
    history: cleanHistory([...base.history, currentHash], nextHash),
    updatedAt: new Date().toISOString(),
  };
}

function recoveryRecord(raw, meta, hash) {
  return JSON.stringify({
    format: "monarch.recovery",
    version: 1,
    raw,
    hash,
    lineage: meta,
    createdAt: new Date().toISOString(),
  });
}

function verifiedRecovery(raw) {
  const record = parseObject(raw);
  if (record.format !== "monarch.recovery" || typeof record.raw !== "string") {
    throw new Error("Invalid recovery record.");
  }
  const checked = validateState(JSON.parse(record.raw));
  if (record.hash !== checked.hash) throw new Error("Recovery checksum mismatch.");
  return { ...checked, lineage: normalizeLineage(record.lineage, checked.hash) };
}

function restoreLocalRecord(area, record) {
  area.setItem(KEY, record.raw);
  area.setItem(META_KEY, JSON.stringify(record.lineage));
  area.removeItem(PENDING_KEY);
}

/**
 * Reads monarch.v1 without ever replacing corrupt data with seed/empty state.
 * A verified transaction checkpoint is restored automatically; otherwise
 * callers receive `blocked: true` and writes remain guarded.
 */
export function loadState() {
  const area = storageArea();
  if (!area) {
    return { state: bundledState(), status: "unavailable", blocked: false, meta: null };
  }

  let raw;
  try {
    raw = area.getItem(KEY);
  } catch (error) {
    return { state: bundledState(), status: "unavailable", blocked: true, error, meta: null };
  }

  /* A device with no save of its own opens on the exported log. It is only a
     starting view; the first verified save creates monarch.v1. */
  if (raw == null) {
    try {
      const recovered = verifiedRecovery(area.getItem(PENDING_KEY));
      restoreLocalRecord(area, recovered);
      return { ...recovered, status: "recovered", blocked: false };
    } catch {
      /* There was no complete first-write transaction to recover. */
    }
    return { state: bundledState(), status: "seed", blocked: false, meta: null };
  }

  try {
    const checked = validateState(JSON.parse(raw));
    let meta = readLineage(area, checked.hash);
    const pendingRaw = area.getItem(PENDING_KEY);
    if (pendingRaw) {
      try {
        const pending = parseObject(pendingRaw);
        if (pending.hash === checked.hash) {
          meta = normalizeLineage(pending.lineage, checked.hash);
          area.setItem(META_KEY, JSON.stringify(meta));
        }
        /* A matching marker completed after the live write; a different one
           never committed. Either way the verified live state wins. */
        area.removeItem(PENDING_KEY);
      } catch {
        /* A malformed marker is not evidence against a verified live save. */
      }
    }
    return { ...checked, status: "ok", blocked: false, meta };
  } catch (error) {
    for (const recoveryKey of [LAST_GOOD_KEY, PENDING_KEY]) {
      try {
        const recovered = verifiedRecovery(area.getItem(recoveryKey));
        restoreLocalRecord(area, recovered);
        return { ...recovered, status: "recovered", blocked: false, error };
      } catch {
        /* Try the next independently verified recovery boundary. */
      }
    }
    return {
      state: bundledState(),
      status: "corrupt",
      blocked: true,
      error,
      meta: null,
      corruptRaw: raw,
    };
  }
}

export function load() {
  return loadState().state;
}

export function hasLocalSave() {
  try {
    return storageArea()?.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

let snapshotTimer = null;
function scheduleSnapshot(state, reason, lineage) {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return;
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    createRecoverySnapshot(state, reason, lineage).catch(() => {});
  }, 1500);
}

/**
 * Transactional localStorage adapter. The live key remains exactly monarch.v1
 * and contains the same plain state shape older builds expect. Metadata,
 * staging, and rollback data live under separate keys.
 */
export function saveState(state, options = {}) {
  const area = storageArea();
  if (!area) return { ok: false, code: "unavailable", reason: "Browser storage is unavailable." };

  let checked;
  try {
    checked = validateState(state);
  } catch (error) {
    return { ok: false, code: "invalid", reason: error.message, error };
  }

  let previousRaw = null;
  let previousMetaRaw = null;
  let previousHash = null;
  let previousMeta = null;

  try {
    previousRaw = area.getItem(KEY);
    previousMetaRaw = area.getItem(META_KEY);
    if (previousRaw != null) {
      try {
        const previous = validateState(JSON.parse(previousRaw));
        previousHash = previous.hash;
        previousMeta = readLineage(area, previous.hash);
      } catch (error) {
        if (!options.allowCorruptReplace) {
          return {
            ok: false,
            code: "corrupt-live",
            reason: "The live save is corrupt. Export or restore it before writing new data.",
            error,
          };
        }
      }
    }

    const hasExpectation = options.expectedHash !== undefined;
    if (hasExpectation && (options.expectedHash || null) !== (previousHash || null)) {
      scheduleSnapshot(checked.state, "stale-tab-conflict", options.lineage || null);
      return {
        ok: false,
        code: "conflict",
        reason: "A newer tab or device save exists. This change was not allowed to overwrite it.",
        currentHash: previousHash,
      };
    }

    if (previousHash === checked.hash) {
      return { ok: true, hash: checked.hash, meta: previousMeta, unchanged: true };
    }

    let lineage;
    if (options.lineage) {
      lineage = normalizeLineage(options.lineage, checked.hash);
    } else if (previousHash) {
      lineage = nextLineage(previousMeta, previousHash, checked.hash);
    } else {
      lineage = { ...baselineLineage(checked.hash), revision: 1 };
    }

    const pending = recoveryRecord(checked.raw, lineage, checked.hash);
    area.setItem(PENDING_KEY, pending);
    if (previousRaw != null && previousHash) {
      area.setItem(LAST_GOOD_KEY, recoveryRecord(previousRaw, previousMeta, previousHash));
    }

    area.setItem(KEY, checked.raw);
    const verify = validateState(JSON.parse(area.getItem(KEY)));
    if (verify.hash !== checked.hash) throw new Error("The browser did not verify the written save.");
    area.setItem(META_KEY, JSON.stringify(lineage));
    area.removeItem(PENDING_KEY);
    scheduleSnapshot(checked.state, options.reason || "autosave", lineage);
    return { ok: true, hash: checked.hash, meta: lineage };
  } catch (error) {
    try {
      if (previousRaw == null) area.removeItem(KEY);
      else area.setItem(KEY, previousRaw);
      if (previousMetaRaw == null) area.removeItem(META_KEY);
      else area.setItem(META_KEY, previousMetaRaw);
      area.removeItem(PENDING_KEY);
    } catch {
      /* Keep the original error; loadState still has lastGood as a fallback. */
    }
    return { ok: false, code: "write-failed", reason: "The save failed and the previous state was kept.", error };
  }
}

export function save(state) {
  const current = loadState();
  return saveState(state, { expectedHash: current.hash }).ok;
}

function openRecoveryDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }
    const request = indexedDB.open(RECOVERY_DB, 1);
    request.onerror = () => reject(request.error || new Error("Could not open recovery storage."));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(RECOVERY_STORE)) {
        request.result.createObjectStore(RECOVERY_STORE, { keyPath: "sequence", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function transact(db, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECOVERY_STORE, mode);
    const store = tx.objectStore(RECOVERY_STORE);
    let result;
    try {
      result = work(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error("Recovery transaction failed."));
    tx.onabort = () => reject(tx.error || new Error("Recovery transaction was aborted."));
  });
}

export async function createRecoverySnapshot(state, reason = "manual", lineage = null) {
  const checked = validateState(state);
  const area = storageArea();
  const meta = normalizeLineage(lineage || readLineage(area, checked.hash), checked.hash);
  const db = await openRecoveryDb();
  try {
    await transact(db, "readwrite", (store) => store.add({
      format: "monarch.snapshot",
      version: 1,
      reason,
      raw: checked.raw,
      hash: checked.hash,
      lineage: meta,
      createdAt: new Date().toISOString(),
    }));

    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(RECOVERY_STORE, "readonly");
      const req = tx.objectStore(RECOVERY_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    const excess = records.slice(0, Math.max(0, records.length - MAX_SNAPSHOTS));
    if (excess.length) {
      await transact(db, "readwrite", (store) => excess.forEach((key) => store.delete(key)));
    }
    return { ok: true, hash: checked.hash };
  } finally {
    db.close();
  }
}

export async function listRecoverySnapshots(limit = 5) {
  const db = await openRecoveryDb();
  try {
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(RECOVERY_STORE, "readonly");
      const req = tx.objectStore(RECOVERY_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    return records.sort((a, b) => b.sequence - a.sequence).slice(0, Math.max(0, limit));
  } finally {
    db.close();
  }
}

export async function replaceState(state, options = {}) {
  const current = loadState();
  let durableSnapshot = false;
  if (!current.blocked) {
    try {
      await createRecoverySnapshot(current.state, `before-${options.reason || "replace"}`, current.meta);
      durableSnapshot = true;
    } catch {
      /* lastGood below remains the synchronous rollback boundary. */
    }
  }

  if (options.preserveBranch && !current.blocked && !durableSnapshot) {
    try {
      const area = storageArea();
      area.setItem(BRANCH_KEY, recoveryRecord(current.raw, current.meta, current.hash));
      verifiedRecovery(area.getItem(BRANCH_KEY));
    } catch (error) {
      return {
        ok: false,
        code: "branch-not-preserved",
        reason: "The current branch could not be preserved, so the divergent import was cancelled.",
        error,
      };
    }
  }
  const result = saveState(state, {
    expectedHash: current.hash,
    allowCorruptReplace: Boolean(options.allowCorruptReplace),
    lineage: options.lineage,
    reason: options.reason || "replace",
  });
  if (result.ok) {
    try {
      await createRecoverySnapshot(state, `after-${options.reason || "replace"}`, result.meta);
    } catch {
      /* Persistence may be denied/private; local lastGood still permits rollback. */
    }
  }
  return result;
}

export async function restoreLatestSnapshot() {
  const current = loadState();
  let snapshot = null;
  try {
    const snapshots = await listRecoverySnapshots(MAX_SNAPSHOTS);
    snapshot = snapshots.find((entry) => entry.hash !== current.hash) || null;
  } catch {
    /* Fall through to the synchronous recovery records below. */
  }
  if (!snapshot) {
    for (const key of [BRANCH_KEY, LAST_GOOD_KEY]) {
      try {
        const fallback = verifiedRecovery(storageArea()?.getItem(key));
        if (fallback.hash !== current.hash) {
          snapshot = { raw: fallback.raw, hash: fallback.hash, lineage: fallback.lineage };
          break;
        }
      } catch {
        /* Try the next verified local recovery record. */
      }
    }
  }
  if (!snapshot) return { ok: false, code: "none", reason: "No earlier recovery checkpoint exists on this device." };
  const checked = validateState(JSON.parse(snapshot.raw));
  if (snapshot.hash !== checked.hash) return { ok: false, code: "invalid", reason: "The recovery checkpoint failed validation." };
  return replaceState(checked.state, {
    allowCorruptReplace: true,
    lineage: snapshot.lineage,
    reason: "recovery",
  });
}

export async function requestPersistentStorage() {
  try {
    if (typeof navigator === "undefined" || !navigator.storage) return { status: "unavailable" };
    if (typeof navigator.storage.persisted === "function" && await navigator.storage.persisted()) {
      return { status: "granted" };
    }
    if (typeof navigator.storage.persist !== "function") return { status: "unavailable" };
    return { status: (await navigator.storage.persist()) ? "granted" : "denied" };
  } catch {
    return { status: "unavailable" };
  }
}

export function exportJson(state) {
  const checked = validateState(state);
  const area = storageArea();
  const lineage = readLineage(area, checked.hash);
  return JSON.stringify({
    format: PORTABLE_FORMAT,
    version: PORTABLE_VERSION,
    exportedAt: new Date().toISOString(),
    lineage,
    checksum: checked.hash,
    state: checked.state,
  }, null, 2);
}

export function exportDamagedJson(raw) {
  if (typeof raw !== "string" || !raw) throw new Error("No damaged save is available to export.");
  return raw;
}

export function prepareImport(text, currentState = null) {
  const parsed = JSON.parse(text);
  let candidate;
  let incomingLineage = null;
  let source = "legacy";

  if (parsed?.format === PORTABLE_FORMAT) {
    if (parsed.version !== PORTABLE_VERSION) throw new Error("This MONARCH backup version is not supported.");
    candidate = validateState(parsed.state);
    if (parsed.checksum !== candidate.hash) throw new Error("The backup checksum does not match its contents.");
    incomingLineage = normalizeLineage(parsed.lineage, candidate.hash);
    source = "portable";
  } else {
    candidate = validateState(parsed);
  }

  const current = currentState ? validateState(currentState) : null;
  let relation = "divergent";
  if (current && current.hash === candidate.hash) {
    relation = "identical";
  } else if (current && incomingLineage) {
    const area = storageArea();
    const currentLineage = readLineage(area, current.hash);
    if (incomingLineage.history.includes(current.hash) || incomingLineage.parentHash === current.hash) {
      relation = "descendant";
    } else if (currentLineage.history.includes(candidate.hash) || currentLineage.parentHash === candidate.hash) {
      relation = "older";
    } else if (incomingLineage.branchId === currentLineage.branchId) {
      relation = incomingLineage.revision > currentLineage.revision ? "descendant" : "older";
    }
  }

  return { ...candidate, lineage: incomingLineage, relation, source };
}

export function importJson(text) {
  return prepareImport(text).state;
}
