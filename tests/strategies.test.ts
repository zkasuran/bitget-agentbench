import { describe, it, expect } from "vitest";
import type { Bar, BarContext, Order, Position, StrategyAgent } from "../src/types.js";
import { ScorecardSchema } from "../src/types.js";
import { STRATEGIES, listStrategies } from "../src/strategies/registry.js";
import { runBacktest } from "../src/engine/backtest.js";
import { loadFixture } from "../src/sources/fixture-source.js";
import { VERSION } from "../src/version.js";

/**
 * Strategy behaviour tests. Each built-in is a pure function of (bar, history),
 * so we drive it bar by bar over a hand-built close series and assert the
 * orders it emits. The engine is long-only spot, so a correct strategy only ever
 * buys to enter and sells to flatten; it must never sell while flat.
 */

const TRADE_SIZE = 0.01;

/** Build a bar from a close. OHLCV is flat around the close; time is the index. */
function bar(close: number, i: number): Bar {
  return { time: i * 3_600_000, open: close, high: close, low: close, close, volume: 1 };
}

/** A toy long-only position used to drive a strategy over a series. */
function flat(): Position {
  return { symbol: "BTCUSDT", size: 0, avgPrice: 0 };
}

/**
 * Run a strategy over a close series with a toy long-only book: a buy opens a
 * single unit, a sell flattens. Records every order with the bar index it fired
 * on. This mirrors how the engine feeds the strategy (history = prior bars).
 */
function drive(agent: StrategyAgent, closes: number[]): { index: number; order: Order }[] {
  const bars = closes.map(bar);
  const out: { index: number; order: Order }[] = [];
  let pos = flat();
  let cash = 10_000;
  for (let i = 0; i < bars.length; i++) {
    const ctx: BarContext = {
      index: i,
      history: bars.slice(0, i),
      position: pos,
      equity: cash + pos.size * bars[i]!.close,
      cash,
    };
    const orders = agent.onBar(bars[i]!, ctx) as Order[];
    for (const o of orders) {
      out.push({ index: i, order: o });
      // toy long-only bookkeeping
      if (o.side === "buy") {
        pos = { symbol: o.symbol, size: pos.size + o.size, avgPrice: bars[i]!.close };
        cash -= o.size * bars[i]!.close;
      } else {
        const sold = Math.min(o.size, pos.size);
        pos = { ...pos, size: pos.size - sold };
        cash += sold * bars[i]!.close;
      }
    }
  }
  return out;
}

/** A long-only strategy must never emit a sell while the book is flat. */
function neverSellsWhileFlat(agent: StrategyAgent, closes: number[]): boolean {
  const bars = closes.map(bar);
  let size = 0;
  for (let i = 0; i < bars.length; i++) {
    const ctx: BarContext = {
      index: i,
      history: bars.slice(0, i),
      position: { symbol: "BTCUSDT", size, avgPrice: bars[i]!.close },
      equity: 10_000,
      cash: 10_000,
    };
    for (const o of agent.onBar(bars[i]!, ctx) as Order[]) {
      if (o.side === "sell" && size <= 0) return false;
      size += o.side === "buy" ? o.size : -Math.min(o.size, size);
    }
  }
  return true;
}

describe("buy-hold", () => {
  const agent = STRATEGIES["buy-hold"]!;

  it("buys a single unit on the first bar when flat", () => {
    const fills = drive(agent, [100, 101, 102, 103]);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.index).toBe(0);
    expect(fills[0]!.order.side).toBe("buy");
    expect(fills[0]!.order.size).toBe(TRADE_SIZE);
  });

  it("never sells, holds to the end", () => {
    const closes = [100, 120, 80, 60, 140, 90];
    const fills = drive(agent, closes);
    expect(fills.filter((f) => f.order.side === "sell")).toHaveLength(0);
    expect(neverSellsWhileFlat(agent, closes)).toBe(true);
  });
});

