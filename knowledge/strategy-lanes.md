# Strategy Lanes

This bot uses multiple strategy lanes. They are not interchangeable.

## RUNNER_HUNTER

- Goal: catch fresh momentum continuation.
- Best signs: strong recent trade velocity, strong buy pressure, fast participation, good follow-through.
- Bad signs: thin liquidity, weak buy ratio, stale token age, fading burst.
- Exit style: trailing runner logic, not tiny instant profit-taking.

## SCALPER

- Goal: capture short moves in noisy conditions.
- Best signs: quick micro-imbalance, stable quote path, short hold edge.
- Bad signs: low route quality, wild slippage, slow confirmation.
- Exit style: fast, disciplined, short duration.

## SNIPER

- Goal: precise high-probability entry.
- Best signs: clean inflection, decisive confirmation, low hesitation after trigger.
- Bad signs: dirty structure, unreliable liquidity, unclear trigger.
- Exit style: tight invalidation.

## MIGRATION_HUNTER

- Goal: exploit transitions from bonding-curve state into stronger pool/routing conditions.
- Best signs: recent migration, improving liquidity, healthy continuation after transition.
- Bad signs: migration with no follow-through, early dump behavior.
- Exit style: more patience than a scalp.

## WALLET_FLOW

- Goal: use strong wallet behavior as supporting evidence.
- Best signs: multiple credible wallets touching the same mint, good wallet quality, early but not obviously farmed flow.
- Bad signs: only suspicious wallets, bundle/farmer clusters, wallet flow contradicts price quality.
- Exit style: follow the setup type, not the wallet label alone.

## Core Rule

- A candidate should be judged by which lane it actually matches.
- Do not treat every setup as a runner.
- If lanes conflict, prefer WATCH or REJECT.
