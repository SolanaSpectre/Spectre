# Spectre

Paper-only Solana memecoin research and diagnostics bot. No live trade path is enabled by default; LIVE mode requires `--confirmLive true` and `LIVE_EXIT_ENGINE_ENABLED=true`.

## Features

- **Paper-run lifecycle**: Runs a bounded PAPER session, then produces reports for post-run review.
- **AI-assisted diagnostics**: Uses an Ollama runtime model for guarded review while keeping timeout fallback paper-gated.
- **Pre-migration research**: Watches Pump.fun-style first-curve behavior and records false-negative evidence.
- **Outcome reporting**: Builds outcome-ledger, NO_PRIOR recovery, wallet, continuation, and learning reports.
- **Safety posture**: Keeps live execution behind explicit mode and confirmation gates.

## Agent Layout

This repo now contains two distinct agent tracks:

- the core Spectre trading bot in `src/`
- the separate `weRvENum` social/narrative agent project in `agents/weRvENum/`

This separation is intentional:

- Spectre stays focused on private trade auditing and execution logic
- `weRvENum` can evolve as a public-facing room-reading and narrative agent
- the two can share intelligence later without collapsing into one mushy agent

## Prerequisites

- Node.js >= 16.0.0
- npm or yarn
- Solana wallet with SOL
- Ollama running locally with `llama3.2:3b` available

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd Spectre
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Run the paper lifecycle:
```bash
npm start -- PAPER 30
```

The default start command now runs the full paper-run lifecycle: it refreshes Telegram/Rick context, launches the trading bot in the foreground, then generates the post-run report bundle after the session exits. Pass the usual bot arguments after `--`, for example:

```bash
npm start -- PAPER 30
```

Use `npm run start:core -- PAPER 30` only when you intentionally want the raw bot without automatic context refresh, post-run reports, or lifecycle-injected Simple Runtime AI.

## Configuration

Edit the `.env` file with your settings:

### Required Variables
- `HOT_WALLET_PRIVATE_KEY`: Solana hot wallet private key (Base58 encoded). For PAPER-only research, use a non-funded burner key if this validation is still enabled.
- `COLD_WALLET_ADDRESS`: Your Solana cold wallet address

### AI Configuration
- `AI_MODEL`: Set to `ollama`
- `OLLAMA_HOST`: Ollama server URL (current AWS tunnel default: `http://127.0.0.1:11435`)
- `OLLAMA_MODEL`: Ollama model name (default: `llama3.2:3b`)

### Trading Configuration
- `TRADING_AMOUNT_SOL`: Amount of SOL to trade per transaction (default: 0.1)
- `SLIPPAGE_TOLERANCE`: Maximum slippage tolerance in basis points (default: 0.5)
- `MAX_PRICE_IMPACT`: Maximum price impact allowed (default: 0.03)
- `BASE_TOKEN_MINT`: Base asset mint used for swaps and valuation (default: wrapped SOL)
- `JUPITER_API_BASE_URL`: Jupiter API base URL (default: `https://lite-api.jup.ag`)
- `JUPITER_API_KEY`: Optional Jupiter API key

