import { describe, it, expect } from "vitest";
import {
  fillOrder,
  applyFill,
  executeOrder,
  newSimState,
} from "../src/engine/simulator.js";
import type { Order, EngineConfig } from "../src/types.js";

// Default config matching Bitget spot standard fee (0.1% = 10 bps),
// verified from Bitget Academy 2026-06-05.
const CONFIG: EngineConfig = {
  startingEquity: 10_000,
  feeBps: 10,
  slippageBps: 1, // 0.01% slippage on market orders
  seed: 1,
};

// Real BTCUSDT 1h bar from the committed fixture (bar index 1).
const BAR1 = {
  time: 1780588800000,
  open: 63897.36,
  high: 63922,
  low: 63448.24,
  close: 63561,
  volume: 340.348267,
};

// --- fillOrder (pure — no state mutation) ---

describe("fillOrder", () => {
  it("market buy fills at open with slippage against the trader", () => {
    const order: Order = {
      symbol: "BTCUSDT",
      side: "buy",
      orderType: "market",
      size: 0.01,
    };
    const fill = fillOrder(order, BAR1, CONFIG, 0)!;
    expect(fill).not.toBeNull();
    // open=63897.36, slippage buy = open * 1.0001
    const expectedPrice = 63897.36 * 1.0001;
    expect(fill.price).toBeCloseTo(expectedPrice, 4);
    expect(fill.size).toBe(0.01);
    expect(fill.side).toBe("buy");
    expect(fill.orderType).toBe("market");
    // fee = notional * 0.0010
    const expectedFee = expectedPrice * 0.01 * 0.001;
    expect(fill.fee).toBeCloseTo(expectedFee, 6);
  });

  it("market sell fills at open with slippage against the trader", () => {
    const order: Order = {
      symbol: "BTCUSDT",
      side: "sell",
      orderType: "market",
      size: 0.01,
    };
    const fill = fillOrder(order, BAR1, CONFIG, 0)!;
    expect(fill).not.toBeNull();
    // slippage sell = open * 0.9999
    const expectedPrice = 63897.36 * 0.9999;
    expect(fill.price).toBeCloseTo(expectedPrice, 4);
  });

  it("limit buy fills when bar low <= limit price", () => {
    const order: Order = {
      symbol: "BTCUSDT",
      side: "buy",
      orderType: "limit",
      price: 63500, // bar low is 63448.24, so this should fill
      size: 0.01,
    };
    const fill = fillOrder(order, BAR1, CONFIG, 0)!;
    expect(fill).not.toBeNull();
    // limit fills at the limit price, no slippage
    expect(fill.price).toBe(63500);
    expect(fill.slippage).toBe(0);
  });

  it("limit buy does NOT fill when bar low > limit price", () => {
    const order: Order = {
      symbol: "BTCUSDT",
      side: "buy",
      orderType: "limit",
      price: 63000, // bar low is 63448.24, limit too low
      size: 0.01,
    };
    expect(fillOrder(order, BAR1, CONFIG, 0)).toBeNull();
  });

  it("limit sell fills when bar high >= limit price", () => {
    const order: Order = {
      symbol: "BTCUSDT",
      side: "sell",
      orderType: "limit",
      price: 63900, // bar high is 63922, so this fills
      size: 0.01,
    };
    const fill = fillOrder(order, BAR1, CONFIG, 0)!;
    expect(fill).not.toBeNull();
    expect(fill.price).toBe(63900);
  });

  it("limit sell does NOT fill when bar high < limit price", () => {
    const order: Order = {
      symbol: "BTCUSDT",
      side: "sell",
      orderType: "limit",
      price: 64000, // bar high is 63922, too low to hit
      size: 0.01,
    };
    expect(fillOrder(order, BAR1, CONFIG, 0)).toBeNull();
  });
});

// --- applyFill (mutates state) ---

