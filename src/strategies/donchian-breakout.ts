/**
 * Donchian channel breakout (the classic turtle trend-follower).
 *
 * Go long when the close breaks above the highest close of the prior ENTRY bars.
 * Flatten when the close breaks below the lowest close of the prior EXIT bars.
 * The two channels are deliberately different lengths: a slow entry that waits
 * for a real breakout, a faster exit that gives the trend back quickly.
 *
 * Long-only spot, no lookahead: both channels are built from bars strictly
 * before the current one, so the signal uses only information already closed.
 *
 * Usage:
 *   npx agentbench run --strategy donchian-breakout --symbol BTCUSDT --tf 4h --out ./report
 */

import type { StrategyAgent, BarContext, Bar, Order } from "../index.js";

const ENTRY = 20; // breakout lookback for entries
const EXIT = 10;  // breakdown lookback for exits
const TRADE_SIZE = 0.01;

/** Highest close over the last `n` bars, or null if there are not enough. */
function highestClose(bars: readonly Bar[], n: number): number | null {
  if (bars.length < n) return null;
  return Math.max(...bars.slice(-n).map((b) => b.close));
}

/** Lowest close over the last `n` bars, or null if there are not enough. */
function lowestClose(bars: readonly Bar[], n: number): number | null {
  if (bars.length < n) return null;
  return Math.min(...bars.slice(-n).map((b) => b.close));
}

const agent: StrategyAgent = {
  name: "donchian-breakout",

  onBar(bar: Bar, ctx: BarContext): Order[] {
    const symbol = ctx.position.symbol || "BTCUSDT";

    // Flat: enter on an upside breakout of the entry channel.
    if (ctx.position.size <= 0) {
      const priorHigh = highestClose(ctx.history, ENTRY);
      if (priorHigh !== null && bar.close > priorHigh) {
        return [{ symbol, side: "buy", orderType: "market", size: TRADE_SIZE, tag: "breakout" }];
      }
      return [];
    }

    // Long: exit on a downside breakout of the (shorter) exit channel.
    const priorLow = lowestClose(ctx.history, EXIT);
    if (priorLow !== null && bar.close < priorLow) {
      return [{ symbol, side: "sell", orderType: "market", size: ctx.position.size, tag: "breakdown" }];
    }

    return [];
  },
};

export default agent;
