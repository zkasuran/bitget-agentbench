# Sample reports

Real backtest runs produced by AgentBench, committed as verifiable evidence. Each
folder holds a `scorecard.json`, a `trades.jsonl` ledger, an `equity.csv` and a
self-contained `scorecard.html`. Every run is on real Bitget candles (public
data, no keys) with a fixed seed, so you can reproduce any of these byte for byte:

```bash
npx agentbench run --strategy <agent> --symbol <SYM> --tf 4h --seed 42 --out /tmp/check
diff /tmp/check/scorecard.json reports/<agent>-<SYM>-4h/scorecard.json
```

These runs were produced by agentbench 0.5.0.

## Results matrix (seed 42, 4h, ~929 bars each)

All nine built-in strategies on all three symbols. Rows are grouped by archetype:
the buy-hold baseline, then trend, breakout and mean-reversion.

| Agent | Symbol | Return | Trades | Win rate | Sharpe |
|-------|--------|-------:|-------:|---------:|-------:|
| buy-hold | BTCUSDT | -2.50% | 0 | 0% | -1.79 |
| buy-hold | ETHUSDT | -0.13% | 0 | 0% | -2.24 |
| buy-hold | SOLUSDT | -0.01% | 0 | 0% | -2.26 |
| sma-crossover | BTCUSDT | -2.14% | 18 | 28% | -2.46 |
| sma-crossover | ETHUSDT | -0.12% | 19 | 16% | -3.45 |
| sma-crossover | SOLUSDT | -0.00% | 20 | 25% | -2.54 |
| macd-crossover | BTCUSDT | -1.05% | 32 | 38% | -1.14 |
| macd-crossover | ETHUSDT | -0.11% | 35 | 26% | -3.12 |
| macd-crossover | SOLUSDT | -0.00% | 35 | 26% | -2.98 |
| momentum | BTCUSDT | -2.31% | 40 | 28% | -2.51 |
| momentum | ETHUSDT | -0.09% | 47 | 28% | -2.36 |
| momentum | SOLUSDT | -0.00% | 44 | 27% | -2.67 |
| donchian-breakout | BTCUSDT | -0.90% | 19 | 37% | -1.21 |
| donchian-breakout | ETHUSDT | -0.06% | 20 | 20% | -2.07 |
| donchian-breakout | SOLUSDT | -0.00% | 18 | 22% | -1.94 |
| atr-channel | BTCUSDT | -0.74% | 19 | 47% | -1.02 |
| atr-channel | ETHUSDT | -0.06% | 18 | 22% | -2.05 |
| atr-channel | SOLUSDT | -0.00% | 22 | 14% | -3.48 |
| rsi-meanrev | BTCUSDT | -1.00% | 14 | 79% | -0.94 |
| rsi-meanrev | ETHUSDT | -0.06% | 14 | 71% | -1.38 |
| rsi-meanrev | SOLUSDT | -0.00% | 15 | 73% | -0.82 |
| bollinger-meanrev | BTCUSDT | -1.44% | 18 | 67% | -1.60 |
| bollinger-meanrev | ETHUSDT | -0.11% | 16 | 69% | -3.12 |
| bollinger-meanrev | SOLUSDT | -0.00% | 16 | 56% | -2.41 |
| vwap-reversion | BTCUSDT | -3.29% | 28 | 64% | -3.26 |
| vwap-reversion | ETHUSDT | -0.13% | 33 | 64% | -3.07 |
| vwap-reversion | SOLUSDT | -0.01% | 39 | 67% | -3.22 |

The point is not that these toy strategies make money (they do not, over this
window). The point is that AgentBench measures them honestly and consistently.
buy-hold is the baseline every other row is judged against. The mean-reversion
agents (rsi, bollinger, vwap) show much higher win rates than the trend, momentum
and breakout agents across all three symbols, and the harness surfaces that
without anyone trading a cent.

Open any `scorecard.html` in a browser to see the equity curve, metrics and trade
ledger for that run.
