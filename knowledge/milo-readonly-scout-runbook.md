# Milo Read-Only Scout

## Purpose

Spectre researches and audits. Milo holds the funded wallet and trades. This bridge never starts Spectre's trading engine, builds a transaction, signs, or submits an order.

The scout combines:

- Rick overlap for current attention
- A manually curated wallet watchlist for wallet discovery
- Helius enhanced history for known-basis realized PnL, median, ex-top-three durability, and fresh buy direction
- DexScreener for exact mint identity, liquidity, volume, and pool selection
- Helius/Solana RPC for mint authorities, Token-2022 transfer-hook checks, holder concentration, and recent pool activity
- Jupiter Ultra for unsigned $10/$15 executable-route probes

Only candidates with complete safety and activity coverage can receive an A or B grade. Missing coverage stays WATCH. Hard safety failures are REJECT.

Watchlist labels and third-party performance claims never qualify a wallet by themselves. A wallet needs at least 12 known-cost-basis realized positions, positive median PnL, positive PnL after its three largest winners are removed, and at least a 50% win rate. One such wallet's fresh buy can trigger an exact-mint audit, but the mint is still held at WATCH unless its symbol also appears in the current Rick context. USDC, USDT, and wrapped SOL are excluded from fresh-token flow.

Kolscan's Terms of Use prohibit bots, automated use, scraping, and data mining. Spectre therefore does not automate Kolscan's leaderboard, trades, token tracker, private APIs, or realtime channel. Use Kolscan manually for visual research only; put wallet addresses you are permitted to analyze into `data/wallet-watchlists/manual-kol-wallets.json`, then let Helius provide the machine-readable on-chain evidence.

## Local Setup

The public Milo wallet linkage lives in `config/milo-scout.local.json`, which is ignored by Git. Safe defaults are documented in `config/milo-scout.example.json`.

Spectre's private `.env` supplies the existing Helius RPC and optional Jupiter API settings. The scout does not need a funded Spectre wallet or a Spectre private key.

## Commands

Refresh Rick context when needed:

```powershell
npm run sync:telegram
npm run build:rick-context
```

Generate a candidate board and exact-mint Milo handoff:

```powershell
npm run scout:milo
```

Reconstruct a bounded 500-transaction Helius history for the first 20 manually curated wallets, build the durable-wallet/fresh-buy report, and run the Milo scout:

```powershell
npm run refresh:milo-intel
```

This command is read-only, but it consumes Helius API credits. It does not read a Spectre trading wallet, build a transaction, sign, or submit an order.

Audit one or more exact mints copied from Milo or another trusted source:

```powershell
npm run scout:milo -- --mints=MINT_ONE,MINT_TWO
```

Symbol-only Rick rows are rejected when more than one active mint uses the same symbol. An exact-mint audit bypasses that ambiguity without weakening the other checks.

Observe Milo's public wallet and append a read-only snapshot:

```powershell
npm run observe:milo-wallet
```

Run both reads:

```powershell
npm run milo:status
```

## Outputs

- `data/reports/milo-scout-latest.json`
- `data/reports/milo-wallet-latest.json`
- `data/reports/kolscan-wallet-evidence-latest.json`
- `data/kolscan/wallet-evidence/`
- `data/milo/scouts/`
- `data/milo/wallet-snapshots.jsonl`

Generated Milo data and the local wallet config are ignored by Git.

## Milo Handoff Rule

Put only the report's A/B exact mint addresses into Milo My Picks. For wallet-flow candidates, A/B additionally means qualified-wallet evidence and current Rick overlap both survived the gate. Never substitute a same-symbol token. Re-run the scout before changing the list, and leave Milo idle when no candidate passes.

The grades are research controls, not a profit guarantee. Milo's position cap, daily loss stop, no-averaging rule, and exit policy remain the final execution controls.
