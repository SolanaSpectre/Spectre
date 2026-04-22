# Kolscan Wallet Lessons

These lessons come from the current Kolscan plus Helius wallet-behavior snapshot, not from generic theory.

## Current Good Wallet Patterns

- Most `TRUSTED` wallets currently look like one of two usable archetypes:
  - `aggressive_pump_trader`
  - `active_rotator`
- Trusted aggressive pump traders usually show:
  - high swap rate
  - strong pump-focused activity
  - low transfer-heavy behavior
  - very recent activity
- Trusted active rotators usually show:
  - solid swap activity
  - enough pump focus to matter
  - broader rotation behavior without collapsing into ops-only noise

## Current Bad Wallet Patterns

- Most `AVOID` wallets currently look like:
  - `ops_or_funder`
  - `stale_wallet`
- Avoid-wallet patterns are dominated by:
  - `TRANSFER_HEAVY`
  - `OPS_HEAVY`
  - `LOW_SWAP_ACTIVITY`
  - `LOW_PUMP_FOCUS`
- `HIGH_REJECT_OVERLAP` is especially important:
  - it means the wallet repeatedly touched names our bot saw and rejected
  - this is a caution flag, not proof that the bot was wrong

## What To Learn From This

- Good runner support is not “any ranked wallet touched it.”
- Better runner support looks like:
  - multiple `TRUSTED` wallets
  - especially `aggressive_pump_trader` or `active_rotator`
  - low ops-heavy / transfer-heavy contamination
- Bad runner support looks like:
  - `AVOID_FLOW` without trusted confirmation
  - ops-heavy wallets dominating the touches
  - stale wallets or wallets with very low swap activity
  - historically rejected overlap without stronger independent evidence

## Strategy Implications

- `trusted_aggressive_pump_traders_present`
  - supports early momentum entries
  - strongest when buy ratio, age, and liquidity are already acceptable
- `trusted_active_rotators_present`
  - supports cleaner continuation and rotation setups
  - useful when the move already has some structure
- `multi_wallet_trusted_convergence`
  - can raise confidence
  - should not override hard gates
- `ops_heavy_avoid_wallets_present`
  - strong caution
  - often means operational or manipulative flow instead of clean trading conviction
- `transfer_heavy_avoid_flow`
  - do not confuse with skilled accumulation
- `historically_rejected_wallet_overlap`
  - treat as a study signal, not as permission to enter

## Current Named Examples

- Trusted examples in the current snapshot include:
  - `unprofitable`
  - `xunle`
  - `Phineas.SOL`
  - `Insyder`
  - `big bags bobby`
  - `ozark`
  - `Pain`
- Avoid examples in the current snapshot include:
  - `xander`
  - `Lynk`
  - several `ops_or_funder` style wallets

Do not copy named wallets blindly.
Use them to understand behavior patterns, not as automatic authority.
