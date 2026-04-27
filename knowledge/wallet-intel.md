# Wallet Intel

Wallet flow is supporting context, not automatic permission to trade.

## What Wallet Flow Can Tell Us

- Whether credible ranked wallets are touching the mint.
- Whether multiple wallets are converging on the same token.
- Whether our bot may be looking at a possible false negative.
- Whether the setup might fit WALLET_FLOW or strengthen another lane.

## How To Interpret Wallet Signals

- `topWalletCount`: how many tracked wallets touched the mint.
- `totalWalletTouches`: how repeatedly those wallets interacted with it.
- `weightedWalletScore`: higher means stronger wallet quality plus stronger touch intensity.
- `supportTier`: quick interpretation of the dominant wallet flow for this mint:
  - `TRUSTED_FLOW`
  - `MIXED_FLOW`
  - `AVOID_FLOW`
- `trustTier` on individual wallets:
  - `TRUSTED` means behavior currently looks usable for confirmation
  - `MIXED` means useful but noisy
  - `AVOID` means caution, spoofing risk, stale behavior, or poor overlap quality
- `behaviorProfile` helps explain how the wallet tends to operate:
  - `aggressive_pump_trader`
  - `active_rotator`
  - `pump_focused`
  - `ops_or_funder`
  - `stale_wallet`
- `topRejectReason`: tells us why the bot previously resisted the mint.

## Good Uses

- Raise confidence when strong wallet flow agrees with good momentum and acceptable liquidity.
- Give extra weight to `TRUSTED_FLOW` when deterministic structure is already good.
- Lower confidence when wallet flow is weak or absent.
- Lower confidence sharply when `AVOID_FLOW` dominates.
- Flag study candidates when strong wallets touch names our bot rejected repeatedly.

## Bad Uses

- Do not override severe liquidity problems just because wallets touched a mint.
- Do not assume a ranked wallet is always right.
- Do not treat one wallet touch as proof of quality.
- Do not ignore suspicious clustering or farm-like behavior.
- Do not ignore `AVOID` labels just because the wallet was early once.

## Future Helius Webhook Upgrade

Helius webhooks should be revisited for wallet watcher v2.

Best first use:

- monitor curated wallet watchlists in near real time
- receive enhanced or raw transaction events for known KOL wallets, suspected sniper wallets, alpha scalpers, conviction whales, risk wallets, and our own hot wallet
- feed those events into `data/wallet-events/events.jsonl` and the existing wallet-event ledger

Why it may help:

- fresher wallet behavior than periodic history polling
- better wallet-event timing around pre-migration and early post-migration phases
- cleaner inputs for wallet classifications like early sniper, alpha scalper, conviction whale, risk wallet, and late chaser

Constraints:

- requires a public webhook receiver URL, not just a local script
- each webhook push consumes Helius credits
- should start with tight tracked-account lists only
- should not replace PumpPortal's new-token/trade/migration stream
- wallet webhook data remains research/supporting context until proven by reports
