# Trend Reversal — results site

Static site for a backtest of the ThinkorSwim `TrendReversal` study on NQ
futures. 1,988,519 one-minute bars, January 2021 to September 2026, 384
scenarios.

**Live:** https://edbertchan.github.io/trend-reversal-site/

## What it shows

The study's reversal markers are drawn on the candle where a turn happened, but
they are not drawn until roughly 50 minutes later, once price has moved far
enough to prove it was a turn. The site measures what that costs.

- **Chart view** — markers where the study places them. Produces a 38,970%
  annual return and, in 66 of 192 combinations, no losing day at all. Not
  attainable; included only to size the gap.
- **Live view** — the same rules, with each pivot visible only from its
  confirmation bar. Best realistic scenario returns 40.7% on a micro contract
  with a 32.7% drawdown, and turns negative if its five best days are removed.

Click any point on the equity curve to see that session's candles and the
trades behind it.

## Files

| File | Contents |
| --- | --- |
| `data.json` | 384 scenario cells with full equity curves |
| `days.json` | 260 sessions of five-minute bars and per-trade records |
| `app.js` | Charts, filtering, session drill-down |

Data derived from Databento `GLBX.MDP3`. Analysis code and reports live in a
separate repository.

Not investment advice. The numbers here argue that this study should not be
traded.
