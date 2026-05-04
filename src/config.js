const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

class Config {
  // Solana RPC Configuration
  static get solanaRpcUrl() {
    return process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  }

  static get solanaRpcFallback() {
    return process.env.SOLANA_RPC_FALLBACK || 'https://api.mainnet-beta.solana.com';
  }

  static get solanaRpcWebsocketUrl() {
    return process.env.SOLANA_RPC_WEBSOCKET_URL || process.env.HELIUS_ENHANCED_WEBSOCKET_URL || process.env.HELIUS_STANDARD_WEBSOCKET_URL || null;
  }

  static get solanaRpcFallbackWebsocketUrl() {
    return process.env.SOLANA_RPC_FALLBACK_WEBSOCKET_URL || null;
  }

  static get solanaRpcPrimaryDowngradeMs() {
    return parseInt(process.env.SOLANA_RPC_PRIMARY_DOWNGRADE_MS || '300000', 10);
  }

  static get heliusEnhancedWebsocketUrl() {
    return process.env.HELIUS_ENHANCED_WEBSOCKET_URL || null;
  }

  static get heliusStandardWebsocketUrl() {
    return process.env.HELIUS_STANDARD_WEBSOCKET_URL || null;
  }

  static get heliusParseApiKey() {
    return process.env.HELIUS_PARSE_API_KEY;
  }

  // PumpPortal Configuration
  static get pumpPortalApiKey() {
    return process.env.PUMP_PORTAL_API_KEY;
  }

  // Wallet Configuration
  static get hotWalletPrivateKey() {
    if (!process.env.HOT_WALLET_PRIVATE_KEY) {
      throw new Error('HOT_WALLET_PRIVATE_KEY environment variable is required');
    }
    return process.env.HOT_WALLET_PRIVATE_KEY;
  }

  static get coldWalletAddress() {
    if (!process.env.COLD_WALLET_ADDRESS) {
      throw new Error('COLD_WALLET_ADDRESS environment variable is required');
    }
    return process.env.COLD_WALLET_ADDRESS;
  }

  static get coldWalletPrivateKey() {
    return process.env.COLD_WALLET_PRIVATE_KEY;
  }

  // Trading Configuration
  static get tradingAmountSol() {
    return parseFloat(process.env.TRADING_AMOUNT_SOL || '0.1');
  }

  static get slippageTolerance() {
    return parseFloat(process.env.SLIPPAGE_TOLERANCE || '0.5');
  }

  static get maxPriceImpact() {
    return parseFloat(process.env.MAX_PRICE_IMPACT || '0.03');
  }

  static get baseTokenMint() {
    return process.env.BASE_TOKEN_MINT || 'So11111111111111111111111111111111111111112';
  }

  static get jupiterApiBaseUrl() {
    return process.env.JUPITER_API_BASE_URL || 'https://lite-api.jup.ag';
  }

  static get jupiterApiKey() {
    return process.env.JUPITER_API_KEY;
  }

  static get raydiumApiBaseUrl() {
    return process.env.RAYDIUM_API_BASE_URL || 'https://api-v3.raydium.io';
  }

  static get raydiumPoolCacheTtlMs() {
    return parseInt(process.env.RAYDIUM_POOL_CACHE_TTL_MS || '60000', 10);
  }

  static get raydiumPoolStaleTtlMs() {
    return parseInt(process.env.RAYDIUM_POOL_STALE_TTL_MS || '300000', 10);
  }

  static get meteoraApiBaseUrl() {
    return process.env.METEORA_API_BASE_URL || 'https://dlmm.datapi.meteora.ag';
  }

  static get meteoraEnabled() {
    return process.env.METEORA_ENABLED !== 'false';
  }

  static get meteoraPoolCacheTtlMs() {
    return parseInt(process.env.METEORA_POOL_CACHE_TTL_MS || '60000', 10);
  }

  static get meteoraPoolStaleTtlMs() {
    return parseInt(process.env.METEORA_POOL_STALE_TTL_MS || '300000', 10);
  }

  static get moonshotApiBaseUrl() {
    return process.env.MOONSHOT_API_BASE_URL || 'https://api.moonshot.cc';
  }

  static get moonshotEnabled() {
    return process.env.MOONSHOT_ENABLED === 'true';
  }

  static get poolStateLaneEnabled() {
    return process.env.POOL_STATE_LANE_ENABLED !== 'false';
  }

  static get poolStateLaneMinLiquidityUsd() {
    return parseFloat(process.env.POOL_STATE_LANE_MIN_LIQUIDITY_USD || '0');
  }

  static get poolStateLaneMaxTrackedMints() {
    return parseInt(process.env.POOL_STATE_LANE_MAX_TRACKED_MINTS || '5000', 10);
  }

  static get pumpBondingCurveLaneEnabled() {
    return process.env.PUMP_BONDING_CURVE_LANE_ENABLED !== 'false';
  }

  static get pumpBondingCurveProgramId() {
    return process.env.PUMP_BONDING_CURVE_PROGRAM_ID || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
  }

  static get pumpBondingCurveRefreshIntervalMs() {
    return parseInt(process.env.PUMP_BONDING_CURVE_REFRESH_INTERVAL_MS || '15000', 10);
  }

  static get pumpBondingCurveFailureCooldownMs() {
    return parseInt(process.env.PUMP_BONDING_CURVE_FAILURE_COOLDOWN_MS || '120000', 10);
  }

  static get pumpBondingCurveMaxTrackedMints() {
    return parseInt(process.env.PUMP_BONDING_CURVE_MAX_TRACKED_MINTS || '5000', 10);
  }

  static get pumpBondingCurveMaxFetchesPerCycle() {
    return parseInt(process.env.PUMP_BONDING_CURVE_MAX_FETCHES_PER_CYCLE || '25', 10);
  }

  static get preMigrationWatchEnabled() {
    return process.env.PRE_MIGRATION_WATCH_ENABLED !== 'false';
  }

  static get preMigrationWatchMinScore() {
    return parseFloat(process.env.PRE_MIGRATION_WATCH_MIN_SCORE || '25');
  }

  static get preMigrationWatchConfirmMinScore() {
    return parseFloat(process.env.PRE_MIGRATION_WATCH_CONFIRM_MIN_SCORE || '60');
  }

  static get preMigrationWatchInterestMinTradeVelocityPerMin() {
    return parseFloat(process.env.PRE_MIGRATION_WATCH_INTEREST_MIN_TRADE_VELOCITY_PER_MIN || '1.5');
  }

  static get preMigrationWatchInterestMinRecentVolumeSol() {
    return parseFloat(process.env.PRE_MIGRATION_WATCH_INTEREST_MIN_RECENT_VOLUME_SOL || '0.15');
  }

  static get preMigrationWatchInterestMinCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_WATCH_INTEREST_MIN_CURVE_PROGRESS || '0.45');
  }

  static get preMigrationWatchInterestMinUniqueBuyerCount() {
    return parseInt(process.env.PRE_MIGRATION_WATCH_INTEREST_MIN_UNIQUE_BUYER_COUNT || '4', 10);
  }

  static get preMigrationWatchConfirmMinObservations() {
    return parseInt(process.env.PRE_MIGRATION_WATCH_CONFIRM_MIN_OBSERVATIONS || '2', 10);
  }

  static get preMigrationWatchConfirmMinGapMs() {
    return parseInt(process.env.PRE_MIGRATION_WATCH_CONFIRM_MIN_GAP_MS || '30000', 10);
  }

  static get preMigrationWatchFastTrackScore() {
    return parseFloat(process.env.PRE_MIGRATION_WATCH_FAST_TRACK_SCORE || '75');
  }

  static get preMigrationWatchRequireSecondarySignal() {
    return process.env.PRE_MIGRATION_WATCH_REQUIRE_SECONDARY_SIGNAL !== 'false';
  }

  static get preMigrationWatchStrongNoSecondaryScore() {
    return parseFloat(process.env.PRE_MIGRATION_WATCH_STRONG_NO_SECONDARY_SCORE || '80');
  }

  static get preMigrationWatchMinCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_WATCH_MIN_CURVE_PROGRESS || '0.85');
  }

  static get preMigrationWatchFlagCooldownMs() {
    return parseInt(process.env.PRE_MIGRATION_WATCH_FLAG_COOLDOWN_MS || '60000', 10);
  }

  static get preMigrationWatchMaxTrackedMints() {
    return parseInt(process.env.PRE_MIGRATION_WATCH_MAX_TRACKED_MINTS || '5000', 10);
  }

  static get candidateDossierEnabled() {
    return process.env.CANDIDATE_DOSSIER_ENABLED !== 'false';
  }

  static get candidateDossierIncludeObserved() {
    return process.env.CANDIDATE_DOSSIER_INCLUDE_OBSERVED === 'true';
  }

  static get candidateDossierMaxRecent() {
    return parseInt(process.env.CANDIDATE_DOSSIER_MAX_RECENT || '25', 10);
  }

  static get outcomeLedgerEnabled() {
    return process.env.OUTCOME_LEDGER_ENABLED !== 'false';
  }

  static get outcomeLedgerFilePath() {
    return process.env.OUTCOME_LEDGER_FILE_PATH || path.join(process.cwd(), 'data', 'outcomes', 'outcome-ledger.jsonl');
  }

  static get outcomeLedgerMaxRecent() {
    return parseInt(process.env.OUTCOME_LEDGER_MAX_RECENT || '25', 10);
  }

  static get postMigrationContinuationEnabled() {
    return process.env.POST_MIGRATION_CONTINUATION_ENABLED !== 'false';
  }

  static get postMigrationContinuationMinScore() {
    return parseFloat(process.env.POST_MIGRATION_CONTINUATION_MIN_SCORE || '65');
  }

  static get postMigrationContinuationConfirmMinScore() {
    return parseFloat(process.env.POST_MIGRATION_CONTINUATION_CONFIRM_MIN_SCORE || '75');
  }

  static get postMigrationContinuationMinLiquidityUsd() {
    return parseFloat(process.env.POST_MIGRATION_CONTINUATION_MIN_LIQUIDITY_USD || '25000');
  }

  static get postMigrationContinuationMinVolumeToLiquidity() {
    return parseFloat(process.env.POST_MIGRATION_CONTINUATION_MIN_VOLUME_TO_LIQUIDITY || '2');
  }

  static get postMigrationContinuationMinVolume1hUsd() {
    return parseFloat(process.env.POST_MIGRATION_CONTINUATION_MIN_VOLUME_1H_USD || '10000');
  }

  static get postMigrationContinuationMinAgeHours() {
    return parseFloat(process.env.POST_MIGRATION_CONTINUATION_MIN_AGE_HOURS || '0.25');
  }

  static get postMigrationContinuationMaxAgeHours() {
    return parseFloat(process.env.POST_MIGRATION_CONTINUATION_MAX_AGE_HOURS || '168');
  }

  static get postMigrationContinuationMaxSellTxnRatio() {
    return parseFloat(process.env.POST_MIGRATION_CONTINUATION_MAX_SELL_TXN_RATIO || '0.72');
  }

  static get postMigrationContinuationFlagCooldownMs() {
    return parseInt(process.env.POST_MIGRATION_CONTINUATION_FLAG_COOLDOWN_MS || '300000', 10);
  }

  static get postMigrationContinuationMaxTrackedMints() {
    return parseInt(process.env.POST_MIGRATION_CONTINUATION_MAX_TRACKED_MINTS || '2500', 10);
  }

  static get postMigrationContinuationMaxDexScreenerFetchesPerCycle() {
    return parseInt(process.env.POST_MIGRATION_CONTINUATION_MAX_DEXSCREENER_FETCHES_PER_CYCLE || '6', 10);
  }

  static get dexScreenerApiBaseUrl() {
    return process.env.DEXSCREENER_API_BASE_URL || 'https://api.dexscreener.com';
  }

  static get dexScreenerCacheTtlMs() {
    return parseInt(process.env.DEXSCREENER_CACHE_TTL_MS || '120000', 10);
  }

  static get preMigrationPaperEnabled() {
    return process.env.PRE_MIGRATION_PAPER_ENABLED !== 'false';
  }

  static get preMigrationPaperOnly() {
    return process.env.PRE_MIGRATION_PAPER_ONLY !== 'false';
  }

  static get preMigrationPaperMinScore() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_MIN_SCORE || '85');
  }

  static get preMigrationPaperMinCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_MIN_CURVE_PROGRESS || '0.85');
  }

  static get preMigrationPaperMaxCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_MAX_CURVE_PROGRESS || '0.92');
  }

  static get preMigrationPaperMinRecentVolumeSol() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_MIN_RECENT_VOLUME_SOL || '25');
  }

  static get preMigrationPaperMinTradeVelocityPerMin() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_MIN_TRADE_VELOCITY_PER_MIN || '25');
  }

  static get preMigrationPaperTakeProfitPct() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_TAKE_PROFIT_PCT || '0.35');
  }

  static get preMigrationPaperStopLossPct() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_STOP_LOSS_PCT || '0.15');
  }

  static get preMigrationPaperMaxHoldSeconds() {
    return parseInt(process.env.PRE_MIGRATION_PAPER_MAX_HOLD_SECONDS || '300', 10);
  }

  static get preMigrationPaperAmountSol() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_AMOUNT_SOL || '0.1');
  }

  static get preMigrationPaperMinCurveProgressDelta() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_MIN_CURVE_PROGRESS_DELTA || '0.005');
  }

  static get preMigrationPaperCurveProgressLookbackMs() {
    return parseInt(process.env.PRE_MIGRATION_PAPER_CURVE_PROGRESS_LOOKBACK_MS || '120000', 10);
  }

  static get preMigrationPaperCloneGuardWindowMs() {
    return parseInt(process.env.PRE_MIGRATION_PAPER_CLONE_GUARD_WINDOW_MS || '1800000', 10);
  }

  static get preMigrationPaperCloneGuardMaxEntriesPerSymbol() {
    return parseInt(process.env.PRE_MIGRATION_PAPER_CLONE_GUARD_MAX_ENTRIES_PER_SYMBOL || '1', 10);
  }

  static get preMigrationPaperBadExitCooldownMs() {
    return parseInt(process.env.PRE_MIGRATION_PAPER_BAD_EXIT_COOLDOWN_MS || '900000', 10);
  }

  static get preMigrationPaperMaxObservedStates() {
    return parseInt(process.env.PRE_MIGRATION_PAPER_MAX_OBSERVED_STATES || '5000', 10);
  }

  static get preMigrationPaperRecheckEnabled() {
    return process.env.PRE_MIGRATION_PAPER_RECHECK_ENABLED !== 'false';
  }

  static get preMigrationPaperRecheckDelayMs() {
    return parseInt(process.env.PRE_MIGRATION_PAPER_RECHECK_DELAY_MS || '10000', 10);
  }

  static get preMigrationPaperRecheckMaxAttempts() {
    return parseInt(process.env.PRE_MIGRATION_PAPER_RECHECK_MAX_ATTEMPTS || '2', 10);
  }

  static get preMigrationPaperRecheckMaxAgeMs() {
    return parseInt(process.env.PRE_MIGRATION_PAPER_RECHECK_MAX_AGE_MS || '1800000', 10);
  }

  static get preMigrationPaperRecheckMaxTrackedMints() {
    return parseInt(process.env.PRE_MIGRATION_PAPER_RECHECK_MAX_TRACKED_MINTS || '500', 10);
  }

  static get preMigrationPaperLateFastTrackEnabled() {
    return process.env.PRE_MIGRATION_PAPER_LATE_FAST_TRACK_ENABLED !== 'false';
  }

  static get preMigrationPaperLateFastTrackMinScore() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_LATE_FAST_TRACK_MIN_SCORE || '87');
  }

  static get preMigrationPaperLateFastTrackMinCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_LATE_FAST_TRACK_MIN_CURVE_PROGRESS || '0.92');
  }

  static get preMigrationPaperLateFastTrackMinRecentVolumeSol() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_LATE_FAST_TRACK_MIN_RECENT_VOLUME_SOL || '75');
  }

  static get preMigrationPaperLateFastTrackMinTradeVelocityPerMin() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_LATE_FAST_TRACK_MIN_TRADE_VELOCITY_PER_MIN || '50');
  }

  static get preMigrationPaperFirstSightOverrideEnabled() {
    return process.env.PRE_MIGRATION_PAPER_FIRST_SIGHT_OVERRIDE_ENABLED !== 'false';
  }

  static get preMigrationPaperFirstSightMinScore() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_FIRST_SIGHT_MIN_SCORE || '84');
  }

  static get preMigrationPaperFirstSightMinCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_FIRST_SIGHT_MIN_CURVE_PROGRESS || '0.78');
  }

  static get preMigrationPaperFirstSightMaxCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_FIRST_SIGHT_MAX_CURVE_PROGRESS || '0.95');
  }

  static get preMigrationPaperFirstSightMinRecentVolumeSol() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_FIRST_SIGHT_MIN_RECENT_VOLUME_SOL || '12');
  }

  static get preMigrationPaperFirstSightMinTradeVelocityPerMin() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_FIRST_SIGHT_MIN_TRADE_VELOCITY_PER_MIN || '12');
  }

  static get preMigrationPaperFirstSightMinBuyRatio() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_FIRST_SIGHT_MIN_BUY_RATIO || '0.75');
  }

  static get preMigrationPaperFirstCurveSnapshotScalpEnabled() {
    return process.env.PRE_MIGRATION_PAPER_FIRST_CURVE_SNAPSHOT_SCALP_ENABLED !== 'false';
  }

  static get preMigrationPaperFirstCurveSnapshotScalpMinScore() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_FIRST_CURVE_SNAPSHOT_SCALP_MIN_SCORE || '55');
  }

  static get preMigrationPaperFirstCurveSnapshotScalpMinCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_FIRST_CURVE_SNAPSHOT_SCALP_MIN_CURVE_PROGRESS || '0.7');
  }

  static get preMigrationPaperFirstCurveSnapshotScalpMaxCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_FIRST_CURVE_SNAPSHOT_SCALP_MAX_CURVE_PROGRESS || '0.9');
  }

  static get preMigrationPaperFirstCurveSnapshotScalpMinRecentVolumeSol() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_FIRST_CURVE_SNAPSHOT_SCALP_MIN_RECENT_VOLUME_SOL || '0.25');
  }

  static get preMigrationPaperFirstCurveSnapshotScalpMinTradeVelocityPerMin() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_FIRST_CURVE_SNAPSHOT_SCALP_MIN_TRADE_VELOCITY_PER_MIN || '1.5');
  }

  static get preMigrationPaperFirstCurveSnapshotScalpMinInterestCount() {
    return parseInt(process.env.PRE_MIGRATION_PAPER_FIRST_CURVE_SNAPSHOT_SCALP_MIN_INTEREST_COUNT || '3', 10);
  }

  static get preMigrationPaperFirstCurveSnapshotScalpMinUniqueBuyerCount() {
    return parseInt(process.env.PRE_MIGRATION_PAPER_FIRST_CURVE_SNAPSHOT_SCALP_MIN_UNIQUE_BUYER_COUNT || '3', 10);
  }

  static get preMigrationPaperFirstCurveSnapshotScalpMaxRiskWalletCount() {
    return parseInt(process.env.PRE_MIGRATION_PAPER_FIRST_CURVE_SNAPSHOT_SCALP_MAX_RISK_WALLET_COUNT || '1', 10);
  }

  static get preMigrationPaperFirstCurveSnapshotScalpMinBuyRatio() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_FIRST_CURVE_SNAPSHOT_SCALP_MIN_BUY_RATIO || '0.45');
  }

  static get preMigrationPaperLogDecisionEvents() {
    return process.env.PRE_MIGRATION_PAPER_LOG_DECISION_EVENTS !== 'false';
  }

  static get preMigrationPaperEarlySurgeOverrideEnabled() {
    return process.env.PRE_MIGRATION_PAPER_EARLY_SURGE_OVERRIDE_ENABLED !== 'false';
  }

  static get preMigrationPaperEarlySurgeMinScore() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_EARLY_SURGE_MIN_SCORE || '84');
  }

  static get preMigrationPaperEarlySurgeMinCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_EARLY_SURGE_MIN_CURVE_PROGRESS || '0.7');
  }

  static get preMigrationPaperEarlySurgeMaxCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_EARLY_SURGE_MAX_CURVE_PROGRESS || '0.82');
  }

  static get preMigrationPaperEarlySurgeMinRecentVolumeSol() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_EARLY_SURGE_MIN_RECENT_VOLUME_SOL || '75');
  }

  static get preMigrationPaperEarlySurgeMinTradeVelocityPerMin() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_EARLY_SURGE_MIN_TRADE_VELOCITY_PER_MIN || '60');
  }

  static get preMigrationPaperEarlySurgeMinBuyRatio() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_EARLY_SURGE_MIN_BUY_RATIO || '0.78');
  }

  static get preMigrationPaperEarlySurgeMinCurveProgressDelta() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_EARLY_SURGE_MIN_CURVE_PROGRESS_DELTA || '0.035');
  }

  static get preMigrationPaperEarlySurgeNoBaselineMinScore() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_EARLY_SURGE_NO_BASELINE_MIN_SCORE || '84');
  }

  static get preMigrationPaperBroadOrganicSurgeEnabled() {
    return process.env.PRE_MIGRATION_PAPER_BROAD_ORGANIC_SURGE_ENABLED !== 'false';
  }

  static get preMigrationPaperBroadOrganicSurgeMinScore() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_BROAD_ORGANIC_SURGE_MIN_SCORE || '75');
  }

  static get preMigrationPaperBroadOrganicSurgeMinCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_BROAD_ORGANIC_SURGE_MIN_CURVE_PROGRESS || '0.7');
  }

  static get preMigrationPaperBroadOrganicSurgeMaxCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_BROAD_ORGANIC_SURGE_MAX_CURVE_PROGRESS || '0.82');
  }

  static get preMigrationPaperBroadOrganicSurgeMinRecentVolumeSol() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_BROAD_ORGANIC_SURGE_MIN_RECENT_VOLUME_SOL || '70');
  }

  static get preMigrationPaperBroadOrganicSurgeMinTradeVelocityPerMin() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_BROAD_ORGANIC_SURGE_MIN_TRADE_VELOCITY_PER_MIN || '90');
  }

  static get preMigrationPaperBroadOrganicSurgeMinUniqueBuyerRatio() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_BROAD_ORGANIC_SURGE_MIN_UNIQUE_BUYER_RATIO || '0.9');
  }

  static get preMigrationPaperBroadOrganicSurgeMinBuyRatio() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_BROAD_ORGANIC_SURGE_MIN_BUY_RATIO || '0.7');
  }

  static get preMigrationPaperCurvePauseOverrideEnabled() {
    return process.env.PRE_MIGRATION_PAPER_CURVE_PAUSE_OVERRIDE_ENABLED !== 'false';
  }

  static get preMigrationPaperCurvePauseMinScore() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_CURVE_PAUSE_MIN_SCORE || '82');
  }

  static get preMigrationPaperCurvePauseMinCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_CURVE_PAUSE_MIN_CURVE_PROGRESS || '0.75');
  }

  static get preMigrationPaperCurvePauseMinRecentVolumeSol() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_CURVE_PAUSE_MIN_RECENT_VOLUME_SOL || '12');
  }

  static get preMigrationPaperCurvePauseMinTradeVelocityPerMin() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_CURVE_PAUSE_MIN_TRADE_VELOCITY_PER_MIN || '12');
  }

  static get preMigrationPaperCurvePauseMinBuyRatio() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_CURVE_PAUSE_MIN_BUY_RATIO || '0.4');
  }

  static get preMigrationPaperEnabledPresets() {
    return process.env.PRE_MIGRATION_PAPER_ENABLED_PRESETS || 'strictMigration,highConfidenceRunner,earlyAccelerationRunner,highConvictionFirstSight';
  }

  static get preMigrationPaperHighConfidenceRunnerMinScore() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_HIGH_CONFIDENCE_RUNNER_MIN_SCORE || '85');
  }

  static get preMigrationPaperHighConfidenceRunnerMinCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_HIGH_CONFIDENCE_RUNNER_MIN_CURVE_PROGRESS || '0.75');
  }

  static get preMigrationPaperHighConfidenceRunnerMinRecentVolumeSol() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_HIGH_CONFIDENCE_RUNNER_MIN_RECENT_VOLUME_SOL || '25');
  }

  static get preMigrationPaperHighConfidenceRunnerMinTradeVelocityPerMin() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_HIGH_CONFIDENCE_RUNNER_MIN_TRADE_VELOCITY_PER_MIN || '25');
  }

  static get preMigrationPaperHighConfidenceRunnerTakeProfitPct() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_HIGH_CONFIDENCE_RUNNER_TAKE_PROFIT_PCT || '0.50');
  }

  static get preMigrationPaperHighConfidenceRunnerStopLossPct() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_HIGH_CONFIDENCE_RUNNER_STOP_LOSS_PCT || '0.15');
  }

  static get preMigrationPaperHighConfidenceRunnerMaxHoldSeconds() {
    return parseInt(process.env.PRE_MIGRATION_PAPER_HIGH_CONFIDENCE_RUNNER_MAX_HOLD_SECONDS || '300', 10);
  }

  static get preMigrationPaperEarlyAccelerationRunnerMinScore() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_EARLY_ACCELERATION_RUNNER_MIN_SCORE || '84.5');
  }

  static get preMigrationPaperEarlyAccelerationRunnerMinCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_EARLY_ACCELERATION_RUNNER_MIN_CURVE_PROGRESS || '0.88');
  }

  static get preMigrationPaperEarlyAccelerationRunnerMinRecentVolumeSol() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_EARLY_ACCELERATION_RUNNER_MIN_RECENT_VOLUME_SOL || '60');
  }

  static get preMigrationPaperEarlyAccelerationRunnerMinTradeVelocityPerMin() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_EARLY_ACCELERATION_RUNNER_MIN_TRADE_VELOCITY_PER_MIN || '40');
  }

  static get preMigrationPaperEarlyAccelerationRunnerTakeProfitPct() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_EARLY_ACCELERATION_RUNNER_TAKE_PROFIT_PCT || '0.35');
  }

  static get preMigrationPaperEarlyAccelerationRunnerStopLossPct() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_EARLY_ACCELERATION_RUNNER_STOP_LOSS_PCT || '0.15');
  }

  static get preMigrationPaperEarlyAccelerationRunnerMaxHoldSeconds() {
    return parseInt(process.env.PRE_MIGRATION_PAPER_EARLY_ACCELERATION_RUNNER_MAX_HOLD_SECONDS || '240', 10);
  }

  static get preMigrationPaperHighConvictionFirstSightMinScore() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_HIGH_CONVICTION_FIRST_SIGHT_MIN_SCORE || String(this.preMigrationPaperFirstSightMinScore));
  }

  static get preMigrationPaperHighConvictionFirstSightMinCurveProgress() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_HIGH_CONVICTION_FIRST_SIGHT_MIN_CURVE_PROGRESS || String(this.preMigrationPaperFirstSightMinCurveProgress));
  }

  static get preMigrationPaperHighConvictionFirstSightMinRecentVolumeSol() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_HIGH_CONVICTION_FIRST_SIGHT_MIN_RECENT_VOLUME_SOL || String(this.preMigrationPaperFirstSightMinRecentVolumeSol));
  }

  static get preMigrationPaperHighConvictionFirstSightMinTradeVelocityPerMin() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_HIGH_CONVICTION_FIRST_SIGHT_MIN_TRADE_VELOCITY_PER_MIN || String(this.preMigrationPaperFirstSightMinTradeVelocityPerMin));
  }

  static get preMigrationPaperHighConvictionFirstSightMinBuyRatio() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_HIGH_CONVICTION_FIRST_SIGHT_MIN_BUY_RATIO || String(this.preMigrationPaperFirstSightMinBuyRatio));
  }

  static get preMigrationPaperHighConvictionFirstSightTakeProfitPct() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_HIGH_CONVICTION_FIRST_SIGHT_TAKE_PROFIT_PCT || '0.50');
  }

  static get preMigrationPaperHighConvictionFirstSightStopLossPct() {
    return parseFloat(process.env.PRE_MIGRATION_PAPER_HIGH_CONVICTION_FIRST_SIGHT_STOP_LOSS_PCT || '0.15');
  }

  static get preMigrationPaperHighConvictionFirstSightMaxHoldSeconds() {
    return parseInt(process.env.PRE_MIGRATION_PAPER_HIGH_CONVICTION_FIRST_SIGHT_MAX_HOLD_SECONDS || '240', 10);
  }

  static get birdeyeApiBaseUrl() {
    return process.env.BIRDEYE_API_BASE_URL || 'https://public-api.birdeye.so';
  }

  static get birdeyeApiKey() {
    return process.env.BIRDEYE_API_KEY || process.env.BIRDEYE_API || process.env.BIRDEYE_KEY;
  }

  static get birdeyeEnabled() {
    return process.env.BIRDEYE_ENABLED !== 'false' && Boolean(this.birdeyeApiKey);
  }

  static get birdeyeRateLimitRpm() {
    return parseInt(process.env.BIRDEYE_RATE_LIMIT_RPM || '60', 10);
  }

  static get birdeyeTargetRpm() {
    const configured = parseInt(process.env.BIRDEYE_TARGET_RPM || '45', 10);
    return Math.min(configured, this.birdeyeRateLimitRpm);
  }

  static get birdeyeCacheTtlMs() {
    return parseInt(process.env.BIRDEYE_CACHE_TTL_MS || '60000', 10);
  }

  static get birdeyeErrorCacheTtlMs() {
    return parseInt(process.env.BIRDEYE_ERROR_CACHE_TTL_MS || '15000', 10);
  }

  static get birdeyeInvalidTokenCooldownMs() {
    return parseInt(process.env.BIRDEYE_INVALID_TOKEN_COOLDOWN_MS || '900000', 10);
  }

  static get birdeyeMaxTokensPerCycle() {
    return parseInt(process.env.BIRDEYE_MAX_TOKENS_PER_CYCLE || '1', 10);
  }

  static get birdeyeRetryBaseDelayMs() {
    return parseInt(process.env.BIRDEYE_RETRY_BASE_DELAY_MS || '1000', 10);
  }

  static get birdeyeMaxRetries() {
    return parseInt(process.env.BIRDEYE_MAX_RETRIES || '3', 10);
  }

  static get birdeyeSecurityEnabled() {
    return process.env.BIRDEYE_SECURITY_ENABLED === 'true';
  }

  static get birdeyeHolderDistributionEnabled() {
    return process.env.BIRDEYE_HOLDER_DISTRIBUTION_ENABLED === 'true';
  }

  static get disableEnvProxy() {
    return process.env.DISABLE_ENV_PROXY !== 'false';
  }

  static get pumpPortalWebsocketUrl() {
    return process.env.PUMPPORTAL_WEBSOCKET_URL || 'wss://pumpportal.fun/api/data';
  }

  static get pumpPortalUseApiKeyQuery() {
    return process.env.PUMPPORTAL_USE_API_KEY_QUERY !== 'false';
  }

  static get pumpPortalEnabled() {
    return process.env.PUMPPORTAL_ENABLED !== 'false';
  }

  static get pumpPortalTrackedAccounts() {
    const accounts = process.env.PUMPPORTAL_TRACKED_ACCOUNTS || '';
    return accounts.split(',').map((account) => account.trim()).filter(Boolean);
  }

  static get pumpPortalReconnectDelayMs() {
    return parseInt(process.env.PUMPPORTAL_RECONNECT_DELAY_MS || '5000', 10);
  }

  static get pumpPortalMaxReconnectDelayMs() {
    return parseInt(process.env.PUMPPORTAL_MAX_RECONNECT_DELAY_MS || '60000', 10);
  }

  static get pumpPortalStaleConnectionMs() {
    return parseInt(process.env.PUMPPORTAL_STALE_CONNECTION_MS || '90000', 10);
  }

  static get pumpPortalHealthCheckIntervalMs() {
    return parseInt(process.env.PUMPPORTAL_HEALTH_CHECK_INTERVAL_MS || '15000', 10);
  }

  static get gmgnApiBaseUrl() {
    return process.env.GMGN_API_BASE_URL || 'https://gmgn.ai';
  }

  static get gmgnApiKey() {
    return process.env.GMGN_API_KEY;
  }

  static get gmgnPublicKey() {
    return process.env.GMGN_PUBLIC_KEY;
  }

  static get gmgnEnabled() {
    return process.env.GMGN_ENABLED === 'true' && Boolean(this.gmgnApiKey);
  }

  static get gmgnWalletTrackingEnabled() {
    return process.env.GMGN_WALLET_TRACKING_ENABLED === 'true';
  }

  static get walletIntelEnabled() {
    return process.env.WALLET_INTEL_ENABLED !== 'false';
  }

  static get walletIntelFilePath() {
    return process.env.WALLET_INTEL_FILE_PATH || path.join(process.cwd(), 'data', 'wallet-intel', 'latest.json');
  }

  static get walletIntelRefreshIntervalMs() {
    return parseInt(process.env.WALLET_INTEL_REFRESH_INTERVAL_MS || '60000', 10);
  }

  static get walletEventLedgerEnabled() {
    return process.env.WALLET_EVENT_LEDGER_ENABLED !== 'false';
  }

  static get walletEventLedgerFilePath() {
    return process.env.WALLET_EVENT_LEDGER_FILE_PATH || path.join(process.cwd(), 'data', 'wallet-events', 'events.jsonl');
  }

  static get walletEventLedgerLatestFilePath() {
    return process.env.WALLET_EVENT_LEDGER_LATEST_FILE_PATH || path.join(process.cwd(), 'data', 'wallet-events', 'latest.json');
  }

  static get walletEventLedgerMaxRecentEvents() {
    return parseInt(process.env.WALLET_EVENT_LEDGER_MAX_RECENT_EVENTS || '250', 10);
  }

  static get kolscanLeaderboardFilePath() {
    return process.env.KOLSCAN_LEADERBOARD_FILE_PATH || path.join(process.cwd(), 'data', 'wallet-watchlists', 'kolscan-leaderboard.json');
  }

  static get manualKolWalletFilePath() {
    return process.env.MANUAL_KOL_WALLET_FILE_PATH || path.join(process.cwd(), 'data', 'wallet-watchlists', 'manual-kol-wallets.json');
  }

  static get telegramContextEnabled() {
    return process.env.TELEGRAM_CONTEXT_ENABLED === 'true';
  }

  static get telegramApiId() {
    return parseInt(process.env.TELEGRAM_API_ID || '0', 10);
  }

  static get telegramApiHash() {
    return process.env.TELEGRAM_API_HASH || '';
  }

  static get telegramPhone() {
    return process.env.TELEGRAM_PHONE || '';
  }

  static get telegramPassword() {
    return process.env.TELEGRAM_PASSWORD || '';
  }

  static get telegramAllowedChatIds() {
    const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS || '';
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
  }

  static get telegramAllowedChatNames() {
    const raw = process.env.TELEGRAM_ALLOWED_CHAT_NAMES || '';
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
  }

  static get telegramContextFilePath() {
    return process.env.TELEGRAM_CONTEXT_FILE_PATH || path.join(process.cwd(), 'data', 'telegram-context', 'latest.json');
  }

  static get telegramStateFilePath() {
    return process.env.TELEGRAM_STATE_FILE_PATH || path.join(process.cwd(), 'data', 'telegram-context', 'state.json');
  }

  static get telegramStringSessionFilePath() {
    return process.env.TELEGRAM_STRING_SESSION_FILE_PATH || path.join(process.cwd(), 'data', 'telegram-context', 'string-session.txt');
  }

  static get telegramContextRefreshIntervalMs() {
    return parseInt(process.env.TELEGRAM_CONTEXT_REFRESH_INTERVAL_MS || '60000', 10);
  }

  static get telegramContextWindowHours() {
    return parseInt(process.env.TELEGRAM_CONTEXT_WINDOW_HOURS || '12', 10);
  }

  static get telegramMaxUpdatesPerFetch() {
    return parseInt(process.env.TELEGRAM_MAX_UPDATES_PER_FETCH || '100', 10);
  }

  static get telegramMaxStoredMessages() {
    return parseInt(process.env.TELEGRAM_MAX_STORED_MESSAGES || '300', 10);
  }

  static get telegramMaxMessagesPerChat() {
    return parseInt(process.env.TELEGRAM_MAX_MESSAGES_PER_CHAT || '40', 10);
  }

  static get telegramSummaryMaxSnippets() {
    return parseInt(process.env.TELEGRAM_SUMMARY_MAX_SNIPPETS || '3', 10);
  }

  static get telegramBootstrapSightingLimit() {
    return parseInt(process.env.TELEGRAM_BOOTSTRAP_SIGHTING_LIMIT || '75', 10);
  }

  static get telegramBootstrapSightingMaxAgeMinutes() {
    return parseFloat(process.env.TELEGRAM_BOOTSTRAP_SIGHTING_MAX_AGE_MINUTES || '240');
  }

  static get telegramBootstrapSightingMode() {
    return String(process.env.TELEGRAM_BOOTSTRAP_SIGHTING_MODE || 'live_only').trim().toLowerCase();
  }

  static get telegramPaperBootstrapSightingLimit() {
    return parseInt(process.env.TELEGRAM_PAPER_BOOTSTRAP_SIGHTING_LIMIT || '10', 10);
  }

  static get telegramPaperBootstrapSightingMaxAgeMinutes() {
    return parseFloat(process.env.TELEGRAM_PAPER_BOOTSTRAP_SIGHTING_MAX_AGE_MINUTES || '60');
  }

  static get telegramPaperRecurringSightingLimit() {
    return parseInt(process.env.TELEGRAM_PAPER_RECURRING_SIGHTING_LIMIT || '25', 10);
  }

  static get telegramPaperRecurringSightingMaxAgeMinutes() {
    return parseFloat(process.env.TELEGRAM_PAPER_RECURRING_SIGHTING_MAX_AGE_MINUTES || '20');
  }

  static get capitalBalanceTimeoutMs() {
    return parseInt(process.env.CAPITAL_BALANCE_TIMEOUT_MS || '5000', 10);
  }

  static get paperBalanceRefreshIntervalMs() {
    return parseInt(process.env.PAPER_BALANCE_REFRESH_INTERVAL_MS || '15000', 10);
  }

  static get rickContextEnabled() {
    return process.env.RICK_CONTEXT_ENABLED !== 'false';
  }

  static get launchIntelEnabled() {
    return process.env.LAUNCH_INTEL_ENABLED !== 'false';
  }

  static get launchIntelLatestFilePath() {
    return process.env.LAUNCH_INTEL_LATEST_FILE_PATH || path.join(process.cwd(), 'data', 'launch-intel', 'latest.json');
  }

  static get launchIntelHistoryFilePath() {
    return process.env.LAUNCH_INTEL_HISTORY_FILE_PATH || path.join(process.cwd(), 'data', 'launch-intel', 'history.jsonl');
  }

  static get launchIntelDeployerIndexFilePath() {
    return process.env.LAUNCH_INTEL_DEPLOYER_INDEX_FILE_PATH || path.join(process.cwd(), 'data', 'launch-intel', 'deployer-index.json');
  }

  static get launchIntelWalletIndexFilePath() {
    return process.env.LAUNCH_INTEL_WALLET_INDEX_FILE_PATH || path.join(process.cwd(), 'data', 'launch-intel', 'wallet-index.json');
  }

  static get positionStateFilePath() {
    return process.env.POSITION_STATE_FILE_PATH || path.join(process.cwd(), 'data', 'positions', 'active-positions.json');
  }

  static get launchIntelFlushIntervalMs() {
    return parseInt(process.env.LAUNCH_INTEL_FLUSH_INTERVAL_MS || '10000', 10);
  }

  static get launchIntelMaxTrackedTokens() {
    return parseInt(process.env.LAUNCH_INTEL_MAX_TRACKED_TOKENS || '5000', 10);
  }

  static get launchIntelMaxEarlyBuys() {
    return parseInt(process.env.LAUNCH_INTEL_MAX_EARLY_BUYS || '50', 10);
  }

  static get launchIntelSniperWindowMs() {
    return parseInt(process.env.LAUNCH_INTEL_SNIPER_WINDOW_MS || '4000', 10);
  }

  static get launchIntelBundlerWindowMs() {
    return parseInt(process.env.LAUNCH_INTEL_BUNDLER_WINDOW_MS || '1500', 10);
  }

  static get launchIntelBundlerMinWallets() {
    return parseInt(process.env.LAUNCH_INTEL_BUNDLER_MIN_WALLETS || '4', 10);
  }

  static get rickContextFilePath() {
    return process.env.RICK_CONTEXT_FILE_PATH || path.join(process.cwd(), 'data', 'rick-context', 'latest.json');
  }

  static get rickContextRefreshIntervalMs() {
    return parseInt(process.env.RICK_CONTEXT_REFRESH_INTERVAL_MS || '60000', 10);
  }

  static get rickContextSourceChatNames() {
    const raw = process.env.RICK_CONTEXT_SOURCE_CHAT_NAMES || 'weRvENum';
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
  }

  static get executionMode() {
    return (process.env.EXECUTION_MODE || 'DRY_RUN').toUpperCase();
  }

  static get sessionDurationMinutes() {
    return parseInt(process.env.SESSION_DURATION_MINUTES || '90', 10);
  }

  static get aiTimeoutMs() {
    return parseInt(process.env.AI_TIMEOUT_MS || '200', 10);
  }

  static get aiFastReviewTimeoutMs() {
    return parseInt(process.env.AI_FAST_REVIEW_TIMEOUT_MS || String(Math.min(this.aiTimeoutMs, 4500)), 10);
  }

  static get aiFastReviewNumPredict() {
    return parseInt(process.env.AI_FAST_REVIEW_NUM_PREDICT || '140', 10);
  }

  static get aiFastRunnerReviewEnabled() {
    return process.env.AI_FAST_RUNNER_REVIEW_ENABLED !== 'false';
  }

  static get aiWarmupTimeoutMs() {
    return parseInt(process.env.AI_WARMUP_TIMEOUT_MS || '30000', 10);
  }

  static get ollamaKeepAlive() {
    return process.env.OLLAMA_KEEP_ALIVE || '30m';
  }

  static get aiTimeoutDefaultsToVeto() {
    return process.env.AI_TIMEOUT_DEFAULTS_TO_VETO !== 'false';
  }

  static get aiRequiredForTrade() {
    if (process.env.AI_REQUIRED_FOR_TRADE !== undefined) {
      return process.env.AI_REQUIRED_FOR_TRADE === 'true';
    }

    return this.executionMode === 'LIVE';
  }

  static get aiTimeoutFallbackEnabled() {
    return process.env.AI_TIMEOUT_FALLBACK_ENABLED !== 'false';
  }

  static get aiTimeoutFallbackPaperOnly() {
    return process.env.AI_TIMEOUT_FALLBACK_PAPER_ONLY !== 'false';
  }

  static get aiTimeoutFallbackMinQualityScore() {
    return parseFloat(
      process.env.AI_TIMEOUT_FALLBACK_MIN_QUALITY_SCORE ||
      String(Math.max(this.minQualityScore + 0.04, 0.48))
    );
  }

  static get aiTimeoutFallbackMinMomentumScore() {
    return parseFloat(
      process.env.AI_TIMEOUT_FALLBACK_MIN_MOMENTUM_SCORE ||
      String(Math.max(this.minPumpMomentumScore + 0.08, 0.78))
    );
  }

  static get maxQuoteAgeMs() {
    return parseInt(process.env.MAX_QUOTE_AGE_MS || '3000', 10);
  }

  static get tokenSignalCooldownMs() {
    return parseInt(process.env.TOKEN_SIGNAL_COOLDOWN_MS || '120000', 10);
  }

  static get quoteFailureQuarantineMs() {
    return parseInt(process.env.QUOTE_FAILURE_QUARANTINE_MS || '600000', 10);
  }

  static get rejectionQuarantineMs() {
    return parseInt(process.env.REJECTION_QUARANTINE_MS || '60000', 10);
  }

  static get tokenPriceCacheTtlMs() {
    return parseInt(process.env.TOKEN_PRICE_CACHE_TTL_MS || '30000', 10);
  }

  static get entryWarmupMs() {
    return parseInt(process.env.ENTRY_WARMUP_MS || '180000', 10);
  }

  static get maxPumpTokenAgeSeconds() {
    return parseInt(process.env.MAX_PUMP_TOKEN_AGE_SECONDS || '1200', 10);
  }

  static get pumpMomentumWindowMs() {
    return parseInt(process.env.PUMP_MOMENTUM_WINDOW_MS || '120000', 10);
  }

  static get minPumpRecentTrades() {
    return parseInt(process.env.MIN_PUMP_RECENT_TRADES || '3', 10);
  }

  static get minPumpBuyRatio() {
    return parseFloat(process.env.MIN_PUMP_BUY_RATIO || '0.55');
  }

  static get maxPumpSellRatio() {
    return parseFloat(process.env.MAX_PUMP_SELL_RATIO || '0.35');
  }

  static get minPumpRecentVolumeSol() {
    return parseFloat(process.env.MIN_PUMP_RECENT_VOLUME_SOL || '0.5');
  }

  static get minPumpTradeVelocityPerMin() {
    return parseFloat(process.env.MIN_PUMP_TRADE_VELOCITY_PER_MIN || '2');
  }

  static get minPumpMomentumScore() {
    return parseFloat(process.env.MIN_PUMP_MOMENTUM_SCORE || '0.7');
  }

  static get pumpMomentumWeight() {
    return parseFloat(process.env.PUMP_MOMENTUM_WEIGHT || '0.35');
  }

  static get badExitCooldownMs() {
    return parseInt(process.env.BAD_EXIT_COOLDOWN_MS || '600000', 10);
  }

  static get weakExitCooldownMs() {
    return parseInt(process.env.WEAK_EXIT_COOLDOWN_MS || '300000', 10);
  }

  static get paperStopLossPercent() {
    return parseFloat(process.env.PAPER_STOP_LOSS_PERCENT || '0.015');
  }

  static get paperTakeProfitPercent() {
    return parseFloat(process.env.PAPER_TAKE_PROFIT_PERCENT || '0.035');
  }

  static get paperTrailingActivationPercent() {
    return parseFloat(process.env.PAPER_TRAILING_ACTIVATION_PERCENT || '0.006');
  }

  static get paperTrailingDrawdownPercent() {
    return parseFloat(
      process.env.PAPER_TRAILING_DRAWDOWN_PERCENT ||
      process.env.PAPER_TRAILING_DISTANCE_PERCENT ||
      '0.008'
    );
  }

  static get paperMinHoldSecondsForProfit() {
    return parseFloat(process.env.PAPER_MIN_HOLD_SECONDS_FOR_PROFIT || '45');
  }

  static get paperRunnerModeEnabled() {
    return process.env.PAPER_RUNNER_MODE_ENABLED !== 'false';
  }

  static get runnerRaydiumShadowEnabled() {
    return process.env.RUNNER_RAYDIUM_SHADOW_ENABLED === 'true';
  }

  static get paperRunnerRequirePumpMigration() {
    return process.env.PAPER_RUNNER_REQUIRE_PUMP_MIGRATION !== 'false';
  }

  static get runnerScalperRequirePumpMigration() {
    return process.env.RUNNER_SCALPER_REQUIRE_PUMP_MIGRATION !== 'false'
      && this.paperRunnerRequirePumpMigration;
  }

  static get paperRunnerMinMigratedLiquidityUsd() {
    return parseFloat(process.env.PAPER_RUNNER_MIN_MIGRATED_LIQUIDITY_USD || '30000');
  }

  static get paperMaxHoldMinutes() {
    return parseFloat(process.env.PAPER_MAX_HOLD_MINUTES || '20');
  }

  static get paperCloseOnSessionEnd() {
    return process.env.PAPER_CLOSE_ON_SESSION_END !== 'false';
  }

  static get liveExitEngineEnabled() {
    return process.env.LIVE_EXIT_ENGINE_ENABLED !== 'false';
  }

  static get maxOpenPaperPositions() {
    return parseInt(process.env.MAX_OPEN_PAPER_POSITIONS || '5', 10);
  }

  static get minLiquidityUsd() {
    return parseFloat(process.env.MIN_LIQUIDITY_USD || '15000');
  }

  static get minQualityScore() {
    return parseFloat(process.env.MIN_QUALITY_SCORE || '0.45');
  }

  static get maxTop10HolderPercent() {
    return parseFloat(process.env.MAX_TOP10_HOLDER_PERCENT || '0.50');
  }

  static get maxDevHoldingPercent() {
    return parseFloat(process.env.MAX_DEV_HOLDING_PERCENT || '0.10');
  }

  static get rejectToken2022() {
    return process.env.REJECT_TOKEN_2022 !== 'false';
  }

  // Profit Taking Configuration
  static get autoProfitTaking() {
    return process.env.AUTO_PROFIT_TAKING === 'true';
  }

  static get profitTakeThreshold() {
    return parseFloat(process.env.PROFIT_TAKE_THRESHOLD || '1.0');
  }

  static get profitTakePercentage() {
    return parseFloat(process.env.PROFIT_TAKE_PERCENTAGE || '0.5');
  }

  static get minProfitTakeAmount() {
    return parseFloat(process.env.MIN_PROFIT_TAKE_AMOUNT || '0.1');
  }

  static get profitTakeIntervalHours() {
    return parseInt(process.env.PROFIT_TAKE_INTERVAL_HOURS || '24');
  }

  static get dynamicThreshold() {
    return process.env.DYNAMIC_THRESHOLD === 'true';
  }

  static get volatilityAdjustment() {
    return parseFloat(process.env.VOLATILITY_ADJUSTMENT || '0.1');
  }

  // AI Agent Configuration
  static get aiModel() {
    return process.env.AI_MODEL || 'ollama';
  }

  static get aiProvider() {
    return this.aiModel.toLowerCase();
  }

  static get aiEnabled() {
    return this.aiProvider === 'ollama';
  }

  static get ollamaHost() {
    return process.env.OLLAMA_HOST || 'http://localhost:11434';
  }

  static get ollamaModel() {
    return process.env.OLLAMA_MODEL || 'llama3.2:3b';
  }

  static get aiFallbackModel() {
    return process.env.AI_FALLBACK_MODEL || 'qwen3.5:4b';
  }

  static get useLocalModel() {
    return process.env.USE_LOCAL_MODEL === 'true';
  }

  static get costOptimization() {
    return process.env.COST_OPTIMIZATION === 'true';
  }

  static get huggingFaceApiKey() {
    return process.env.HUGGINGFACE_API_KEY;
  }

  static get localModelPath() {
    return process.env.LOCAL_MODEL_PATH;
  }

  // Risk Management
  static get maxPositionSizeSol() {
    return parseFloat(process.env.MAX_POSITION_SIZE_SOL || '1.0');
  }

  static get stopLossPercent() {
    return parseFloat(process.env.STOP_LOSS_PERCENT || '0.10');
  }

  static get takeProfitPercent() {
    return parseFloat(process.env.TAKE_PROFIT_PERCENT || '0.20');
  }

  static get maxDailyLossSol() {
    return parseFloat(process.env.MAX_DAILY_LOSS_SOL || '0.5');
  }

  static get hotWalletStartingBalanceSol() {
    return parseFloat(process.env.HOT_WALLET_STARTING_BALANCE_SOL || '5');
  }

  static get coldWalletStartingBalanceSol() {
    return parseFloat(process.env.COLD_WALLET_STARTING_BALANCE_SOL || '0');
  }

  static get autoRebalanceEnabled() {
    return process.env.AUTO_REBALANCE_ENABLED !== 'false';
  }

  static get minColdSweepSol() {
    return parseFloat(process.env.MIN_COLD_SWEEP_SOL || '0.05');
  }

  static get workingCapitalSol() {
    return parseFloat(process.env.WORKING_CAPITAL_SOL || '50');
  }

  static get hotWalletFeeBufferSol() {
    return parseFloat(process.env.HOT_WALLET_FEE_BUFFER_SOL || '0.01');
  }

  static get paperStartingBalanceSol() {
    return parseFloat(process.env.PAPER_STARTING_BALANCE_SOL || String(this.hotWalletStartingBalanceSol || 5));
  }

  static get profitAllocationTiers() {
    return this.parseJsonEnv(process.env.PROFIT_ALLOCATION_TIERS, [
      { maxEquitySol: 10, hotShare: 0.85, coldShare: 0.15 },
      { maxEquitySol: 25, hotShare: 0.7, coldShare: 0.3 },
      { maxEquitySol: 50, hotShare: 0.55, coldShare: 0.45 },
      { maxEquitySol: null, hotShare: 0.4, coldShare: 0.6 }
    ]);
  }

  static get riskSizeTiers() {
    return this.parseJsonEnv(process.env.RISK_SIZE_TIERS, [
      { maxHotEquitySol: 10, riskPercent: 0.12 },
      { maxHotEquitySol: 25, riskPercent: 0.1 },
      { maxHotEquitySol: 50, riskPercent: 0.08 },
      { maxHotEquitySol: null, riskPercent: 0.06 }
    ]);
  }

  // Market Analysis
  static get refreshIntervalMs() {
    return parseInt(process.env.REFRESH_INTERVAL_MS || '5000');
  }

  static get volumeThresholdSol() {
    return parseFloat(process.env.VOLUME_THRESHOLD_SOL || '100');
  }

  static get liquidityThresholdSol() {
    return parseFloat(process.env.LIQUIDITY_THRESHOLD_SOL || '50');
  }

  static get maxSignalsPerCycle() {
    return parseInt(process.env.MAX_SIGNALS_PER_CYCLE || '2', 10);
  }

  static get excludedTokenSymbols() {
    const symbols = process.env.EXCLUDED_TOKEN_SYMBOLS || 'USDC,USDT,USD1,WSOL,SOL';
    return symbols.split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
  }

  static get excludedTokenMints() {
    const mints = process.env.EXCLUDED_TOKEN_MINTS ||
      'So11111111111111111111111111111111111111112,EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v,Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB,USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB';
    return mints.split(',').map((mint) => mint.trim()).filter(Boolean);
  }

  static get solPriceCacheTtlMs() {
    return parseInt(process.env.SOL_PRICE_CACHE_TTL_MS || '30000', 10);
  }

  static get jupiterMinRequestIntervalMs() {
    return parseInt(process.env.JUPITER_MIN_REQUEST_INTERVAL_MS || '500', 10);
  }

  // Copy Trading Configuration
  static get copyTradingEnabled() {
    return process.env.COPY_TRADING_ENABLED === 'true';
  }

  static get copyTradingWallets() {
    const wallets = process.env.COPY_TRADING_WALLETS;
    return wallets ? wallets.split(',').map(w => w.trim()) : [];
  }

  static get copyTradeMaxAmount() {
    return parseFloat(process.env.COPY_TRADE_MAX_AMOUNT || '0.1');
  }

  // Log Configuration
  static get logLevel() {
    return process.env.LOG_LEVEL || 'info';
  }

  static get telemetryEnabled() {
    return process.env.TELEMETRY_ENABLED !== 'false';
  }

  static get telemetryLogDir() {
    return process.env.TELEMETRY_LOG_DIR || path.join(process.cwd(), 'run-logs');
  }

  static get strategyLedgerEnabled() {
    return process.env.STRATEGY_LEDGER_ENABLED !== 'false';
  }

  static get strategyLedgerDir() {
    return process.env.STRATEGY_LEDGER_DIR || this.telemetryLogDir;
  }

  // Advanced Settings
  static get priorityFee() {
    return parseInt(process.env.PRIORITY_FEE || '1000');
  }

  static get maxConcurrentTransactions() {
    return parseInt(process.env.MAX_CONCURRENT_TRANSACTIONS || '3');
  }

  static get transactionTimeoutMs() {
    return parseInt(process.env.TRANSACTION_TIMEOUT_MS || '30000');
  }

  static get debugMode() {
    return process.env.DEBUG_MODE === 'true';
  }

  // Validation
  static validate() {
    const required = [
      'HOT_WALLET_PRIVATE_KEY',
      'COLD_WALLET_ADDRESS'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    // Validate numeric values
    const numericChecks = [
      { key: 'tradingAmountSol', value: this.tradingAmountSol, min: 0.001 },
      { key: 'sessionDurationMinutes', value: this.sessionDurationMinutes, min: 1 },
      { key: 'aiTimeoutMs', value: this.aiTimeoutMs, min: 50 },
      { key: 'aiFastReviewTimeoutMs', value: this.aiFastReviewTimeoutMs, min: 200 },
      { key: 'aiFastReviewNumPredict', value: this.aiFastReviewNumPredict, min: 32, max: 256 },
      { key: 'aiWarmupTimeoutMs', value: this.aiWarmupTimeoutMs, min: 1000 },
      { key: 'aiTimeoutFallbackMinQualityScore', value: this.aiTimeoutFallbackMinQualityScore, min: 0, max: 1 },
      { key: 'aiTimeoutFallbackMinMomentumScore', value: this.aiTimeoutFallbackMinMomentumScore, min: 0, max: 1 },
      { key: 'maxQuoteAgeMs', value: this.maxQuoteAgeMs, min: 100 },
      { key: 'tokenSignalCooldownMs', value: this.tokenSignalCooldownMs, min: 0 },
      { key: 'quoteFailureQuarantineMs', value: this.quoteFailureQuarantineMs, min: 0 },
      { key: 'rejectionQuarantineMs', value: this.rejectionQuarantineMs, min: 0 },
      { key: 'tokenPriceCacheTtlMs', value: this.tokenPriceCacheTtlMs, min: 1000 },
      { key: 'entryWarmupMs', value: this.entryWarmupMs, min: 0 },
      { key: 'maxPumpTokenAgeSeconds', value: this.maxPumpTokenAgeSeconds, min: 0 },
      { key: 'pumpMomentumWindowMs', value: this.pumpMomentumWindowMs, min: 10000 },
      { key: 'minPumpRecentTrades', value: this.minPumpRecentTrades, min: 0 },
      { key: 'minPumpBuyRatio', value: this.minPumpBuyRatio, min: 0, max: 1 },
      { key: 'maxPumpSellRatio', value: this.maxPumpSellRatio, min: 0, max: 1 },
      { key: 'minPumpRecentVolumeSol', value: this.minPumpRecentVolumeSol, min: 0 },
      { key: 'minPumpTradeVelocityPerMin', value: this.minPumpTradeVelocityPerMin, min: 0 },
      { key: 'minPumpMomentumScore', value: this.minPumpMomentumScore, min: 0, max: 1 },
      { key: 'pumpMomentumWeight', value: this.pumpMomentumWeight, min: 0, max: 2 },
      { key: 'badExitCooldownMs', value: this.badExitCooldownMs, min: 0 },
      { key: 'weakExitCooldownMs', value: this.weakExitCooldownMs, min: 0 },
      { key: 'paperStopLossPercent', value: this.paperStopLossPercent, min: 0.001, max: 1 },
      { key: 'paperTakeProfitPercent', value: this.paperTakeProfitPercent, min: 0.001, max: 2 },
      { key: 'paperTrailingActivationPercent', value: this.paperTrailingActivationPercent, min: 0.001, max: 2 },
      { key: 'paperTrailingDrawdownPercent', value: this.paperTrailingDrawdownPercent, min: 0.001, max: 1 },
      { key: 'paperMinHoldSecondsForProfit', value: this.paperMinHoldSecondsForProfit, min: 0 },
      { key: 'paperMaxHoldMinutes', value: this.paperMaxHoldMinutes, min: 1 },
      { key: 'maxOpenPaperPositions', value: this.maxOpenPaperPositions, min: 1 },
      { key: 'minLiquidityUsd', value: this.minLiquidityUsd, min: 0 },
      { key: 'minQualityScore', value: this.minQualityScore, min: 0, max: 1 },
      { key: 'maxTop10HolderPercent', value: this.maxTop10HolderPercent, min: 0, max: 1 },
      { key: 'maxDevHoldingPercent', value: this.maxDevHoldingPercent, min: 0, max: 1 },
      { key: 'birdeyeRateLimitRpm', value: this.birdeyeRateLimitRpm, min: 1 },
      { key: 'birdeyeTargetRpm', value: this.birdeyeTargetRpm, min: 1 },
      { key: 'birdeyeCacheTtlMs', value: this.birdeyeCacheTtlMs, min: 1000 },
      { key: 'birdeyeErrorCacheTtlMs', value: this.birdeyeErrorCacheTtlMs, min: 1000 },
      { key: 'birdeyeMaxTokensPerCycle', value: this.birdeyeMaxTokensPerCycle, min: 1 },
      { key: 'birdeyeRetryBaseDelayMs', value: this.birdeyeRetryBaseDelayMs, min: 100 },
      { key: 'birdeyeMaxRetries', value: this.birdeyeMaxRetries, min: 0, max: 10 },
      { key: 'preMigrationWatchMinScore', value: this.preMigrationWatchMinScore, min: 0, max: 100 },
      { key: 'preMigrationWatchConfirmMinScore', value: this.preMigrationWatchConfirmMinScore, min: 0, max: 100 },
      { key: 'preMigrationWatchInterestMinTradeVelocityPerMin', value: this.preMigrationWatchInterestMinTradeVelocityPerMin, min: 0 },
      { key: 'preMigrationWatchInterestMinRecentVolumeSol', value: this.preMigrationWatchInterestMinRecentVolumeSol, min: 0 },
      { key: 'preMigrationWatchInterestMinCurveProgress', value: this.preMigrationWatchInterestMinCurveProgress, min: 0, max: 1 },
      { key: 'preMigrationWatchInterestMinUniqueBuyerCount', value: this.preMigrationWatchInterestMinUniqueBuyerCount, min: 0 },
      { key: 'preMigrationWatchConfirmMinObservations', value: this.preMigrationWatchConfirmMinObservations, min: 1 },
      { key: 'preMigrationWatchConfirmMinGapMs', value: this.preMigrationWatchConfirmMinGapMs, min: 0 },
      { key: 'preMigrationWatchFastTrackScore', value: this.preMigrationWatchFastTrackScore, min: 0, max: 100 },
      { key: 'preMigrationWatchStrongNoSecondaryScore', value: this.preMigrationWatchStrongNoSecondaryScore, min: 0, max: 100 },
      { key: 'preMigrationWatchMinCurveProgress', value: this.preMigrationWatchMinCurveProgress, min: 0, max: 1 },
      { key: 'preMigrationWatchFlagCooldownMs', value: this.preMigrationWatchFlagCooldownMs, min: 0 },
      { key: 'preMigrationWatchMaxTrackedMints', value: this.preMigrationWatchMaxTrackedMints, min: 1 },
      { key: 'candidateDossierMaxRecent', value: this.candidateDossierMaxRecent, min: 1 },
      { key: 'postMigrationContinuationMinScore', value: this.postMigrationContinuationMinScore, min: 0, max: 100 },
      { key: 'postMigrationContinuationConfirmMinScore', value: this.postMigrationContinuationConfirmMinScore, min: 0, max: 100 },
      { key: 'postMigrationContinuationMinLiquidityUsd', value: this.postMigrationContinuationMinLiquidityUsd, min: 0 },
      { key: 'postMigrationContinuationMinVolumeToLiquidity', value: this.postMigrationContinuationMinVolumeToLiquidity, min: 0 },
      { key: 'postMigrationContinuationMinVolume1hUsd', value: this.postMigrationContinuationMinVolume1hUsd, min: 0 },
      { key: 'postMigrationContinuationMinAgeHours', value: this.postMigrationContinuationMinAgeHours, min: 0 },
      { key: 'postMigrationContinuationMaxAgeHours', value: this.postMigrationContinuationMaxAgeHours, min: 0.01 },
      { key: 'postMigrationContinuationMaxSellTxnRatio', value: this.postMigrationContinuationMaxSellTxnRatio, min: 0, max: 1 },
      { key: 'postMigrationContinuationFlagCooldownMs', value: this.postMigrationContinuationFlagCooldownMs, min: 0 },
      { key: 'postMigrationContinuationMaxTrackedMints', value: this.postMigrationContinuationMaxTrackedMints, min: 1 },
      { key: 'postMigrationContinuationMaxDexScreenerFetchesPerCycle', value: this.postMigrationContinuationMaxDexScreenerFetchesPerCycle, min: 0 },
      { key: 'dexScreenerCacheTtlMs', value: this.dexScreenerCacheTtlMs, min: 1000 },
      { key: 'preMigrationPaperMinScore', value: this.preMigrationPaperMinScore, min: 0, max: 100 },
      { key: 'preMigrationPaperMinCurveProgress', value: this.preMigrationPaperMinCurveProgress, min: 0, max: 1 },
      { key: 'preMigrationPaperMaxCurveProgress', value: this.preMigrationPaperMaxCurveProgress, min: 0, max: 1 },
      { key: 'preMigrationPaperMinRecentVolumeSol', value: this.preMigrationPaperMinRecentVolumeSol, min: 0 },
      { key: 'preMigrationPaperMinTradeVelocityPerMin', value: this.preMigrationPaperMinTradeVelocityPerMin, min: 0 },
      { key: 'preMigrationPaperTakeProfitPct', value: this.preMigrationPaperTakeProfitPct, min: 0.001, max: 5 },
      { key: 'preMigrationPaperStopLossPct', value: this.preMigrationPaperStopLossPct, min: 0.001, max: 1 },
      { key: 'preMigrationPaperMaxHoldSeconds', value: this.preMigrationPaperMaxHoldSeconds, min: 1 },
      { key: 'preMigrationPaperAmountSol', value: this.preMigrationPaperAmountSol, min: 0.001 },
      { key: 'preMigrationPaperMinCurveProgressDelta', value: this.preMigrationPaperMinCurveProgressDelta, min: 0, max: 1 },
      { key: 'preMigrationPaperCurveProgressLookbackMs', value: this.preMigrationPaperCurveProgressLookbackMs, min: 0 },
      { key: 'preMigrationPaperCloneGuardWindowMs', value: this.preMigrationPaperCloneGuardWindowMs, min: 0 },
      { key: 'preMigrationPaperCloneGuardMaxEntriesPerSymbol', value: this.preMigrationPaperCloneGuardMaxEntriesPerSymbol, min: 0 },
      { key: 'preMigrationPaperBadExitCooldownMs', value: this.preMigrationPaperBadExitCooldownMs, min: 0 },
      { key: 'preMigrationPaperMaxObservedStates', value: this.preMigrationPaperMaxObservedStates, min: 1 },
      { key: 'preMigrationPaperRecheckDelayMs', value: this.preMigrationPaperRecheckDelayMs, min: 1000 },
      { key: 'preMigrationPaperRecheckMaxAttempts', value: this.preMigrationPaperRecheckMaxAttempts, min: 0 },
      { key: 'preMigrationPaperRecheckMaxAgeMs', value: this.preMigrationPaperRecheckMaxAgeMs, min: 1000 },
      { key: 'preMigrationPaperRecheckMaxTrackedMints', value: this.preMigrationPaperRecheckMaxTrackedMints, min: 1 },
      { key: 'preMigrationPaperLateFastTrackMinScore', value: this.preMigrationPaperLateFastTrackMinScore, min: 0, max: 100 },
      { key: 'preMigrationPaperLateFastTrackMinCurveProgress', value: this.preMigrationPaperLateFastTrackMinCurveProgress, min: 0, max: 1 },
      { key: 'preMigrationPaperLateFastTrackMinRecentVolumeSol', value: this.preMigrationPaperLateFastTrackMinRecentVolumeSol, min: 0 },
      { key: 'preMigrationPaperLateFastTrackMinTradeVelocityPerMin', value: this.preMigrationPaperLateFastTrackMinTradeVelocityPerMin, min: 0 },
      { key: 'preMigrationPaperFirstSightMinScore', value: this.preMigrationPaperFirstSightMinScore, min: 0, max: 100 },
      { key: 'preMigrationPaperFirstSightMinCurveProgress', value: this.preMigrationPaperFirstSightMinCurveProgress, min: 0, max: 1 },
      { key: 'preMigrationPaperFirstSightMaxCurveProgress', value: this.preMigrationPaperFirstSightMaxCurveProgress, min: 0, max: 1 },
      { key: 'preMigrationPaperFirstSightMinRecentVolumeSol', value: this.preMigrationPaperFirstSightMinRecentVolumeSol, min: 0 },
      { key: 'preMigrationPaperFirstSightMinTradeVelocityPerMin', value: this.preMigrationPaperFirstSightMinTradeVelocityPerMin, min: 0 },
      { key: 'preMigrationPaperFirstSightMinBuyRatio', value: this.preMigrationPaperFirstSightMinBuyRatio, min: 0, max: 1 },
      { key: 'preMigrationPaperFirstCurveSnapshotScalpMinScore', value: this.preMigrationPaperFirstCurveSnapshotScalpMinScore, min: 0, max: 100 },
      { key: 'preMigrationPaperFirstCurveSnapshotScalpMinCurveProgress', value: this.preMigrationPaperFirstCurveSnapshotScalpMinCurveProgress, min: 0, max: 1 },
      { key: 'preMigrationPaperFirstCurveSnapshotScalpMaxCurveProgress', value: this.preMigrationPaperFirstCurveSnapshotScalpMaxCurveProgress, min: 0, max: 1 },
      { key: 'preMigrationPaperFirstCurveSnapshotScalpMinRecentVolumeSol', value: this.preMigrationPaperFirstCurveSnapshotScalpMinRecentVolumeSol, min: 0 },
      { key: 'preMigrationPaperFirstCurveSnapshotScalpMinTradeVelocityPerMin', value: this.preMigrationPaperFirstCurveSnapshotScalpMinTradeVelocityPerMin, min: 0 },
      { key: 'preMigrationPaperFirstCurveSnapshotScalpMinInterestCount', value: this.preMigrationPaperFirstCurveSnapshotScalpMinInterestCount, min: 1 },
      { key: 'preMigrationPaperFirstCurveSnapshotScalpMinUniqueBuyerCount', value: this.preMigrationPaperFirstCurveSnapshotScalpMinUniqueBuyerCount, min: 1 },
      { key: 'preMigrationPaperFirstCurveSnapshotScalpMaxRiskWalletCount', value: this.preMigrationPaperFirstCurveSnapshotScalpMaxRiskWalletCount, min: 0 },
      { key: 'preMigrationPaperFirstCurveSnapshotScalpMinBuyRatio', value: this.preMigrationPaperFirstCurveSnapshotScalpMinBuyRatio, min: 0, max: 1 },
      { key: 'preMigrationPaperEarlySurgeMinScore', value: this.preMigrationPaperEarlySurgeMinScore, min: 0, max: 100 },
      { key: 'preMigrationPaperEarlySurgeMinCurveProgress', value: this.preMigrationPaperEarlySurgeMinCurveProgress, min: 0, max: 1 },
      { key: 'preMigrationPaperEarlySurgeMaxCurveProgress', value: this.preMigrationPaperEarlySurgeMaxCurveProgress, min: 0, max: 1 },
      { key: 'preMigrationPaperEarlySurgeMinRecentVolumeSol', value: this.preMigrationPaperEarlySurgeMinRecentVolumeSol, min: 0 },
      { key: 'preMigrationPaperEarlySurgeMinTradeVelocityPerMin', value: this.preMigrationPaperEarlySurgeMinTradeVelocityPerMin, min: 0 },
      { key: 'preMigrationPaperEarlySurgeMinBuyRatio', value: this.preMigrationPaperEarlySurgeMinBuyRatio, min: 0, max: 1 },
      { key: 'preMigrationPaperEarlySurgeMinCurveProgressDelta', value: this.preMigrationPaperEarlySurgeMinCurveProgressDelta, min: 0, max: 1 },
      { key: 'preMigrationPaperEarlySurgeNoBaselineMinScore', value: this.preMigrationPaperEarlySurgeNoBaselineMinScore, min: 0, max: 100 },
      { key: 'preMigrationPaperCurvePauseMinScore', value: this.preMigrationPaperCurvePauseMinScore, min: 0, max: 100 },
      { key: 'preMigrationPaperCurvePauseMinCurveProgress', value: this.preMigrationPaperCurvePauseMinCurveProgress, min: 0, max: 1 },
      { key: 'preMigrationPaperCurvePauseMinRecentVolumeSol', value: this.preMigrationPaperCurvePauseMinRecentVolumeSol, min: 0 },
      { key: 'preMigrationPaperCurvePauseMinTradeVelocityPerMin', value: this.preMigrationPaperCurvePauseMinTradeVelocityPerMin, min: 0 },
      { key: 'preMigrationPaperCurvePauseMinBuyRatio', value: this.preMigrationPaperCurvePauseMinBuyRatio, min: 0, max: 1 },
      { key: 'preMigrationPaperHighConfidenceRunnerMinScore', value: this.preMigrationPaperHighConfidenceRunnerMinScore, min: 0, max: 100 },
      { key: 'preMigrationPaperHighConfidenceRunnerMinCurveProgress', value: this.preMigrationPaperHighConfidenceRunnerMinCurveProgress, min: 0, max: 1 },
      { key: 'preMigrationPaperHighConfidenceRunnerMinRecentVolumeSol', value: this.preMigrationPaperHighConfidenceRunnerMinRecentVolumeSol, min: 0 },
      { key: 'preMigrationPaperHighConfidenceRunnerMinTradeVelocityPerMin', value: this.preMigrationPaperHighConfidenceRunnerMinTradeVelocityPerMin, min: 0 },
      { key: 'preMigrationPaperHighConfidenceRunnerTakeProfitPct', value: this.preMigrationPaperHighConfidenceRunnerTakeProfitPct, min: 0.001, max: 5 },
      { key: 'preMigrationPaperHighConfidenceRunnerStopLossPct', value: this.preMigrationPaperHighConfidenceRunnerStopLossPct, min: 0.001, max: 1 },
      { key: 'preMigrationPaperHighConfidenceRunnerMaxHoldSeconds', value: this.preMigrationPaperHighConfidenceRunnerMaxHoldSeconds, min: 1 },
      { key: 'preMigrationPaperEarlyAccelerationRunnerMinScore', value: this.preMigrationPaperEarlyAccelerationRunnerMinScore, min: 0, max: 100 },
      { key: 'preMigrationPaperEarlyAccelerationRunnerMinCurveProgress', value: this.preMigrationPaperEarlyAccelerationRunnerMinCurveProgress, min: 0, max: 1 },
      { key: 'preMigrationPaperEarlyAccelerationRunnerMinRecentVolumeSol', value: this.preMigrationPaperEarlyAccelerationRunnerMinRecentVolumeSol, min: 0 },
      { key: 'preMigrationPaperEarlyAccelerationRunnerMinTradeVelocityPerMin', value: this.preMigrationPaperEarlyAccelerationRunnerMinTradeVelocityPerMin, min: 0 },
      { key: 'preMigrationPaperEarlyAccelerationRunnerTakeProfitPct', value: this.preMigrationPaperEarlyAccelerationRunnerTakeProfitPct, min: 0.001, max: 5 },
      { key: 'preMigrationPaperEarlyAccelerationRunnerStopLossPct', value: this.preMigrationPaperEarlyAccelerationRunnerStopLossPct, min: 0.001, max: 1 },
      { key: 'preMigrationPaperEarlyAccelerationRunnerMaxHoldSeconds', value: this.preMigrationPaperEarlyAccelerationRunnerMaxHoldSeconds, min: 1 },
      { key: 'preMigrationPaperHighConvictionFirstSightMinScore', value: this.preMigrationPaperHighConvictionFirstSightMinScore, min: 0, max: 100 },
      { key: 'preMigrationPaperHighConvictionFirstSightMinCurveProgress', value: this.preMigrationPaperHighConvictionFirstSightMinCurveProgress, min: 0, max: 1 },
      { key: 'preMigrationPaperHighConvictionFirstSightMinRecentVolumeSol', value: this.preMigrationPaperHighConvictionFirstSightMinRecentVolumeSol, min: 0 },
      { key: 'preMigrationPaperHighConvictionFirstSightMinTradeVelocityPerMin', value: this.preMigrationPaperHighConvictionFirstSightMinTradeVelocityPerMin, min: 0 },
      { key: 'preMigrationPaperHighConvictionFirstSightMinBuyRatio', value: this.preMigrationPaperHighConvictionFirstSightMinBuyRatio, min: 0, max: 1 },
      { key: 'preMigrationPaperHighConvictionFirstSightTakeProfitPct', value: this.preMigrationPaperHighConvictionFirstSightTakeProfitPct, min: 0.001, max: 5 },
      { key: 'preMigrationPaperHighConvictionFirstSightStopLossPct', value: this.preMigrationPaperHighConvictionFirstSightStopLossPct, min: 0.001, max: 1 },
      { key: 'preMigrationPaperHighConvictionFirstSightMaxHoldSeconds', value: this.preMigrationPaperHighConvictionFirstSightMaxHoldSeconds, min: 1 },
      { key: 'pumpBondingCurveRefreshIntervalMs', value: this.pumpBondingCurveRefreshIntervalMs, min: 1000 },
      { key: 'pumpBondingCurveMaxTrackedMints', value: this.pumpBondingCurveMaxTrackedMints, min: 1 },
      { key: 'pumpBondingCurveMaxFetchesPerCycle', value: this.pumpBondingCurveMaxFetchesPerCycle, min: 1 },
      { key: 'walletIntelRefreshIntervalMs', value: this.walletIntelRefreshIntervalMs, min: 1000 },
      { key: 'walletEventLedgerMaxRecentEvents', value: this.walletEventLedgerMaxRecentEvents, min: 1 },
      { key: 'telegramContextRefreshIntervalMs', value: this.telegramContextRefreshIntervalMs, min: 1000 },
      { key: 'telegramContextWindowHours', value: this.telegramContextWindowHours, min: 1 },
      { key: 'rickContextRefreshIntervalMs', value: this.rickContextRefreshIntervalMs, min: 1000 },
      { key: 'telegramMaxStoredMessages', value: this.telegramMaxStoredMessages, min: 1 },
      { key: 'telegramMaxMessagesPerChat', value: this.telegramMaxMessagesPerChat, min: 1 },
      { key: 'telegramSummaryMaxSnippets', value: this.telegramSummaryMaxSnippets, min: 1 },
      { key: 'telegramBootstrapSightingLimit', value: this.telegramBootstrapSightingLimit, min: 0 },
      { key: 'telegramBootstrapSightingMaxAgeMinutes', value: this.telegramBootstrapSightingMaxAgeMinutes, min: 0 },
      { key: 'capitalBalanceTimeoutMs', value: this.capitalBalanceTimeoutMs, min: 100 },
      { key: 'slippageTolerance', value: this.slippageTolerance, min: 0.1 },
      { key: 'maxPriceImpact', value: this.maxPriceImpact, min: 0.01 },
      { key: 'minColdSweepSol', value: this.minColdSweepSol, min: 0 },
      { key: 'workingCapitalSol', value: this.workingCapitalSol, min: 0 },
      { key: 'hotWalletFeeBufferSol', value: this.hotWalletFeeBufferSol, min: 0 },
      { key: 'paperStartingBalanceSol', value: this.paperStartingBalanceSol, min: 0 },
      { key: 'paperRunnerMinMigratedLiquidityUsd', value: this.paperRunnerMinMigratedLiquidityUsd, min: 0 },
      { key: 'maxPositionSizeSol', value: this.maxPositionSizeSol, min: 0.01 },
      { key: 'stopLossPercent', value: this.stopLossPercent, min: 0.01, max: 1.0 },
      { key: 'takeProfitPercent', value: this.takeProfitPercent, min: 0.01, max: 2.0 },
      { key: 'maxDailyLossSol', value: this.maxDailyLossSol, min: 0.01 },
      { key: 'hotWalletStartingBalanceSol', value: this.hotWalletStartingBalanceSol, min: 0 },
      { key: 'coldWalletStartingBalanceSol', value: this.coldWalletStartingBalanceSol, min: 0 },
      { key: 'refreshIntervalMs', value: this.refreshIntervalMs, min: 1000 },
      { key: 'volumeThresholdSol', value: this.volumeThresholdSol, min: 1 },
      { key: 'liquidityThresholdSol', value: this.liquidityThresholdSol, min: 1 },
      { key: 'maxSignalsPerCycle', value: this.maxSignalsPerCycle, min: 1 },
      { key: 'solPriceCacheTtlMs', value: this.solPriceCacheTtlMs, min: 1000 },
      { key: 'raydiumPoolCacheTtlMs', value: this.raydiumPoolCacheTtlMs, min: 1000 },
      { key: 'raydiumPoolStaleTtlMs', value: this.raydiumPoolStaleTtlMs, min: 1000 },
      { key: 'meteoraPoolCacheTtlMs', value: this.meteoraPoolCacheTtlMs, min: 1000 },
      { key: 'meteoraPoolStaleTtlMs', value: this.meteoraPoolStaleTtlMs, min: 1000 },
      { key: 'jupiterMinRequestIntervalMs', value: this.jupiterMinRequestIntervalMs, min: 0 },
      { key: 'profitTakeThreshold', value: this.profitTakeThreshold, min: 0.1 },
      { key: 'profitTakePercentage', value: this.profitTakePercentage, min: 0.1, max: 1.0 },
      { key: 'minProfitTakeAmount', value: this.minProfitTakeAmount, min: 0.01 },
      { key: 'priorityFee', value: this.priorityFee, min: 100 },
      { key: 'maxConcurrentTransactions', value: this.maxConcurrentTransactions, min: 1, max: 10 },
      { key: 'transactionTimeoutMs', value: this.transactionTimeoutMs, min: 5000 }
    ];

    for (const check of numericChecks) {
      if (check.value < check.min || (check.max && check.value > check.max)) {
        throw new Error(`${check.key} must be between ${check.min} and ${check.max || 'infinity'}, got ${check.value}`);
      }
    }

    // Validate wallet addresses
    if (!this.isValidSolanaAddress(this.coldWalletAddress)) {
      throw new Error('Invalid COLD_WALLET_ADDRESS format');
    }

    if (!['LIVE', 'DRY_RUN', 'PAPER'].includes(this.executionMode)) {
      throw new Error(`Unsupported EXECUTION_MODE: ${this.executionMode}`);
    }

    this.validateProfitAllocationTiers(this.profitAllocationTiers);
    this.validateRiskSizeTiers(this.riskSizeTiers);
  }

  static isValidSolanaAddress(address) {
    try {
      // Basic validation - check if it's a valid base58 string
      const bs58 = require('bs58');
      bs58.decode(address);
      return address.length >= 32 && address.length <= 44;
    } catch {
      return false;
    }
  }

  static parseJsonEnv(value, fallback) {
    if (!value) {
      return fallback;
    }

    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid JSON configuration: ${error.message}`);
    }
  }

  static validateProfitAllocationTiers(tiers) {
    if (!Array.isArray(tiers) || tiers.length === 0) {
      throw new Error('profitAllocationTiers must be a non-empty array');
    }

    for (const tier of tiers) {
      if (typeof tier.hotShare !== 'number' || typeof tier.coldShare !== 'number') {
        throw new Error('Each profit allocation tier must define numeric hotShare and coldShare values');
      }

      const totalShare = tier.hotShare + tier.coldShare;
      if (Math.abs(totalShare - 1) > 0.0001) {
        throw new Error(`Profit allocation tier shares must add up to 1.0, got ${totalShare}`);
      }
    }
  }

  static validateRiskSizeTiers(tiers) {
    if (!Array.isArray(tiers) || tiers.length === 0) {
      throw new Error('riskSizeTiers must be a non-empty array');
    }

    for (const tier of tiers) {
      if (typeof tier.riskPercent !== 'number' || tier.riskPercent <= 0 || tier.riskPercent > 1) {
        throw new Error(`Risk size tier riskPercent must be between 0 and 1, got ${tier.riskPercent}`);
      }
    }
  }
}

module.exports = Config;
