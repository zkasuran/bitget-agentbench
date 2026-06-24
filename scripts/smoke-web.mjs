/**
 * Headless smoke for the web verifier. No browser available, so simulate one:
 * polyfill fetch to serve files from docs/, import the built bundle and run the
 * same calls the page makes. Asserts every committed report verifies, a tampered
 * copy fails on ledger + replay, and the verdict matches the CLI's verifyReport.
 */

import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyReport, runBacktest, loadFixture, hashDataset, STRATEGIES, VERSION } from "../dist/index.js";

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

// Bring-your-own A: a fixture run in the browser must recompute the exact same
// scorecard as the CLI's runBacktest, and verify 4/4.
{
  const bars = loadFixture("BTCUSDT", "4h");
  const cli = await runBacktest({
    agent: STRATEGIES["momentum"],
    bars,
    config: { startingEquity: 10_000, feeBps: 10, slippageBps: 1, seed: 1 },
    risk: { maxDrawdownKill: 0.3, maxPositionSize: 1.0 },
    manifest: {
      agentbenchVersion: VERSION,
      symbol: "BTCUSDT",
      granularity: "4h",
      source: "fixture",
      bars: bars.length,
      firstBarTime: bars[0].time,
      lastBarTime: bars[bars.length - 1].time,
      datasetSha256: hashDataset(bars),
    },
  });
  const web_run = await web.runStrategy({
    strategy: "momentum",
    symbol: "BTCUSDT",
    granularity: "4h",
    source: "fixture",
    seed: 1,
  });
  const allPass = web_run.pass && web_run.checks.every((c) => c.status === "pass");
  const sameSharpe = web_run.summary.sharpe === cli.scorecard.metrics.sharpe;
  const ok = allPass && sameSharpe;
  console.log(
    `  ${ok ? "OK " : "XX "} runStrategy fixture momentum-BTCUSDT-4h: verify=${web_run.pass ? "PASS" : "FAIL"} ` +
      `sharpe web=${web_run.summary.sharpe} cli=${cli.scorecard.metrics.sharpe} match=${sameSharpe}`,
  );
  if (!ok) failures++;
}

// Bring-your-own B: uploading a committed report's files must verify, matching
// the CLI over the same files on disk.
{
  const name = reports[0].name;
  const dir = join(docs, "reports", name);
  const files = {};
  for (const f of await readdir(dir)) files[f] = await readFile(join(dir, f), "utf8");
  const up = await web.verifyUploaded(files);
  const cli = await verifyReport(join(root, "reports", name));
  const same =
    up.pass === cli.pass &&
    JSON.stringify(up.checks.map((c) => [c.name, c.status])) ===
      JSON.stringify(cli.checks.map((c) => [c.name, c.status]));
  const ok = up.pass && same;
  console.log(
    `  ${ok ? "OK " : "XX "} verifyUploaded ${name}: web=${up.pass ? "PASS" : "FAIL"} cli=${cli.pass ? "PASS" : "FAIL"} match=${same}`,
  );
  if (!ok) failures++;
}

// Bring-your-own B (guard): a selection holding two different report folders is
// rejected, not silently mixed into one confusing FAIL.
{
  const [a, b] = [reports[0].name, reports[1].name];
  const files = {};
  for (const rn of [a, b]) {
    const d = join(docs, "reports", rn);
    for (const f of await readdir(d)) files[`${rn}/${f}`] = await readFile(join(d, f), "utf8");
  }
  let rejected = false;
  try {
    await web.verifyUploaded(files);
  } catch {
    rejected = true;
  }
  console.log(`  ${rejected ? "OK " : "XX "} verifyUploaded rejects a multi-report selection (${a} + ${b})`);
  if (!rejected) failures++;
}

if (failures > 0) {
  console.error(`\nWEB SMOKE FAILED: ${failures} problem(s)`);
  process.exit(1);
}
console.log(
  "\nweb smoke: all reports verify in-browser and match the CLI, tamper is caught, " +
    "a browser run reproduces the CLI scorecard and an uploaded report verifies",
);