### Market Data Providers
- `DISABLE_ENV_PROXY`: Disables inherited proxy env vars for outbound API clients (default: `true`)
- `RAYDIUM_API_BASE_URL`: Raydium API base URL (default: `https://api-v3.raydium.io`)
- `METEORA_ENABLED`: Enables Meteora DLMM pool snapshots (default: `true`)
- `METEORA_API_BASE_URL`: Meteora DLMM API base URL (default: `https://dlmm.datapi.meteora.ag`)
- `BIRDEYE_ENABLED`: Enables Birdeye price/liquidity enrichment when an API key is present
- `BIRDEYE_API_KEY`: Birdeye API key sent as `X-API-KEY`
- `PUMPPORTAL_ENABLED`: Enables PumpPortal websocket ingestion (default: `true`)
- `PUMP_PORTAL_API_KEY`: Optional PumpPortal API key
- `PUMPPORTAL_USE_API_KEY_QUERY`: Adds the PumpPortal API key as an `api-key` websocket query parameter (default: `true`)
- `PUMPPORTAL_WEBSOCKET_URL`: PumpPortal websocket URL (default: `wss://pumpportal.fun/api/data`)
- `PUMPPORTAL_TRACKED_ACCOUNTS`: Comma-separated wallets for PumpPortal `subscribeAccountTrade`
- `PRE_MIGRATION_WATCH_ENABLED`: Enables passive pre-migration scoring/logging without trade execution (default: `true`)
- `PRE_MIGRATION_WATCH_MIN_SCORE`: Minimum passive watch score to flag a token (default: `60`)
- `PRE_MIGRATION_WATCH_MIN_CURVE_PROGRESS`: Curve-progress threshold for near-migration flags when available (default: `0.85`)
- `PRE_MIGRATION_WATCH_FLAG_COOLDOWN_MS`: Minimum time between repeated watch flags for the same mint (default: `60000`)
- `PRE_MIGRATION_PAPER_LATE_FAST_TRACK_ENABLED`: Allows high-score, high-volume, near-complete curves to bypass stale/missing curve-delta guards in paper only (default: `true`)
- `PRE_MIGRATION_PAPER_LATE_FAST_TRACK_MIN_SCORE`: Minimum watch score for the late near-completion paper fast-track (default: `87`)
- `PRE_MIGRATION_PAPER_LATE_FAST_TRACK_MIN_CURVE_PROGRESS`: Minimum curve progress for late fast-track consideration (default: `0.92`)
- `PRE_MIGRATION_PAPER_LATE_FAST_TRACK_MIN_RECENT_VOLUME_SOL`: Recent-volume floor for late fast-track consideration (default: `75`)
- `PRE_MIGRATION_PAPER_LATE_FAST_TRACK_MIN_TRADE_VELOCITY_PER_MIN`: Trade-velocity floor for late fast-track consideration (default: `50`)
- `PRE_MIGRATION_PAPER_MAX_CURVE_PROGRESS`: Maximum curve progress for the default `strictMigration` paper preset (default: `0.92`) to avoid buying too close to the bonding-curve cliff.
- `PRE_MIGRATION_PAPER_FIRST_SIGHT_OVERRIDE_ENABLED`: Allows a high-conviction first sighting to bypass missing curve-history guards in paper only (default: `true`)
- `PRE_MIGRATION_PAPER_FIRST_SIGHT_MIN_SCORE`: Minimum watch score for first-sighting override consideration (default: `84`)
- `PRE_MIGRATION_PAPER_FIRST_SIGHT_MIN_CURVE_PROGRESS`: Minimum curve progress for first-sighting override consideration (default: `0.78`)
- `PRE_MIGRATION_PAPER_FIRST_SIGHT_MAX_CURVE_PROGRESS`: Maximum curve progress for first-sighting override consideration (default: `0.95`)
- `PRE_MIGRATION_PAPER_FIRST_SIGHT_MIN_RECENT_VOLUME_SOL`: Recent-volume floor for first-sighting override consideration (default: `12`)
- `PRE_MIGRATION_PAPER_FIRST_SIGHT_MIN_TRADE_VELOCITY_PER_MIN`: Trade-velocity floor for first-sighting override consideration (default: `12`)
- `PRE_MIGRATION_PAPER_FIRST_SIGHT_MIN_BUY_RATIO`: Minimum buy ratio for high-conviction first-sighting override consideration (default: `0.75`)
- `PRE_MIGRATION_PAPER_EARLY_SURGE_OVERRIDE_ENABLED`: Allows ASTERDOGE-style early/mid-curve first sightings to use stricter flow requirements with a lower score floor in paper only (default: `true`)
- `PRE_MIGRATION_PAPER_EARLY_SURGE_MIN_SCORE`: Minimum watch score for early-surge first-sighting override consideration (default: `84`)
- `PRE_MIGRATION_PAPER_EARLY_SURGE_MIN_CURVE_PROGRESS`: Minimum curve progress for early-surge first-sighting override consideration (default: `0.7`)
- `PRE_MIGRATION_PAPER_EARLY_SURGE_MAX_CURVE_PROGRESS`: Maximum curve progress for early-surge first-sighting override consideration (default: `0.82`)
- `PRE_MIGRATION_PAPER_EARLY_SURGE_MIN_RECENT_VOLUME_SOL`: Recent-volume floor for early-surge first-sighting override consideration (default: `75`)
- `PRE_MIGRATION_PAPER_EARLY_SURGE_MIN_TRADE_VELOCITY_PER_MIN`: Trade-velocity floor for early-surge first-sighting override consideration (default: `60`)
- `PRE_MIGRATION_PAPER_EARLY_SURGE_MIN_BUY_RATIO`: Minimum buy ratio for early-surge first-sighting override consideration when buy/sell data is available (default: `0.78`)
- `PRE_MIGRATION_PAPER_EARLY_SURGE_MIN_CURVE_PROGRESS_DELTA`: Minimum lookback curve-progress delta required when early-surge history exists, keeping `EARLY_SURGE_FIRST_SIGHT` tied to real acceleration (default: `0.035`)
- `PRE_MIGRATION_PAPER_EARLY_SURGE_NO_BASELINE_MIN_SCORE`: Higher score floor required when an early-surge candidate has no prior curve baseline yet (default: `84`)
- Pre-migration dossiers now export `uniqueBuyerCount`, `uniqueBuyerRatio`, and `sniperWalletCount` on watch-lane summaries and paper decisions so buyer-breadth guards can be validated before becoming hard rejects.
- `PRE_MIGRATION_PAPER_CURVE_PAUSE_OVERRIDE_ENABLED`: Allows high-conviction flat/paused curves to bypass the curve-delta guard in paper only (default: `true`)
- `PRE_MIGRATION_PAPER_CURVE_PAUSE_MIN_SCORE`: Minimum watch score for curve-pause override consideration (default: `82`)
- `PRE_MIGRATION_PAPER_CURVE_PAUSE_MIN_CURVE_PROGRESS`: Minimum curve progress for curve-pause override consideration (default: `0.75`)
- `PRE_MIGRATION_PAPER_CURVE_PAUSE_MIN_RECENT_VOLUME_SOL`: Recent-volume floor for curve-pause override consideration (default: `12`)
- `PRE_MIGRATION_PAPER_CURVE_PAUSE_MIN_TRADE_VELOCITY_PER_MIN`: Trade-velocity floor for curve-pause override consideration (default: `12`)
- `PRE_MIGRATION_PAPER_CURVE_PAUSE_MIN_BUY_RATIO`: Minimum buy ratio for curve-pause override consideration when buy/sell data is available (default: `0.4`)
- `PRE_MIGRATION_PAPER_ENABLED_PRESETS`: Comma-separated paper presets to simulate (default: `strictMigration,highConfidenceRunner,earlyAccelerationRunner,highConvictionFirstSight`)
- `PRE_MIGRATION_PAPER_HIGH_CONVICTION_FIRST_SIGHT_MIN_SCORE`: Minimum watch score for the high-conviction first-sighting paper preset (default: first-sighting override score)
- `PRE_MIGRATION_PAPER_HIGH_CONVICTION_FIRST_SIGHT_MIN_CURVE_PROGRESS`: Minimum curve progress for the high-conviction first-sighting paper preset (default: first-sighting override curve progress)
- `PRE_MIGRATION_PAPER_HIGH_CONVICTION_FIRST_SIGHT_MIN_RECENT_VOLUME_SOL`: Recent-volume floor for the high-conviction first-sighting paper preset (default: first-sighting override recent volume)
- `PRE_MIGRATION_PAPER_HIGH_CONVICTION_FIRST_SIGHT_MIN_TRADE_VELOCITY_PER_MIN`: Trade-velocity floor for the high-conviction first-sighting paper preset (default: first-sighting override trade velocity)
- `PRE_MIGRATION_PAPER_HIGH_CONVICTION_FIRST_SIGHT_MIN_BUY_RATIO`: Buy-ratio floor for the high-conviction first-sighting paper preset (default: first-sighting override buy ratio)
- `PRE_MIGRATION_PAPER_HIGH_CONVICTION_FIRST_SIGHT_TAKE_PROFIT_PCT`: Take-profit target for first-sighting paper entries (default: `0.50`)
- `PRE_MIGRATION_PAPER_HIGH_CONVICTION_FIRST_SIGHT_STOP_LOSS_PCT`: Stop-loss for first-sighting paper entries (default: `0.15`)
- `PRE_MIGRATION_PAPER_HIGH_CONVICTION_FIRST_SIGHT_MAX_HOLD_SECONDS`: Max hold time for first-sighting paper entries (default: `240`)
- `highConvictionFirstSight` is override-only: it only enters when a pre-migration guard explicitly promotes the candidate (`EARLY_SURGE_FIRST_SIGHT`, `HIGH_CONVICTION_FIRST_SIGHT`, or `HIGH_CONVICTION_CURVE_PAUSE`).
- `PRE_MIGRATION_PAPER_EARLY_ACCELERATION_RUNNER_MIN_SCORE`: Minimum watch score for the early-acceleration paper preset (default: `84.5`)
- `PRE_MIGRATION_PAPER_EARLY_ACCELERATION_RUNNER_MIN_CURVE_PROGRESS`: Minimum curve progress for early-acceleration candidates (default: `0.88`)
- `PRE_MIGRATION_PAPER_EARLY_ACCELERATION_RUNNER_MIN_RECENT_VOLUME_SOL`: Recent-volume floor for early-acceleration candidates (default: `60`)
- `PRE_MIGRATION_PAPER_EARLY_ACCELERATION_RUNNER_MIN_TRADE_VELOCITY_PER_MIN`: Trade-velocity floor for early-acceleration candidates (default: `40`)
- `PRE_MIGRATION_PAPER_EARLY_ACCELERATION_RUNNER_TAKE_PROFIT_PCT`: Take-profit target for early-acceleration paper entries (default: `0.35`)
- `PRE_MIGRATION_PAPER_EARLY_ACCELERATION_RUNNER_STOP_LOSS_PCT`: Stop-loss for early-acceleration paper entries (default: `0.15`)
- `PRE_MIGRATION_PAPER_EARLY_ACCELERATION_RUNNER_MAX_HOLD_SECONDS`: Max hold time for early-acceleration paper entries (default: `240`)
- `PRE_MIGRATION_PAPER_BAD_EXIT_COOLDOWN_MS`: Mint-level cooldown after a pre-migration paper stop-loss or losing close, shared across presets (default: `900000`)
- `POST_MIGRATION_CONTINUATION_ENABLED`: Enables passive continuation scoring for already-graduated coins (default: `true`)
- `POST_MIGRATION_CONTINUATION_MIN_SCORE`: Minimum score for a `continuation_watch` dossier (default: `65`)
- `POST_MIGRATION_CONTINUATION_CONFIRM_MIN_SCORE`: Minimum score for a `continuation_confirmed` dossier (default: `75`)
- `POST_MIGRATION_CONTINUATION_MIN_LIQUIDITY_USD`: Liquidity-depth floor for continuation candidates (default: `25000`)
- `POST_MIGRATION_CONTINUATION_MIN_VOLUME_TO_LIQUIDITY`: 24h volume/liquidity floor (default: `2`)
- `POST_MIGRATION_CONTINUATION_MAX_DEXSCREENER_FETCHES_PER_CYCLE`: DexScreener token snapshots per cycle for the continuation observer (default: `6`)
- `CANDIDATE_DOSSIER_ENABLED`: Writes JSONL candidate dossiers for watch, paper, and continuation lanes (default: `true`)
- `MOONSHOT_ENABLED`: Enables experimental Moonshot feed integration (default: `false`)
- `MOONSHOT_API_BASE_URL`: Moonshot API base URL
- `GMGN_ENABLED`: Enables future GMGN Agent API integrations (default: `false`)
- `GMGN_API_KEY`: Optional GMGN API key
- `GMGN_PUBLIC_KEY`: Optional GMGN public key generated through their auth flow
- `GMGN_WALLET_TRACKING_ENABLED`: Enables future GMGN-style wallet-tracking enrichment (default: `false`)

