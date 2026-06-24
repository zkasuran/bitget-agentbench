/**
 * Browser entry for client-side verification.
 *
 * It runs the REAL verifyReport from src/verify.ts, unchanged. The only thing
 * that differs from the CLI is where bytes come from: node:fs/node:path/node:crypto
 * are aliased (at bundle time) to browser shims, and this module fetches every
 * file a report needs, loads them into the in-memory fs, then calls verifyReport
 * synchronously over them. So the page recomputes the same numbers, with the same
 * code, as the CLI. There is no second verifier.
 */

import { verifyReport } from "../src/verify.js";
import type { VerifyResult } from "../src/verify.js";
import { runBacktest } from "../src/engine/backtest.js";
import { emitReport, hashDataset } from "../src/report/emit.js";
import { fetchRawCandles } from "../src/sources/candle-source.js";
import { loadFixture, parseRawCandles } from "../src/sources/fixture-source.js";
import { STRATEGIES, listStrategies } from "../src/strategies/registry.js";
import type { Bar, Granularity } from "../src/types.js";
// The fs shim instance the bundle aliases node:fs to. Importing it here gives us
// the same module instance the verifier reads from.
// @ts-expect-error - plain JS shim, no types
import * as vfs from "./shims/node-fs.js";

// Injected by build-web.mjs from package.json. version.ts reads package.json via
// readFileSync at module load, which the browser cannot do, so the build stamps
// the version in here as a constant. Same single source of truth, no fs read.
declare const __AGENTBENCH_VERSION__: string;
const VERSION = __AGENTBENCH_VERSION__;

const BASE = new URL(".", import.meta.url).href; // directory this bundle is served from

async function fetchText(rel: string): Promise<string> {
  const res = await fetch(BASE + rel);
  if (!res.ok) throw new Error(`fetch ${rel} -> HTTP ${res.status}`);
  return res.text();
}

interface ReportInfo {
  name: string;
  symbol: string;
  granularity: string;
  agent: string;
}

/** Headline numbers shown next to a PASS, so the page reveals what the strategy
 *  actually did, not only that the scorecard reproduces. Read straight off the
 *  scorecard the verifier already loaded, so they cannot disagree with verify. */
export interface ReportSummary {
  symbol: string;
  granularity: string;
  source: string;
  bars: number;
  totalReturnPct: number;
  sharpe: number;
  maxDrawdownPct: number;
  winRatePct: number;
  totalTrades: number;
}

interface ScorecardLike {
  metrics: Record<string, number>;
  manifest: { symbol: string; granularity: string; source: string; bars: number };
}

function summarize(scorecardText: string): ReportSummary {
  const sc = JSON.parse(scorecardText) as ScorecardLike;
  const m = sc.metrics;
  const man = sc.manifest;
  return {
    symbol: man.symbol,
    granularity: man.granularity,
    source: man.source,
    bars: man.bars,
    totalReturnPct: m.totalReturnPct,
    sharpe: m.sharpe,
    maxDrawdownPct: m.maxDrawdownPct,
    winRatePct: m.winRatePct,
    totalTrades: m.totalTrades,
  };
}

/** Read the build-generated index of committed reports. */
export async function listReports(): Promise<ReportInfo[]> {
  const raw = await fetchText("reports-index.json");
  return JSON.parse(raw) as ReportInfo[];
}

async function loadReportIntoVfs(name: string, scorecardText: string): Promise<void> {
  vfs.reset();
  const dir = `/reports/${name}`;
  vfs.loadFile(`${dir}/scorecard.json`, scorecardText);
  // equity + trades drive the ledger check.
  vfs.loadFile(`${dir}/equity.csv`, await fetchText(`reports/${name}/equity.csv`));
  vfs.loadFile(`${dir}/trades.jsonl`, await fetchText(`reports/${name}/trades.jsonl`));
  // Candles drive dataset + replay. A fixture run loads the named fixture from
  // /fixtures (defaultFixtureDir resolves there in the browser); a live run keeps
  // a candles.json snapshot next to its report. Load whichever this report uses
  // so dataset and replay run, not SKIP.
  const sc = JSON.parse(scorecardText);
  const m = sc.manifest;
  if (m && m.source === "fixture") {
    const file = `${m.symbol}-${m.granularity}.json`;
    vfs.loadFile(`/fixtures/${file}`, await fetchText(`fixtures/${file}`));
  } else if (m && m.source === "candles") {
    vfs.loadFile(`${dir}/candles.json`, await fetchText(`reports/${name}/candles.json`));
  }
}