describe("donchian-breakout", () => {
  const agent = STRATEGIES["donchian-breakout"]!;

  it("buys when close breaks above the prior N-bar high", () => {
    const closes = Array(25).fill(100);
    closes.push(101); // breakout above the flat channel
    const fills = drive(agent, closes);
    const buys = fills.filter((f) => f.order.side === "buy");
    expect(buys).toHaveLength(1);
    expect(buys[0]!.index).toBe(25);
  });

  it("sells to flatten when close breaks below the prior M-bar low", () => {
    // climb to force entry, then drop below the recent channel low
    const closes = [...Array(25).fill(100), 101, ...Array(12).fill(101), 99];
    const fills = drive(agent, closes);
    const sells = fills.filter((f) => f.order.side === "sell");
    expect(sells.length).toBeGreaterThanOrEqual(1);
    expect(sells[sells.length - 1]!.order.side).toBe("sell");
  });

  it("does nothing inside the channel and never sells while flat", () => {
    const closes = Array(40).fill(100); // perfectly flat: no breakout either way
    expect(drive(agent, closes)).toHaveLength(0);
    expect(neverSellsWhileFlat(agent, [100, 100, 101, 99, 100, 102, 98])).toBe(true);
  });
});

describe("bollinger-meanrev", () => {
  const agent = STRATEGIES["bollinger-meanrev"]!;

  // 20 prior closes, ten at 90 and ten at 110: mean 100, population sd 10,
  // so the 2-sigma lower band is 80 and the middle band is 100.
  const window20 = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 90 : 110));

  it("buys when close pierces below the lower band", () => {
    const closes = [...window20, 79]; // 79 < lower band (80), flat
    const fills = drive(agent, closes);
    const buys = fills.filter((f) => f.order.side === "buy");
    expect(buys).toHaveLength(1);
    expect(buys[0]!.index).toBe(20);
  });

  it("sells to flatten once price reverts above the middle band", () => {
    // enter at 79; the next bar at 101 is back above the (rolling) middle band, so exit
    const closes = [...window20, 79, 101];
    const fills = drive(agent, closes);
    expect(fills.filter((f) => f.order.side === "buy")).toHaveLength(1);
    const sells = fills.filter((f) => f.order.side === "sell");
    expect(sells).toHaveLength(1);
    expect(sells[0]!.index).toBe(21);
  });

  it("does nothing between the bands and never sells while flat", () => {
    const closes = [...window20, 95]; // inside the bands, flat
    expect(drive(agent, closes)).toHaveLength(0);
    expect(neverSellsWhileFlat(agent, [...window20, 79, 85, 101])).toBe(true);
  });
});

describe("macd-crossover", () => {
  const agent = STRATEGIES["macd-crossover"]!;

  it("buys on a bullish cross during a sustained uptrend", () => {
    // long flat base then a steady ramp: the fast EMA pulls MACD above signal
    const closes = [...Array(40).fill(100), ...Array.from({ length: 25 }, (_, i) => 100 + (i + 1) * 2)];
    const fills = drive(agent, closes);
    const buys = fills.filter((f) => f.order.side === "buy");
    expect(buys.length).toBeGreaterThanOrEqual(1);
    expect(buys[0]!.order.side).toBe("buy");
  });

  it("sells on a bearish cross after the trend turns down", () => {
    const up = Array.from({ length: 25 }, (_, i) => 100 + (i + 1) * 2);
    const down = Array.from({ length: 25 }, (_, i) => up[up.length - 1]! - (i + 1) * 2);
    const closes = [...Array(40).fill(100), ...up, ...down];
    const fills = drive(agent, closes);
    expect(fills.some((f) => f.order.side === "buy")).toBe(true);
    expect(fills.some((f) => f.order.side === "sell")).toBe(true);
    expect(neverSellsWhileFlat(agent, closes)).toBe(true);
  });

  it("emits nothing before there is enough history for a signal", () => {
    expect(drive(agent, Array.from({ length: 20 }, (_, i) => 100 + i))).toHaveLength(0);
  });
});

describe("vwap-reversion", () => {
  const agent = STRATEGIES["vwap-reversion"]!;

  it("buys when close trades below the rolling VWAP band", () => {
    const closes = [...Array(20).fill(100), 95]; // VWAP ~100, 95 is well below
    const fills = drive(agent, closes);
    const buys = fills.filter((f) => f.order.side === "buy");
    expect(buys).toHaveLength(1);
    expect(buys[0]!.index).toBe(20);
  });

  it("sells to flatten once price reverts back to VWAP", () => {
    const closes = [...Array(20).fill(100), 95, 101]; // enter cheap, exit at/above VWAP
    const fills = drive(agent, closes);
    expect(fills.filter((f) => f.order.side === "buy")).toHaveLength(1);
    expect(fills.filter((f) => f.order.side === "sell")).toHaveLength(1);
  });

  it("does nothing at fair value and never sells while flat", () => {
    expect(drive(agent, [...Array(20).fill(100), 100])).toHaveLength(0);
    expect(neverSellsWhileFlat(agent, [...Array(20).fill(100), 95, 100, 101])).toBe(true);
  });
});

