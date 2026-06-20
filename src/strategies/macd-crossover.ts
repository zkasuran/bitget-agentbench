/**
 * MACD signal-line crossover (Appel's classic momentum trigger).
 *
 * MACD is the fast EMA minus the slow EMA; the signal line is an EMA of MACD.
 * Go long when MACD crosses up through its signal line (momentum turning up),
 * flatten when it crosses back down. EMA-based, so it reacts to the same trends
 * sma-crossover does but weights recent bars more, which moves the timing.
 *
 * Long-only spot, no lookahead: every EMA is built from closes up to and
 * including the just-closed bar, and the cross is read off the last two points.
 *
 * Usage:
 *   npx agentbench run --strategy macd-crossover --symbol BTCUSDT --tf 4h --out ./report
 */

import type { StrategyAgent, BarContext, Bar, Order } from "../index.js";

const FAST = 12;
const SLOW = 26;
const SIGNAL = 9;
const TRADE_SIZE = 0.01;

/**
 * EMA series aligned to `values`: entry i holds the EMA at index i, or undefined
 * before the seed is established. The seed is the SMA of the first `period`
 * values (Wilder/Appel convention), then the standard recursive update.
 */
function emaSeries(values: readonly number[], period: number): (number | undefined)[] {
  const out = new Array<number | undefined>(values.length).fill(undefined);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i]!;
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

interface MacdState {
  macdNow: number;
  signalNow: number;
  macdPrev: number;
  signalPrev: number;
}

/**
 * MACD and signal at the last two bars, or null until both are defined at both
 * points (so a crossover can be read). Pure function of the close series.
 */
function macd(closes: readonly number[]): MacdState | null {
  const fast = emaSeries(closes, FAST);
  const slow = emaSeries(closes, SLOW);
  const macdLine = closes.map((_, i) =>
    fast[i] !== undefined && slow[i] !== undefined ? fast[i]! - slow[i]! : undefined,
  );
  // The signal is an EMA over the defined MACD values, which start at SLOW-1.
  const startIdx = SLOW - 1;
  const defined = macdLine.slice(startIdx).filter((v): v is number => v !== undefined);
  const sig = emaSeries(defined, SIGNAL);
  const signalLine = new Array<number | undefined>(closes.length).fill(undefined);
  for (let j = 0; j < sig.length; j++) {
    if (sig[j] !== undefined) signalLine[startIdx + j] = sig[j];
  }

  const n = closes.length;
  const macdNow = macdLine[n - 1];
  const signalNow = signalLine[n - 1];
  const macdPrev = macdLine[n - 2];
  const signalPrev = signalLine[n - 2];
  if (
    macdNow === undefined || signalNow === undefined ||
    macdPrev === undefined || signalPrev === undefined
  ) {
    return null;
  }
  return { macdNow, signalNow, macdPrev, signalPrev };
}

const agent: StrategyAgent = {
  name: "macd-crossover",

  onBar(bar: Bar, ctx: BarContext): Order[] {
    const closes = [...ctx.history, bar].map((b) => b.close);
    const m = macd(closes);
    if (m === null) return [];

    const symbol = ctx.position.symbol || "BTCUSDT";

    // Bullish cross: MACD crosses up through the signal line.
    if (m.macdPrev <= m.signalPrev && m.macdNow > m.signalNow && ctx.position.size <= 0) {
      return [{ symbol, side: "buy", orderType: "market", size: TRADE_SIZE, tag: "macd-up" }];
    }

    // Bearish cross: MACD crosses back down -> flatten.
    if (m.macdPrev >= m.signalPrev && m.macdNow < m.signalNow && ctx.position.size > 0) {
      return [{ symbol, side: "sell", orderType: "market", size: ctx.position.size, tag: "macd-down" }];
    }

    return [];
  },
};

export default agent;
