# &milo Documentation Digest

Source: `https://docs.andmilo.com/` — all 31 pages listed in the public nav, read 2026-08-02.

This is a digest of &milo's own documentation. Everything below is what &milo claims about itself. Nothing here has been independently verified against the running product or on-chain behaviour. Marketing pages are marked as such; the four technical pages at the end are the only ones with concrete, testable specifications.

---

## 1. What &milo Is

An AI portfolio manager / "AI crypto agent" for crypto trading, operated through natural-language conversation instead of dashboards and parameter panels. Positioning language: "trade with confidence instead of chaos", operates "quietly, attentively, and with discipline", explains decisions "in plain English", users "stay in control of your wallet".

Framing on `/why-now`: DeFi complexity has multiplied, liquidity is fragmented across chains, and professional traders already use AI tools retail cannot reach. &milo claims to bring "institutional-grade execution" and tools "once reserved for institutions and quant firms" to retail. This page is pure positioning — no market statistics, no dated claims.

**Four product pillars** (`/the-ai-crypto-agent-experience`):

1. **Smart Wallet & AI Assistant** — natural-language commands, smart routing across DEXs, risk-aware operations
2. **Live Market Intelligence** — chart analysis, token screening, whale tracking, social sentiment
3. **Portfolio Command Center** — multi-wallet, cross-chain tracking, performance analytics, risk monitoring
4. **Social Trading** — follow/copy successful traders, community alpha sharing

Stated phasing: **Phase 1** Solana-focused (DeFi integration, social, portfolio); **Phase 2** cross-chain expansion, advanced AI, institutional features.

---

## 2. Team, Backers, Advisors

**Team** (`/the-team-behind-and-milo`)

- **Moti Cohen** — CEO & co-founder. Previously founded Apester.com (clients incl. Time Inc., Rolling Stone, Variety); founding member of bit.dev (adopted by DELL, AT&T). In crypto since 2017 under the handle "@marooned_otc".
- **Omri Keret** — CTO & co-founder. 15+ years architecting complex systems and AI solutions; enterprise software plus crypto trading experience.

**Backers** (`/backers-and-advisory`)

- **Wix Ventures** — Wix's corporate investment arm, Seed–Series A globally. (The team page phrases this as "backed by Wix Capital and prominent angel investors".)
- No funding amount is disclosed anywhere in the docs.

**Advisors**

- **Tal Cohen** — blockchain advisor since 2016; former CEO of Kraken US (until mid-2024); previously McKinsey and Google.
- **Tomer Warschauer Nuni** — CMO at Kima Network; Investment Director at ChainGPT Labs; angel investor in 60+ companies.
- **Ariel Maislos** — serial entrepreneur/angel; portfolio exits to Apple, Crowdstrike, Palo Alto Networks, Google.

---

## 3. Operating Modes

There are three distinct user-facing modes. The distinction matters: only one of them trades without per-trade human approval.

### Manual Mode (`/getting-started-with-milo-manuel-mode`)

Conversational and fully user-approved. Explicitly: milo "will **never trade automatically**" in this mode. User asks questions, reviews trade ideas, approves each trade individually.

Setup: authenticate at `app.andmilo.com` via Google/social login or existing wallet → fund via credit card through **MoonPay** → select Manual Mode → issue commands conversationally.

Features: analytical Q&A, trade explanations before commit, a "trade diary" recording entry rationale, confidence levels, and exit plans.

No position caps, allocation limits, or quantified risk parameters are documented for Manual Mode. The Low/Medium/High risk strategy selection is an AutoTrade feature, not a Manual Mode one.

### Story Mode (`/getting-started-with-milo-story-mode`)

The narrative onboarding path (portfolio management framed as ocean navigation). Five steps:

1. Click "Get Started", connect a wallet via social login (Gmail, etc.) or create a new one
2. Fund with SOL as transaction fuel — "milo never holds funds"
3. Receive plain-language market insights aggregated from blockchain RPC nodes, Birdeye APIs, and Cookie social data
4. Enable AutoTrade — define risk tolerance, wallet allocation limits, personal trading rules
5. Monitor via a journal of positions, trades, analyses, rationale, and outcomes

