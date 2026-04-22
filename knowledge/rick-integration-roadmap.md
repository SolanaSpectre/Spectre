# Rick Integration Roadmap

This file defines the next structured context sources to integrate from Rick / Talk.Markets resources.

The goal is not to dump raw Rick output into Ollama. The goal is to transform Rick-style commands and reports into compact, deterministic context packets that can be used by:

- the deterministic runner-hunter pipeline
- post-run false-negative review
- Ollama trade review prompts

## Priority Order

1. Deployer History
2. Notable Holders / Known Top Holders
3. Market Stats / State of the Trenches
4. Today's Runners Report / Last & Hot Tokens
5. Dex Paid / Dex Paid Alerts
6. Lore / Trending Tweets / Narrative enrichment

This order is intentional:

- first improve risk filtering
- then improve wallet/holder interpretation
- then improve regime awareness
- then improve post-run review
- finally improve narrative context

## Phase 1: Deployer History

Primary value:

- detect repeat deployers
- detect rug / spam / farm patterns
- identify deployers with a history of runners

Expected normalized fields:

```json
{
  "deployerHistory": {
    "deployerAddress": "string",
    "knownProjects": 0,
    "recentLaunches": 0,
    "runnerCount": 0,
    "rugCount": 0,
    "status": "TRUSTED|MIXED|AVOID|UNKNOWN",
    "notes": ["short note"]
  }
}
```

Immediate usage:

- hard caution for serial bad deployers
- confidence boost only when deployer history is unusually strong

## Phase 2: Notable Holders / Known Top Holders

Primary value:

- understand holder quality beyond raw holder count
- detect smart holders, bundlers, farmers, and suspicious clusters
- cross-check with our own wallet-intel layer

Expected normalized fields:

```json
{
  "holderContext": {
    "topHolderCount": 0,
    "notableHolderCount": 0,
    "trustedHolderCount": 0,
    "avoidHolderCount": 0,
    "bundleRisk": "LOW|MEDIUM|HIGH",
    "farmerRisk": "LOW|MEDIUM|HIGH",
    "notes": ["short note"]
  }
}
```

Immediate usage:

- warn when top holders are mostly toxic
- support trades where wallet flow and holder quality agree

## Phase 3: Market Stats / State of the Trenches

Primary value:

- tell the bot what kind of day it is
- support regime-style decisions
- avoid forcing runner logic in dead or messy conditions

Expected normalized fields:

```json
{
  "marketStats": {
    "regime": "RUNNER_MARKET|CHOPPY_MARKET|DEAD_MARKET|MIGRATION_MARKET",
    "hotTokenCount": 0,
    "migrationCount": 0,
    "runnerQuality": "LOW|MEDIUM|HIGH",
    "notes": ["short note"]
  }
}
```

Immediate usage:

- runner-hunter confidence modifier
- later can become an explicit regime gate

## Phase 4: Today's Runners Report / Last Hot Tokens

Primary value:

- improve after-action review
- compare our misses against what actually ran
- identify repeated false-negative patterns

Expected normalized fields:

```json
{
  "runnerReport": {
    "appearedInRunnersReport": true,
    "appearedInHotTokens": true,
    "rank": 0,
    "notes": ["short note"]
  }
}
```

Immediate usage:

- post-run learning
- watchlist generation
- bot-learnings knowledge pack updates

## Phase 5: Dex Paid / Dex Paid Alerts

Primary value:

- detect whether a project is spending to appear more serious / visible
- separate zero-effort spam from more organized launches

Expected normalized fields:

```json
{
  "dexContext": {
    "dexPaid": true,
    "alerted": true,
    "status": "PAID|UNPAID|UNKNOWN",
    "notes": ["short note"]
  }
}
```

Immediate usage:

- supporting context only
- should not override weak liquidity or bad deployer history

## Phase 6: Lore / Trending Tweets / Narrative enrichment

Primary value:

- enrich Telegram context
- let Ollama understand story quality, not just mention count

Expected normalized fields:

```json
{
  "narrativeContext": {
    "loreSummary": "short text",
    "tweetVelocity": "LOW|MEDIUM|HIGH",
    "narrativeStrength": "LOW|MEDIUM|HIGH",
    "notes": ["short note"]
  }
}
```

Immediate usage:

- AI context only
- not a deterministic buy trigger

## Output Contract

All Rick-derived data should eventually merge into a single local artifact, similar to wallet intel and Telegram context.

Suggested future artifact:

`data/rick-context/latest.json`

Suggested top-level shape:

```json
{
  "generatedAt": "iso-timestamp",
  "tokens": {
    "MINT_ADDRESS": {
      "deployerHistory": {},
      "holderContext": {},
      "marketStats": {},
      "runnerReport": {},
      "dexContext": {},
      "narrativeContext": {}
    }
  }
}
```

## How Ollama Should Use It

Rick context should behave like:

- deployer history: risk modifier
- holder context: wallet/cluster modifier
- market stats: regime modifier
- runners report: learning / validation source
- dex paid: supporting maturity signal
- lore / tweets: narrative modifier

Rick context should not behave like:

- standalone buy authority
- replacement for liquidity checks
- replacement for deterministic gates

## First Build Slice

The first practical integration slice should be:

1. deployer history
2. notable holders
3. market stats

That slice gives the best balance of:

- risk filtering
- wallet/holder intelligence
- regime context

without requiring the full narrative stack first.
