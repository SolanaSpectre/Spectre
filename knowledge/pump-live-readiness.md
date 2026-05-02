# Pump Live Readiness

Spectre is still paper-only research. This note captures Pump protocol compatibility requirements for future live-executor work; it does not enable live trading and should not loosen paper thresholds.

## Sources

- Local discovery: `c:\Users\rlmjr\Downloads\Telegram Desktop\ChatExport_2026-05-01\messages.html`
- Official fee-recipient upgrade: https://github.com/pump-fun/pump-public-docs/blob/main/docs/BREAKING_FEE_RECIPIENT.md
- Official Pump program notes: https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md
- Official PumpSwap AMM notes: https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_SWAP_README.md

## April 28, 2026 Fee-Recipient Upgrade

Pump announced a breaking upgrade for the bonding curve program and PumpSwap AMM effective `2026-04-28T16:00:00Z`.

The official upgrade note says both programs share these 8 upgraded fee recipients:

```text
5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD
9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7
GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL
3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR
5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6
EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL
5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD
A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW
```

## Program IDs

- Pump bonding curve: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
- PumpSwap AMM: `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`

## Direct Instruction Requirements

Bonding curve buy/sell builders must add one upgraded fee recipient after `bonding-curve-v2`. The added account is mutable. Expected total accounts:

- buy: 18
- sell, non-cashback: 16
- sell, cashback: 17

PumpSwap AMM buy/sell builders must add two accounts after `pool-v2`, even for coins that did not graduate from bonding curve:

- second-last: one upgraded fee recipient, readonly
- last: quote mint ATA for that fee recipient, mutable

Expected PumpSwap account totals:

- buy, non-cashback: 26
- buy, cashback: 27
- sell, non-cashback: 24
- sell, cashback: 26

## Spectre Impact

Current Spectre runs use PumpPortal, bonding-curve telemetry, watch lanes, and paper lanes. They do not construct direct Pump or PumpSwap live trade instructions.

That means this upgrade is not a blocker for `npm start -- PAPER 30`, but it is a future live-readiness blocker if a direct Pump bonding curve executor or direct PumpSwap executor is added.

Before any future direct Pump/PumpSwap LIVE executor is allowed:

1. Validate the direct builder's account order against this note and official docs.
2. Verify the upgraded fee recipient account or fee recipient ATA is present for every buy and sell instruction.
3. Confirm Token-2022 handling separately; do not assume legacy SPL Token-only flow is enough.
4. Run `npm run check:pump-live-readiness`.
5. Keep `EXECUTION_MODE=PAPER` until paper evidence and transaction construction evidence are both reviewed.
