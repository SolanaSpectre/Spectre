# Live Risk Framework

This is the target risk model for future live trading.

Do not apply this to paper-mode validation yet.

Paper mode should stay fixed-size while we validate strategy quality cleanly.

## Purpose

When live trading starts, position sizing should depend on two things:

1. portfolio size
2. strategy lane

That means:

`final live trade size = portfolio-based base size x lane-specific risk rule`

This keeps the system disciplined as equity changes and prevents all strategies from using the same blunt trade size.

## Current Foundation

The current build already has the beginnings of portfolio-aware sizing in:

- `src/capital-allocation.js`

It already supports:

1. equity-tier-based profit allocation
2. hot-wallet risk size tiers
3. dynamic trade amount computation from hot equity

What it does not yet support is strategy-lane-specific risk scaling.

## Design Principles

Live sizing should follow these rules:

1. paper mode stays fixed-size for comparability
2. live mode sizes as a controlled fraction of operating capital
3. risk scales down automatically during drawdowns
4. each lane gets its own exposure profile
5. min and max clamps always apply
6. no single trade should dominate the portfolio

## Two-Layer Live Sizing Model

### 1. Portfolio Layer

This answers:

`How much can the system reasonably risk at this account size?`

Base rule:

- use hot-wallet or total operating equity
- assign a base risk percent by equity tier
- convert that into a raw SOL trade amount

Illustrative example:

1. `<= 5 SOL`: risk `1.0%`
2. `<= 15 SOL`: risk `1.25%`
3. `<= 40 SOL`: risk `1.5%`
4. `> 40 SOL`: risk `1.75%`

These are placeholders, not final production numbers.

### 2. Lane Layer

This answers:

`How much of that base risk should this specific strategy use?`

Illustrative example:

1. `RUNNER_HUNTER`: `1.0x`
2. `SCALPER`: `0.6x` to `0.8x`
3. future `SNIPER`: `0.35x` to `0.5x`
4. future `MIGRATION_HUNTER`: `0.75x` to `1.0x`
5. future `WALLET_FLOW`: `0.75x` to `0.9x`

This means runner-hunter can use the full portfolio-approved base size, while faster or noisier lanes are automatically constrained.

## Why Runner And Scalper Should Differ

`RUNNER_HUNTER` and `SCALPER` should not share one risk rule.

Runner-hunter:

1. expects continuation
2. may hold longer
3. uses broader context and structure
4. can justify moderate position sizing if validated

Scalper:

1. is shorter-horizon
2. is more execution-sensitive
3. is more vulnerable to slippage and chop
4. should usually size smaller until proven otherwise

Even if both are profitable, they are profitable for different reasons and should not inherit the same default risk.

## Suggested Live Formula

Illustrative formula:

`baseRiskSol = hotEquitySol x equityTierRiskPercent`

`laneAdjustedRiskSol = baseRiskSol x laneRiskMultiplier`

`finalTradeSizeSol = clamp(laneAdjustedRiskSol, laneMinTradeSol, laneMaxTradeSol)`

Then also enforce:

1. max per-trade SOL cap
2. max per-token exposure
3. max total open exposure
4. max daily realized loss

## Required Safety Caps

Before live rollout, keep these caps separate from the sizing formula:

1. `maxTradeSizeSol`
2. `maxOpenExposurePercent`
3. `maxPerTokenExposurePercent`
4. `maxDailyLossSol`
5. `drawdownThrottleMultiplier`

These should always be able to reduce trade size further, even when portfolio and lane rules allow more.

## Drawdown Rule

Live mode should shrink automatically during pain.

Illustrative approach:

1. if daily drawdown exceeds threshold A, reduce all lane sizes by `0.75x`
2. if drawdown exceeds threshold B, reduce all lane sizes by `0.5x`
3. if drawdown exceeds threshold C, stop new entries entirely

This should happen regardless of AI confidence.

## Confidence Scaling

Do not add AI-confidence-based sizing at the beginning of live rollout.

Start with:

1. portfolio sizing
2. lane multipliers
3. hard caps

Only later, after enough live evidence, consider whether very high-confidence setups deserve slightly larger size.

Confidence scaling should be a later refinement, not a launch requirement.

## Live Rollout Order

When we are ready for live trading, use this order:

1. keep paper mode unchanged
2. enable live portfolio-aware base sizing
3. add lane-specific multipliers
4. enforce strict max caps
5. enforce drawdown throttles
6. monitor live trade sizing versus outcomes before adding any confidence scaling

## Implementation Direction

The likely clean implementation path is:

1. keep `CapitalAllocation` as the portfolio-tier engine
2. add a lane-risk configuration layer on top
3. compute live size in the execution path only
4. leave paper size logic unchanged

This keeps paper validation honest while giving live mode a more adult capital-allocation model.

## Boundaries

Do not:

1. apply live sizing logic to paper sessions
2. change current paper trade size comparability
3. mix strategy validation with live capital-compounding logic

The point of this framework is to improve live capital discipline later, not to contaminate current research.
