# Market Mechanics

This bot trades Solana memecoins in a market where structure matters more than hype.

## Pump.fun State

- Prebond Pump.fun tokens live on a bonding curve first.
- Bonding progress is more meaningful than a fixed folklore market-cap number.
- A token can be near graduation while displayed market cap still looks modest.
- Graduation and migration are state transitions, not simple price milestones.

## Liquidity Truths

- Bonding-curve liquidity is not the same as post-migration pool liquidity.
- Fast execution does not fix bad liquidity.
- Thin liquidity can make a strong-looking runner untradeable.
- Quoteability and slippage matter as much as momentum.
- A setup with poor liquidity should usually be rejected even if narrative is strong.
- Once a token is already above the bot's configured minimum liquidity floor, liquidity should usually be treated as cautionary context instead of a second automatic veto by the AI alone.

## Prebond vs Postbond

- Prebond tokens can move very fast but are often thin and noisy.
- Near-graduation tokens may have better momentum persistence if flow remains strong.
- Post-migration tokens may have better route quality and more stable exits.

## Practical Heuristics

- Treat bonding progress, route type, and usable liquidity as first-class context.
- Do not assume a token is good just because the price is moving quickly.
- Do not assume a token is safe just because it is quoteable once.
- When liquidity is weak, prefer WATCH or REJECT over forced conviction.
