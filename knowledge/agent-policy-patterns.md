# Agent Policy Patterns

These notes were pulled from `F:\weRvENum` because that project does one thing very well:

it separates agent behavior into small policy layers instead of one giant prompt or one giant config blob.

That is useful for this trading build even though the domain is different.

## Best Idea To Borrow

The strongest pattern in `weRvENum` is:

1. one canonical identity or doctrine file
2. one attention or intake policy
3. one action policy
4. one memory or novelty layer
5. one follow-up enforcement layer

In that project, those layers are split into files like:

1. `persona_rules.json`
2. `attention_policy.json`
3. `follow_policy.json`
4. topic and engagement targets

For this trading system, the direct lesson is:

do not let the AI layer become one giant mixed pile of market doctrine, execution doctrine, social context rules, and live-risk rules.

## What This Means For Our Bot

The current build already moved in the right direction with:

1. `strategy-lanes.md`
2. `decision-rules.md`
3. `trade-lessons.md`
4. `regime-playbooks.md`
5. `wallet-intel.md`
6. `kolscan-wallet-lessons.md`
7. `rick-signals.md`
8. `narrative-signals.md`

That is good.

The `weRvENum` lesson is that we should keep leaning into this split instead of collapsing everything back into a single smart prompt.

## Best Structural Imports

### 1. Explicit Hard-Ban Thinking

`persona_rules.json` uses hard bans for system leaks and unsafe phrasing.

Trading equivalent:

the auditor should have explicit hard-ban logic for:

1. direct financial-advice style output
2. invented external facts
3. hidden-system leakage
4. unsupported certainty language
5. action drift outside the allowed contract

We already do some of this implicitly.

The lesson is to keep these as explicit policy rules, not just vibes.

### 2. Attention Policy As A Separate Layer

`attention_policy.json` is useful because it answers a different question than persona:

`is this even worth reacting to?`

Trading equivalent:

we should keep intake or attention policy separate from trade judgment.

That means:

1. candidate worthiness
2. social-context worthiness
3. wallet-context worthiness
4. quoteability and execution worthiness

should not all be solved in the same mental step.

This supports the current design where deterministic filtering happens before AI review.

### 3. Archetype Classification

`wallet_lore.py` is simple but smart:

it classifies wallet behavior into small archetypes before generating any output.

Trading equivalent:

we should keep classifying things into compact behavior buckets before asking the AI to reason over them.

Examples:

1. wallet archetypes
2. deployer archetypes
3. tape archetypes
4. setup archetypes

This reinforces the direction we are already taking with:

1. trusted vs mixed vs avoid wallet flow
2. structured support vs structured caution in Rick context
3. runner vs scalper vs future sniper lane separation

### 4. Novelty / Repetition Awareness

`weRvENum` keeps memory so the system does not keep saying the same thing over and over.

Trading equivalent:

future benchmark and review systems should remember:

1. repeated weak setup types
2. repeated false-positive structures
3. repeated false-negative structures
4. repeated context combinations that do not add value

That does not mean changing paper behavior now.

It means future learning layers should reduce repetitive bad judgment patterns, not just accumulate more notes.

## What Not To Import

Do not import:

1. the persona voice system
2. posting-growth mechanics
3. engagement farming logic
4. public-character behavior rules

Those belong to a social agent, not a trading auditor.

The value here is structural, not stylistic.

## Best Takeaway

The best thing to borrow from `weRvENum` is:

`small policy files + explicit archetypes + clear intake/action separation`

That pattern makes agents easier to reason about, easier to harden, and less likely to turn into one giant mushy prompt.

That is exactly the kind of discipline we want for a live-capital trading agent.

## Near-Term Use

This should influence future work in three places:

1. benchmark packet capture
2. live-risk policy separation
3. future deployer and setup archetype classification

It should not change the current paper runner baseline directly.
