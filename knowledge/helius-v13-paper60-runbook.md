# Helius V13 PAPER60 Runbook

This is an operator runbook. It does not alter the frozen experiment and must
not be injected into trade-review prompts.

## Scope

- Preregistration: `helius_pumpfun_decision_divergence_v13_2026-08-01`
- Mode: PAPER only, report only
- Duration: 60 minutes
- PumpPortal remains the runtime decision input.
- Helius remains a counterfactual evidence source.
- Strategy, routing, freshness, subscription capacity, and live behavior remain
  unchanged.

## Frozen Question

After holding the actual lane's first-trade sniper-window anchor and window
length constant, can every same-path executed-entry mismatch be assigned while
transport, account provenance, baseline control, and sniper-anchor control stay
valid?

V12 telemetry is historical context only and cannot be reused as V13 evidence.

## Preflight

Run from `E:\Spectre\Spectre-clean` without opening or printing `.env`.

```powershell
git status --short --branch
npm test
npm run lint
```

Also confirm:

1. no Spectre Node process is already active
2. sufficient E-drive free space
3. normal provider-funding and disk guards pass at startup
4. internet, Solana RPC, Helius, PumpPortal, and Ollama are reachable
5. no code, configuration, or preregistration changes are made during the run

## V13 Comparator Control

For every comparable decision:

1. the actual anchor kind is `first_trade`
2. shadow anchor timestamp equals the actual timestamp exactly
3. shadow window length equals the actual window exactly
4. Helius buyers are counted only from the inclusive anchor through the
   inclusive window end
5. pre-anchor Helius trades are excluded
6. producer-source labels remain visible but do not create an anchor mismatch

Any failure is `INCOMPARABLE_SNIPER_ANCHOR_CONTROL`, not an attributed provider
mismatch. The decisive report must show
`sniperWindowAnchorControlInvariant: true`.

## Start

```powershell
npm start -- PAPER 60
```

Use the normal lifecycle and automatic decisive report profile. Do not add
`--skipReports` or start another report process while the bot is active.

## During The Run

Watch for:

1. clean provider and funding preflight
2. one Helius connection and subscription acknowledgement
3. reconnects, transport gaps, queue drops, or queue drain failures
4. queue-resident latency as distinct from event-loop lag
5. paid-tape budget warnings
6. automatic stop near 60 minutes

## Evidence Rules

A valid V13 run requires the frozen plan, clean lifecycle and transport, intact
queue accounting, complete provenance, consumed baseline control, exact
sniper-anchor control, and complete comparable market-input telemetry.

Attribution evidence then requires:

1. at least one comparable executed entry
2. at least one executed exit
3. at least one same-path executed-entry mismatch

Every mismatch must receive an allowed frozen cause. Broad coverage and
agreement thresholds remain visible diagnostics, not V13 pass/fail gates while
the evaluation mode is `entry_mismatch_attribution`.

## Read Results

Read only current, telemetry-matched artifacts from the decisive ledger:

1. `data/reports/post-run-decisive-ledger-latest.json`
2. `data/reports/helius-pumpfun-shadow-parity-latest.json`
3. `data/reports/helius-pumpfun-decision-divergence-latest.json`
4. `data/reports/event-loop-lag-diagnostic-latest.json`
5. `data/reports/latest-run-summary-latest.json`
6. `data/reports/live-readiness-latest.json`
7. `data/reports/strategy-candidate-scorecard-latest.json`

Do not cite a `*-latest.json` artifact unless its source telemetry matches the
current run. In particular, the recall-autopsy artifact is not currently part of
the decisive profile.

## Mechanical Verdicts

- Pass: `HELIUS_DECISION_SHADOW_V13_CONTROLLED_ANCHOR_MISMATCHES_ATTRIBUTED_REPORT_ONLY`
- Fail: `HELIUS_DECISION_SHADOW_V13_UNATTRIBUTED_SAME_PATH_ENTRY_MISMATCH`
- Insufficient: `HELIUS_DECISION_SHADOW_V13_INSUFFICIENT_CONTROLLED_ANCHOR_ATTRIBUTION_EVIDENCE`
- Invalid: `HELIUS_DECISION_SHADOW_V13_INVALID_RUN`

A pass keeps Helius report-only and supports another unchanged V13 run or a
separately preregistered wallet-identity experiment. It does not establish
provider replacement, strategy profitability, or live readiness.
