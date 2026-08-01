# Agentic Trading Architecture

This is a design note only. It does not change paper, dry-run, or live behavior.

## Purpose

Spectre's north star is a fully agentic trading system that can:

1. scalp selectively when market conditions are weak
2. hunt runners when continuation structure is present
3. identify conviction plays that may justify larger size after validation
4. learn from outcomes without tuning itself on unverified impressions
5. operate without allowing an AI model to bypass deterministic safety

Fully agentic does not mean unrestricted. It means the system can observe,
propose, execute approved workflows, reconcile outcomes, and remember lessons
inside explicit contracts.

## Core Rule

`AI proposes; deterministic policy disposes; the signer signs only validated intent.`

The model must never possess private keys, broaden its own mandate, alter risk
limits, select arbitrary recipients, or sign opaque transaction bytes.

## Ideas Retained From External Reviews

### Milo

The useful Milo concepts are structural, not a dependency:

1. versioned mandates that define what an agent may do
2. role-scoped tools instead of one all-powerful agent
3. a live system-state memory distinct from long-term lessons
4. structured decision diaries
5. an internal paper arena comparing frozen playbooks

### Parasol

The useful Parasol concepts are also structural, not a package dependency:

1. a generic signer boundary
2. separate quote, build, sign, send, and receipt stages
3. machine-readable spending policies
4. receipts that connect an action to its payment or transaction

Do not import Parasol's global `fetch` interception, automatic `402` payment,
automatic token swap, or opaque remote-transaction signing. Spectre should use
explicit providers and locally validate every instruction against a frozen
trade intent before a signer sees it.

## Target Layers

### 1. Observation Layer

Inputs may include:

1. Helius account and transaction evidence
2. PumpPortal market tape
3. RPC bonding-curve truth
4. wallet behavior
5. Rick, Telegram, and narrative context
6. portfolio and execution state

Every observation needs source, timestamp, freshness, and coverage provenance.

### 2. Deterministic Candidate Layer

This layer constructs candidate state and applies non-negotiable eligibility,
market-structure, liquidity, quote-quality, and safety rules.

The AI does not restore a candidate rejected here.

### 3. Agent Mandate

A versioned mandate defines the agent's allowed lane and behavior. It should
include:

1. mandate ID and schema version
2. allowed strategy lanes
3. allowed tools and data sources
4. PAPER, DRY_RUN, or LIVE mode
5. maximum trade, session, and daily budgets
6. allowed mints, recipients, programs, and venues where applicable
7. maximum slippage, price impact, quote age, and state age
8. maximum open positions and per-mint exposure
9. required confirmations and stop conditions
10. expiry and revocation state

A mandate is configuration owned by deterministic code. The model may not edit
or reinterpret it.

### 4. Agent Decision

The AI receives a bounded evidence packet and returns a small schema such as:

1. `ENTER`, `WATCH`, or `REJECT`
2. confidence and risk class
3. selected lane
4. short reason
5. evidence references and contradictions

This remains advisory until deterministic guards accept it.

### 5. Trade Intent

An accepted decision becomes an immutable intent before transaction building:

```json
{
  "intentId": "uuid",
  "mandateId": "runner_hunter_paper_v1",
  "mode": "PAPER",
  "mint": "base58",
  "side": "BUY",
  "amountLamports": "50000000",
  "maxSlippageBps": 150,
  "maxPriceImpactBps": 300,
  "quoteExpiresAt": "ISO-8601",
  "allowedPrograms": [],
  "allowedRecipients": [],
  "decisionEvidenceHash": "sha256",
  "idempotencyKey": "session|mint|side|decision"
}
```

The exact schema is future work. Amounts must use canonical integer units, with
mint decimals and value basis carried explicitly.

### 6. Policy Gateway

One deterministic gateway evaluates every intent. It must verify:

1. mandate validity and mode
2. lane status and promotion eligibility
3. per-trade, session, daily, and portfolio budgets
4. recipient, mint, venue, and program allowlists
5. quote freshness, slippage, price impact, and reserve drift
6. duplicate and replay protection
7. position and drawdown limits
8. transaction instructions against the accepted intent
9. live-readiness and kill-switch state

The result is an explicit `ALLOW`, `BLOCK`, or `EXPIRED` policy decision with a
stable reason code.

### 7. Execution Adapter

Venue adapters may quote and build transactions, but they may not sign them.
Remote transactions are untrusted input. Before signing, Spectre must decode and
verify program IDs, accounts, token mints, transfer amounts, recipients, fees,
and any address lookup tables against the accepted intent.

