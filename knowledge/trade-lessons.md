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

## Curve Advancement Is Not The Same As Trade Edge

- PAPER480 on 2026-07-12 closed three separate curve-advancement hypotheses without producing a tradeable promotion:
  - runner-reject shadow reached `11/20` samples with `3W/8L`, `-0.059271262 SOL`, and `8` stop losses.
  - pinned crosser precursor confirmed crossing enrichment out of sample but failed economics with negative median and negative ex-top robustness.
  - prior `CURVE_NOT_ADVANCING` separator shadows were rejected out of sample.
- The shared lesson is that "this mint will advance up the curve" can be learnable while still being unprofitable with tight fixed-stop momentum entries near the curve.
- Do not repin or loosen a failed curve-advancement lane by quietly swapping exits, stops, or holds after seeing OOS results.
- Any attempt to apply trailing-giveback or runner-watch-style confirmation to a failed curve-advancement population must be treated as a new pre-registered hypothesis with its own future-only confirmation.
- The strongest live-shaped evidence remains selective `RUNNER_WATCH` entries with confirmation plus trailing exits, not raw proximity to curve60/curve90.

## Wallet Shadow Checkpoint Discipline

- The `all_low_score_first_sight__tracked_first_touch_buy` wallet shadow lane reached its first 10-sample checkpoint on 2026-07-13, but it was not promoted.
- The denominator was valid for the frozen broad slice: the rule was "earliest pre-entry/pre-85 tracked-wallet touch is a buy," not "positive/proven wallet only."
- The evidence was not clean enough to grade economically because some samples mixed a prior high wallet-touch curve with a later lower decision-time outcome window.
- Treat the first 10 samples as instrumentation-compromised/crossings-only supporting context.
- The lane disposition is `EXTEND_WITH_CAUSE_AFTER_JOIN_PROVENANCE_FIX`: collect 10 additional clean post-fix samples under the same broad slice before any promotion/kill decision.
- Do not tighten this frozen lane into a positive/proven-only wallet slice after seeing its OOS mix. A positive/proven-first-touch rule is a new hypothesis and needs its own discovery/pin/confirm cycle.

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
