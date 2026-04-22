class SimulatedTrade {
  static records = [];
  static nextId = 1;

  constructor(params) {
    this.id = `sim_${SimulatedTrade.nextId++}`;
    Object.assign(this, params);
  }

  static store(record) {
    this.records.push(record);
    return record;
  }

  static getAll() {
    return this.records;
  }
}

module.exports = SimulatedTrade;
