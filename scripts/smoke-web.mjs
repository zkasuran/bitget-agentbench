/**
 * Headless smoke for the web verifier. No browser available, so simulate one:
 * polyfill fetch to serve files from docs/, import the built bundle and run the
 * same calls the page makes. Asserts every committed report verifies, a tampered
 * copy fails on ledger + replay, and the verdict matches the CLI's verifyReport.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyReport } from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");

// Serve docs/ over fetch(). The bundle builds absolute file:// URLs from the
// bundle's own location (docs/verify.bundle.js), so map any file:// under docs.
globalThis.fetch = async (url) => {
  const u = typeof url === "string" ? url : url.href;
  const path = u.startsWith("file://") ? fileURLToPath(u) : join(docs, u);
  try {
    const body = await readFile(path, "utf8");
    return { ok: true, status: 200, text: async () => body };
  } catch {
    return { ok: false, status: 404, text: async () => "" };
  }
};

// Import the bundle as if served from docs/verify.bundle.js so import.meta.url
// resolves BASE to docs/.
const bundleUrl = pathToFileURL(join(docs, "verify.bundle.js")).href;
const web = await import(bundleUrl);

let failures = 0;
const reports = await web.listReports();
console.log(`smoke: ${reports.length} reports indexed`);

for (const r of reports) {
  const webResult = await web.verifyByName(r.name);
  // CLI ground truth over the same files on disk.
  const cliResult = await verifyReport(join(root, "reports", r.name));
  const same =
    webResult.pass === cliResult.pass &&
    JSON.stringify(webResult.checks.map((c) => [c.name, c.status])) ===
      JSON.stringify(cliResult.checks.map((c) => [c.name, c.status]));
  const ok = webResult.pass && same;
  console.log(
    `  ${ok ? "OK " : "XX "} ${r.name}: web=${webResult.pass ? "PASS" : "FAIL"} ` +
      `cli=${cliResult.pass ? "PASS" : "FAIL"} ` +
      `checks=[${webResult.checks.map((c) => c.name + ":" + c.status).join(",")}]`,
  );
  if (!ok) {
    failures++;
    if (!same) {
      console.log("    MISMATCH web vs cli:", JSON.stringify(webResult.checks), JSON.stringify(cliResult.checks));
    }
  }
}

// Tamper: doctor totalReturnPct and expect FAIL on ledger + replay.
const target = reports[0];
const t = await web.verifyTampered(target.name, {
  field: "metrics.totalReturnPct",
  value: 99,
});
const tChecks = Object.fromEntries(t.result.checks.map((c) => [c.name, c.status]));
const tamperCaught =
  t.result.pass === false &&
  tChecks.ledger === "fail" &&
  tChecks.replay === "fail";
console.log(
  `  ${tamperCaught ? "OK " : "XX "} tamper ${target.name}: verdict=${t.result.pass ? "PASS" : "FAIL"} ` +
    `ledger=${tChecks.ledger} replay=${tChecks.replay} integrity=${tChecks.integrity}`,
);
if (!tamperCaught) failures++;

if (failures > 0) {
  console.error(`\nWEB SMOKE FAILED: ${failures} problem(s)`);
  process.exit(1);
}
console.log("\nweb smoke: all reports verify in-browser and match the CLI, tamper is caught");