describe("applyFill", () => {
  it("buy increases position and reduces cash by notional + fee", () => {
    const state = newSimState(10_000);
    const fill = fillOrder(
      { symbol: "BTCUSDT", side: "buy", orderType: "market", size: 0.01 },
      BAR1,
      CONFIG,
      0,
    )!;

    const result = applyFill(fill, state);

    expect(state.size).toBe(0.01);
    expect(state.avgPrice).toBeCloseTo(63897.36 * 1.0001, 2); // VWAP entry
    // Cash = 10000 - notional - fee
    const notional = result.price * 0.01;
    const fee = result.fee;
    expect(state.cash).toBeCloseTo(10_000 - notional - fee, 4);
    // Opening buy -> no realised PnL
    expect(result.realizedPnl).toBe(0);
    // Equity = cash + position * fillPrice (marked at execution price)
    const expectedEquity = state.cash + state.size * result.price;
    expect(result.equityAfter).toBeCloseTo(expectedEquity, 4);
  });

  it("sell closes a long and books realised PnL", () => {
    const state = newSimState(10_000);
    // First, buy 0.01 BTC
    const buyFill = fillOrder(
      { symbol: "BTCUSDT", side: "buy", orderType: "market", size: 0.01 },
      BAR1,
      CONFIG,
      0,
    )!;
    applyFill(buyFill, state);
    const entryPrice = state.avgPrice;
    const cashAfterBuy = state.cash;

    // Then sell 0.01 BTC on a different bar (higher price for a win)
    const BAR2 = {
      time: 1780592400000,
      open: 63561,
      high: 63723.87,
      low: 62945.22,
      close: 63543.49,
      volume: 405.689157,
    };
    const sellFill = fillOrder(
      { symbol: "BTCUSDT", side: "sell", orderType: "market", size: 0.01 },
      BAR2,
      CONFIG,
      1,
    )!;
    const result = applyFill(sellFill, state);

    // Position should be closed
    expect(state.size).toBe(0);
    expect(state.avgPrice).toBe(0);
    // PnL: (sellPrice - entryPrice) * size
    const expectedPnl = (sellFill.price - entryPrice) * 0.01;
    expect(result.realizedPnl).toBeCloseTo(expectedPnl, 4);
    // Cash after sell = cashAfterBuy + sellProceeds - fee
    const sellProceeds = sellFill.price * 0.01;
    expect(state.cash).toBeCloseTo(cashAfterBuy + sellProceeds - sellFill.fee, 4);
  });

  it("oversell is clamped to held size (no cash leak, long-only)", () => {
    const state = newSimState(10_000);
    // Buy 0.01 BTC
    applyFill(
      fillOrder(
        { symbol: "BTCUSDT", side: "buy", orderType: "market", size: 0.01 },
        BAR1,
        CONFIG,
        0,
      )!,
      state,
    );
    const cashAfterBuy = state.cash;

    // Try to sell 0.05 (5x the held position) — should clamp to 0.01.
    const BAR2 = {
      time: 1780592400000, open: 63561, high: 63723.87,
      low: 62945.22, close: 63543.49, volume: 405.689157,
    };
    const sellFill = fillOrder(
      { symbol: "BTCUSDT", side: "sell", orderType: "market", size: 0.05 },
      BAR2,
      CONFIG,
      1,
    )!;
    applyFill(sellFill, state);

    // Position flat, not negative (no short).
    expect(state.size).toBe(0);
    // Fill size clamped to what was held.
    expect(sellFill.size).toBeCloseTo(0.01, 8);
    // Cash credited only for the 0.01 actually sold, not 0.05.
    const sellProceeds = sellFill.price * 0.01;
    expect(state.cash).toBeCloseTo(cashAfterBuy + sellProceeds - sellFill.fee, 4);
  });

  it("partial sell reduces position proportionally", () => {
    const state = newSimState(10_000);
    // Buy 0.02 BTC
    applyFill(
      fillOrder(
        { symbol: "BTCUSDT", side: "buy", orderType: "market", size: 0.02 },
        BAR1,
        CONFIG,
        0,
      )!,
      state,
    );
    const entryAvg = state.avgPrice;
    const cashAfterBuy = state.cash;

    // Sell 0.01 (half)
    const BAR2 = {
      time: 1780592400000,
      open: 63561,
      high: 63723.87,
      low: 62945.22,
      close: 63543.49,
      volume: 405.689157,
    };
    const sellFill = fillOrder(
      { symbol: "BTCUSDT", side: "sell", orderType: "market", size: 0.01 },
      BAR2,
      CONFIG,
      1,
    )!;
    applyFill(sellFill, state);

    // Half position remains, avgPrice unchanged
    expect(state.size).toBe(0.01);
    expect(state.avgPrice).toBeCloseTo(entryAvg, 2);
  });
});

// --- executeOrder (convenience composite) ---

describe("executeOrder", () => {
  it("fills and updates state in one call", () => {
    const state = newSimState(10_000);
    const result = executeOrder(
      { symbol: "BTCUSDT", side: "buy", orderType: "market", size: 0.01 },
      BAR1,
      state,
      CONFIG,
    );
    expect(result).not.toBeNull();
    expect(state.size).toBe(0.01);
    expect(result!.realizedPnl).toBe(0); // opening
  });

  it("sell with no position is a no-op (null, no ledger row)", () => {
    const state = newSimState(10_000);
    const result = executeOrder(
      { symbol: "BTCUSDT", side: "sell", orderType: "market", size: 0.01 },
      BAR1,
      state,
      CONFIG,
    );
    expect(result).toBeNull();
    expect(state.size).toBe(0);
    expect(state.cash).toBe(10_000); // no phantom cash credit
  });

  it("returns null when limit not hit (no state change)", () => {
    const state = newSimState(10_000);
    const result = executeOrder(
      { symbol: "BTCUSDT", side: "buy", orderType: "limit", price: 1000, size: 1 },
      BAR1,
      state,
      CONFIG,
    );
    expect(result).toBeNull();
    expect(state.size).toBe(0); // no change
    expect(state.cash).toBe(10_000); // no change
  });
});
