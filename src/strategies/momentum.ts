/**
 * Time-series (absolute) momentum.
 *
 * Look back LOOKBACK bars and measure the return over that window. Go long when
 * it turns positive (the asset is trending up against its own recent past),
 * flatten when it turns negative. This is the single-asset, absolute leg of
 * momentum: it compares the asset to itself, not to other assets, so it fits a
 * one-symbol backtest honestly (true cross-sectional momentum needs a basket).
 *
 * Long-only spot, no lookahead: the return is measured from a close LOOKBACK bars
 * back up to the just-closed bar, both already known.
 *
 * Usage:
 *   npx agentbench run --strategy momentum --symbol BTCUSDT --tf 4h --out ./report
 */

import type { StrategyAgent, BarContext, Bar, Order } from "../index.js";

const LOOKBACK = 20; // bars to measure the trailing return over
const TRADE_SIZE = 0.01;

/**
 * Return over the last `lookback` bars: (close_now / close_lookback_ago) - 1.
 * Needs `lookback + 1` closes (the anchor plus the current bar). Null until then.
 */
function trailingReturn(closes: readonly number[], lookback: number): number | null {
  if (closes.length < lookback + 1) return null;
  const now = closes[closes.length - 1]!;
  const past = closes[closes.length - 1 - lookback]!;
  if (past === 0) return null;
  return now / past - 1;
}

const agent: StrategyAgent = {
  name: "momentum",

  onBar(bar: Bar, ctx: BarContext): Order[] {
    const closes = [...ctx.history, bar].map((b) => b.close);
    const ret = trailingReturn(closes, LOOKBACK);
    if (ret === null) return [];

    const symbol = ctx.position.symbol || "BTCUSDT";

    // Positive trailing return and flat -> go long.
    if (ret > 0 && ctx.position.size <= 0) {
      return [{ symbol, side: "buy", orderType: "market", size: TRADE_SIZE, tag: `mom=${(ret * 100).toFixed(1)}%` }];
    }

    // Momentum gone negative and long -> flatten.
    if (ret < 0 && ctx.position.size > 0) {
      return [{ symbol, side: "sell", orderType: "market", size: ctx.position.size, tag: `mom=${(ret * 100).toFixed(1)}%` }];
    }

    return [];
  },
};

export default agent;
