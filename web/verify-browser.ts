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
// The fs shim instance the bundle aliases node:fs to. Importing it here gives us
// the same module instance the verifier reads from.
// @ts-expect-error - plain JS shim, no types
import * as vfs from "./shims/node-fs.js";

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
  // Fixture candles drive dataset + replay. defaultFixtureDir resolves to
  // /fixtures in the browser, so load the candle file there.
  const sc = JSON.parse(scorecardText);
  const m = sc.manifest;
  if (m && m.source === "fixture") {
    const file = `${m.symbol}-${m.granularity}.json`;
    vfs.loadFile(`/fixtures/${file}`, await fetchText(`fixtures/${file}`));
  }
}

/** Verify a committed report exactly as the CLI would. */
export async function verifyByName(name: string): Promise<VerifyResult> {
  const scorecardText = await fetchText(`reports/${name}/scorecard.json`);
  await loadReportIntoVfs(name, scorecardText);
  return verifyReport(`/reports/${name}`);
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
