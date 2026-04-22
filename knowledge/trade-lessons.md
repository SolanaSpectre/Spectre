# Trade Lessons

These lessons come from this bot's own paper-trading outcomes.

## What Good Runner Trades Have Looked Like

- Good runner entries usually had:
  - acceptable liquidity above the hard floor
  - strong momentum without needing a looser age gate
  - enough buy pressure to survive the `0.62` buy-ratio filter
  - a clear lane match as `RUNNER_HUNTER`
- The best validated runner baseline so far is:
  - `MIN_PUMP_MOMENTUM_SCORE=0.68`
  - `MIN_PUMP_BUY_RATIO=0.62`
  - `MAX_PUMP_TOKEN_AGE_SECONDS=300`
- Consecutive profitable baseline runs suggest that selective participation is part of the edge.

## What Bad Runner Trades Have Looked Like

- Weak runner entries often shared one or more of these traits:
  - thin or only barely acceptable liquidity
  - weak buy ratio
  - no clear strategy lane
  - poor holder or deployer backing
  - caution-heavy wallet or Rick context
- A trade that passes hard gates can still be bad if the structure is merely marginal.
- "Above the floor" does not mean "good." It only means "not automatically disqualified."

## What Threshold Experiments Taught Us

- Lowering buy ratio from `0.62` to `0.60` increased activity but diluted edge.
- Widening age from `300` to `320` or `360` increased activity but also weakened results.
- These experiments suggest the current runner baseline is filtering out many genuinely worse setups.
- More trades did not equal better performance.

## How To Use Wins And Losses

- A profitable trade does not prove every similar setup is good.
- A losing trade does not prove the whole lane is broken.
- Look for repeated structural patterns:
  - which trades won
  - which trades lost
  - which sessions correctly produced no trades

## Good AI Behavior

- ENTER when the setup looks clearly tradeable and fits a real lane.
- WATCH when the candidate has some support but still looks marginal.
- REJECT when contradictions dominate even if one signal source looks exciting.
- Use local lessons to avoid approving weak "almost good" runner setups.

## Bad AI Behavior

- Do not bless a trade just because:
  - wallets touched it
  - chat is active
  - the token barely passed the hard floor
- Do not force trades in mixed or weak regimes just to stay active.
- Do not confuse a study candidate with a trade candidate.

## Regime Awareness

- Some sessions should produce no trades.
- Mixed or softer tapes can still have lots of chat activity without enough clean runner structure.
- In those conditions, discipline is more valuable than participation.