### Pump Live-Readiness Notes

Spectre's current Pump work is paper-only telemetry and diagnostics. The April 28, 2026 Pump fee-recipient upgrade is captured in `knowledge/pump-live-readiness.md` and `src/lib/pump-live-readiness.js` so future direct Pump/PumpSwap executor work has an explicit compatibility checklist.

Run this non-trading check before any future direct Pump/PumpSwap executor work:

```bash
npm run check:pump-live-readiness
```

### Risk Management
- `MAX_POSITION_SIZE_SOL`: Maximum position size in SOL (default: 1.0)
- `STOP_LOSS_PERCENT`: Stop loss percentage (default: 0.10 = 10%)
- `TAKE_PROFIT_PERCENT`: Take profit percentage (default: 0.20 = 20%)
- `MAX_DAILY_LOSS_SOL`: Maximum daily loss limit in SOL (default: 0.5)
- `PAPER_STOP_LOSS_PERCENT`: Paper/scalp stop-loss threshold (default: 0.015 = 1.5%)
- `PAPER_TAKE_PROFIT_PERCENT`: Paper/scalp take-profit threshold (default: 0.035 = 3.5%)
- `PAPER_MAX_HOLD_MINUTES`: Maximum paper/scalp hold time before time exit (default: 20)
- `MAX_OPEN_PAPER_POSITIONS`: Maximum simultaneous paper positions (default: 5)

