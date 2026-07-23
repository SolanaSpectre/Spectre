# PumpPortal Data Stream Access

Spectre treats PumpPortal as a paper-run telemetry source. Do not put PumpPortal
keys, Lightning wallet private keys, or funded wallet details in Git.

## Current Access Rules

As of May 1, 2026, PumpPortal requires a PumpPortal API key and a linked wallet
funded with at least 0.02 SOL for paid trade streams:

- `subscribeTokenTrade`
- `subscribeAccountTrade`

The following streams remain free:

- `subscribeNewToken`
- `subscribeMigration`

The websocket URL should include the API key as a query parameter when paid
trade streams are used:

```text
wss://pumpportal.fun/api/data?api-key=<redacted>
```

Local `.env` settings:

```text
PUMPPORTAL_ENABLED=true
PUMPPORTAL_WEBSOCKET_URL=wss://pumpportal.fun/api/data
PUMPPORTAL_USE_API_KEY_QUERY=true
PUMP_PORTAL_API_KEY=<local secret only>
PUMPPORTAL_FUNDED_WALLET_ADDRESS=<public address, local only>
PUMPPORTAL_FUNDING_PREFLIGHT_REQUIRED=true
```

## Safety Rules

- Keep the linked PumpPortal wallet minimally funded as a data wallet, not a
  treasury or trading vault.
- Treat the PumpPortal API key as sensitive. The key is linked to a Lightning
  wallet and should not appear in chat, screenshots, logs, commits, or streams.
- If `PUMP_PORTAL_API_KEY` is blank, Spectre should only use free new-token and
  migration streams. It must not auto-subscribe token or account trade streams.
- A paid-tape run needs enough starting balance to preserve the 0.02 SOL
  provider floor after its metered-event budget. Startup calculates that amount
  from the configured event cap when the linked public address is available.
- `PUMPPORTAL_FUNDING_PREFLIGHT_REQUIRED=false` permits the public address to be
  omitted. Once an address is configured, the check fails closed on an invalid
  address, RPC failure, unbounded event budget, or insufficient balance.
- An explicit funding/API-key rejection latches paid subscriptions off for the
  remainder of the session. Free discovery remains available, but the run is
  mixed coverage and cannot count as full-coverage evidence.
- Avoid repeated websocket reconnect storms. PumpPortal warns that excessive
  connection churn can trigger temporary bans that expire after roughly an hour.
  Spectre uses capped reconnect backoff controlled by
  `PUMPPORTAL_RECONNECT_DELAY_MS` and `PUMPPORTAL_MAX_RECONNECT_DELAY_MS`.

## Run Interpretation

When `data/reports/latest-run-summary.txt` reports `PumpPortal feed health` as
`degraded_trade_stream`, treat PumpPortal trade/pre-migration evidence as partial.
Raydium shadow and continuation reports may still be useful, but PumpPortal
trade velocity, recent volume, and NO_PRIOR follow-through may be under-sampled.

Source docs:

- https://pumpportal.fun/data-api/real-time/
- https://pumpportal.fun/fees/
- https://pumpportal.fun/FAQ/