/** Verify a committed report exactly as the CLI would. Carries the scorecard's
 *  headline numbers so the page can show them next to the verdict. */
export async function verifyByName(
  name: string,
): Promise<VerifyResult & { summary: ReportSummary }> {
  const scorecardText = await fetchText(`reports/${name}/scorecard.json`);
  await loadReportIntoVfs(name, scorecardText);
  const result = await verifyReport(`/reports/${name}`);
  return { ...result, summary: summarize(scorecardText) };
}

export interface TamperSpec {
  field: string; // dotted path under scorecard, e.g. "metrics.totalReturnPct"
  value: unknown; // the doctored value
}

/**
 * Verify a doctored copy of a report. The on-disk files are never touched: we
 * fetch the real scorecard, edit one field in memory and verify the edited copy.
 * The point is to watch verify catch the lie live, naming the failing checks.
 */
export async function verifyTampered(name: string, spec: TamperSpec): Promise<{
  result: VerifyResult;
  original: unknown;
  doctored: unknown;
}> {
  const scorecardText = await fetchText(`reports/${name}/scorecard.json`);
  const sc = JSON.parse(scorecardText);
  const { container, key, original } = resolvePath(sc, spec.field);
  container[key] = spec.value;
  await loadReportIntoVfs(name, JSON.stringify(sc));
  const result = await verifyReport(`/reports/${name}`);
  return { result, original, doctored: spec.value };
}

function resolvePath(
  root: Record<string, unknown>,
  dotted: string,
): { container: Record<string, unknown>; key: string; original: unknown } {
  const parts = dotted.split(".");
  let node: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    node = node[parts[i]] as Record<string, unknown>;
    if (node == null || typeof node !== "object") {
      throw new Error(`tamper path ${dotted} is not reachable`);
    }
  }
  const key = parts[parts.length - 1];
  return { container: node, key, original: node[key] };
}

// ---------------------------------------------------------------------------
// Bring-your-own: run a backtest in the browser, then verify it. Same code path
// as the CLI's `run` then `verify`, just over the in-memory fs.
// ---------------------------------------------------------------------------

/** The built-in strategy names, for the page's dropdown. */
export function strategyNames(): string[] {
  return listStrategies();
}

export interface RunSpec {
  strategy: string;
  symbol: string;
  granularity: Granularity;
  source: "fixture" | "live";
  /** Live only: how many candles to fetch (default 200, capped at 1000). */
  limit?: number;
  /** RNG seed, so a run is reproducible (default 1, matching the CLI). */
  seed?: number;
}

/**
 * Run a built-in strategy and verify the result, entirely in the browser. This
 * mirrors the CLI's cmdRun: load candles (a committed fixture, or fresh live
 * candles from Bitget's keyless public endpoint), runBacktest, emitReport into
 * the in-memory fs, snapshot the live candles next to it, then verifyReport over
 * what was just written. The verdict and numbers are the CLI's, recomputed here.
 */
