# Helius Promotion Plan

## Implementation update (2026-08-08)

The combined cutover described below is now implemented in the working tree. Helius is the default
and exclusive Pump.fun runtime provider, strategy consumption and Helius-sourced launch intel switch
atomically, and PumpPortal/PumpDev are retained only as explicit rollback and historical-analysis
paths. Runtime events pass through a bounded, same-mint-ordered queue; queue overflow fails closed.

Future strategy evidence starts under the separate, future-only
`runner_watch_helius_primary_v6_2026-08-08` pre-registration. V1-V5 evidence cannot be pooled into
V6. The next PAPER60 is a validation run for this new substrate, not proof that the strategy has an
edge and not permission to enable live trading.

Everything below this update is the historical rationale and design record as it stood on
2026-08-03.

Status as of 2026-08-03. Helius is still `strategyConsumptionAllowed: false` and report-only. This
document records the evidence for promotion, the structural reason V13 cannot gate it, the coupling
that killed the original phase plan, and the design for the remaining work.

## Why promote

Not a cost optimisation. Validating the strategy needs roughly 250 paper trades. At ~10 entries per
hour that is ~25 hours of runtime.

| Path | Cost of 25 hours |
|---|---|
| PumpPortal | ~2.5 SOL (~$183) |
| Helius | ~1.15M credits, ~11.5% of a plan already paid for |

An 8-hour session at full PumpPortal tape needs ~840,000 metered events, roughly 0.84 SOL. The
working pattern the operator actually wants - 8 to 12 hours per day - is not fundable on PumpPortal
at any realistic balance. It is comfortable on Helius.

## Evidence

Gathered across eleven sessions on 2026-08-01 to 2026-08-03.

- **Shadow parity: 3 of 3 PASSED.** Portal trade identity recall 98.45% / 100% / 96.83%, volume
  agreement 100% in all three, curve agreement 96.2-98.0%.
- **Trader ground truth: 36 of 36 Helius correct.** Twelve from the original v5 sample, twenty-four
  from the 2026-08-03 adjudication. Zero cases where PumpPortal matched the on-chain `TradeEvent`
  user and Helius did not. In 9 of 24, PumpPortal matched the fee payer rather than the trader -
  that is its error mode, and it matters because wallet identity drives the entry gates.
- **Gate action agreement: 99.27-99.88%** across thousands of comparable evaluations.
- **Exits: 11 of 11** on the highest-volume session.
- **Coverage: 6.75x more trades** than PumpPortal at equal budget (135,081 vs 20,002).
- **Discovery: Helius earlier on every single match**, median -683ms across 1,528 comparisons.
- **Misses are transport gaps, not data quality.** 204 gaps produced 654 misses; zero gaps produced
  zero misses; one gap produced 392. The burst-sensitivity diagnostic did not replicate - it
  inverted between runs - so no gate is warranted on it.

## Why V13 cannot be the gate

Six runs, six failures, a different reason each time: paid-tape budget, comparable evaluation
coverage, wallet feature agreement, tracked address agreement, executed action agreement, and
finally account verifier capacity. Coverage never came within 50 points of its 90% requirement.

The structural reason, established on 2026-08-03: the coverage gate weights all evaluations equally,
but **2,487 of 2,488 excluded evaluations were `WOULD_SKIP`**. Exactly one was an entry decision.
Measured on decisions that do something, coverage was 3 of 4.

Worse, V13 requires the shadow to be under 1000ms fresh to count as comparable, while the runtime
observes no freshness bound at all - it decides on whatever state it has, median 16 seconds old. The
comparison population therefore systematically excludes the conditions the runtime operates in.

V13 answers a narrow question - can entry mismatches be attributed - and it answers it. It was never
designed as a promotion gate, and its own `nextIfPass` says promotion requires a separate review.
Waiting for V13 to pass means never promoting.

## Launch-intel parity: what is real and what is not

The counterfactual was scored on strictly less information than the runtime, which made every entry
divergence one-directional. Four terms were investigated.

