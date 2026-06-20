import type { StrategyAgent } from "../types.js";
import smaCrossover from "./sma-crossover.js";
import rsiMeanrev from "./rsi-meanrev.js";
import buyHold from "./buy-hold.js";
import donchianBreakout from "./donchian-breakout.js";
import bollingerMeanrev from "./bollinger-meanrev.js";
import macdCrossover from "./macd-crossover.js";
import vwapReversion from "./vwap-reversion.js";
import atrChannel from "./atr-channel.js";
import momentum from "./momentum.js";

/**
 * Built-in strategies, addressable by name from both the CLI (`--strategy`) and
 * the MCP tool. One source of truth so the two entry points cannot drift.
 *
 * The set spans the main archetypes a benchmark should cover: a buy-hold
 * baseline, trend (SMA cross, MACD cross), momentum (trailing return), breakout
 * (Donchian price channel, ATR volatility channel) and mean-reversion (RSI,
 * Bollinger bands, VWAP). All are long-only spot, matching the engine.
 */
export const STRATEGIES: Record<string, StrategyAgent> = {
  "sma-crossover": smaCrossover,
  "rsi-meanrev": rsiMeanrev,
  "buy-hold": buyHold,
  "donchian-breakout": donchianBreakout,
  "bollinger-meanrev": bollingerMeanrev,
  "macd-crossover": macdCrossover,
  "vwap-reversion": vwapReversion,
  "atr-channel": atrChannel,
  momentum: momentum,
};

/** The names of the built-in strategies. */
export function listStrategies(): string[] {
  return Object.keys(STRATEGIES);
}
