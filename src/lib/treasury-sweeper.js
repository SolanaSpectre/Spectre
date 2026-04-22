const SweepLog = require('../models/SweepLog');

class TreasurySweeper {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.lastSweepAt = null;
    this.cooldownMs = 60 * 60 * 1000;
  }

  async checkAndSweep(connection, walletManager, hotBalanceSol) {
    if (!this.config.autoRebalanceEnabled || this.config.executionMode !== 'LIVE') {
      return { swept: false, reason: 'DISABLED' };
    }

    if (this.lastSweepAt && Date.now() - this.lastSweepAt < this.cooldownMs) {
      return { swept: false, reason: 'COOLDOWN' };
    }

    if (hotBalanceSol <= this.config.workingCapitalSol + this.config.minColdSweepSol) {
      return { swept: false, reason: 'BELOW_THRESHOLD' };
    }

    const sweepAmountSol = hotBalanceSol - this.config.workingCapitalSol - this.config.hotWalletFeeBufferSol;
    if (sweepAmountSol < this.config.minColdSweepSol) {
      return { swept: false, reason: 'BELOW_MIN_SWEEP' };
    }

    const signature = await walletManager.transferSol(
      connection,
      this.config.coldWalletAddress,
      sweepAmountSol
    );

    this.lastSweepAt = Date.now();
    SweepLog.store(new SweepLog({
      fromWallet: walletManager.getAddress(),
      toWallet: this.config.coldWalletAddress,
      amountSol: sweepAmountSol,
      signature,
      trigger: 'THRESHOLD',
      timestamp: Date.now()
    }));

    this.logger.info('Treasury sweep submitted', {
      amountSol: Number(sweepAmountSol.toFixed(6)),
      signature
    });

    return { swept: true, amountSol: sweepAmountSol, signature };
  }
}

module.exports = TreasurySweeper;