| Term | Outcome |
|---|---|
| `uniqueBuyerCount` | **Fixed.** Was a rolling 120s window capped at 201 trades against the runtime's monotonic lifetime high-water mark - 26-43% of the runtime's value. Now cumulative from `walletEvidenceTrades`, which is count-capped but never age-pruned. |
| `kolOverlap` | **Added.** First-wave wallets from the Helius tape, KOL classification via `buildKolWalletSummary` - a pure lookup against `kolWalletProfiles`, which is reference data from wallet-intel/kolscan/manual files and not derived from either tape. Delta median 0 on both counts. |
| `repeatedEarlyBuyerCount` | **Reverted.** A Helius derivation was tried and measured wrong. launch-intel counts first-wave wallets with cross-launch history (`totalLaunches > 1`) capped at 5; the attempt counted per-mint repeat buys uncapped, and measured delta median +13, max +315. The correct definition needs a cross-launch wallet index the shadow does not maintain. Retained as the renamed diagnostic `perMintRepeatBuyerCount`. Remains a known understatement bounded at 6 score points. |
| `bundlerCandidate` | **Reverted.** The derivation worked, but PumpPortal payloads carry no `slot`, so the runtime's `slotBuyCounts` never populates and its `bundlerCandidate` is always false. The shadow scored true on 2,096 of 2,458 evaluations, taking a free +8 the runtime structurally cannot earn. A like-for-like counterfactual must not hold features the oracle cannot compute. |

Result after the two verified fixes, measured clean on 2026-08-03:

- Score delta **median -3.11 to -2.03**, **mean -2.172 to -0.26** (88% reduction in bias)
- Divergence became bidirectional: 763 shadow-higher vs 1,143 shadow-lower

The residual -2.03 is fully accounted for by the one remaining handicap. `repeatedEarlyBuyerCount` is
non-zero on 87% of runtime evaluations, median 2, against the shadow's 0 - worth 4-6 score points
under `Math.min(count * 2, 6)`, which is larger than the gap itself. Adjusted for it, the shadow
scores at or above the runtime. The remaining divergence is not a Helius deficiency.

## The coupling that killed the three-phase plan

The original plan was: (1) Helius-fed launch intel, (2) Helius-fed lane, (3) cut over. Phase 1 was
built and tested on 2026-08-03 with `LAUNCH_INTEL_SOURCE=helius`.

Registration worked - 3,314 Helius-sourced records, both create and trade events, symbols populated.
**Entries went to zero**, from 3-13 in every prior session. `LOW_SCORE` tripled to 1,886 and
`RISK_WALLET_COUNT` doubled to 2,448.

Cause: `registerTrade()` was doing double duty - recording the trade *and* returning the freshly
updated summary. Replacing it with `getMintSummary()` meant lane-tracked mints stopped being updated
by the very trade flow driving the lane, while Helius updated an overlapping-but-different mint set
on different timing.

**The lane's tape source and its launch-intel source must switch atomically.** They are one change,
not two. Discovering this after PumpPortal had been removed would have been far worse.

## Remaining work: one combined phase

**The seam** is `trading-engine.js`:

```js
this.observePreMigrationToken(this.latestPumpPortalTokens.get(mint), launchIntelSummary);
```

`latestPumpPortalTokens` is the single Map the pre-migration lane reads. Curve progress already comes
from RPC via `syncPumpBondingCurveBeforePreMigrationObservation`, so what PumpPortal actually supplies
is the momentum block: trade window, buys/sells, recent volume, velocity, buy ratio, unique buyers.
`heliusDecisionShadowState.snapshot()` already computes every one of those correctly.

**Design**

A parallel `latestHeliusTokens` map is NOT needed. `HeliusDecisionShadowState.snapshot()` returns a
`state` object that already carries almost the whole contract:

```
mint, symbol, name, source, createdAt, quoteMint, pairBase,
tradeCount, buys, sells, volumeSol,
recentTradeCount, recentBuys, recentSells, recentVolumeSol, tradeVelocityPerMin, uniqueBuyerCount,
curveProgress, bondingCurveProgress, curveProgressSource, providerCurveProgress,
providerCurvePriceSol, providerCurveSnapshotAt, bondingCurvePriceSol, lastCurveUpdateAt,
virtualSolReservesSol, virtualTokenReservesTokens, bondingStage, firstTradeAt, migratedAt
```

