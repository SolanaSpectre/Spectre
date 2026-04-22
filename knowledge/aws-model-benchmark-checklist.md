# AWS Model Benchmark Checklist

Use this checklist when comparing stronger AWS-hosted models for the local AI auditor.

## Goal

Choose the best model for the bot's context-heavy, JSON-only trade review workload without disrupting the validated `RUNNER_HUNTER` baseline.

The model is an auditor, not a freeform trader.

## First Benchmark Pack

Test these three first:

1. `Qwen 2.5 7B Instruct`
2. `Hermes-2-Pro-Llama-3-8B`
3. `Llama 3.1 8B Instruct`

Optional second round:

1. `Gemma 2 9B`
2. `Mistral 7B Instruct`

## Infrastructure Baseline

Use the simplest fair setup first:

1. AWS `EC2 g4dn.xlarge`
2. `Ollama`
3. same timeout settings across all models
4. same prompt assembly logic across all models
5. same quantization class when practical

Do not optimize serving before the first comparison. First find the right model, then worry about vLLM or stricter schema decoding later.

## Replay Pack

Build a replay set of saved real review packets from our own history.

Current seed builder:

1. run `npm run build:model-benchmark-replay`
2. inspect `data/model-benchmark/latest.json`
3. treat the current output as a seed pack derived from run logs, not a full historical AI packet archive

Target:

1. `30-50` total cases
2. `10-15` good entries that became solid paper trades
3. `10-15` bad or weak entries that should be rejected or downgraded
4. `10-15` mixed-regime or no-trade borderline cases

The pack should include:

1. strong wallet support
2. weak wallet support
3. strong Rick support
4. noisy Telegram chatter
5. thin liquidity above deterministic floor
6. weak buy ratio
7. age pressure
8. quote-price-impact concerns
9. conflicting context across multiple layers

## Inputs To Hold Constant

For every replayed case, keep all of this identical:

1. deterministic packet
2. wallet context
3. Telegram context
4. Rick context
5. knowledge-pack selection
6. system prompt
7. JSON contract

Only the model should change.

## Metrics

Score each model in four buckets.

### 1. Reliability

Track:

1. valid JSON rate
2. retry rate
3. timeout rate
4. parse-fallback rate
5. malformed or schema-broken responses

### 2. Latency

Track:

1. total response time
2. average latency
3. p95 latency
4. worst-case latency
5. time to first token if available

### 3. Judgment Quality

For each case, review:

1. correct action shape: `ENTER`, `WATCH`, `REJECT`
2. whether the reasoning matches known outcome
3. whether the model overreacts to chatter
4. whether doctrine is respected under conflicting inputs
5. whether weak "no clear lane" setups are handled conservatively

### 4. Discipline

Track:

1. false positives: weak trades the model blesses
2. false negatives: good setups the model kills
3. behavior in mixed tape
4. consistency under noisy context

## Scoring Weights

Use these weights:

1. `35%` judgment quality
2. `30%` reliability
3. `20%` latency
4. `15%` discipline consistency

Reason:

1. a fast model that breaks JSON is not useful
2. a smart model that times out is not useful
3. judgment and reliability matter more than style

## Win Conditions

A winner should:

1. produce valid JSON almost every time
2. stay under a few seconds on average
3. reduce retries and timeouts versus the current small-model setup
4. make fewer bad `ENTER` calls on weak borderline setups
5. behave more coherently than `llama3.2:3b` under mixed context

## Things Not To Do

Do not:

1. benchmark on vibes
2. benchmark only winning trades
3. change prompts mid-test
4. compare one model on full context and another on compressed context
5. let quantization or timeout differences quietly invalidate the comparison

## Decision Rule

1. If one model clearly wins on judgment and reliability without unacceptable latency, make it the leading auditor candidate.
2. If two models are close, prefer the faster or cheaper one for `RUNNER_HUNTER` and keep the other in reserve for deeper future lanes.
3. If none clearly beat the current setup, keep the current stack and keep validating.

## Expected First Read

Before benchmarking, the most likely first winners are:

1. `Qwen 2.5 7B Instruct` for best balance
2. `Hermes-2-Pro-Llama-3-8B` for strongest JSON-tuned Llama-family candidate
3. `Llama 3.1 8B Instruct` as the clean mainstream comparison

## Execution Notes

Run the benchmark as a side investigation while keeping the current runner baseline frozen.

Do not mix this benchmark with:

1. fresh threshold tuning
2. scalper-lane tuning
3. live-capital changes

The point is to upgrade the AI layer cleanly before giving it more responsibility.
