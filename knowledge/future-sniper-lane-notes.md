# Future Sniper Lane Notes

This file captures ideas for a future `SNIPER` lane without mixing them into the current runner baseline too early.

## First Principle

Sniper behavior is not the same as runner-hunter behavior.

- runner-hunter: catch fresh continuation with structure
- sniper: get in extremely early, manage micro-latency, and exit fast

If we blend them together too early, we ruin both lanes.

## What Fast Wallets Suggest

Wallets that make small early buys and occasionally realize much larger sells are often doing some mix of:

- ultra-early launch entries
- fast flips into retail flow
- strict position sizing
- very short hold windows

What matters is not just the big sell transactions.
What matters is:

- full hit rate
- loss rate
- hold time
- average entry size
- distribution of returns

Visible wins hide a graveyard of bad entries if we only look at highlights.

## What A Sniper Lane Would Likely Need

- faster signal detection than runner-hunter
- tighter execution path
- better RPC quality
- more sensitivity to latency and quote freshness
- smaller sizing
- faster exits

Possible future ingredients:

- higher-performance RPC / private RPC usage
- faster event streams
- Jito / tip-aware execution research
- venue-specific launch feeds

## What Not To Confuse With Edge

- copying a wallet address
- copying a Telegram bot
- copying visible winners without the loss distribution
- assuming speed alone fixes bad selection

## The Gemini Conversation Lesson

The useful takeaway was not:

- "go become that wallet tomorrow"

The useful takeaway was:

- this is PvP
- speed matters by lane
- the visible big flips are only part of the truth
- sniper behavior deserves its own lane and its own research

## Repo Pattern: Create -> Wait -> Sell

The open-source `pumpfun-sniping-bot` repo reinforces that an anti-sniper / dev-operator lane has a very different structure from runner-hunter.

Core loop:

- create token
- buy own token immediately
- watch for external buys
- sell into that first external flow
- rotate to a fresh wallet and repeat

Important mechanics from that repo:

- very short timeout windows
- first-external-buy detection
- full-cycle profit tracking
- fresh-wallet cycling between launches

Why this matters:

- the edge is mostly in launch mechanics, latency, and first-buyer detection
- not in the same kind of market-structure filtering used by runner-hunter
- it is a separate lane with separate reliability questions

Most important caution:

- even the repo author said the approach was not consistently reliable long-term
- that is a good reminder not to confuse a clever mechanism with stable edge

## Deployer-Led Trading Pattern

One important pattern to study is the dev-led flip described by Alonzo:

- "buy on dev, sell dev"
- use dev-side buying/selling to cover dex costs quickly
- avoid bundling/farming the chart to death
- sell in the first candle only
- keep side-wallet exposure capped
- focus on higher-probability narratives instead of pure slop

The fuller thread adds an important nuance:

- the method is not "sell everything instantly"
- the idea is:
  - recover early risk / dex costs quickly
  - keep a small retained bag (`~3.4%` to `~3.8%`)
  - only keep holding that residual bag if the coin still has life or bonds
  - cut it if the coin is clearly dead

That makes this more of a two-bucket method:

- early de-risking bucket
- conditional retained-conviction bucket

Why this matters:

- this is not the same thing as classic sniper copy-trading
- it is a deployer/operator method
- it mixes launch creation, narrative selection, and first-candle exit discipline
- it is also not identical to full chart-farm behavior

This should be studied as:

- deployer behavior intelligence
- dev-linked wallet behavior
- first-candle exit method
- partial de-risking versus full dump behavior

not as a runner-hunter rule.

## What We Study vs What We Refuse To Build

Useful to study:

- `DB -> external buys -> DS` behavior patterns
- first-candle dev sell pressure
- how partial de-risking differs from full chart-kill behavior
- repeated deployer signatures across launches
- how to avoid becoming exit liquidity for these methods

Not acceptable to build into this system:

- fake "organic" volume
- manipulative wallet farming
- deceptive flow intended to bait outside buyers
- launch-and-dump automation designed to manufacture victims

The right use of these insights is defensive and analytical:

- detect the pattern
- classify the pattern
- protect against the pattern

not automate the pattern.

## Questions For Future Research

- what distinguishes a good sniper wallet from a bad one?
- what is the true hit-rate distribution?
- how often do fast wallets win because of speed vs selection?
- what first-candle or first-minute exit behaviors repeat?
- when does dev-led behavior produce real edge vs just hidden self-dealing?

## Current Decision

Keep the current runner baseline separate.
Do not force sniper logic into runner-hunter.
Collect notes, wallet behavior, and venue data now so the future sniper lane can be built faster and smarter later.
