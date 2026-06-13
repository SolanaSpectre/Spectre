# Live Graduation Criteria

Created: 2026-06-13

Spectre's north star is to reach live trading only after proving a repeatable edge with evidence. A green paper run is not enough. Live trading can remain disabled forever if the evidence does not clear this bar.

## Current Verdict

The current expected verdict is `infra_ready_strategy_not_proven`.

Healthy infra is necessary, but it is not edge. Do not treat RPC health, dry-run transaction building, or a funded hot wallet as a reason to enable broadcast.

## Strategy Evidence Required

Before any live launch review, the exact lane and preset proposed for live trading must show:

- At least 50 closed zero-risk shadow entries for the statistical case.
- At least 20 closed capped paper entries for runtime/execution-parity evidence.
- Evidence spanning at least 10 sessions, at least 7 calendar days, and at least 2 market regimes when regime labels are available.
- Positive total PnL after fees and configured slippage.
- Positive median trade PnL.
- Positive PnL after removing the top 1 winner.
- Positive PnL after removing the top 3 winners.
- No single winner contributes more than 40% of gross winning PnL.
- Positive expectancy under adverse slippage stress.
- Bootstrap 5th-percentile resampled PnL greater than 0 once bootstrap reporting exists.

Shadow entries may support the statistical case, but they do not replace capped paper entries. Paper entries must be a subset of, or explainably aligned with, the same shadow lane being evaluated.

## Funnel Evidence Required

The skip funnel must show that gates are rejecting more future losers than future winners. The summary must include false-negative follow-through for:

- `CURVE_NOT_ADVANCING`
- `NO_PRIOR_CURVE_PROGRESS`
- `CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY`

Do not loosen any of these gates until their false-negative rate, later curve movement, and replay PnL are measured across multiple runs.

## Data Quality Required

Wallet-conditioned strategy evidence is not valid while wallet coverage is effectively blind. Before wallet proof can be treated as a hard live signal:

- Tracked wallet hit rate must clear a predeclared floor, initially 5% of provider trade rows.
- Wallet-channel verdict must improve beyond `RAW_UNTRUSTED_CHANNEL_ONLY`.
- Shadow/untracked wallets must remain report-only and must not satisfy runtime entry guards.
- Avoid-wallet and risk-wallet slices must remain non-negative under replay.

Curve data quality must also be checked:

- Curve parity/freshness reports must show provider curve data is not materially stale for the candidate class being traded.
- On-chain/readiness checks must have no critical failures for live-candidate rows.

## Execution Evidence Required

Live execution remains disabled until all strategy and data-quality requirements clear. Then live review still requires:

- Live-readiness verdict has no launch blockers.
- Dry-run transaction builder has at least 20 `would_send` rows for the candidate lane.
- Signed simulation has zero critical failures for `would_send` rows.
- Broadcast path remains disabled during review and is enabled only through an explicit live launch procedure.
- Hot wallet balance is only sized for the approved live test, not unrestricted trading.
- Daily loss cap, max open exposure, and restart confirmation are enforced.

## Initial Live Test Rules

If all criteria clear, the first live test must use minimum size and hard abort rules:

- One open live position at a time.
- Daily loss cap active.
- Manual confirmation required for each restart.
- Abort live if live execution diverges materially from paper/shadow assumptions.
- Abort live if RPC, websocket, signer, or broadcast telemetry shows critical failures.

## Do Not Change Without New Evidence

- Do not enable live broadcast because a short paper run is green.
- Do not tune delayed-confirmation thresholds on fewer than 50 closed shadow entries.
- Do not loosen `CURVE_NOT_ADVANCING`, `NO_PRIOR_CURVE_PROGRESS`, or first-touch gates just to increase entries.
- Do not revive runner/scalper or continuation lanes until their own replay and paper evidence clears a separate review.
- Do not count report-only shadow wallets as trusted wallet proof.

## Current Research Track

The active research hypothesis is delayed curve confirmation:

Wait for a candidate skipped by curve stalling to show later curve movement before considering entry. Runtime paper entries stay capped for safety. Uncapped zero-risk shadow logging is used to collect the statistical sample faster.