Configuration controls exposed: **risk tolerance level**, **portfolio allocation percentage** milo may deploy, and **exclusion rules** (e.g. avoid microcaps or high-volatility assets).

**Wallet isolation claim:** milo operates exclusively through a dedicated wallet created during onboarding. Personal wallets stay isolated and milo "cannot access external wallets".

Note the tension with the FAQ (§7), which advertises connecting Ledger, Trezor, Phantom, MetaMask, and Trust Wallet. Treat the dedicated-wallet model as the one that governs execution, and the FAQ's wallet list as read/aggregation-oriented or aspirational until proven otherwise.

### ATF / AI Auto-Trade (`/getting-started-with-atf`)

ATF = **AI Auto-Trade**. Automated execution against a user-defined strategy.

Setup: go to `app.andmilo.com` → AI Auto-Trade → Settings → switch to Advanced mode → toggle **Auto Mode ON** → select a strategy from the marketplace or create a custom one → **Save changes** → monitor via Home, Action Log, or Chat tabs.

Configuration:

- **Risk slider** "Low ↔ High" which "auto chose preset milo ATF based on the risk"
- **Asset allocation across buckets**: Trenches, Memes, Majors, Stables, xStocks, etc.
- Optional **custom token list**
- **Trade controls**: minimum ticket size, maximum daily positions
- **Strategy prompt** written in plain language

Prerequisites and constraints: an account with a managed trading wallet; sufficient funding; wallet balance must exceed minimum ticket size; strategy allocations cannot be 0%; max-daily-positions limit applies if configured; custom token lists need tickers added. The docs flag that most reported problems are just forgetting to Save after toggling Auto Mode on.

### AutoTrader Alpha (`/milo-autotrader-alpha`)

The conceptual description of autonomous operation — "the evolution of Milo from advisor to portfolio manager".

Decision loop: continuously observe on-chain liquidity shifts, volatility, community narratives → on a detected pattern, review trends, re-evaluate liquidity, assess sentiment, calculate volatility, confirm alignment with user risk preferences, and **write an internal thesis justifying the trade** → only then execute. Execution handles "sizing, routing, timing". Trades execute from the user's own wallet.

Position management is thesis-based: hold while conditions support the original logic, exit when "the original logic is no longer valid", and document the exit rationale.

User retains: pause/override, manual position close, the right to demand justification before execution, and the ability to request alternative approaches.

**Disclaimer, verbatim:** "AutoTrader is experimental alpha. Use sizes you're comfortable with. Not financial advice."

**No stop-loss rules, position-sizing formulas, or quantified risk controls are specified on this page.** The only concrete execution controls documented anywhere are the ATF settings above and the trading-engine parameters in §8.

---

## 4. Intelligence Surfaces

### The Feed (`/the-feed`)

Personalised command center across three domains:

- **Market intelligence** — real-time price action commentary, technical analysis, volume/liquidity/pattern detection, emerging narratives and sector rotation, whale movement and institutional flow
- **Portfolio updates** — real-time P&L, entry/exit recommendations, risk alerts, yield opportunities, composition and risk metrics
- **Social signals** — successful-trader tracking and strategy replication, trending topics, sentiment, community discussion monitoring

Sources described as market feeds, social signals, on-chain activity, and wallet movements via "proprietary nodes and intelligent filtering system". Four-stage workflow: collect → analyse and denoise → personalise to the user's strategy → deliver actionable insights with next steps.

### Live Market Intelligence (`/live-market-intelligence`)

Three intelligence streams:

- **Base layer** — real-time volume, liquidity depth changes, price action patterns, smart contract interactions across DEXs
- **Social layer** — developer GitHub activity, community growth, influencer tracking, sentiment
- **Wallet behaviour** — smart money movement, historical wallet performance, network effect mapping, accumulation/distribution detection

Metrics referenced: whale accumulation positions, social mention rates, diamond-hands supply percentage, DEX liquidity changes, RSI divergence, staking rates, DeFi TVL, mempool activity. No refresh rates and no named providers on this page.

### Smart Wallet & AI Quant (`/smart-wallet-and-ai-quant`)

"Personal trading expert that lives in your wallet." Accepts commands like "ape 2 SOL into Sigma" or "stake my SOL for best yield".

