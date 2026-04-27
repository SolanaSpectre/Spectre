# Venum Standalone

Standalone Venum codebase focused on one job:

- grow the X account
- protect the persona
- learn which topics, timings, and reply angles earn real attention
- gather social intelligence without becoming a Spectre announcement bot

This build does **not** carry the older sidecar assumptions.
It treats Venum as a public character system with:

- topic intake
- growth scoring
- persona-safe draft generation
- memory to reduce repetitive posting
- room/context awareness for replies and market narratives
- lightweight relationship memory for accounts Venum sees or engages

Venum has its own X account, lore, and personality. The Spectre account is
controlled separately by the operator.

It does, however, intentionally preserve the strongest parts of the original
Venum voice:

- `we` identity instead of `i`
- big brain dumb words
- deterministic misspelling instead of random typo slop
- spoodee lore as a recurring, controlled rivalry
- readable first weird second

## Philosophy

We want stronger reach without spam, deception, or platform-evasion tricks.

The growth loop here is:

1. ingest candidate topics
2. score them for relevance, freshness, and conversation potential
3. draft replies and original posts in Venum voice
4. reject drafts that drift out of persona
5. store what we posted so future drafts stay novel

## Layout

- `config/persona_rules.json`: canonical Venum speech rules
- `config/growth_policy.json`: what kinds of topics/angles are allowed
- `config/attention_policy.json`: second-stage replyability and attention rules
- `config/tracked_accounts.json`: accounts Venum hunts for openings
- `config/follow_policy.json`: curated important-account follow rules
- `config/engagement_targets.json`: special accounts and search queries for openings
- `config/spectre_narrative_brief.schema.json`: structured handoff contract for Spectre
- `config/example_spectre_narrative_brief.json`: example regime/narrative brief
- `config/example_topics.json`: sample input for local testing
- `docs/social_intelligence_plan.md`: Venum's social-intel mission and build order
- `venum_standalone/`: package source

## Quick Start

```bash
cd F:\Cline Test\Spectre\solana-trading-bot\agents\weRvENum
python -m venum_standalone.cli sample
python -m venum_standalone.cli draft --topics config/example_topics.json --kind both --limit 6
python -m venum_standalone.cli lint --text "headline loud at top\n\nwe rember who chase green"
python -m venum_standalone.cli spectre-brief --topics config/example_topics.json
python -m venum_standalone.cli spectre-brief-rick
```

## Input Shape

Topic files are JSON arrays of objects. Minimal shape:

```json
[
  {
    "id": "topic-1",
    "author_handle": "WatcherGuru",
    "title": "Bitcoin falls after geopolitical headline",
    "text": "headline hit first then price reacts",
    "created_at": "2026-04-12T13:20:00Z",
    "tags": ["bitcoin", "headline", "liquidity"],
    "metrics": {
      "likes": 1200,
      "replies": 180,
      "reposts": 350,
      "quotes": 42
    }
  }
]
```

## Output

The `draft` command prints ranked candidates with:

- topic score
- candidate type
- draft text
- persona validation notes
- rationale

That gives us a clean base for later wiring into any private bot brain or posting executor you want.

## Local Model

The current default local model is:

```bash
gurubot/self-after-dark:8b-q4_K_M
```

Venum talks through Ollama on:

```bash
http://127.0.0.1:11434
```

## X API Setup

Copy `.env.example` to `.env` and fill in your X account credentials locally.

Required values:

- `X_API_KEY`
- `X_API_SECRET`
- `X_ACCESS_TOKEN`
- `X_ACCESS_TOKEN_SECRET`
- `X_BEARER_TOKEN`
- `X_USER_ID`

## New Commands

```bash
cd F:\Cline Test\Spectre\solana-trading-bot\agents\weRvENum
python -m venum_standalone.cli whoami
python -m venum_standalone.cli x-budget-status
python -m venum_standalone.cli mentions --limit 5
python -m venum_standalone.cli x-draft-replies --limit 5 --max-drafts 3
python -m venum_standalone.cli x-draft-replies --limit 5 --show-all-candidates
python -m venum_standalone.cli tracked-timeline --limit 5
python -m venum_standalone.cli tracked-draft-replies --limit 5 --per-account 3 --max-drafts 3
python -m venum_standalone.cli kolscan-bootstrap --top 20 --write
python -m venum_standalone.cli kolscan-leaderboard --top 10
python -m venum_standalone.cli wallet-reaction --rank 1
python -m venum_standalone.cli follow-candidates --top 20
python -m venum_standalone.cli follow-account --username Solanadegen
python -m venum_standalone.cli search-openings --limit 10
python -m venum_standalone.cli search-draft-replies --limit 10 --max-queries 3 --max-drafts 3 --show-all-candidates
python -m venum_standalone.cli trend-hunt --limit 10 --max-queries 4 --max-drafts 5 --min-opportunity-score 35
python -m venum_standalone.cli x-post --text "headline loud\n\nliquidity move first"
```

`x-post` respects `VENUM_DRY_RUN=true` and will only simulate the post until you turn dry mode off.

## X API Budget

Venum keeps a local daily X API ledger in:

```bash
runtime/x_api_budget.json
```

Defaults are intentionally conservative:

```bash
VENUM_X_BUDGET_ENABLED=true
VENUM_X_DAILY_READ_BUDGET=80
VENUM_X_DAILY_WRITE_BUDGET=5
VENUM_X_DAILY_FOLLOW_BUDGET=5
```

Search commands cap the number of paid search queries with `--max-queries`.
Drafting commands cap the number of generated replies with `--max-drafts`.
Weak or generic model replies are now suppressed even when they technically pass
persona validation.
Add `--remember` to draft commands when a reviewed sweep should update Venum's
author relationship profiles and recent phrase memory.
Use:

```bash
python -m venum_standalone.cli x-budget-status
```

to check the local meter before running a hunt.

## Spectre Bridge

Venum can now produce a first-pass structured narrative brief for Spectre:

```bash
cd F:\Cline Test\Spectre\solana-trading-bot\agents\weRvENum
python -m venum_standalone.cli spectre-brief --topics config/example_topics.json
python -m venum_standalone.cli spectre-brief-rick
```

By default this also writes:

```bash
runtime/spectre_narrative_brief_latest.json
runtime/spectre_narrative_brief_rick_latest.json
```

`spectre-brief-rick` reads the bot's Rick sidecar snapshot from:

```bash
F:\Cline Test\Spectre\solana-trading-bot\data\rick-context\latest.json
```

and converts real Rick market reports into the same structured posture brief format.

This is meant to be:

- posture context
- narrative compression
- lane guidance

Not:

- a direct trade trigger
- a threshold setter
- a replacement for Spectre's deterministic filters
