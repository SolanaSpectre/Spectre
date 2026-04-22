const fs = require('fs');
const path = require('path');

class StrategyLedger {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.enabled = config.strategyLedgerEnabled !== false;
    this.filePath = null;
    this.events = [];
    this.summary = {
      totalEntries: 0,
      totalExits: 0,
      totalRealizedPnlSol: 0,
      totalSessions: 0,
      strategies: {}
    };

    if (this.enabled) {
      const logDir = config.strategyLedgerDir || config.telemetryLogDir;
      fs.mkdirSync(logDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      this.filePath = path.join(logDir, `strategy-ledger-${stamp}.jsonl`);
    }
  }

  record(type, payload = {}) {
    const event = {
      type,
      timestamp: new Date().toISOString(),
      payload
    };

    this.events.push(event);
    this.applyToSummary(event);

    if (this.enabled && this.filePath) {
      try {
        fs.appendFileSync(this.filePath, `${JSON.stringify(event)}\n`);
      } catch (error) {
        this.logger.warn('Failed to write strategy ledger event', error.message);
      }
    }

    return event;
  }

  applyToSummary(event) {
    if (event.type === 'session.started') {
      this.summary.totalSessions += 1;
      return;
    }

    if (event.type === 'trade.entry') {
      this.summary.totalEntries += 1;
      const bucket = this.ensureStrategyBucket(event.payload.strategy);
      bucket.entries += 1;
      return;
    }

    if (event.type === 'trade.exit') {
      this.summary.totalExits += 1;
      const realizedPnlSol = Number(event.payload.realizedPnlSol || 0);
      this.summary.totalRealizedPnlSol += realizedPnlSol;

      const bucket = this.ensureStrategyBucket(event.payload.strategy);
      bucket.exits += 1;
      bucket.realizedPnlSol += realizedPnlSol;

      if (realizedPnlSol > 0) {
        bucket.wins += 1;
      } else if (realizedPnlSol < 0) {
        bucket.losses += 1;
      } else {
        bucket.flats += 1;
      }

      if (event.payload.exitReason) {
        bucket.exitReasons[event.payload.exitReason] = (bucket.exitReasons[event.payload.exitReason] || 0) + 1;
      }
    }
  }

  ensureStrategyBucket(strategy = 'UNKNOWN') {
    if (!this.summary.strategies[strategy]) {
      this.summary.strategies[strategy] = {
        entries: 0,
        exits: 0,
        wins: 0,
        losses: 0,
        flats: 0,
        realizedPnlSol: 0,
        exitReasons: {}
      };
    }

    return this.summary.strategies[strategy];
  }

  getSummary() {
    const strategies = Object.fromEntries(
      Object.entries(this.summary.strategies).map(([strategy, bucket]) => {
        const decidedExits = bucket.wins + bucket.losses;
        const winRate = decidedExits > 0 ? bucket.wins / decidedExits : 0;
        return [
          strategy,
          {
            ...bucket,
            realizedPnlSol: Number(bucket.realizedPnlSol.toFixed(8)),
            winRate: Number(winRate.toFixed(4))
          }
        ];
      })
    );

    return {
      enabled: this.enabled,
      filePath: this.filePath,
      totalEvents: this.events.length,
      totalEntries: this.summary.totalEntries,
      totalExits: this.summary.totalExits,
      totalSessions: this.summary.totalSessions,
      totalRealizedPnlSol: Number(this.summary.totalRealizedPnlSol.toFixed(8)),
      strategies
    };
  }

  static readEvents(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  static summarizeEvents(events = []) {
    const ledger = {
      summary: {
        totalEntries: 0,
        totalExits: 0,
        totalRealizedPnlSol: 0,
        totalSessions: 0,
        strategies: {}
      },
      ensureStrategyBucket(strategy = 'UNKNOWN') {
        if (!this.summary.strategies[strategy]) {
          this.summary.strategies[strategy] = {
            entries: 0,
            exits: 0,
            wins: 0,
            losses: 0,
            flats: 0,
            realizedPnlSol: 0,
            exitReasons: {}
          };
        }
        return this.summary.strategies[strategy];
      },
      applyToSummary(event) {
        if (event.type === 'session.started') {
          this.summary.totalSessions += 1;
          return;
        }

        if (event.type === 'trade.entry') {
          this.summary.totalEntries += 1;
          this.ensureStrategyBucket(event.payload.strategy).entries += 1;
          return;
        }

        if (event.type === 'trade.exit') {
          this.summary.totalExits += 1;
          const pnl = Number(event.payload.realizedPnlSol || 0);
          this.summary.totalRealizedPnlSol += pnl;
          const bucket = this.ensureStrategyBucket(event.payload.strategy);
          bucket.exits += 1;
          bucket.realizedPnlSol += pnl;
          if (pnl > 0) bucket.wins += 1;
          else if (pnl < 0) bucket.losses += 1;
          else bucket.flats += 1;
          if (event.payload.exitReason) {
            bucket.exitReasons[event.payload.exitReason] = (bucket.exitReasons[event.payload.exitReason] || 0) + 1;
          }
        }
      }
    };

    events.forEach((event) => ledger.applyToSummary(event));

    const strategies = Object.fromEntries(
      Object.entries(ledger.summary.strategies).map(([strategy, bucket]) => {
        const decidedExits = bucket.wins + bucket.losses;
        const winRate = decidedExits > 0 ? bucket.wins / decidedExits : 0;
        return [
          strategy,
          {
            ...bucket,
            realizedPnlSol: Number(bucket.realizedPnlSol.toFixed(8)),
            winRate: Number(winRate.toFixed(4))
          }
        ];
      })
    );

    return {
      totalEntries: ledger.summary.totalEntries,
      totalExits: ledger.summary.totalExits,
      totalSessions: ledger.summary.totalSessions,
      totalRealizedPnlSol: Number(ledger.summary.totalRealizedPnlSol.toFixed(8)),
      strategies
    };
  }
}

module.exports = StrategyLedger;
