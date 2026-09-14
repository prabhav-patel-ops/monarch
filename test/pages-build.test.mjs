import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const expectedBase = process.env.EXPECTED_BASE_PATH || "/monarch/";
const [html, manifest, registerWorker] = await Promise.all([
  readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
  readFile(new URL("../dist/manifest.webmanifest", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../dist/registerSW.js", import.meta.url), "utf8"),
]);

assert.ok(html.includes(`href="${expectedBase}icon-180.png"`), "apple icon must use the Pages base path");
assert.ok(html.includes(`src="${expectedBase}assets/`), "entry script must use the Pages base path");
assert.equal(manifest.start_url, "./", "PWA start URL must be relative to the deployed manifest");
assert.equal(manifest.scope, "./", "PWA scope must be relative to the deployed manifest");
assert.ok(
  manifest.icons.every(({ src }) => !src.startsWith("/")),
  "PWA icons must resolve relative to the deployed manifest",
);
assert.ok(registerWorker.includes(`'${expectedBase}sw.js'`), "service worker must use the Pages base path");
assert.ok(registerWorker.includes(`scope: '${expectedBase}'`), "service worker scope must use the Pages base path");

console.log(`Pages build paths verified for ${expectedBase}`);
