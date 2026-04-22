const Position = require('../models/Position');
const SimulatedTrade = require('../models/SimulatedTrade');
const SweepLog = require('../models/SweepLog');

class AccountingService {
  constructor() {
    this.positions = new Map();
    this.realizedPnL = 0;
  }

  openPosition(params) {
    const position = new Position(params);
    this.positions.set(position.id, position);
    return position;
  }

  closePosition(positionId, exitPrice, fees = 0) {
    const position = this.positions.get(positionId);
    if (!position) {
      return null;
    }

    position.close(exitPrice, fees);
    this.realizedPnL += position.netPnL;
    return position;
  }

  recordSimulatedTrade(record) {
    SimulatedTrade.store(record);
  }

  recordSweep(record) {
    SweepLog.store(record);
  }

  getOpenPositions() {
    return Array.from(this.positions.values()).filter((position) => position.status === 'OPEN');
  }

  getStats() {
    return {
      realizedPnL: this.realizedPnL,
      openPositions: this.getOpenPositions().length,
      simulatedTrades: SimulatedTrade.getAll().length,
      sweeps: SweepLog.getAll().length
    };
  }
}

module.exports = AccountingService;
