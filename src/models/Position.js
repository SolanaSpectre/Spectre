class Position {
  static nextId = 1;

  constructor({
    mint,
    mode,
    entryPrice,
    size,
    entryValueSol,
    signalId,
    aiConfidence,
    fees = 0
  }) {
    this.id = `pos_${Position.nextId++}`;
    this.mint = mint;
    this.mode = mode;
    this.entryPrice = entryPrice;
    this.size = size;
    this.entryValueSol = entryValueSol;
    this.signalId = signalId;
    this.aiConfidence = aiConfidence ?? null;
    this.fees = fees;
    this.status = 'OPEN';
    this.entryTime = Date.now();
    this.exitPrice = null;
    this.exitTime = null;
    this.grossPnL = 0;
    this.netPnL = 0;
  }

  close(exitPrice, exitFees = 0) {
    this.exitPrice = exitPrice;
    this.exitTime = Date.now();
    this.status = 'CLOSED';
    this.grossPnL = (exitPrice - this.entryPrice) * this.size;
    this.netPnL = this.grossPnL - this.fees - exitFees;
  }
}

module.exports = Position;