### Dynamic Compounding
- `HOT_WALLET_STARTING_BALANCE_SOL`: Starting hot wallet operating balance
- `COLD_WALLET_STARTING_BALANCE_SOL`: Starting cold wallet treasury balance
- `AUTO_REBALANCE_ENABLED`: Enables automatic profit sweeps from hot to cold wallet
- `MIN_COLD_SWEEP_SOL`: Minimum SOL amount required before a cold-wallet sweep is sent
- `PROFIT_ALLOCATION_TIERS`: JSON array of equity tiers controlling hot/cold profit split
- `RISK_SIZE_TIERS`: JSON array of hot-wallet tiers controlling per-trade risk sizing

### Market Analysis
- `REFRESH_INTERVAL_MS`: Market data refresh interval in milliseconds (default: 5000)
- `VOLUME_THRESHOLD_SOL`: Minimum volume threshold for token analysis (default: 100)
- `LIQUIDITY_THRESHOLD_SOL`: Minimum liquidity threshold for token analysis (default: 50)

## Usage

### Morning Workflow

When resuming runner-hunter research after overnight context collection, use this order:

```bash
npm run fetch:kolscan
npm run analyze:kolscan -- --limit 25 --txLimit 100
npm run import:venum-wallets
npm run analyze:venum-wallets -- --limit 25 --txLimit 100
npm run enqueue:venum-token-research -- --limit 8
npm run report:macro-posture
npm run report:early-organic-interest
npm run report:wallet-first-touch
npm run compare:kolscan
npm run build:wallet-intel
npm run sync:telegram
npm run report:convergence
npm run build:false-negatives
node src/index.js --mode PAPER --session 20 --maxQuoteAge 3000
npm run report:run
```

