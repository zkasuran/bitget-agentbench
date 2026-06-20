/**
 * ATR channel breakout (a Keltner-style volatility breakout).
 *
 * The channel middle is the simple moving average of the close over PERIOD bars.
 * Its width is MULT times the Average True Range, so the bands breathe with
 * volatility instead of sitting at a fixed price like a raw Donchian channel. Go
 * long when the close pushes above the upper band (a move large relative to
 * recent range), flatten when it falls back below the middle.
 *
 * Long-only spot, no lookahead: both the SMA and the ATR are built from bars
 * strictly before the current one, then compared against the just-closed price.
 *
 * Usage:
 *   npx agentbench run --strategy atr-channel --symbol BTCUSDT --tf 4h --out ./report
 */

import type { StrategyAgent, BarContext, Bar, Order } from "../index.js";

const PERIOD = 20; // SMA and ATR lookback
const MULT = 1.5;  // band width in ATRs
const TRADE_SIZE = 0.01;

/** Simple moving average of the close over the last `period` bars, or null. */
function sma(bars: readonly Bar[], period: number): number | null {
  if (bars.length < period) return null;
  return bars.slice(-period).reduce((a, b) => a + b.close, 0) / period;
}

/**
 * Average True Range over the last `period` bars. True range needs the prior
 * close, so this needs `period + 1` bars. Returns null until then.
 */
function atr(bars: readonly Bar[], period: number): number | null {
  if (bars.length < period + 1) return null;
  const window = bars.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < window.length; i++) {
    const cur = window[i]!;
    const prevClose = window[i - 1]!.close;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prevClose),
      Math.abs(cur.low - prevClose),
    );
    sum += tr;
  }
  return sum / period;
}

const agent: StrategyAgent = {
  name: "atr-channel",

  onBar(bar: Bar, ctx: BarContext): Order[] {
    const middle = sma(ctx.history, PERIOD);
    const range = atr(ctx.history, PERIOD);
    if (middle === null || range === null) return [];

    const symbol = ctx.position.symbol || "BTCUSDT";
    const upper = middle + MULT * range;

    // Flat: enter when the close breaks above the upper band.
    if (ctx.position.size <= 0 && bar.close > upper) {
      return [{ symbol, side: "buy", orderType: "market", size: TRADE_SIZE, tag: "above-channel" }];
    }

    // Long: exit when the close falls back below the middle.
    if (ctx.position.size > 0 && bar.close < middle) {
      return [{ symbol, side: "sell", orderType: "market", size: ctx.position.size, tag: "below-middle" }];
    }

    return [];
  },
};

export default agent;
