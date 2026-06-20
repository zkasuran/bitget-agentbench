/**
 * Buy-and-hold baseline.
 *
 * Buys a single unit on the first bar and never sells. This is the comparator
 * every other strategy is measured against: an agent that cannot beat buy-hold
 * on the same data is not earning its fees. AgentBench ships it as a built-in so
 * a scorecard always has an honest baseline to sit next to.
 *
 * Long-only spot, no lookahead, no indicators.
 *
 * Usage:
 *   npx agentbench run --strategy buy-hold --symbol BTCUSDT --tf 4h --out ./report
 */

import type { StrategyAgent, BarContext, Bar, Order } from "../index.js";

const TRADE_SIZE = 0.01; // base units bought once and held

const agent: StrategyAgent = {
  name: "buy-hold",

  onBar(_bar: Bar, ctx: BarContext): Order[] {
    const symbol = ctx.position.symbol || "BTCUSDT";

    // Enter once, on the first bar we are flat, then hold forever.
    if (ctx.position.size <= 0) {
      return [{ symbol, side: "buy", orderType: "market", size: TRADE_SIZE, tag: "hold" }];
    }

    return [];
  },
};

export default agent;
