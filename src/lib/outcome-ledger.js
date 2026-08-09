const fs = require('fs');
const path = require('path');
const AsyncJsonlWriter = require('./async-jsonl-writer');

class OutcomeLedger {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.enabled = config.outcomeLedgerEnabled !== false;
    this.filePath = config.outcomeLedgerFilePath;
    this.maxRecent = Number(config.outcomeLedgerMaxRecent || 25);
    this.recent = [];
    this.stats = {
      enabled: this.enabled,
      filePath: this.filePath,
      totalEvents: 0,
      eventCounts: {},
      sourceCounts: {}
    };

    if (this.enabled && this.filePath) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      this.writer = new AsyncJsonlWriter(this.filePath, this.logger);
    }
  }

  /**
   * Record a candidate observation, flag, or early rejection.
   *
   * This intentionally keeps the existing event shape while adding richer
   * rejection context for NO_PRIOR_CURVE_PROGRESS and nearby early guard
   * failures. The report layer already expects reason/market/raw fields, so
   * avoid moving those values to new top-level-only names.
   */
  recordCandidate(state = {}, meta = {}) {
    const mint = state.mint || meta.mint || meta.mintAddress;
    if (!mint) {
      return null;
    }

    const reason = meta.reason || meta.rejectionReason || meta.flagType || state.confirmationReason || null;
    const normalizedReason = String(reason || '').toUpperCase();
    const isNoPriorCurveRejection = normalizedReason.includes('NO_PRIOR_CURVE');
    const isRejected = meta.rejected === true || meta.kind === 'candidate.rejected' || isNoPriorCurveRejection;
    const kind = meta.kind || (isRejected ? 'candidate.rejected' : meta.flagged ? 'candidate.flagged' : 'candidate.observed');

    return this.record({
      kind,
      source: meta.source || 'pre_migration_watch',
      stage: meta.stage || 'pre_migration',
      sessionId: meta.sessionId || null,
      mint,
      symbol: state.symbol || meta.symbol || null,
      name: state.name || meta.name || null,
      decision: isRejected ? 'CANDIDATE_REJECTED' : meta.flagged ? 'WATCH_FLAGGED' : 'WATCH_OBSERVED',
      reason,
      reasons: Array.isArray(state.reasons) ? state.reasons.slice(0, 12) : Array.isArray(meta.reasons) ? meta.reasons.slice(0, 12) : [],
      score: state.score ?? meta.score,
      curveProgress: state.curveProgress ?? meta.curveProgress ?? null,
      priceSol: state.bondingCurvePriceSol ?? state.priceSol ?? meta.priceSol ?? null,
      market: {
        recentVolumeSol: state.recentVolumeSol ?? meta.recentVolumeSol,
        tradeVelocityPerMin: state.tradeVelocityPerMin ?? state.tradeVelocity ?? meta.tradeVelocityPerMin ?? meta.tradeVelocity,
        recentTradeCount: state.recentTradeCount ?? meta.recentTradeCount,
        uniqueBuyerCount: state.uniqueBuyerCount ?? state.buyerCount ?? meta.uniqueBuyerCount ?? meta.buyerCount,
        buyRatio: state.buyRatio ?? meta.buyRatio ?? this.buyRatio(state),
        bondingCurveComplete: state.bondingCurveComplete,
        bondingStage: state.bondingStage,
        migratedAt: state.migratedAt || null
      },
      rejection: isRejected ? {
        reason,
        detail: meta.detail || null,
        isNoPriorCurveRejection,
        firstSighting: Boolean(meta.firstSighting),
        recheck: Boolean(meta.recheck),
        confirmedWatch: Boolean(state.confirmed || meta.confirmedWatch),
        currentCurveSnapshotAvailable: Boolean(meta.currentCurveSnapshotAvailable),
        lastCurveSnapshotAt: meta.lastCurveSnapshotAt || null
      } : null,
      social: {
        externalMentionCount: state.externalMentionCount,
        externalChatCount: state.externalChatCount,
        rickMentionCount: state.rickMentionCount
      },
      wallet: {
        earlySniperCount: state.earlySniperCount,
        alphaScalperCount: state.alphaScalperCount,
        convictionWhaleCount: state.convictionWhaleCount,
        riskWalletCount: state.riskWalletCount,
        lateChaserCount: state.lateChaserCount
      },
      links: {
        pumpFunUrl: `https://pump.fun/coin/${mint}`
      },
      followup: isRejected ? {
        done: false
      } : null,
      raw: {
        observedSignal: Boolean(meta.observedSignal),
        observedInterest: Boolean(meta.observedInterest),
        confirmed: Boolean(state.confirmed),
        newlyConfirmed: Boolean(meta.newlyConfirmed),
        rejected: isRejected,
        rejectionDetail: meta.detail || null
      }
    });
  }

  recordPaperEvent(event = {}, state = {}, meta = {}) {
    const payload = event.payload || {};
    const mint = payload.mint || state.mint;
    if (!mint) {
      return null;
    }

    const kind = this.paperKind(event);
    const reason = payload.reason || null;
    const curveProgress = payload.curveProgress ?? state.curveProgress;
    const score = payload.score ?? state.score;
    const symbol = payload.symbol || state.symbol || null;

    if (kind === 'paper.skipped' && this.isEarlyCandidateRejectionReason(reason)) {
      this.recordCandidate({
        ...state,
        mint,
        symbol,
        score,
        curveProgress,
        recentVolumeSol: payload.recentVolumeSol ?? state.recentVolumeSol,
        tradeVelocityPerMin: payload.tradeVelocityPerMin ?? state.tradeVelocityPerMin,
        uniqueBuyerCount: payload.uniqueBuyerCount ?? state.uniqueBuyerCount,
        buyRatio: payload.buyRatio ?? state.buyRatio,
        bondingCurvePriceSol: payload.priceSol ?? state.bondingCurvePriceSol,
        priceSol: payload.priceSol ?? state.priceSol
      }, {
        ...meta,
        kind: 'candidate.rejected',
        source: 'pre_migration_paper',
        stage: 'pre_migration',
        rejected: true,
        reason,
        detail: {
          decision: payload.decision || event.type || null,
          preset: payload.preset || null,
          lane: payload.lane || null,
          profileName: payload.profileName || null,
          guardOverride: payload.guardOverride || null,
          failedChecks: Array.isArray(payload.failedChecks) ? payload.failedChecks : [],
          value: payload.value ?? null,
          threshold: payload.threshold ?? null,
          curveProgressDelta: payload.curveProgressDelta ?? null,
          curveProgressDelta60s: payload.curveProgressDelta60s ?? null,
          baselineCurveProgress: payload.baselineCurveProgress ?? null,
          baselineAt: payload.baselineAt ?? null,
          baselineCurveProgress60s: payload.baselineCurveProgress60s ?? null,
          baselineAt60s: payload.baselineAt60s ?? null
        },
        firstSighting: reason === 'NO_PRIOR_CURVE_PROGRESS',
        recheck: Boolean(payload.recheck || meta.recheck),
        confirmedWatch: Boolean(state.confirmed || meta.confirmedWatch),
        currentCurveSnapshotAvailable: Number.isFinite(Number(curveProgress)),
        lastCurveSnapshotAt: payload.baselineAt || payload.baselineAt60s || meta.lastCurveSnapshotAt || null
      });
    }

    return this.record({
      kind,
      source: 'pre_migration_paper',
      stage: 'pre_migration',
      sessionId: meta.sessionId || null,
      mint,
      symbol,
      name: state.name || null,
      decision: payload.decision || event.type || null,
      reason,
      reasons: Array.isArray(payload.reasons) ? payload.reasons : Array.isArray(state.reasons) ? state.reasons.slice(0, 12) : [],
      score,
      curveProgress,
      priceSol: payload.priceSol ?? payload.entryPriceSol ?? payload.exitPriceSol ?? state.bondingCurvePriceSol ?? null,
      market: {
        recentVolumeSol: payload.recentVolumeSol ?? state.recentVolumeSol,
        tradeVelocityPerMin: payload.tradeVelocityPerMin ?? state.tradeVelocityPerMin,
        uniqueBuyerCount: payload.uniqueBuyerCount ?? state.uniqueBuyerCount,
        buyRatio: payload.buyRatio ?? this.buyRatio(state),
        maxCurveProgress: payload.maxCurveProgress
      },
      paper: {
        preset: payload.preset || null,
        lane: payload.lane || null,
        profileName: payload.profileName || null,
        guardOverride: payload.guardOverride || null,
        amountSol: payload.amountSol ?? null,
        entryPriceSol: payload.entryPriceSol ?? null,
        exitPriceSol: payload.exitPriceSol ?? null,
        returnPct: payload.returnPct ?? null,
        pnlSol: payload.pnlSol ?? null,
        holdSeconds: payload.holdSeconds ?? null,
        peakReturnPct: payload.peakReturnPct ?? null,
        failedChecks: Array.isArray(payload.failedChecks) ? payload.failedChecks : []
      }
    });
  }

  recordContinuationState(state = {}, meta = {}) {
    if (!state?.mint) {
      return null;
    }

    return this.record({
      kind: meta.eventType || state.lastEventType || 'continuation.observed',
      source: 'post_migration_continuation',
      stage: 'post_migration',
      sessionId: meta.sessionId || null,
      mint: state.mint,
      symbol: state.symbol || null,
      name: state.name || null,
      decision: state.confirmed ? 'CONTINUATION_CONFIRMED' : state.rejectReason ? 'CONTINUATION_REJECTED' : 'CONTINUATION_WATCH',
      reason: state.rejectReason || state.confirmationReason || null,
      reasons: Array.isArray(state.reasons) ? state.reasons.slice(0, 12) : [],
      score: state.score,
      curveProgress: state.curveProgress ?? null,
      priceSol: state.priceNative ?? null,
      market: {
        liquidityUsd: state.liquidityUsd,
        volumeM5Usd: state.volumeM5Usd,
        volume1hUsd: state.volume1hUsd,
        volume6hUsd: state.volume6hUsd,
        volume24hUsd: state.volume24hUsd,
        volumeToLiquidity24h: state.volumeToLiquidity24h,
        priceChangeM5Pct: state.priceChangeM5Pct,
        priceChange1hPct: state.priceChange1hPct,
        priceChange6hPct: state.priceChange6hPct,
        priceChange24hPct: state.priceChange24hPct,
        pairCount: state.pairCount,
        dexCount: state.dexCount,
        primaryDexId: state.primaryDexId,
        ageHours: state.ageHours
      },
      links: {
        dexscreenerUrl: state.dexscreenerUrl || null,
        twitterUrl: state.twitterUrl || null,
        telegramUrl: state.telegramUrl || null,
        websiteUrl: state.websiteUrl || null
      }
    });
  }

  recordTradeRejection(signal = {}, reason, meta = {}) {
    const mint = signal.token || signal.mint || signal.mintAddress;
    if (!mint) {
      return null;
    }

    return this.record({
      kind: 'trade.rejected',
      source: signal.tokenInfo?.source || signal.source || 'trading_engine',
      stage: meta.stage || 'entry_filter',
      sessionId: meta.sessionId || null,
      mint,
      symbol: signal.tokenInfo?.symbol || signal.symbol || null,
      name: signal.tokenInfo?.name || null,
      decision: 'TRADE_REJECTED',
      reason,
      score: signal.qualityScore ?? signal.score ?? null,
      curveProgress: signal.tokenInfo?.curveProgress ?? signal.tokenInfo?.bondingCurveProgress ?? null,
      market: {
        liquiditySol: signal.tokenInfo?.liquidity ?? signal.tokenInfo?.liquiditySol ?? null,
        liquidityUsd: signal.tokenInfo?.liquidityUsd ?? null,
        volume24h: signal.tokenInfo?.volume24h ?? null,
        marketCap: signal.tokenInfo?.marketCap ?? null
      },
      trade: {
        signalId: signal.id || null,
        qualityScore: signal.qualityScore ?? null,
        qualityFactors: signal.qualityFactors || null,
        momentumScore: signal.momentumScore ?? null,
        momentumFactors: signal.momentumFactors || null
      }
    });
  }

  recordMigration(mint, state = {}, event = {}, meta = {}) {
    if (!mint) {
      return null;
    }

    return this.record({
      kind: 'candidate.migrated',
      source: meta.source || event.source || 'pumpportal_migration',
      stage: 'migration',
      sessionId: meta.sessionId || null,
      mint,
      symbol: state.symbol || event.symbol || null,
      name: state.name || event.name || null,
      decision: 'MIGRATED',
      reason: event.signature || event.txSignature || event.sig || null,
      score: state.score ?? null,
      curveProgress: state.curveProgress ?? 1,
      market: {
        bondingCurveComplete: true,
        migratedAt: state.migratedAt || new Date().toISOString()
      },
      links: {
        pumpFunUrl: `https://pump.fun/coin/${mint}`
      }
    });
  }

  isEarlyCandidateRejectionReason(reason) {
    const normalized = String(reason || '').toUpperCase();
    return normalized.includes('NO_PRIOR_CURVE')
      || normalized === 'MISSING_CURVE_PROGRESS'
      || normalized === 'CURVE_NOT_ADVANCING';
  }

  paperKind(event = {}) {
    if (event.telemetryType === 'pre_migration_paper.first_curve_snapshot_near_miss') {
      return 'paper.near_miss';
    }

    const decision = event.payload?.decision || event.type || 'event';
    if (decision === 'PAPER_ENTERED') return 'paper.entry';
    if (decision === 'PAPER_EXITED') return 'paper.exit';
    if (decision === 'PAPER_ELIGIBLE') return 'paper.eligible';
    if (decision === 'PAPER_SKIPPED') return 'paper.skipped';
    return `paper.${String(decision).toLowerCase()}`;
  }

  record(payload = {}) {
    if (!this.enabled || !payload.mint) {
      return null;
    }

    const event = this.pruneNullish({
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      ...payload
    });

    this.stats.totalEvents += 1;
    this.increment(this.stats.eventCounts, event.kind);
    this.increment(this.stats.sourceCounts, event.source);
    this.recent.push({
      timestamp: event.timestamp,
      kind: event.kind,
      mint: event.mint,
      symbol: event.symbol || null,
      decision: event.decision || null,
      reason: event.reason || null,
      score: this.numberOrNull(event.score, 2),
      curveProgress: this.numberOrNull(event.curveProgress, 6)
    });
    if (this.recent.length > this.maxRecent) {
      this.recent = this.recent.slice(-this.maxRecent);
    }

    this.writer?.append(event, 'outcome ledger event');

    return event;
  }

  async flushAsync() {
    await this.writer?.flush?.();
  }

  getStats() {
    return {
      ...this.stats,
      recent: this.recent.slice(-Math.min(this.maxRecent, 10))
    };
  }

  increment(bucket, key) {
    if (!key) return;
    bucket[key] = (bucket[key] || 0) + 1;
  }

  buyRatio(state = {}) {
    const buys = Number(state.recentBuys || 0);
    const sells = Number(state.recentSells || 0);
    const total = buys + sells;
    return total > 0 ? this.numberOrNull(buys / total, 4) : null;
  }

  numberOrNull(value, decimals = 4) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
  }

  pruneNullish(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null && item !== undefined)
        .map(([key, item]) => [key, this.pruneNullish(item)])
    );
  }
}

module.exports = OutcomeLedger;
