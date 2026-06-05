import { describe, it, expect } from "vitest";
import {
  BarSchema,
  OrderSchema,
  FillSchema,
  RiskPolicySchema,
  ScorecardSchema,
  GRANULARITIES,
} from "../src/types.js";

describe("BarSchema", () => {
  it("validates a real Bitget candle row", () => {
    const row = ["1780624800000", "63375.01", "63444.98", "62590", "62617.03", "448.73826", "28235687.25137837", "28235687.25137837"];
    const bar = BarSchema.parse({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    });
    expect(bar.time).toBe(1780624800000);
    expect(bar.open).toBe(63375.01);
    expect(bar.close).toBe(62617.03);
  });
});

describe("OrderSchema", () => {
  it("accepts a market buy", () => {
    expect(
      OrderSchema.parse({ symbol: "BTCUSDT", side: "buy", orderType: "market", size: 0.01 }),
    ).toBeTruthy();
  });
  it("accepts a limit sell with price", () => {
    expect(
      OrderSchema.parse({ symbol: "BTCUSDT", side: "sell", orderType: "limit", price: 64000, size: 0.01 }),
    ).toBeTruthy();
  });
});

describe("GRANULARITIES", () => {
  it("contains the Bitget-standard 12 levels", () => {
    expect(GRANULARITIES).toHaveLength(12);
  });
});
