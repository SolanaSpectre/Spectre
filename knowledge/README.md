# Ollama Knowledge Pack

This directory holds compact local context files meant to improve AI judgment for the trading bot.

## Files

- `market-mechanics.md`
- `strategy-lanes.md`
- `bot-learnings.md`
- `trade-lessons.md`
- `regime-playbooks.md`
- `hardening-checklist.md`
- `aws-model-benchmark-checklist.md`
- `live-risk-framework.md`
- `agent-policy-patterns.md`
- `rick-venum-spectre-bridge.md`
- `wallet-intel.md`
- `narrative-signals.md`
- `decision-rules.md`
- `rick-integration-roadmap.md`
- `rick-signals.md`
- `bags-integration-roadmap.md`
- `future-sniper-lane-notes.md`
- `pump-live-readiness.md`

## Purpose

These files are designed to teach the local model:

- how this memecoin market works
- how the bot's strategy lanes differ
- what the bot has already learned from paper runs
- what winning, losing, and no-trade sessions have taught us
- how behavior should change across hot, mixed, and weak tapes
- how to benchmark stronger AWS-hosted models without contaminating the current baseline
- how live portfolio-aware and lane-aware sizing should work later without affecting paper runs
- how other local agent systems can improve this bot structurally without polluting the current lane
- how Rick, Venum, and Spectre should hand off narrative and regime intelligence cleanly
- how future venue and sniper lanes may fit without contaminating the runner baseline
- what the April 2026 Pump fee-recipient upgrade means for future live-executor compatibility
- which operational sharpness issues still need hardening later
- how wallet flow should be interpreted
- how narrative should be used without becoming hype-blind

## Usage Intent

The best pattern is selective retrieval:

- always useful:
  - `market-mechanics.md`
  - `strategy-lanes.md`
  - `decision-rules.md`

- add when relevant:
  - `bot-learnings.md`
  - `trade-lessons.md`
  - `regime-playbooks.md`
  - `hardening-checklist.md`
  - `aws-model-benchmark-checklist.md`
- `live-risk-framework.md`
- `agent-policy-patterns.md`
- `rick-venum-spectre-bridge.md`
- `wallet-intel.md`
- `narrative-signals.md`
- `rick-signals.md`
- `bags-integration-roadmap.md`
- `future-sniper-lane-notes.md`

For the next context expansion layer, use:

- `rick-integration-roadmap.md`

Keep prompts compact. The goal is grounded judgment, not maximal prompt length.
