import assert from "node:assert/strict";
import {
  KEY,
  META_KEY,
  LAST_GOOD_KEY,
  PENDING_KEY,
  emptyState,
  loadState,
  saveState,
  exportJson,
  prepareImport,
  replaceState,
  validateState,
} from "../src/store.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

const originalStorage = globalThis.localStorage;
const storage = new MemoryStorage();
globalThis.localStorage = storage;

let pass = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass += 1;
  } catch (error) {
    console.error(`FAIL  ${name}\n      ${error.stack || error.message}`);
    process.exitCode = 1;
  }
};

const stateWithXp = (xp) => {
  const state = emptyState();
  state.totalXp = xp;
  state.statXp.INT = xp;
  return state;
};

await t("monarch.v1 remains a plain backward-compatible state", () => {
  storage.clear();
  const result = saveState(stateWithXp(10));
  assert.equal(result.ok, true);
  const live = JSON.parse(storage.getItem(KEY));
  assert.equal(live.totalXp, 10);
  assert.ok(live.statXp);
  assert.equal(live.format, undefined, "the portable envelope must not replace monarch.v1");
  assert.equal(storage.getItem(PENDING_KEY), null, "a verified transaction clears its marker");
  assert.ok(JSON.parse(storage.getItem(META_KEY)).branchId);
});

await t("corrupt live data is blocked and never replaced by seed state", () => {
  storage.clear();
  storage.setItem(KEY, "{truncated");
  const loaded = loadState();
  assert.equal(loaded.status, "corrupt");
  assert.equal(loaded.blocked, true);
  assert.equal(storage.getItem(KEY), "{truncated");
  const write = saveState(emptyState());
  assert.equal(write.ok, false);
  assert.equal(write.code, "corrupt-live");
  assert.equal(storage.getItem(KEY), "{truncated");
});

await t("a corrupt live write rolls back to the verified last-good state", () => {
  storage.clear();
  const first = saveState(stateWithXp(10));
  const second = saveState(stateWithXp(20), { expectedHash: first.hash });
  assert.equal(second.ok, true);
  assert.ok(storage.getItem(LAST_GOOD_KEY));
  storage.setItem(KEY, "not-json");

  const recovered = loadState();
  assert.equal(recovered.status, "recovered");
  assert.equal(recovered.state.totalXp, 10);
  assert.equal(JSON.parse(storage.getItem(KEY)).totalXp, 10);
});

await t("a stale tab cannot overwrite a newer branch", () => {
  storage.clear();
  const base = saveState(stateWithXp(10));
  const newer = saveState(stateWithXp(20), { expectedHash: base.hash });
  const stale = saveState(stateWithXp(15), { expectedHash: base.hash });
  assert.equal(newer.ok, true);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "conflict");
  assert.equal(JSON.parse(storage.getItem(KEY)).totalXp, 20);
});

await t("a tab that started with no live save cannot overwrite one created elsewhere", () => {
  storage.clear();
  saveState(stateWithXp(20));
  const stale = saveState(stateWithXp(10), { expectedHash: null });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "conflict");
  assert.equal(JSON.parse(storage.getItem(KEY)).totalXp, 20);
});

await t("an interrupted first write recovers its verified pending record", () => {
  storage.clear();
  saveState(stateWithXp(25));
  const live = storage.getItem(KEY);
  const meta = JSON.parse(storage.getItem(META_KEY));
  const hash = validateState(JSON.parse(live)).hash;
  storage.clear();
  storage.setItem(PENDING_KEY, JSON.stringify({
    format: "monarch.recovery",
    version: 1,
    raw: live,
    hash,
    lineage: meta,
  }));
  const recovered = loadState();
  assert.equal(recovered.status, "recovered");
  assert.equal(recovered.state.totalXp, 25);
  assert.equal(storage.getItem(PENDING_KEY), null);
});

await t("portable backups validate their checksum", () => {
  storage.clear();
  const state = stateWithXp(12);
  saveState(state);
  const backup = JSON.parse(exportJson(state));
  assert.equal(backup.format, "monarch.backup");
  backup.state.totalXp = 999;
  assert.throws(() => prepareImport(JSON.stringify(backup), state), /checksum/i);
});

await t("lineage classifies identical, descendant, older, and divergent imports", () => {
  storage.clear();
  const baseState = stateWithXp(10);
  const baseWrite = saveState(baseState);
  const baseRaw = storage.getItem(KEY);
  const baseMeta = storage.getItem(META_KEY);
  const baseExport = exportJson(baseState);
  assert.equal(prepareImport(baseExport, baseState).relation, "identical");

  const childState = stateWithXp(20);
  saveState(childState, { expectedHash: baseWrite.hash });
  const childRaw = storage.getItem(KEY);
  const childMeta = storage.getItem(META_KEY);
  const childExport = exportJson(childState);

  storage.setItem(KEY, baseRaw);
  storage.setItem(META_KEY, baseMeta);
  assert.equal(prepareImport(childExport, baseState).relation, "descendant");

  storage.setItem(KEY, childRaw);
  storage.setItem(META_KEY, childMeta);
  assert.equal(prepareImport(baseExport, childState).relation, "older");

  storage.clear();
  const otherState = stateWithXp(77);
  saveState(otherState);
  const otherExport = exportJson(otherState);
  storage.setItem(KEY, childRaw);
  storage.setItem(META_KEY, childMeta);
  assert.equal(prepareImport(otherExport, childState).relation, "divergent");
});

await t("critical replacement keeps a synchronous rollback record", async () => {
  storage.clear();
  saveState(stateWithXp(10));
  const result = await replaceState(stateWithXp(30), { reason: "import" });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(storage.getItem(KEY)).totalXp, 30);
  const rollback = JSON.parse(storage.getItem(LAST_GOOD_KEY));
  assert.equal(JSON.parse(rollback.raw).totalXp, 10);
});

await t("photo bytes are rejected before they can bloat monarch.v1", () => {
  const state = emptyState();
  state.body.photos = [{ src: "data:image/png;base64,AAAA" }];
  assert.throws(() => validateState(state), /Photo bytes/);
});

if (originalStorage === undefined) delete globalThis.localStorage;
else globalThis.localStorage = originalStorage;

console.log(`\n${pass} storage safety checks passing`);