What this does:

- refreshes leaderboard wallet discovery
- refreshes Helius wallet summaries
- imports Venum's public social-wallet SOL breadcrumbs as a watch-only list
- refreshes Helius wallet summaries for that Venum watch-only list
- queues interesting Spectre token candidates for later Venum X/social research without spending X reads
- builds a report-only macro posture snapshot for the next session
- builds an early-organic-interest shadow lane from first-curve near misses
- builds watched-wallet first-touch token clusters from wallet trade telemetry
- refreshes wallet-vs-paper overlap analysis
- rebuilds wallet intel for the AI layer
- syncs approved Telegram chats/channels only
- rebuilds the convergence report
- rebuilds the false-negative watchlist
- runs the next foreground paper session with the current runner settings
- prints a post-run battlefield report from the latest telemetry and dossier logs

Primary morning artifacts to inspect:

- [wallet-intel latest](data/wallet-intel/latest.json)
- [convergence latest](data/convergence/latest.json)
- [false-negative watchlist](data/watchlists/false-negative-watchlist-latest.json)
- [battlefield report latest](data/reports/run-battlefield-latest.json)
- [macro posture latest](data/reports/macro-posture-latest.json)
- [early organic interest latest](data/reports/early-organic-interest-latest.json)
- [early organic interest watchlist](data/watchlists/early-organic-interest-watchlist-latest.json)
- [wallet first-touch latest](data/reports/wallet-first-touch-latest.json)
- [wallet first-touch watchlist](data/watchlists/wallet-first-touch-watchlist-latest.json)
- [Venum token social queue](agents/weRvENum/runtime/token_social_research_queue.json)
- latest file in [run-logs](run-logs)