The shadow state is already a per-mint accumulator, so it can serve as the token source directly.
Only these contract fields are absent and must be overlaid from the existing RPC bonding-curve
sync: `liquiditySol`, `marketCapSol`, `bondingCurveAddress`, `bondingCurveAccountFound`,
`bondingCurveComplete`, `realSolReservesSol`, `bondingCurveLastFetchAt`, plus `rawTrade`.

1. On a Helius trade event, call `snapshot({ portalState: { mint }, accountState })` where
   `accountState` is the existing RPC curve state. Without portal context the V13 sniper-anchor
   control does not apply and the shadow anchors on its own first observed trade, which is the
   correct production behaviour.
2. Overlay the seven missing fields and pass the result to `observePreMigrationToken`.
3. Switch launch-intel registration in the same flag, using the adapter already built at
   `src/lib/helius-launch-intel-adapter.js`.
4. Single config flag gating all three. `LAUNCH_INTEL_SOURCE` should be folded into it or replaced -
   a separate launch-intel switch is what produced the zero-entry session.

A standalone token-mapper module was written and then deleted on 2026-08-03: it duplicated what
`snapshot().state` already produces. Check the state shape before writing mapping code.

**Risks to resolve before cutover**

- **Event-loop throughput.** Helius delivers 6.75x more trades than PumpPortal. Today that volume only
  touches the shadow path. Feeding the main lane multiplies hot-path work against
  `EVENT_LOOP_MONITOR_LAG_THRESHOLD_MS=250`; one session already showed `lag=2/1202ms`.
- **Account verifier capacity.** `FINALIST_ACCOUNT_VERIFIER_MAX_SUBSCRIPTIONS=100` was exceeded on the
  2026-08-03 13-entry session, failing `noAccountVerifierCapacitySkips`. A richer feed makes this worse.
  Raise it before any long run.
- **Clean-room launch intel.** Every test so far started from `loadExistingState()` with accumulated
  PumpPortal records. Whether Helius alone can build launch intel from an empty store is untested.

## Operating economics on the Developer plan

Measured from the dashboard, 8.48 stream hours consuming 389,477 credits.

| Product | Share | Per hour |
|---|---|---|
| LaserStream WebSocket | 65.1% | ~31,100 |
| RPC | 25.8% | ~12,300 |
| Enhanced API | 9.1% | episodic |

**~43,400 credits/hour recurring.** Plan is 10M/month.

| Pattern | Credits | % of plan | Overage at $5/M |
|---|---|---|---|
| 8h x 30 | 10.4M | 104% | ~$2 |
| 12h x 30 | 15.6M | 156% | ~$28 |

**Autoscaling is already set to $50 / 10M credits** (confirmed 2026-08-03). Total capacity is
therefore 20M/month, or about 461 hours at the measured rate - roughly 15 hours a day, comfortably
above the 8-12 hour operating pattern. It is a ceiling, not a commitment: only credits actually
consumed are billed, and the cycle so far shows $0.00 autoscaling spend. Without it, exhausting the
plan would stop the stream mid-session.

Payload varies 3.7x with market activity (833-3,046 MB/hour), so budget against the high end.

`analyze:kolscan` costs ~37,000 credits per run at 100 credits per Enhanced API call. Weekly is
~1.5% of plan and correct; daily is waste. That file going stale silently re-breaks every
positive-wallet gate - it is load-bearing, not optional.

## Not fixed by any of this

The strategy is still unprofitable. Expectancy -1.0% per trade over 457 paper exits. The 15% stop
realised **-44.6% on average** including one -90.9% exit, and the 8% trailing giveback realised 18pp,
converting two +20% winners into losses. Exits overshoot because price gaps between sparse
observations - which is equally true live, plus slippage.

Helius promotion makes measurement cheap. It does not make the strategy work. The exit overshoot is
what stands between this system and live trading.
