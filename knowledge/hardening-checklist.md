# Hardening Checklist

These are not strategy ideas. These are operational sharpness issues to revisit as the system matures.

## 1. AI Timeout Overlap

Risk:

- when the primary AI review times out, the original request may still keep running
- if the system immediately launches a lightweight retry, local Ollama can end up doing duplicate work
- that can create queueing and make the timeout problem reinforce itself

Why it matters:

- this is an operational reliability issue, not a strategy issue
- it can distort review latency and system behavior under load

## 2. Permissive Context Matching

Risk:

- Telegram and Rick matching currently rely on permissive `includes()` style matching
- this is reasonable for full mint addresses
- it is much less reliable for short symbols or generic token names

Why it matters:

- false-positive chat/context matches can contaminate the AI packet
- bad context can make a good reviewer act worse than no reviewer

## 3. Paper / Live Coupling

Risk:

- paper mode still depends too much on live wallet configuration and live operational wiring
- paper-only research should ideally be more isolated from live secrets and live balance reads

Why it matters:

- increases operational friction
- weakens the clean boundary between research and live capital systems

## Current Priority

If these are revisited later, the likely order is:

1. AI timeout overlap
2. permissive context matching
3. paper/live separation

## Rule

Do not confuse hardening work with strategy tuning.
These are system-quality improvements, not reasons to reopen threshold churn.