### Automated Run Lifecycle

`npm start -- PAPER 30` now does the normal run ritual automatically:

- syncs Telegram context before the run
- builds a report-only macro posture snapshot before and after the run
- rebuilds Rick context before and after fresh Rick commands
- sends the default Rick commands: `/vol`, `/runners`, `/dt`, `/pft`, `/burp`
- runs the bot in the foreground so terminal activity stays visible
- generates the post-run battlefield, watch validation, pre-migration, preset replay, signal-quality, and broad-organic-surge reports

Useful overrides:

```bash
npm start -- --skipContext PAPER 30
npm start -- --skipReports PAPER 30
npm start -- --forceRick PAPER 30
npm start -- --rickCommands vol,runners,pft PAPER 30
```

### Post-Run Battlefield Report

After any paper run, summarize the newest telemetry and candidate dossier pair:

```bash
npm run report:run
```

The full automatic report bundle can be regenerated manually with:

```bash
npm run report:post-run
```

The report covers runner-lane signals/rejections, AI timeout fallback decisions, pre-migration paper entries/exits, top watch-lane candidates, and post-migration continuation verdicts. To inspect a specific run:

```bash
npm run report:run -- --telemetry run-logs/telemetry-YYYY-MM-DDTHH-MM-SS-msZ.jsonl --dossier run-logs/candidate-dossiers-YYYY-MM-DDTHH-MM-SS-msZ.jsonl
```

For a single-token specimen replay:

```bash
npm run report:mint -- --mint <MINT>
```

The mint report reconstructs first/last sightings, curve and score movement, watch flags, pre-migration paper decisions, runner-lane signals/rejections, AI fallback decisions, and continuation verdicts. Use `--all --limitRuns 10` to search recent historical runs instead of only the newest run.

### Runner Baseline

The current `RUNNER_HUNTER` paper-trading baseline is:

```env
MIN_PUMP_MOMENTUM_SCORE=0.68
MIN_PUMP_BUY_RATIO=0.62
MAX_PUMP_TOKEN_AGE_SECONDS=300
AI_TIMEOUT_MS=3000
AI_FAST_RUNNER_REVIEW_ENABLED=true
AI_FAST_REVIEW_TIMEOUT_MS=4500
AI_FAST_REVIEW_NUM_PREDICT=140
MIN_LIQUIDITY_USD=5000
MIN_QUALITY_SCORE=0.42
```

Important baseline behavior:

- keep the current AI timeout retry and JSON repair logic enabled
- keep fast runner review enabled for PumpPortal momentum candidates so Hermes receives a compact packet instead of the full doctrine pack during time-sensitive entries
- keep `AI_TIMEOUT_FALLBACK_ENABLED=true` for paper runs so strong deterministic candidates are not hard-vetoed solely because local Ollama timed out
- keep `AI_TIMEOUT_FALLBACK_PAPER_ONLY=true` unless we deliberately promote the fallback after paper evidence
- keep the current AI liquidity-above-floor guard behavior enabled
- keep wallet, Telegram, knowledge-pack, and Rick context enabled
- do not loosen momentum further unless later evidence clearly points back to it

Current interpretation:

- `RUNNER_MODE_REQUIRES_PUMP_MOMENTUM` is lane filtering, not a true momentum-threshold problem
- the real PumpPortal gate pressure is now primarily `PUMP_FAIL_BUY_RATIO` and `PUMP_FAIL_AGE`
- `LOW_QUALITY_SCORE` still matters, but momentum is no longer the main culprit

### Baseline Validation Runs

The current runner baseline has two consecutive profitable validation sessions:

1. [strategy-ledger-2026-04-11T19-37-39-356Z.jsonl](run-logs/strategy-ledger-2026-04-11T19-37-39-356Z.jsonl)
   [telemetry-2026-04-11T19-37-39-356Z.jsonl](run-logs/telemetry-2026-04-11T19-37-39-356Z.jsonl)
   Result: `2` trades, `2` wins, `+0.1030 SOL`