- **Route optimisation** — best price discovery across DEXs, smart slippage adjustment, liquidity analysis, MEV protection
- **Risk management** — position size recommendations, market impact analysis, slippage protection, failed transaction recovery
- **Gas optimisation** — best timing for lowest fees, transaction batching, priority adjustment, cost-saving strategies
- **DeFi** — analyses staking protocols (Marinade, Lido), LP opportunities, yield strategies, presented as risk-tiered options
- **Safeguards** — transaction simulation, risk assessment, rug protection; learns trading style and adapts to risk preferences

Despite the page title, **no custody model, key management architecture, or quantitative backtesting capability is described.** The custody answer lives on the trading-engine page (Turnkey, §8).

### Portfolio Command Center (`/portfolio-command-center`)

"&milo watches every wallet, every position, every chain — providing insights you'd need a professional trading desk to catch."

- **Risk management** — exposure modelling, over-concentration detection (the worked example is 45% in SOL ecosystem), correlation risk
- **Position optimisation** — yield maximisation across stables, spot, staking, and LPs, with cost-benefit analysis for migrations
- **Cross-chain intelligence** — aggregation across Solana, Ethereum, and other L1s, with bridge security ratings and chain-specific risk analysis
- **Performance analytics** — top performers, profitable strategy patterns, optimal entry timing, position-sizing recommendations from history
- **Automated actions** — user-set rules for DCA, take-profit targets, rebalancing schedules, reward harvesting

Not documented: multi-wallet connection methods or limits, tax/regulatory reporting, a complete supported-chain list, data security or custody arrangements.

### Social DeFi (`/social-defi-the-future-of-trading-together`)

- **Copy trading** — "auto-copy with your risk settings"; followers get live updates and detailed analysis and can adjust copied trades to their own risk tolerance
- **Reputation** — 0–100 score from win rate, risk management, community value, strategy innovation; achievement badges (examples: "Consistency King", "Whale Whisperer")
- **Alpha sharing** — traders broadcast live positions with entry setups, technical analysis, timeframes, risk metrics; &milo adds comparative context ("similar setup to December's 2.5x", how many top traders entered matching positions)
- **Fee sharing** — strategy leaders earn fees from follower trading volume. Worked example: 324 active followers generating 125 SOL in fees, with 35 SOL distributed to followers.

No position limits, allocation caps, or withdrawal restrictions documented for copy trading.

---

## 5. Agent Architecture

### Core model (`/the-and-milo-agent-architecture`)

Agentic-system model where "the system is the core" — model upgrades are meant to enhance rather than obsolete the platform.

**System Agent** (central coordinator) tracks:

- **System state** — agent activity, task distribution, resource availability
- **Semi-deterministic RAG** — controlled retrieval supplying system knowledge, user context, curated prompts
- **Tool definitions** — capabilities and APIs exposed to specialised agents based on role and objective

**Per-agent structure:**

- Memory: short-term (conversation), long-term (preferences, history), system-state (positions, balances)
- Guard Curation Layer filtering malicious inputs and outputs
- Built-in tenancy module restricting actions to the active tenant; multi-tenant resource isolation
- State graphs defining objectives, guidelines, and toolsets; dynamic role assignment for delegation between agents

**Agent swarm** operating in three modes: **real-time** (immediate interactions), **streaming** (continuous data evaluation), **consistency** (sustained periodic tasks).

Named agents in the docs: **Trade Agent** and **Analyst Agent** (given as a delegation example). LLM providers referenced as "OpenAI, DeepSeek, or future providers" — no exclusive model commitment.

### Integration & communication layer (`/integration-and-communication-layer`)

The only page with framework-level code. Communication services register via `communicationsManager.registerCommunicationService()` to be discoverable by the agent framework.

```typescript
export interface ICommunicationLayer {
  sendMessageToUser(
    tenantIdentity: TenantIdentity,
    conversation: IConversation,
    data: Pick<IConversationMessage, 'messages' | 'metadata' | 'userId' | 'channel' | 'conversationId'>
  ): Promise<boolean>;
}
```

Tools and skills extend an abstract base:

```typescript
export abstract class FunctionDetail {
  name: string;
  description: string;
  parameters: JSONSchema;
  type: 'tool' | 'skill';
  tenantIdentity: TenantIdentity;
  reasonModel: GenericLLM;
  executionModel: GenericLLM;
  abstract call(parameters: unknown, context?: any): Promise<toolResult>;
}
```

Built-in tools named: **FetchTransaction** (transaction data via RPC), **ScanProgram** (program integrity/compliance analysis), **Swap** (token exchange via liquidity pool providers), **Transfer** (fund/token movement between wallets).

Governance: tenancy management for isolation, plus recipient role enforcement (member vs. external) governing action authorization.

### Memory & system state (`/memory-and-system-state`)

Three layers:

1. **Short-term** — session-based, token-aware context-window management, ephemeral
2. **Long-term** — cross-session preference continuity, personalised execution parameters, "retrieval-augmented learning" with structured indexing
3. **System state** — live positions, balances, transactions; "stateful execution" for multi-agent coordination; pre-execution verification of wallet balances, open positions, and agent sync

Uses "Deterministic RAG" rather than generic retrieval: role-based retrieval aligned to agent execution state, structured queries to prevent hallucination, execution-critical data prioritised. No vector DB, storage engine, or retention policy is named.

### Multichain (`/multichain-support`)

- **Live:** Solana (primary launch chain)
- **Planned:** Ethereum, Base, Bitcoin, BNB Chain — "progressive chain integration"

Each chain gets its own **custodial wallet**, "automatically generated and assigned per chain", optimised for gas and execution speed. Note this page says *custodial*, while the trading-engine and Story Mode pages say non-custodial / "Milo never takes custody". See §9.

Bridging is treated as foundational: automated cross-chain transfers, smart routing through low-cost high-speed bridge providers, MEV protection, slippage mitigation.

Chain abstraction via **tool modularity** — execution logic has per-chain mods: Solana uses Jupiter/Raydium, Ethereum uses Uniswap/1inch with gas optimisation. Agents keep "stateful chain awareness" of active chain, custody balances, network conditions, MEV and reorg risk.

### Data mining (`/data-mining-real-time-intelligence-at-scale`)

On-demand data streams rather than a continuous pipeline. Stream types: smart contracts, transaction types, wallet clusters. "Distributed node architecture that enables parallelized data mining at scale", with streams dynamically opened and closed by need.

Explicitly avoids traditional indexers — "Instead of relying on... traditional indexers to update" — claiming parallel transaction processing without indexer delay. Real-time detection of wash trading, account farming, liquidity manipulation. Tracks DEX pools, lending protocols, NFT mints, whale activity.

No named sources, no throughput or volume numbers.

### Roadmap (`/technical-consideration-and-roadmap`)

| Date | Release | Content |
|---|---|---|
| March 2025 | Alpha | Autonomous trading execution, live market data, token analysis via stateful agents, deterministic RAG. Solana only. |
| June 2025 | Beta | Agent self-monitoring (historical performance tracking, flagging inefficiencies); risk detection for artificial volume and abnormal wallet patterns; agents scoring and evolving strategies autonomously. |
| August 2025 | Full | Multi-chain beyond Solana (Ethereum, Base); cross-chain transfers as core; "fully operational feedback loops, enabling AI-driven monitoring, optimization, and adaptive decision-making". |
| Post-2025 | Vision | Multi-agent DeFi strategies, AI governance models, self-regulating decentralized execution, on-chain identity for permissioned agent operations. |

All roadmap dates are in the past as of this digest (2026-08-02). The docs have not been updated to reflect delivery status, so treat these as historical intent rather than a current shipping plan.

---

## 6. Referral Program (`/referral-program`)

Three-tier structure based on trading circles ("packs"), paid out of Milo's fee:

- **Pack Level 1** — "Earn 30% of Milo's fee on every trade from pack members you directly invite"
- **Pack Level 2** — "Pocket 3% of Milo's fee from your 2nd degree pack circle"
- **Pack Level 3** — "Grab 2% of Milo's fee from traders in your 3rd pack circle"

Referral link is at the top left of the home feed. Payout token, minimum eligibility, earning caps, and withdrawal mechanics are not documented.

---

## 7. Official Links & FAQ

**Official links** (`/official-links`)

