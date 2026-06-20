/**
 * Bollinger Band mean-reversion.
 *
 * Build a band from the prior PERIOD closes: the middle is their simple moving
 * average, the lower/upper rails sit K population standard deviations away. Buy
 * when the close pierces below the lower rail (stretched cheap), then flatten
 * once it reverts back above the middle band (mean reached).
 *
 * A volatility-band counterpart to rsi-meanrev: same mean-reversion idea, a
 * different lens (dispersion instead of an oscillator), so the two disagree on
 * real data and the scorecard shows it.
 *
 * Long-only spot, no lookahead: the band is computed from bars strictly before
 * the current one and compared against the just-closed price.
 *
 * Usage:
 *   npx agentbench run --strategy bollinger-meanrev --symbol BTCUSDT --tf 4h --out ./report
 */

import type { StrategyAgent, BarContext, Bar, Order } from "../index.js";

const PERIOD = 20; // band lookback
const K = 2;       // standard deviations to each rail
const TRADE_SIZE = 0.01;

interface Band {
  middle: number;
  lower: number;
  upper: number;
}

/** Bollinger band over the last `period` closes, or null if not enough bars. */
function band(bars: readonly Bar[], period: number, k: number): Band | null {
  if (bars.length < period) return null;
  const closes = bars.slice(-period).map((b) => b.close);
  const mean = closes.reduce((a, b) => a + b, 0) / period;
  const variance = closes.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { middle: mean, lower: mean - k * sd, upper: mean + k * sd };
}

const agent: StrategyAgent = {
  name: "bollinger-meanrev",

  onBar(bar: Bar, ctx: BarContext): Order[] {
    const b = band(ctx.history, PERIOD, K);
    if (b === null) return [];

    const symbol = ctx.position.symbol || "BTCUSDT";

    // Stretched below the lower rail and flat -> buy the dip.
    if (ctx.position.size <= 0 && bar.close < b.lower) {
      return [{ symbol, side: "buy", orderType: "market", size: TRADE_SIZE, tag: "below-lower" }];
    }

    // Reverted back to the mean and long -> take it off.
    if (ctx.position.size > 0 && bar.close > b.middle) {
      return [{ symbol, side: "sell", orderType: "market", size: ctx.position.size, tag: "revert-mean" }];
    }

    return [];
  },
};

export default agent;