2. [strategy-ledger-2026-04-11T20-10-14-664Z.jsonl](run-logs/strategy-ledger-2026-04-11T20-10-14-664Z.jsonl)
   [telemetry-2026-04-11T20-10-14-664Z.jsonl](run-logs/telemetry-2026-04-11T20-10-14-664Z.jsonl)
   Result: `2` trades, `2` wins, `+0.1356 SOL`

Why these matter:

- they validate the current runner baseline across consecutive sessions
- they confirm the new Pump failure telemetry is exposing real blockers
- they show the next likely experimental levers are `buy ratio` first, then smarter age handling

### Recent Context Read

Saturday night context review across Telegram and Rick showed:

- `Yakuza` was highly active, but mostly with tactical position-management chatter and leaderboard/caller discussion
- `Chatbox!!!!` was more narrative-driven and noisy
- `Cryptoshi Cooks` leaned on caller stats and leaderboard validation
- Rick showed a mixed but not explosive tape:
  - `/runners` still had real global runners
  - `/pft` showed fresh low-cap Pump names
  - `/burp` had weakened versus hotter earlier snapshots

That combination matched the later baseline-validation no-trade sessions well: active chatter without enough clean runner structure to justify forced entries.

### Next Intelligence Work

The next structured context source after wallet intel and Telegram is Rick / Talk.Markets enrichment.

Planned order:

1. deployer history
2. notable holders / known top holders
3. market stats / state of the trenches
4. runners report / last hot tokens
5. dex paid / dex paid alerts
6. lore / trending tweets

Implementation notes live in:

- [Rick integration roadmap](knowledge/rick-integration-roadmap.md)

### Starting the Bot

```bash
npm start
```

### Development Mode

```bash
npm run dev
```

### Stopping the Bot

Press `Ctrl+C` to gracefully stop the bot.

## Architecture

```
src/
├── index.js           # Main entry point
├── config.js          # Configuration management
├── wallet.js          # Wallet management
├── logger.js          # Logging utility
├── market-data.js     # Market data fetching
├── ai-agent.js        # AI analysis engine
└── trading-engine.js  # Core trading logic
```

## How It Works

1. **Market Analysis**: The bot continuously monitors Solana DEX pools for trading opportunities
2. **AI Evaluation**: Market data is analyzed by Ollama to generate trading recommendations
3. **Risk Assessment**: Each potential trade is evaluated against risk management rules
4. **Trade Execution**: Approved trades are executed automatically
5. **Position Management**: Active positions are monitored and managed according to stop-loss and take-profit rules

## Risk Management

The bot implements multiple layers of risk management:

- **Position Sizing**: Limits on individual position sizes
- **Stop Loss**: Automatic stop-loss at configured percentage
- **Take Profit**: Automatic profit-taking at configured percentage
- **Daily Loss Limit**: Trading stops if daily loss exceeds limit
- **Liquidity Checks**: Only trades tokens with sufficient liquidity
- **Slippage Protection**: Maximum slippage tolerance on all trades
- **Dynamic Compounding**: Realized profits are split between hot and cold wallets based on equity growth tiers
- **Cold Wallet Sweeps**: Positive realized profit can trigger an on-chain SOL transfer from hot to cold wallet

## AI Features

The AI agent provides:

- **Market Sentiment Analysis**: Evaluates overall market conditions
- **Token Analysis**: Deep analysis of individual tokens
- **Risk Assessment**: Detailed risk scoring for each opportunity
- **Strategy Generation**: Comprehensive trading strategies
- **Confidence Scoring**: Confidence levels for all recommendations

## Disclaimer

⚠️ **WARNING**: Trading cryptocurrencies, especially memecoins, involves significant risk. This bot is for educational purposes only. You could lose your entire investment. Never trade with money you cannot afford to lose.

- Past performance does not guarantee future results
- Memecoins are highly volatile and speculative
- The bot may not perform as expected in all market conditions
- Always monitor the bot and be prepared to intervene

## License

MIT License - see LICENSE file for details

## Support

For issues and questions, please open an issue on GitHub.
