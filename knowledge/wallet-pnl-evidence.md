# Wallet PnL Evidence

Spectre keeps wallet profitability evidence separate from runtime trust.

The current wallet evidence stack is report-only:

1. `build-wallet-realized-pnl.js`
   - reads tracked wallet transaction history
   - reconstructs realized SOL PnL where the trade path is clear enough
   - skips ambiguous multi-token swaps instead of inventing PnL
2. `wallet-pnl-evidence-report.js`
   - classifies wallets from realized-position evidence
   - emits broad evidence tiers such as `PROVEN_POSITIVE`, `PROMISING_POSITIVE`, `NEGATIVE_EVIDENCE`, and `INSUFFICIENT_EVIDENCE`
3. `wallet-promotion-review-report.js`
   - combines realized PnL evidence with first-touch behavior
   - emits human-review buckets such as `TRUST_REVIEW` and `AVOID_REVIEW`
4. `wallet-review-outcome-lift-report.js`
   - checks whether review cohorts touch better downstream outcomes than the broader first-touch population
5. `wallet-per-wallet-lift-report.js`
   - checks the same question per wallet so mixed clusters do not hide good or bad actors

## Interpretation Rules

- A profitable wallet is not automatically a useful early-entry wallet.
- A wallet should not move toward runtime trust only because it made money somewhere else.
- `TRUST_REVIEW` means "worth human review", not "trusted by the bot".
- Small samples stay small even when they look pretty. Respect the report warnings.
- Cluster-level lift can be confounded when good and bad wallets appear together. Prefer the per-wallet report before drawing conclusions.
- Realized PnL evidence is strongest when it agrees with useful first-touch behavior and downstream outcome lift.

## Current Promotion Shape

The evidence stack is intentionally staged:

1. Realized PnL says whether a wallet appears to make money.
2. First-touch behavior says whether that wallet is present early enough to matter for Spectre.
3. Outcome lift says whether those touches are associated with better token outcomes than baseline.
4. Only after those layers line up should we even discuss changing runtime trust tiers.

That keeps wallet research useful without letting a flashy PnL screenshot wander straight into entry logic.

## Guardrails

- Do not mutate runtime trust tiers from a single report.
- Do not promote wallets from realized PnL alone.
- Do not paper over ambiguous transaction reconstruction; skipped ambiguity is better than fake confidence.
- Do not use wallet evidence to loosen unrelated entry thresholds.
- Keep this layer report-only until repeated observations support a specific runtime change.

