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
