# Bot Learnings

These are local lessons from this bot's own paper-trading research.

## Lessons From Recent Runs

- No-trade sessions can be correct and healthy.
- The bot previously overtraded noise before stricter runner gating.
- Age, buy ratio, quality, and liquidity each became bottlenecks at different times.
- Repeated re-evaluation of the same mint polluted telemetry until rejection quarantine was added.
- Liquidity normalization on PumpPortal tokens had to be fixed because bonding-curve SOL and USD liquidity were being mixed incorrectly.

## Current Runner-Lane Lessons

- Strong momentum candidates often still fail on usable liquidity.
- Some overlap mints touched by ranked wallets were still rejected for LOW_PUMP_MOMENTUM.
- Wallet overlap is useful, but it does not automatically mean the bot should enter.
- When the bot sees thousands of candidates and chooses none, that can still be a sign of discipline rather than failure.
- Consecutive profitable validation runs established a credible runner baseline at:
  - `MIN_PUMP_MOMENTUM_SCORE=0.68`
  - `MIN_PUMP_BUY_RATIO=0.62`
  - `MAX_PUMP_TOKEN_AGE_SECONDS=300`
- The old `LOW_PUMP_MOMENTUM` rejection label was misleading for PumpPortal tuning.
- After telemetry cleanup, the real PumpPortal gate pressure was shown to be mostly:
  - `PUMP_FAIL_BUY_RATIO`
  - `PUMP_FAIL_AGE`
  - and only rarely `PUMP_FAIL_SELL_RATIO`
- Most meaningful PumpPortal gate failures were still happening in the `0.7+` momentum band, which means the next tuning conversation should not default to lowering momentum again.
- The current runner stack performs better when age remains at `300`; widening to `360` increased activity but degraded results.
- AI liquidity-above-floor caution should remain a caution, not a hidden second hard veto or a blind entry override.
- Rejected-candidate snapshot telemetry is now live and should be reviewed before changing runner thresholds again.
- A Sunday-night `15` minute paper run confirmed the AI liquidity-above-floor caution path can still downgrade into an entry, so that behavior needs direct review before widening runner gates.
- In the same run, the new snapshot events mostly captured `LOW_PUMP_MOMENTUM` rejects tied to concrete PumpPortal gate failures like buy ratio, sell ratio, volume, and age, which is exactly the kind of false-negative evidence the bot needs before tuning.

## Telegram And Rick Regime Notes

- Telegram activity can be high even when the runner environment is only mixed.
- Yakuza was especially active on Saturday night, but the tone was mostly tactical position management and caller/leaderboard discussion rather than obvious fresh-runner discovery.
- Chatbox!!!! was noisier and more narrative-driven, with more speculative chatter and broader token promotion.
- Cryptoshi Cooks leaned heavily on caller-performance and leaderboard-style validation.
- 4AM Solana Volume Signal remained useful as a structured volume/market-cap feed rather than a sentiment source.
- Saturday-night Rick context showed a softer short-horizon expansion tape than earlier in the day:
  - `/runners` still showed real global runners, but only a small set
  - `/pft` showed very low-cap fresh Pump names
  - `/burp` weakened materially versus earlier snapshots
- In that mixed regime, a `0`-trade runner session was healthy behavior, not failure.

## Decision Discipline

- Capital preservation matters more than forcing trades.
- MFE and excursion shape at `n=10` predicted nothing for the frozen wallet lane: realizable replay reversed the seductive excursion picture into a median-negative, ex-top-3-negative failure. Never grade a strategy lane on excursions; require realizable exits plus frozen median and ex-top-winner durability checks.
- A valid response to uncertainty is no trade.
- One isolated threshold change is better than panic-tuning multiple gates at once.
- The bot should prefer trustworthy structure over exciting noise.
- Once a profitable baseline is validated across consecutive sessions, document it and avoid impulsive threshold churn.
