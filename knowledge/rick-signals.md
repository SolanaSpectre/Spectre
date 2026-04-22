# Rick Signals

Rick-derived context is structured support, not a buy trigger.

Interpret it this way:

- deployer history: risk modifier
- holder context: wallet / holder quality modifier
- market stats: regime modifier

Rules:

- `STRUCTURED_SUPPORT` should raise confidence only when it agrees with momentum, liquidity, and strategy lane.
- `STRUCTURED_CAUTION` should lower confidence and can justify `WATCH` or `REJECT` when paired with weak market structure.
- `STRUCTURED_MIXED` is informative but not decisive.
- Rick context should never override hard liquidity, quoteability, or safety gates.
- Positive Rick context is most valuable when it agrees with wallet flow and Telegram narrative.