describe("atr-channel", () => {
  const agent = STRATEGIES["atr-channel"]!;

  // oscillate to build a non-zero ATR, then break out well above the channel
  const choppy = Array.from({ length: 25 }, (_, i) => (i % 2 === 0 ? 99 : 101));

  it("buys exactly once on a breakout above the upper ATR channel", () => {
    const fills = drive(agent, [...choppy, 120]);
    expect(fills.filter((f) => f.order.side === "buy")).toHaveLength(1);
    expect(fills.filter((f) => f.order.side === "sell")).toHaveLength(0);
    expect(fills[0]!.index).toBe(25);
  });

  it("sells to flatten when price falls back below the middle", () => {
    const fills = drive(agent, [...choppy, 120, 80]);
    expect(fills.some((f) => f.order.side === "buy")).toBe(true);
    expect(fills.some((f) => f.order.side === "sell")).toBe(true);
    expect(neverSellsWhileFlat(agent, [...choppy, 120, 80, 100])).toBe(true);
  });

  it("emits nothing before there is enough history", () => {
    expect(drive(agent, Array.from({ length: 10 }, (_, i) => 100 + i))).toHaveLength(0);
  });
});

describe("momentum", () => {
  const agent = STRATEGIES["momentum"]!;

  it("goes long exactly once when lookback return turns positive", () => {
    const closes = [...Array(20).fill(100), ...Array.from({ length: 10 }, (_, i) => 100 + (i + 1) * 3)];
    const fills = drive(agent, closes);
    // First full lookback window is at index 20: close 103 vs close[0]=100, +3%.
    expect(fills.filter((f) => f.order.side === "buy")).toHaveLength(1);
    expect(fills.filter((f) => f.order.side === "sell")).toHaveLength(0);
    expect(fills[0]!.index).toBe(20);
  });

  it("flattens when momentum turns negative", () => {
    const up = Array.from({ length: 12 }, (_, i) => 100 + (i + 1) * 3);
    const down = Array.from({ length: 25 }, (_, i) => up[up.length - 1]! - (i + 1) * 3);
    const closes = [...Array(20).fill(100), ...up, ...down];
    const fills = drive(agent, closes);
    expect(fills.some((f) => f.order.side === "buy")).toBe(true);
    expect(fills.some((f) => f.order.side === "sell")).toBe(true);
    expect(neverSellsWhileFlat(agent, closes)).toBe(true);
  });

  it("emits nothing before the lookback window is filled", () => {
    expect(drive(agent, Array.from({ length: 10 }, () => 100))).toHaveLength(0);
  });
});

describe("registry", () => {
  const expected = [
    "sma-crossover",
    "rsi-meanrev",
    "buy-hold",
    "donchian-breakout",
    "bollinger-meanrev",
    "macd-crossover",
    "vwap-reversion",
    "atr-channel",
    "momentum",
  ];

  it("exposes every built-in by name", () => {
    for (const name of expected) expect(listStrategies()).toContain(name);
  });

  it("each built-in carries its own name", () => {
    for (const name of expected) expect(STRATEGIES[name]!.name).toBe(name);
  });

  it.each(expected)("runs %s end-to-end and emits a valid scorecard", async (name) => {
    const bars = loadFixture("BTCUSDT", "4h");
    const { scorecard, fills } = await runBacktest({
      agent: STRATEGIES[name]!,
      bars,
      config: { startingEquity: 10_000, feeBps: 10, slippageBps: 1, seed: 42 },
      risk: { maxDrawdownKill: 0.5 },
      manifest: {
        agentbenchVersion: VERSION,
        symbol: "BTCUSDT",
        granularity: "4h",
        source: "fixture",
        bars: bars.length,
        firstBarTime: bars[0]!.time,
        lastBarTime: bars[bars.length - 1]!.time,
        datasetSha256: "fixture",
      },
    });
    expect(scorecard.agent).toBe(name);
    expect(() => ScorecardSchema.parse(scorecard)).not.toThrow();
    expect(Number.isFinite(scorecard.metrics.totalReturnPct)).toBe(true);
    // long-only spot: the book is never net short at any fill
    for (const f of fills) expect(f.equityAfter).toBeGreaterThan(0);
  });
});
