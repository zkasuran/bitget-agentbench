/**
 * Fixture source — reads committed JSON candle files.
 * Zero network, zero credentials, fully deterministic.
 *
 * Candle format (verified from live Bitget calls 2026-06-05):
 *   [ts_ms_str, open_str, high_str, low_str, close_str, baseVol_str, quoteVol_str, quoteVol_str]
 * All fields are strings. This source normalises them to Bar objects.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Bar, Granularity } from "../types.js";

/** Raw shape of a single candle in the Bitget JSON response. */
type RawCandle = [string, string, string, string, string, string, string, string?];

/**
 * Load bars from a committed fixture file. Looks in the package's
 * `fixtures/` dir by default, or at an explicit path.
 *
 * Expected filename matches `SYMBOL-TF.json`, e.g. `BTCUSDT-1h.json`.
 */
export function loadFixture(
  symbol: string,
  granularity: Granularity,
  fixtureDir?: string,
): Bar[] {
  const dir = fixtureDir ?? defaultFixtureDir();
  const filename = `${symbol}-${granularity}.json`;
  const full = resolve(dir, filename);

  if (!existsSync(full)) {
    throw new Error(
      `Fixture not found: ${full}. Run the capture script or use --source candles.`,
    );
  }

  const payload = JSON.parse(readFileSync(full, "utf8"));
  // The fixture file is the full Bitget API response { code, msg, requestTime, data }
  const data: RawCandle[] | undefined = payload?.data ?? payload;
  if (!Array.isArray(data)) {
    throw new Error(`Fixture ${full}: expected array at .data or root, got ${typeof data}`);
  }
  return parseRawCandles(data);
}

/**
 * Parse the raw Bitget candle array into Bar objects, sorted oldest-first.
 *
 * Bitget endpoints are not consistent about order: the plain candles endpoint
 * returns newest-first, while history-candles with start/end returns
 * oldest-first. We sort by time ascending so chronological replay is always
 * correct regardless of the source's order.
 */
export function parseRawCandles(raw: RawCandle[]): Bar[] {
  return raw
    .map((row) => ({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    .sort((a, b) => a.time - b.time);
}

/** Guess the fixture directory relative to the package root. */
function defaultFixtureDir(): string {
  // When running from dist/cli.js, fixtures live at ../fixtures.
  // When running from src/ via vitest, we use the workspace root.
  const candidates = [
    resolve(import.meta.dirname ?? ".", "..", "fixtures"),
    resolve(import.meta.dirname ?? ".", "..", "..", "fixtures"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error("Cannot locate fixtures/ directory.");
}
