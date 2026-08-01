# Coverage Epochs

## 2026-07-16: PumpDev Primary Coverage-Limited Epoch Closed

Telemetry sessions configured with `pumpDevDrivesPreMigration=true` and created
before ACK-gated subscription accounting commit `75e0fa8` used PumpDev as the
load-bearing source for trade-derived decision features while the anonymous
server tier allowed only five live token or wallet subscriptions.

The client previously counted subscription requests as active before server
acknowledgement. PAPER30 telemetry
`run-logs/telemetry-2026-07-17T02-11-13-132Z.jsonl` proved the mismatch:
100 token-trade requests, 5 server acknowledgements, and 95 explicit tier-limit
rejections.

Treat conclusions from that epoch involving `recentVolumeSol`,
`tradeVelocityPerMin`, `buyRatio`, `uniqueBuyerCount`, market-wide scarcity,
or separability as coverage-limited. Do not pool those runs with post-fix
coverage-validation runs without an explicit epoch split. Conservative actions
from the epoch remain valid: no strategy was promoted, gates stayed frozen,
and live trading remained disabled.

The post-fix architecture assigns PumpPortal to broad discovery and trade
features, PumpDev's ACK-confirmed anonymous slots to flagged/finalist depth,
and Helius/RPC account reads to curve ground truth. New strategy conclusions
must be based on telemetry collected after that architecture is active and
validated.

## 2026-07-18: PumpPortal Paid-Tape Cap Epochs

PumpPortal's metered trade-event cap creates a second measurement boundary
inside a run. Reports must not treat the whole session as one uniform
provider-coverage period.

- `FULL_PAID_TAPE`: the decision and requested outcome window complete before the cap.
- `PAID_TAPE_TRUNCATED_BY_CAP`: the decision occurs before the cap, but its requested outcome window crosses the boundary.
- `DISCOVERY_RPC_ONLY`: the decision occurs after paid token/account streams are disabled; discovery and RPC verification may continue, but funnel rates are not directly comparable with full paid tape.

The boundary is the first `provider.pumpportal.metered_budget_reached` telemetry
event. A capped run is valid mixed-coverage evidence, not a full-session
paid-tape run.

## 2026-07-31: Helius Decision Comparator V9 Baseline Epoch Closed

V9 decision-shadow telemetry recomputed the shadow short-window curve baseline
from shared observation history after the actual lane appended its current row.
That allowed the two sides to select different effective anchors even though the
history array itself was nominally held constant. The six V9 same-path entry
mismatches from `run-logs/telemetry-2026-07-27T20-31-18-183Z.jsonl` are therefore
invalid comparator evidence and may not be relabeled or reused under V10.

V10 begins only after the effective actual-lane baseline is captured before
`observe()`, passed as an explicit counterfactual control, and checked at value
level. Every comparable V10 row must carry a valid control and prove either an
exact selected-anchor match (zero timestamp and curve skew) or an exact frozen
no-baseline match (both skew fields null). Historical rows lacking these fields
are classified as fields-absent, never as anchor mismatches.

V10 also freezes deterministic mismatch-family priority and records immutable
prewarm trigger/path provenance. These are report-only measurement changes.
Paper strategy, provider routing, freshness, subscription capacity, and live
status remain unchanged.