| Label | URL |
|---|---|
| App | `https://app.andmilo.com` |
| Website | `https://andmilo.com/` |
| X | `https://x.com/MiloOnChains` |
| Discord | `https://discord.gg/yXmgwu7a8S` |
| Telegram | `http://t.me/miloonchains` |

No token contract address is published on this page. Anything claiming to be a &milo token contract should be treated as unverified.

**FAQ answers**

- *Cross-chain asset management* — "a cutting-edge cross-chain crypto asset management platform designed to streamline the management of digital assets across multiple blockchain networks": AI agents for asset allocation, strategy automation, portfolio diversification, interoperability.
- *How AI agents help* — "advanced machine learning algorithms and predictive analytics to monitor market trends, assess risk factors, and execute trades in real-time across multiple blockchain platforms"; automated rebalancing, continuous risk mitigation, "high-frequency trades to exploit market inefficiencies", cross-chain transfers.
- *Which networks* — **Solana (SOL), Ethereum (ETH), Base (ETH L2)**, with "more chain integrations… in development". This contradicts `/multichain-support`, which lists only Solana as live. See §9.
- *Wallet/exchange integration* — hardware wallets "such as Ledger and Trezor"; software wallets "including Phantom, MetaMask, Trust Wallet, and others"; DeFi protocol integration for yield farming, staking, LP. Method: "API-based integrations and wallet connect protocols", surfaced in a single dashboard.

The FAQ index lists three further questions that were not in the page set read here and are not covered by this digest: security of assets, analytics and reporting features, and cross-chain interoperability mechanics.

---

## 8. Technical Reference (the pages that actually specify behaviour)

### Partner API (`/3rd-party-api`)

**Base URL** `https://partners.andmilo.com/api/v1`
**Auth** `X-API-Key` header on all endpoints except signup.

```bash
curl -H "X-API-Key: mk_live_..." https://partners.andmilo.com/api/v1/users/{userId}/positions
```

Endpoints by group:

- **User** — `GET /me`; `POST /users/siwx/message` (SIWX signing message, no auth); `POST /users` (register with signed SIWX message, no auth)
- **Auto-trading** — `GET|PATCH /users/{userId}/auto-trade-settings`; `POST|GET /users/{userId}/auto-trade-settings/strategies`; `POST /users/{userId}/auto-trade-settings/strategies/{strategyId}/sync`
- **Arena (public leaderboard)** — `POST /users/{userId}/arena/deploy`; `POST /users/{userId}/arena/withdraw`; `GET /users/{userId}/arena/leaderboard`
- **Trading** — `POST /wallets/{walletId}/orders` (buy/sell with TP/SL); `GET /users/{userId}/orders`; `POST /users/{userId}/orders/{orderId}/pause|activate|delete`; `GET /users/{userId}/positions`; `POST /users/{userId}/positions/{thesisId}/close`; `POST /users/{userId}/positions/close-all`
- **Wallet** — `POST /wallets/{walletId}/actions/send`; `GET /wallets/{walletId}/holdings`; `GET /wallets/{walletId}/transactions` (cursor-paginated); `GET /wallets/{walletId}/executed-transactions`
- **Conversations** — `POST /users/{userId}/conversations`; `POST|GET /users/{userId}/conversations/{conversationId}/messages`
- **Quests & points** — `GET /users/{userId}/quests`; `POST /users/{userId}/quests/{questId}/claim`; `GET /users/{userId}/quests/bones`

Format: `Content-Type: application/json`, responses shaped `{ "data": {...}, "meta": {...} }`, errors carrying `error.code` and `error.message`.

Pagination: page-based `page` (default 1) and `pageSize` (default 25, max 100); cursor-based `limit` (max 200) plus `cursor` for transactions.

Rate limits per 60s window:

| Group | Limit |
|---|---|
| Signup (per IP) | 5 |
| Conversation writes | 2 free, then paid overage |
| Portfolio reads | 60 |
| Orders create | 5 |
| Position close-all | 1 |

Rejections return `429` with `Retry-After`.

Error codes: `400 bad_request`, `401 unauthorized`, `402 payment_required`, `404 not_found`, `409 error` (conflict, e.g. wallet already registered), `429 rate_limit_exceeded`.

