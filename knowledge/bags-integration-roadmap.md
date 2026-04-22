# Bags Integration Roadmap

This file captures how Bags could fit into the system later without distracting from the validated runner baseline.

## What Bags Looks Useful For

- launch and pool discovery
- venue-specific enrichment
- quote comparison
- future partner / creator / fee analytics

## What Not To Do First

- do not make Bags the primary live execution path yet
- do not rush into agent-wallet or export-style flows
- do not add new signing/key-handling complexity while the runner baseline is still being validated

## Best Near-Term Uses

### 1. Launch Feed Enrichment

Use:

- token launch feed

Why:

- another view into new launches
- possible cross-check against PumpPortal / existing venue discovery
- useful for later multi-venue runner or migration detection

### 2. Pool-By-Mint Lookup

Use:

- Bags pool lookup by token mint

Why:

- helps determine whether a mint has Bags venue support
- useful for venue-specific routing or post-launch structure checks

### 3. Quote Comparison

Use:

- Bags trade quote

Why:

- compare route quality / price impact against the current stack
- useful later for quote-quality investigation

## Medium-Term Uses

- swap transaction creation
- fee-share / partner analytics
- creator and lifetime-fee analytics

These are interesting, but secondary to:

- runner baseline validation
- sniper/scalper lane definition
- quote / quality research

## High-Caution Areas

- agent authentication
- wallet import / export
- anything that increases signing or key-management risk

These features are powerful, but they should be handled like production security work, not casual experimentation.

## Suggested Integration Order

1. launch feed
2. pool-by-mint lookup
3. quote comparison
4. only later consider execution or agent-wallet features

## How Bags Should Influence Ollama

- Bags should behave like structured venue context.
- Good uses:
  - another source of launch / venue awareness
  - quote-quality support
  - creator / fee maturity context later
- Bad uses:
  - standalone buy authority
  - reason to ignore hard gates
  - excuse to expand key exposure

## Current Decision

Track Bags as a future enrichment and venue-intelligence layer.
Do not let it disrupt the current runner baseline or pull focus from validated paper research.
