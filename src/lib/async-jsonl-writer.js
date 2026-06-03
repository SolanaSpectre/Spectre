const fs = require('fs');
const path = require('path');

class AsyncJsonlWriter {
  constructor(filePath, logger = null) {
    this.filePath = filePath || null;
    this.logger = logger;
    this.pending = Promise.resolve();
    this.pendingCount = 0;
    this.failedWrites = 0;

    if (this.filePath) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    }
  }

  append(record, label = 'async jsonl write') {
    if (!this.filePath) return;

    let line = '';
    try {
      line = `${JSON.stringify(record)}\n`;
    } catch (error) {
      this.failedWrites += 1;
      this.logger?.warn?.(`Failed to serialize ${label}`, error.message);
      return;
    }

    this.pendingCount += 1;
    this.pending = this.pending
      .then(() => fs.promises.appendFile(this.filePath, line, 'utf8'))
      .catch((error) => {
        this.failedWrites += 1;
        this.logger?.warn?.(`Failed to write ${label}`, error.message);
      })
      .finally(() => {
        this.pendingCount = Math.max(0, this.pendingCount - 1);
      });
  }

  async flush() {
    await this.pending;
  }

  getStats() {
    return {
      pending: this.pendingCount,
      failedWrites: this.failedWrites
    };
  }
}

module.exports = AsyncJsonlWriter;
