const { VersionedTransaction } = require('@solana/web3.js');
const SimulatedTrade = require('../models/SimulatedTrade');

class ExecutionModeManager {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.mode = config.executionMode;
  }

  isLive() {
    return this.mode === 'LIVE';
  }

  isDryRun() {
    return this.mode === 'DRY_RUN';
  }

  isPaper() {
    return this.mode === 'PAPER';
  }

  async executeTrade({ signal, quote, connection, marketData, wallet, liveExecutor, paperExecutor }) {
    if (this.isDryRun()) {
      return this.executeDryRun({ signal, quote, connection, marketData });
    }

    if (this.isPaper()) {
      return paperExecutor({ signal, quote });
    }

    return liveExecutor({ signal, quote, wallet });
  }

  async executeDryRun({ signal, quote, connection, marketData }) {
    const record = new SimulatedTrade({
      mode: 'DRY_RUN',
      signalId: signal.id,
      mint: signal.token,
      quotePrice: quote.quotedOutAmountSol ?? signal.amount,
      quoteTimestamp: quote._fetchTimestamp,
      simulatedSuccess: false,
      timestamp: Date.now()
    });

    try {
      if (!quote.transaction) {
        throw new Error('Quote did not include a transaction for simulation');
      }

      const transaction = VersionedTransaction.deserialize(
        Buffer.from(quote.transaction, 'base64')
      );

      const simulation = await connection.simulateTransaction(transaction, {
        sigVerify: false,
        replaceRecentBlockhash: true
      });

      record.simulatedSuccess = !simulation.value.err;
      record.wouldHaveFailed = Boolean(simulation.value.err);
      record.simulationError = simulation.value.err ? JSON.stringify(simulation.value.err) : null;
      SimulatedTrade.store(record);

      if (simulation.value.err) {
        return {
          success: false,
          mode: 'DRY_RUN',
          reason: 'SIMULATION_FAILED',
          simulation: simulation.value
        };
      }

      return {
        success: true,
        mode: 'DRY_RUN',
        simulated: true,
        simulation: simulation.value
      };
    } catch (error) {
      record.simulatedSuccess = false;
      record.wouldHaveFailed = true;
      record.simulationError = error.message;
      SimulatedTrade.store(record);

      this.logger.warn('Dry-run simulation failed', error.message);
      return {
        success: false,
        mode: 'DRY_RUN',
        reason: error.message
      };
    }
  }
}

module.exports = ExecutionModeManager;