An MCP interface is also exposed at `POST|GET|DELETE /mcp` using an `Mcp-Session-Id` header and `text/event-stream` responses.

### x402 pay-per-request (`/x402`)

Stablecoin micropayments over HTTP headers — "pay per request — upgrade the brain behind any API call".

Flow: normal request → `402 Payment Required` with exact requirements → submit a transfer on Solana → retry with an `X-PAYMENT` header → Milo verifies on-chain and processes.

Currently live only for **conversation write overage** beyond the 2-per-60s free tier. Accepted: **0.25 USDC** or **0.01 SOL**.

402 response headers:

```
X-Payment-Required: true
X-Payment-Header: X-PAYMENT
X-Payment-Recipient: <TREASURY_WALLET>
X-Payment-Options: USDC:0.25,SOL:0.01
X-Payment-Id-Field: paymentId
X-Payment-Tx-Field: txSignature
```

`X-PAYMENT` header payload:

```json
{
  "recipient": "<TREASURY_WALLET>",
  "asset": "USDC|SOL",
  "amount": 0.25,
  "paymentId": "unique-one-time-id",
  "txSignature": "<confirmed-solana-tx>"
}
```

Success adds `PAYMENT-RESPONSE: <base64-json-settlement>`, `X-PAYMENT-RESPONSE: <same-value>`, and `X-Billing-Mode: payg`.

Rules: never share private keys; unique `paymentId` per request (replay rejected); read the recipient from the server response rather than hardcoding; wait for transaction confirmation before retrying; proofs are one-use.

Planned tiers: **Standard** free with API key, **Pro** ~$0.01 USDC/request, **Ultra** ~$0.05 USDC/request — targeting conversations (market-analyst / auto-trader), send-message, and position analysis. TypeScript, Python, and raw-HTTP SDKs are planned but not yet available.

### Trading engine (`/trading-engine`)

Swaps execute on Solana through **Jupiter**, routing across **Raydium, Orca, Meteora, Phoenix**. "Your tokens stay in your wallet until the moment a swap settles on-chain."

Flow: order created via Partner API → engine monitors trigger conditions → Jupiter quote for best route → **Turnkey** signs → Solana settlement → order marked `fulfilled`.

Order types:

| Type | Trigger | Example |
|---|---|---|
| Market | always execute (`gte: 0`) | buy $100 immediately |
| Limit buy | price drops to threshold | buy at `lte: $0.50` |
| Limit sell | price rises to threshold | sell at `gte: $2.00` |
| Stop-loss | relative price drop | sell 100% if price drops 15% |
| Take-profit | relative price rise | sell 50% if price rises 30% |
| TP/SL ladders | multi-level exits | tiered profit/loss levels |

Coming soon: trailing stop, DCA, TWAP.

Amount types: `absolute` (raw token amount), `absolute_usd` (USD equivalent), `relative` (percentage of position, sell only).

Execution parameters:

| Parameter | Default | Range | Purpose |
|---|---|---|---|
| `slippagePercentage` | 3% | 0–100 | max acceptable price movement |
| `priorityFee` | auto | — | SOL lamports for block inclusion speed |
| `platformFeeBps` | 90–100 bps | — | Milo's fee in basis points |

**Milo's take is 0.90%–1.00% per trade.** That is the number the referral percentages in §6 are a cut of.

Triggers: absolute (`gte`/`lte` on a USD price) or relative (`rise`/`drop` percentage from a reference).

Order states: `draft` → `active` → `fulfilling` → `fulfilled` | `paused` | `error` | `expired` | `archived`.

Failure modes: `no_route_found`, `not_enough_token_balance`, `not_enough_sol`, `slippage_too_low`, `swap_not_supported`, `network_error`. Automatic retry with exponential backoff, max 5 attempts.

Guarantee, verbatim: "Milo never takes custody of your funds." Non-custodial via Turnkey, on-chain settlement, no internal order book, no counterparty risk.

### MCP (`/mcp`)

- **URL** `https://partners.andmilo.com/mcp`
- **Transport** HTTP
- `POST /mcp` initialize can start without `X-API-Key` (for signup); authenticated tool calls need the API key issued afterwards
- Supports the x402-style payment flow for conversation write overage

Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`) and `.mcp.json`:

```json
{
  "mcpServers": {
    "milo": {
      "type": "http",
      "url": "https://partners.andmilo.com/mcp"
    }
  }
}
```

Codex CLI: `codex mcp add milo --url https://partners.andmilo.com/mcp`