### 8. Signer Boundary

The signer interface should be deliberately small:

1. return its public address
2. sign a locally validated transaction bound to an approved intent ID
3. refuse expired, duplicate, unapproved, or over-budget requests

Local keys, hardware signers, or MPC custody can implement this interface later.
Changing custody must not change strategy or policy semantics.

### 9. Broadcast And Reconciliation

Broadcasting produces a receipt containing:

1. intent and mandate IDs
2. quote and policy decision hashes
3. transaction signature
4. submitted and landed slots
5. actual token and SOL deltas
6. fees, priority fees, slippage, and route
7. final status and retry history

Reconciliation must use on-chain effects, not merely a successful RPC response.

### 10. Decision Diary And Learning

One append-only diary should join:

1. observations used at decision time
2. deterministic gate results
3. agent decision and model provenance
4. mandate and intent
5. policy decision
6. execution receipt
7. realized outcome
8. later lesson or hypothesis disposition

Long-term memory should store only reviewed lessons and terminal hypothesis
results. Raw model opinions do not become doctrine automatically.

## Current Spectre Mapping

| Target responsibility | Existing foundation | Current boundary |
| --- | --- | --- |
| Deterministic candidate and safety gates | `src/trading-engine.js` | Strong foundation; keep authoritative |
| Quote freshness and quality | `src/trading-engine.js` | Runs before AI review |
| Compact AI auditor | `src/simple-runtime-ai-patch.js` | Bounded JSON output and single-flight guard; Qwen v2 evidence is paused for repeated-response degeneracy |
| Rich AI knowledge retrieval | `src/ai-agent.js`, `knowledge/` | Human-curated context, not autonomous memory |
| Mode dispatch | `src/lib/execution-modes.js` | PAPER, DRY_RUN, and LIVE are separated |
| Live-shaped no-broadcast validation | `src/lib/live-execution-dry-run-lane.js` | Good place to introduce future intent and policy schemas first |
| Capital sizing foundation | `src/capital-allocation.js` | Portfolio tiers exist; lane-aware live policy remains future work |
| Evidence and outcomes | telemetry, strategy ledger, outcome ledger | Rich records exist but are not one intent-linked decision diary |
| Live signing and execution | wallet and market-data paths | No reusable signer interface or single intent-bound transaction validator yet |

## Gap Map

### Current Priority: Finish Evidence Work

Complete the frozen Helius V12 experiment before changing provider routing,
strategy behavior, freshness bounds, or execution architecture.

### Next Design Priority: Contracts

Define report-only schemas for:

1. `AgentMandate`
2. `AgentDecision`
3. `TradeIntent`
4. `PolicyDecision`
5. `ExecutionReceipt`

Schemas should be versioned and fixture-tested before they influence behavior.

### Next Runtime Priority: Dry-Run Policy Gateway

Insert the policy gateway into the live-shaped dry-run lane first. Compare its
decision against current behavior without signing or broadcasting.

### Later Priority: Signer And Transaction Validation

Add a signer interface only after instruction-level validation is complete.
Never treat client-side signing by itself as a security boundary.

### Later Priority: Unified Diary

Join existing telemetry and ledgers through intent, mandate, and receipt IDs.
Do not replace the existing evidence paths until parity is demonstrated.

### Later Priority: Frozen Agent Arena

Run competing mandates or playbooks on identical historical or future PAPER
evidence. Freeze each contestant before evaluation, record all hypotheses, and
promote none directly to LIVE.

## Non-Negotiable Invariants

1. AI never receives or handles private keys.
2. AI never calls a signer directly.
3. AI cannot override deterministic safety, closed lanes, or live readiness.
4. Every external transaction is decoded and checked against local intent.
5. Every financial action has explicit budget and idempotency controls.
6. Provider or signer changes do not silently change strategy semantics.
7. PAPER evidence remains fixed-size and comparable.
8. No model, mandate, lane, or adapter reaches LIVE from replay evidence alone.

## Sequence From Here

1. finish and grade Helius V12 under its frozen contract
2. continue bounded Qwen auditor evaluation without making AI mandatory
3. specify the five contracts above as report-only data
4. shadow the policy gateway in DRY_RUN
5. validate transaction decoding and intent parity
6. add a signer abstraction
7. unify receipts and decision diaries
8. reconsider live execution only after strategy and operational graduation

