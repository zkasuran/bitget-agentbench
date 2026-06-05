import { describe, it, expect } from "vitest";
import { parseRawCandles } from "../src/sources/fixture-source.js";

// Raw candle rows: [ts, open, high, low, close, baseVol, quoteVol, quoteVol]
const NEWEST_FIRST: [string, string, string, string, string, string, string, string][] = [
  ["3000", "30", "31", "29", "30.5", "1", "1", "1"],
  ["2000", "20", "21", "19", "20.5", "1", "1", "1"],
  ["1000", "10", "11", "9", "10.5", "1", "1", "1"],
];

const OLDEST_FIRST: [string, string, string, string, string, string, string, string][] = [
  ["1000", "10", "11", "9", "10.5", "1", "1", "1"],
  ["2000", "20", "21", "19", "20.5", "1", "1", "1"],
  ["3000", "30", "31", "29", "30.5", "1", "1", "1"],
];

describe("parseRawCandles", () => {
  it("sorts newest-first input into oldest-first bars", () => {
    const bars = parseRawCandles(NEWEST_FIRST);
    expect(bars.map((b) => b.time)).toEqual([1000, 2000, 3000]);
  });

  it("keeps oldest-first input oldest-first (regression: no blind reverse)", () => {
    const bars = parseRawCandles(OLDEST_FIRST);
    expect(bars.map((b) => b.time)).toEqual([1000, 2000, 3000]);
  });

  it("converts string fields to numbers correctly", () => {
    const bars = parseRawCandles(OLDEST_FIRST);
    expect(bars[0]).toEqual({
      time: 1000, open: 10, high: 11, low: 9, close: 10.5, volume: 1,
    });
  });

  it("produces strictly increasing timestamps", () => {
    const bars = parseRawCandles(NEWEST_FIRST);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i]!.time).toBeGreaterThan(bars[i - 1]!.time);
    }
  });
});
