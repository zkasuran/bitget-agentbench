/**
 * VWAP reversion.
 *
 * Track the volume-weighted average price over the prior PERIOD bars: each bar's
 * typical price (high + low + close) / 3 weighted by its volume. Buy when the
 * close trades a band below VWAP (the crowd's average cost, and we are getting it
 * cheaper), then flatten once price reverts back up to VWAP.
 *
 * The only built-in that uses volume, so it leans on information the price-only
 * strategies ignore. Long-only spot, no lookahead: VWAP is built from bars
 * strictly before the current one and compared against the just-closed price.
 *
 * Usage:
 *   npx agentbench run --strategy vwap-reversion --symbol BTCUSDT --tf 4h --out ./report
 */

import type { StrategyAgent, BarContext, Bar, Order } from "../index.js";

const PERIOD = 20;    // VWAP lookback
const BAND = 0.005;   // buy this fraction below VWAP (50 bps)
const TRADE_SIZE = 0.01;

/** Volume-weighted average price over the last `period` bars, or null. */
function vwap(bars: readonly Bar[], period: number): number | null {
  if (bars.length < period) return null;
  const window = bars.slice(-period);
  let pv = 0;
  let vol = 0;
  for (const b of window) {
    const typical = (b.high + b.low + b.close) / 3;
    pv += typical * b.volume;
    vol += b.volume;
  }
  if (vol === 0) return null;
  return pv / vol;
}

const agent: StrategyAgent = {
  name: "vwap-reversion",

  onBar(bar: Bar, ctx: BarContext): Order[] {
    const v = vwap(ctx.history, PERIOD);
    if (v === null) return [];

    const symbol = ctx.position.symbol || "BTCUSDT";

    // Trading below VWAP by the band and flat -> buy the discount.
    if (ctx.position.size <= 0 && bar.close < v * (1 - BAND)) {
      return [{ symbol, side: "buy", orderType: "market", size: TRADE_SIZE, tag: "below-vwap" }];
    }

    // Reverted back to VWAP and long -> take it off.
    if (ctx.position.size > 0 && bar.close >= v) {
      return [{ symbol, side: "sell", orderType: "market", size: ctx.position.size, tag: "at-vwap" }];
    }

    return [];
  },
};

export default agent;