Tools named on the page: `get_me`, `list_conversations`, `get_holdings` — all requiring authentication. The page is not an exhaustive tool list and gives no parameter schemas. The raw markdown (`/mcp.md`) adds nothing further. To enumerate the real tool set, initialize a session against the endpoint and read the `tools/list` response.

---

## 9. Contradictions and Gaps Worth Tracking

These are places where the docs disagree with themselves or omit something load-bearing. Resolve against live behaviour before relying on either side.

1. **Custody.** `/trading-engine` says "Milo never takes custody of your funds" (Turnkey signing) and Story Mode says "milo never holds funds". `/multichain-support` says each chain gets "its own custodial wallet… automatically generated and assigned per chain". The reconciliation is probably that Turnkey holds key shares for a per-chain managed wallet — which is non-custodial in the Turnkey sense but is not a user-held key. Do not read "non-custodial" as "you hold the keys".
2. **Live chains.** FAQ says Solana, Ethereum, and Base are supported today. `/multichain-support` lists only Solana as live with Ethereum and Base planned. The trading engine page describes Solana execution exclusively.
3. **Wallet connection.** The FAQ advertises Ledger, Trezor, Phantom, MetaMask, Trust Wallet. Story Mode says milo "cannot access external wallets" and trades only from a dedicated onboarding-created wallet. Most likely: external wallets can be read/aggregated, but execution runs through the managed wallet.
4. **Roadmap staleness.** Every roadmap milestone predates this digest by roughly a year, with no delivery status recorded.
5. **Risk controls.** AutoTrader Alpha describes thesis-based exits in prose but specifies no stop-loss policy, sizing formula, or daily-loss cap. The only concrete controls are ATF's min ticket size / max daily positions / allocation buckets and the engine's `slippagePercentage`, TP/SL triggers, and 5-attempt retry.
6. **Fees.** The 90–100 bps platform fee is documented only on the trading-engine page. Referral, Social DeFi fee sharing, and Arena all reference "Milo's fee" without restating the rate.
7. **Undocumented FAQ pages.** Security of assets, analytics/reporting, and cross-chain interoperability were listed in the FAQ index but not read.
8. **No token.** No &milo token contract address appears anywhere in the docs.

---

## 10. Relevance to Spectre

Context for whoever reads this next — see [milo-readonly-scout-runbook.md](milo-readonly-scout-runbook.md) for the bridge this repo actually implements.

Spectre's current posture is that Spectre researches and Milo executes, with the handoff being A/B exact mint addresses pasted into Milo My Picks by a human. Nothing in these docs changes that division. What they do add:

- **There is a programmatic path** — the Partner API exposes `POST /wallets/{walletId}/orders`, position close, and auto-trade strategy CRUD. If the handoff were ever automated, that is where it would land, and it would mean Spectre originating orders. That is a materially different risk posture from today's read-only scout and should be an explicit decision, not a drift.
- **A read-only subset exists** that does not originate orders: `GET /me`, `GET /wallets/{walletId}/holdings`, `GET /wallets/{walletId}/transactions`, `GET /users/{userId}/positions`, `GET /users/{userId}/orders`. This is a candidate replacement for whatever the current wallet observer scrapes, subject to having an API key.
- **Milo's own execution controls** are thinner than the runbook assumes. The runbook credits Milo with "position cap, daily loss stop, no-averaging rule, and exit policy" as the final controls. The docs support a max-daily-positions setting and min ticket size under ATF, plus TP/SL orders — but there is no documented daily loss stop and no documented no-averaging rule. Either those come from user configuration not covered in the docs, or the runbook overstates them.
- **Cost of execution is 90–100 bps** to Milo on top of slippage (3% default) and priority fees. Any expected-value framing on Spectre's side should carry that.
- **Rate limits are tight** on anything conversational: 2 writes per 60s before per-message payment. Portfolio reads at 60/60s are comfortable for polling; order creation at 5/60s is not a high-frequency surface.