export async function runStrategy(
  spec: RunSpec,
): Promise<VerifyResult & { summary: ReportSummary }> {
  const agent = STRATEGIES[spec.strategy];
  if (!agent) throw new Error(`unknown strategy "${spec.strategy}"`);

  const seed = spec.seed ?? 1;
  // Fixed output dir: the report contents do not depend on the path, and a
  // constant keeps a free-text symbol from steering files to an odd vfs path.
  const out = `/run/report`;
  const fixtureFile = `/fixtures/${spec.symbol}-${spec.granularity}.json`;

  // Fetch everything BEFORE touching the vfs, so a failed live fetch (CORS, HTTP
  // error, empty data) leaves the previous run's state alone rather than wiping
  // it and stranding a stale result card.
  let rawSnapshot: Awaited<ReturnType<typeof fetchRawCandles>> | null = null;
  let fixtureText: string | null = null;
  if (spec.source === "live") {
    const limit = spec.limit ?? 200;
    // Keyless public endpoint, served with Access-Control-Allow-Origin: *, so
    // the browser can fetch it directly. No key, no account, no real money.
    rawSnapshot = await fetchRawCandles({ symbol: spec.symbol, granularity: spec.granularity, limit });
  } else {
    // loadFixture reads the fixture file via the fs shim, so fetch the committed
    // fixture first (the same file the verifier uses).
    fixtureText = await fetchText(`fixtures/${spec.symbol}-${spec.granularity}.json`);
  }

  // Fetch succeeded: now it is safe to claim the vfs and build the run.
  vfs.reset();
  let bars: Bar[];
  let manifestSource: "fixture" | "candles";
  if (rawSnapshot) {
    bars = parseRawCandles(rawSnapshot.data as Parameters<typeof parseRawCandles>[0]);
    manifestSource = "candles";
  } else {
    vfs.loadFile(fixtureFile, fixtureText!);
    bars = loadFixture(spec.symbol, spec.granularity);
    manifestSource = "fixture";
  }
  if (bars.length === 0) throw new Error("no candles to run on");

  const config = { startingEquity: 10_000, feeBps: 10, slippageBps: 1, seed };
  const risk = { maxDrawdownKill: 0.3, maxPositionSize: 1.0 };
  const { scorecard, fills, equityCurve } = await runBacktest({
    agent,
    bars,
    config,
    risk,
    manifest: {
      agentbenchVersion: VERSION,
      symbol: spec.symbol,
      granularity: spec.granularity,
      source: manifestSource,
      bars: bars.length,
      firstBarTime: bars[0]?.time ?? 0,
      lastBarTime: bars[bars.length - 1]?.time ?? 0,
      datasetSha256: hashDataset(bars),
    },
  });

  emitReport(scorecard, fills, equityCurve, out);
  // A live run snapshots its candles next to the report so the replay check has
  // the exact data, exactly as the CLI does.
  if (rawSnapshot) vfs.writeFileSync(`${out}/candles.json`, JSON.stringify(rawSnapshot));

  const result = await verifyReport(out);
  return { ...result, summary: summarize(vfs.readFileSync(`${out}/scorecard.json`)) };
}

/**
 * Verify a report the user produced with the CLI, by uploading its files. The
 * files never leave the browser: they are read locally, loaded into the in-memory
 * fs and checked by the same verifyReport. A fixture-sourced report needs its
 * fixture, which the page already ships, so pull it if the upload omitted it.
 */
export async function verifyUploaded(
  files: Record<string, string>,
): Promise<VerifyResult & { summary: ReportSummary }> {
  // Files arrive keyed by their relative path. A folder pick can sweep in more
  // than one report (e.g. the whole reports/ tree), so group by parent directory
  // and verify exactly one report, never a mix of files from sibling dirs.
  const parentOf = (k: string): string => {
    const i = k.lastIndexOf("/");
    return i === -1 ? "" : k.slice(0, i);
  };
  const scorecardDirs = Object.keys(files)
    .filter((k) => k.split("/").pop() === "scorecard.json")
    .map(parentOf);
  if (scorecardDirs.length === 0) throw new Error("no scorecard.json in the uploaded files");
  if (new Set(scorecardDirs).size > 1) {
    throw new Error(
      `found ${scorecardDirs.length} reports in that selection; pick one report folder at a time`,
    );
  }
  const reportDir = scorecardDirs[0]!;

  vfs.reset();
  const dir = "/upload";
  // Load only the files that sit in the same directory as the chosen scorecard,
  // so an equity.csv or candles.json from a different report cannot leak in.
  const REPORT_FILES = ["scorecard.json", "equity.csv", "trades.jsonl", "candles.json"];
  let scorecardText = "";
  for (const [k, v] of Object.entries(files)) {
    if (parentOf(k) !== reportDir) continue;
    const base = k.split("/").pop()!;
    if (REPORT_FILES.includes(base)) {
      vfs.loadFile(`${dir}/${base}`, v);
      if (base === "scorecard.json") scorecardText = v;
    } else if (base.startsWith("agent.snapshot.")) {
      // accepted, though replaying it stays opt-in (verify never runs it here)
      vfs.loadFile(`${dir}/${base}`, v);
    }
  }

  // A fixture run reads /fixtures/<symbol>-<gran>.json. If the upload did not
  // bring candles.json (a live snapshot), it is a fixture run: fetch the fixture
  // the page ships so dataset and replay run instead of skipping.
  const m = (JSON.parse(scorecardText) as { manifest?: { source?: string; symbol?: string; granularity?: string } }).manifest;
  if (m && m.source === "fixture") {
    const file = `${m.symbol}-${m.granularity}.json`;
    if (!vfs.existsSync(`/fixtures/${file}`)) {
      vfs.loadFile(`/fixtures/${file}`, await fetchText(`fixtures/${file}`));
    }
  }

  const result = await verifyReport(dir);
  return { ...result, summary: summarize(scorecardText) };
}
