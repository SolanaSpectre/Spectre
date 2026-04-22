class SweepLog {
  static records = [];
  static nextId = 1;

  constructor(params) {
    this.id = `sweep_${SweepLog.nextId++}`;
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

module.exports = SweepLog;
