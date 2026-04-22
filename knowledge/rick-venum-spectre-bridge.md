# Rick Venum Spectre Bridge

## Purpose

Define a clean relationship between:

- `Rick`
- `weRvENum`
- `Spectre`

So we can add room-reading and narrative awareness without turning the trading
bot into social-media soup.

## Role Split

### Rick

Rick is the fast external scout.

Rick is good for:

- what is happening now
- trending DEX and Pump names
- recent runners
- macro snapshot
- trending tweets and profiles
- token lore and token social lookup

Rick should be treated as:

- fast market terminal
- signal surface
- first-pass scout

Not:

- final interpreter
- final regime judge
- final trade decision maker

### weRvENum

Venum is the narrative interpreter and social creature.

Venum should:

- ingest Rick outputs
- ingest selected X context
- ingest selected Telegram context later if useful
- identify dominant narratives
- classify trader mood
- infer room posture
- compress the chaos into a small structured brief

Venum should not:

- decide trades
- set thresholds
- change sizing
- become raw tweet spam for Spectre

### Spectre

Spectre is the private trade auditor and execution brain.

Spectre should:

- consume Venum's structured brief as one more context layer
- use it as regime and posture context
- never use it as a direct buy trigger

## Best Rick Inputs For Venum

Start with:

- `/now@rick`
- `/macro@rick`
- `/tt@rick`
- `/xt@rick`
- `/runners@rick`
- `/dt@rick`
- `/pft@rick`
- `/burp@rick`

Optional later:

- `/lore@rick`
- `/gc@rick`
- `/soc@rick`
- `/ts@rick`

## Venum Output Contract

Venum should produce a small structured narrative brief.

The brief should answer:

- what does the room think matters right now
- how strong are those narratives
- what emotional posture is spreading
- what does that imply for runner and scalper conditions

Core fields:

- `market_posture`
- `dominant_narratives`
- `emerging_narratives`
- `fading_narratives`
- `attention_quality`
- `trader_psychology`
- `lane_implications`
- `supporting_signals`
- `warnings`

## Narrative Rules

The bridge should be adaptive.

Do not hardcode a fixed set of topics like:

- war
- oil
- repo
- QE

Those are examples, not the system.

The actual job is:

- detect whatever the room currently believes matters
- measure whether it is spreading
- infer whether it changes market posture

## Spectre Consumption Rules

Spectre may use the brief for:

- regime awareness
- confidence dampening
- tighter interpretation of marginal setups
- deciding whether no-trade behavior is healthy
- deciding whether runner or scalper posture fits the room better

Spectre may not use the brief for:

- direct buy triggers
- direct sell triggers
- threshold changes by itself
- letting social noise override deterministic structure

## First Implementation Path

Phase 1:

- document the bridge
- define the JSON shape
- create a sample brief

Phase 2:

- have Venum produce the brief manually or semi-manually from Rick outputs
- current first command: `python -m venum_standalone.cli spectre-brief-rick`

Phase 3:

- let Spectre load the brief as an optional sidecar context file

Phase 4:

- automate refresh and retention
- compare the brief against paper-run outcomes

## Success Criteria

This bridge is working if:

- Venum helps name the active narrative regime clearly
- Spectre becomes better at interpreting mixed conditions
- no-trade sessions become easier to trust when the room is weak
- runner vs scalper posture becomes easier to evaluate
- we avoid turning random CT noise into direct trading decisions
