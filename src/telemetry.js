const fs = require('fs');
const path = require('path');

class Telemetry {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.enabled = config.telemetryEnabled;
    this.events = [];
    this.counts = new Map();
    this.rejectionCounts = new Map();
    this.providerErrors = new Map();
    this.paperExitCounts = new Map();
    this.liveExitCounts = new Map();
    this.strategyEntries = new Map();
    this.strategyExits = new Map();
    this.strategyPnl = new Map();
    this.pumpFailureCounts = new Map();
    this.preMigrationPaperDecisionCounts = new Map();
    this.preMigrationPaperSkipReasonCounts = new Map();
    this.momentumBucketsByReason = new Map();
    this.pumpMomentumBucketsByFailureReason = new Map();
    this.filePath = null;

    if (this.enabled) {
      const logDir = config.telemetryLogDir;
      fs.mkdirSync(logDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      this.filePath = path.join(logDir, `telemetry-${stamp}.jsonl`);
    }
  }

  record(type, payload = {}) {
    const event = {
      type,
      timestamp: new Date().toISOString(),
      payload
    };

    this.events.push(event);
    this.counts.set(type, (this.counts.get(type) || 0) + 1);

    if (type === 'trade.rejected' && payload.reason) {
      this.rejectionCounts.set(payload.reason, (this.rejectionCounts.get(payload.reason) || 0) + 1);

      if (payload.momentumScore !== undefined && payload.momentumScore !== null) {
        const bucket = this.getMomentumBucket(payload.momentumScore);
        if (!this.momentumBucketsByReason.has(payload.reason)) {
          this.momentumBucketsByReason.set(payload.reason, new Map());
        }

        const reasonBuckets = this.momentumBucketsByReason.get(payload.reason);
        reasonBuckets.set(bucket, (reasonBuckets.get(bucket) || 0) + 1);
      }
    }

    if (type === 'provider.error' && payload.provider) {
      this.providerErrors.set(payload.provider, (this.providerErrors.get(payload.provider) || 0) + 1);
    }

    if (type === 'pump.momentum_gate_failed' && payload.reason) {
      this.pumpFailureCounts.set(payload.reason, (this.pumpFailureCounts.get(payload.reason) || 0) + 1);

      if (payload.momentumScore !== undefined && payload.momentumScore !== null) {
        const bucket = this.getMomentumBucket(payload.momentumScore);
        if (!this.pumpMomentumBucketsByFailureReason.has(payload.reason)) {
          this.pumpMomentumBucketsByFailureReason.set(payload.reason, new Map());
        }

        const reasonBuckets = this.pumpMomentumBucketsByFailureReason.get(payload.reason);
        reasonBuckets.set(bucket, (reasonBuckets.get(bucket) || 0) + 1);
      }
    }

    if (type === 'paper.position.closed' && payload.reason) {
      this.paperExitCounts.set(payload.reason, (this.paperExitCounts.get(payload.reason) || 0) + 1);
    }

    if (type === 'live.position.closed' && payload.reason) {
      this.liveExitCounts.set(payload.reason, (this.liveExitCounts.get(payload.reason) || 0) + 1);
    }

    if (type === 'pre_migration_paper.decision' && payload.decision) {
      this.preMigrationPaperDecisionCounts.set(
        payload.decision,
        (this.preMigrationPaperDecisionCounts.get(payload.decision) || 0) + 1
      );

      if (payload.reason) {
        this.preMigrationPaperSkipReasonCounts.set(
          payload.reason,
          (this.preMigrationPaperSkipReasonCounts.get(payload.reason) || 0) + 1
        );
      }
    }

    if (type === 'trade.executed' && payload.aiPrimaryStrategy) {
      this.strategyEntries.set(
        payload.aiPrimaryStrategy,
        (this.strategyEntries.get(payload.aiPrimaryStrategy) || 0) + 1
      );
    }

    if ((type === 'paper.position.closed' || type === 'live.position.closed') && payload.aiPrimaryStrategy) {
      this.strategyExits.set(
        payload.aiPrimaryStrategy,
        (this.strategyExits.get(payload.aiPrimaryStrategy) || 0) + 1
      );
      this.strategyPnl.set(
        payload.aiPrimaryStrategy,
        (this.strategyPnl.get(payload.aiPrimaryStrategy) || 0) + Number(payload.realizedPnLSol || 0)
      );
    }

    if (this.enabled && this.filePath) {
      try {
        fs.appendFileSync(this.filePath, `${JSON.stringify(event)}\n`);
      } catch (error) {
        this.logger.warn('Failed to write telemetry event', error.message);
      }
    }

    return event;
  }

  getSummary() {
    return {
      enabled: this.enabled,
      filePath: this.filePath,
      totalEvents: this.events.length,
      counts: Object.fromEntries(this.counts),
      rejectionCounts: Object.fromEntries(this.rejectionCounts),
      providerErrors: Object.fromEntries(this.providerErrors),
      paperExitCounts: Object.fromEntries(this.paperExitCounts),
      liveExitCounts: Object.fromEntries(this.liveExitCounts),
      pumpFailureCounts: Object.fromEntries(this.pumpFailureCounts),
      preMigrationPaperDecisionCounts: Object.fromEntries(this.preMigrationPaperDecisionCounts),
      preMigrationPaperSkipReasonCounts: Object.fromEntries(this.preMigrationPaperSkipReasonCounts),
      strategyEntries: Object.fromEntries(this.strategyEntries),
      strategyExits: Object.fromEntries(this.strategyExits),
      momentumBucketsByReason: Object.fromEntries(
        Array.from(this.momentumBucketsByReason.entries()).map(([reason, buckets]) => [
          reason,
          Object.fromEntries(buckets)
        ])
      ),
      pumpMomentumBucketsByFailureReason: Object.fromEntries(
        Array.from(this.pumpMomentumBucketsByFailureReason.entries()).map(([reason, buckets]) => [
          reason,
          Object.fromEntries(buckets)
        ])
      ),
      strategyPnl: Object.fromEntries(
        Array.from(this.strategyPnl.entries()).map(([strategy, pnl]) => [
          strategy,
          Number(pnl.toFixed(8))
        ])
      )
    };
  }

  getMomentumBucket(score) {
    const normalized = Number(score || 0);
    if (normalized < 0.2) return '0.0-0.2';
    if (normalized < 0.4) return '0.2-0.4';
    if (normalized < 0.6) return '0.4-0.6';
    if (normalized < 0.7) return '0.6-0.7';
    return '0.7+';
  }
}

module.exports = Telemetry;
