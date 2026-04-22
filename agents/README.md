# Agent Projects

This directory holds agent projects that belong with the Spectre stack but should
remain logically separate from the core trading bot runtime.

## Current layout

- `weRvENum/`
  - public/social-facing narrative agent project
  - separate from the private Spectre trade auditor
  - intended to help with room-reading, sentiment, and narrative context rather
    than direct trade execution

## Why this exists

The trading bot in `src/` should stay focused on deterministic filtering,
context enrichment, and trade auditing.

The `weRvENum` project is a different kind of agent:

- character-driven
- socially expressive
- useful for reading narrative and engagement patterns
- not part of the core execution engine

Keeping it here preserves one codebase while protecting separation of roles.
