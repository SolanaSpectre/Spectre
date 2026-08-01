# Helius V12 PAPER60 Morning Runbook

This is an operator runbook. It does not alter the frozen experiment and should
not be injected into trade-review prompts.

## Baseline

- Runtime baseline commit: `e485415`
- Preregistration: `helius_pumpfun_decision_divergence_v12_2026-08-01`
- Mode: PAPER only, report only
- Planned duration: 60 minutes
- Strategy behavior, provider routing, freshness thresholds, and subscription
  capacity remain unchanged.

Documentation-only commits after `e485415` are acceptable only when the runtime,
configuration example, dependency lockfile, and preregistration paths remain
unchanged.

## Frozen Question

Under the actual 120-second rolling market-feature window, can every same-path
executed-entry mismatch be assigned by the frozen V11 attribution priority while
transport and account provenance remain gap-safe?

## Do Not Change Before The Run

1. strategy gates, scoring, presets, entries, or exits
2. Helius or PumpPortal routing
3. freshness or account-state thresholds
4. subscription capacity or event-queue controls
5. `PUMP_MOMENTUM_WINDOW_MS`
6. AI model, prompt, timeout, or fallback behavior
7. the V12 preregistration
8. live settings

## Preflight

Run from `E:\Spectre\Spectre-clean`.

1. Confirm no trading process is already active:

```powershell
Get-Process node -ErrorAction SilentlyContinue
```

Review any returned process before stopping it. Do not start two Spectre
sessions.

2. Verify repository state:

```powershell
git status --short --branch
git diff --exit-code e485415 -- src scripts package.json package-lock.json .env.example data/strategy-preregistrations
```

The second command must produce no diff. Do not print or inspect `.env` during
this check.

3. Check free space:

```powershell
Get-PSDrive E
```

4. Run offline validation:

```powershell
npm test
npm run lint
```

5. Confirm the public provider funding guard and other lifecycle guards pass
from their normal startup output. Do not echo secret-bearing environment values.

6. Confirm internet, Helius, PumpPortal, Solana RPC, and Ollama are available.
Keep other GPU-heavy applications and additional local models closed during the
session.

## Frozen Validity Checks

The decisive report must evaluate the inherited and V12-specific contract:

1. raw recovery exclusion window: `120000 ms`
2. maximum shadow state age: `1000 ms`
3. minimum comparable gate evaluations: `500`
4. minimum comparable evaluation coverage: `90%`
5. minimum gate-action agreement: `99%`
6. minimum wallet-feature agreement: `99%`
7. minimum tracked-address agreement: `99%`
8. maximum unexpected reconnects: `3/hour`
9. maximum single transport gap: `5000 ms`
10. maximum cumulative transport gap: `15000 ms/hour`
11. at least one comparable executed entry for attribution evaluation
12. at least one same-path mismatch for a pass or fail attribution verdict

No mismatch or no comparable executed entry means insufficient evidence, not a
failure. A transport, lifecycle, plan, or provenance violation makes the run
invalid.

## Start Command

```powershell
npm start -- PAPER 60
```

Use the normal lifecycle. Do not add `--skipReports`, change report profiles, or
run a second report process while the bot is active.

## During The Run

Watch for:

1. provider and disk preflight success
2. `session.started`
3. Helius socket open and subscription acknowledgement
4. reconnects, raw gaps, account-generation changes, or stale-state warnings
5. event-loop lag and queue pressure
6. paid-tape budget or funding warnings
7. the automatic session stop near 60 minutes

Do not edit code, configuration, or preregistration files during the session.

## Invalid Or Interrupted Run

Do not grade or reuse the run if any of these occur:

1. internet or provider outage materially interrupts coverage
2. Windows restart, terminal closure, manual stop, or process crash
3. provider or disk guard blocks startup
4. no fresh telemetry is produced
5. the lifecycle does not record a clean stop
6. the runtime plan differs from V12
7. transport gaps exceed the frozen limits

Keep the telemetry available for diagnosis, but exclude it from V12 evidence.
Do not run the decisive report against an interrupted file and call it valid.

If the self-stop timer fails beyond its configured grace period, stop the
process, mark the run invalid, and treat the timer failure as a lifecycle defect.

## Automatic Post-Run Stack

The normal lifecycle runs the decisive report profile automatically. Read the
results in this order:

1. `data/reports/post-run-decisive-ledger-latest.json`
2. `data/reports/helius-pumpfun-shadow-parity-latest.json`
3. `data/reports/helius-pumpfun-recall-autopsy-latest.json`
4. `data/reports/helius-pumpfun-decision-divergence-latest.json`
5. `data/reports/event-loop-lag-diagnostic-latest.json`
6. `data/reports/latest-run-summary-latest.json`
7. `data/reports/live-readiness-latest.json`
8. `data/reports/strategy-candidate-scorecard-latest.json`

Only rerun reports manually when the lifecycle produced clean telemetry but the
post-run stack was interrupted. Pin the telemetry path explicitly:

```powershell
npm run report:post-run -- --telemetry run-logs/telemetry-YYYY-MM-DDTHH-MM-SS-msZ.jsonl
```

## Mechanical Verdicts

### Pass

`HELIUS_DECISION_SHADOW_V12_SAME_PATH_MISMATCHES_ATTRIBUTED_REPORT_ONLY`

Meaning: attribution worked under the frozen V12 contract. Helius remains
report-only and V12 must repeat unchanged before any provider-routing or
strategy-consumption proposal.

### Fail

`HELIUS_DECISION_SHADOW_V12_UNATTRIBUTED_SAME_PATH_ENTRY_MISMATCH`

Meaning: fix only the demonstrated V12 instrumentation defect. Do not change
strategy, freshness, gates, exits, capacity, or provider routing.

### Insufficient

`HELIUS_DECISION_SHADOW_V12_INSUFFICIENT_SAME_PATH_ATTRIBUTION_EVIDENCE`

Meaning: the run was valid but did not produce enough comparable entry or
mismatch evidence. Repeat unchanged.

### Invalid

`HELIUS_DECISION_SHADOW_V12_INVALID_RUN`

Meaning: diagnose the validity failure and repeat only after correcting that
specific operational or instrumentation issue.

## Morning Report

The final rundown should state:

1. exact telemetry path and clean session duration
2. post-run ledger status
3. transport parity verdict and gap/reconnect counts
4. comparable evaluation count and coverage
5. gate, wallet-feature, and tracked-address agreement
6. comparable entries and same-path mismatch count
7. mismatch attribution histogram
8. V12 verdict and its mechanical next action
9. event-loop lag condition
10. live-readiness status, which remains independent and blocked unless its own
   criteria say otherwise
