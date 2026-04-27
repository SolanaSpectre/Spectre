# Venum Standalone

Standalone Venum codebase focused on one job:

- grow the X account
- protect the persona
- learn which topics, timings, and reply angles earn real attention

This build does **not** carry the older Goblin-sidecar assumptions.
It treats Venum as a public character system with:

- topic intake
- growth scoring
- persona-safe draft generation
- memory to reduce repetitive posting

It does, however, intentionally preserve the strongest parts of the original
Goblin-era Venum voice:

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
- `venum_standalone/`: package source

## Quick Start

```bash
cd F:\Cline Test\Spectre\solana-trading-bot\agents\weRvENum
python -m venum_standalone.cli sample
python -m venum_standalone.cli draft --topics config/example_topics.json --kind both --limit 6
python -m venum_standalone.cli lint --text "headline loud at top\n\nwe rember who chase green"
python -m venum_standalone.cli spectre-brief --topics config/example_topics.json
python -m venum_standalone.cli spectre-brief-rick
python -m venum_standalone.cli spectre-update-draft
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
python -m venum_standalone.cli mentions --limit 5
python -m venum_standalone.cli x-draft-replies --limit 5
python -m venum_standalone.cli x-draft-replies --limit 5 --show-all-candidates
python -m venum_standalone.cli tracked-timeline --limit 5
python -m venum_standalone.cli tracked-draft-replies --limit 5 --per-account 3
python -m venum_standalone.cli kolscan-bootstrap --top 20 --write
python -m venum_standalone.cli kolscan-leaderboard --top 10
python -m venum_standalone.cli wallet-reaction --rank 1
python -m venum_standalone.cli follow-candidates --top 20
python -m venum_standalone.cli follow-account --username Solanadegen
python -m venum_standalone.cli search-openings --limit 10
python -m venum_standalone.cli search-draft-replies --limit 10 --show-all-candidates
python -m venum_standalone.cli spectre-update-draft --limit 5
python -m venum_standalone.cli x-post --text "headline loud\n\nliquidity move first"
```

`x-post` respects `VENUM_DRY_RUN=true` and will only simulate the post until you turn dry mode off.

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

Venum can also draft short manual-review community updates from Spectre's latest
paper run report:

```bash
cd F:\Cline Test\Spectre\solana-trading-bot\agents\weRvENum
python -m venum_standalone.cli spectre-update-draft --limit 5
```

This reads:

```bash
F:\Cline Test\Spectre\solana-trading-bot\data\reports\run-battlefield-latest.json
F:\Cline Test\Spectre\solana-trading-bot\paper-results.json
```

It only prints draft text and persona validation notes. It does not post to X.
