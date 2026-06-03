const fs = require('fs');
const path = require('path');

class Telemetry {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.enabled = config.telemetryEnabled;
    this.events = [];
    this.maxRecentEvents = Math.max(0, Number(process.env.TELEMETRY_MAX_RECENT_EVENTS || 5000));
    this.totalEventsRecorded = 0;
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
    this.writeBuffer = [];
    this.flushTimer = null;
    this.flushIntervalMs = 250;
    this.flushMaxEvents = 100;
    this.writeInFlight = false;
    this.flushPending = false;
    this.writePromise = Promise.resolve();

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

    this.totalEventsRecorded += 1;
    if (this.maxRecentEvents !== 0) {
      this.events.push(event);
      if (this.events.length > this.maxRecentEvents) {
        this.events.splice(0, this.events.length - this.maxRecentEvents);
      }
    }
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

    this.enqueueWrite(event);

    return event;
  }

  enqueueWrite(event) {
    if (!this.enabled || !this.filePath) return;

    this.writeBuffer.push(`${JSON.stringify(event)}\n`);
    if (this.writeBuffer.length >= this.flushMaxEvents) {
      this.flush();
      return;
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, this.flushIntervalMs);
      if (typeof this.flushTimer.unref === 'function') {
        this.flushTimer.unref();
      }
    }
  }

  flush() {
    if (!this.enabled || !this.filePath || !this.writeBuffer.length) return;
    if (this.writeInFlight) {
      this.flushPending = true;
      return;
    }

    const chunk = this.writeBuffer.join('');
    this.writeBuffer = [];
    this.writeInFlight = true;
    this.writePromise = fs.promises.appendFile(this.filePath, chunk)
      .catch((error) => {
        this.logger.warn('Failed to write telemetry events', error.message);
      })
      .finally(() => {
        this.writeInFlight = false;
        if (this.flushPending || this.writeBuffer.length > 0) {
          this.flushPending = false;
          this.flush();
        }
      });
  }

  async flushAsync() {
    if (!this.enabled || !this.filePath) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
    await this.writePromise;
    if (this.writeBuffer.length > 0 || this.writeInFlight) {
      await this.flushAsync();
    }
  }

  getSummary() {
    this.flush();
    return {
      enabled: this.enabled,
      filePath: this.filePath,
      totalEvents: this.totalEventsRecorded,
      recentEventsRetained: this.events.length,
      maxRecentEvents: this.maxRecentEvents,
      bufferedEvents: this.writeBuffer.length,
      writeInFlight: this.writeInFlight,
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
