const fs = require('fs');
const path = require('path');

class AsyncJsonlWriter {
  constructor(filePath, logger = null) {
    this.filePath = filePath || null;
    this.logger = logger;
    this.pending = Promise.resolve();
    this.pendingCount = 0;
    this.failedWrites = 0;
    this.buffer = [];
    this.bufferBytes = 0;
    this.flushTimer = null;
    this.flushIntervalMs = 100;
    this.flushMaxRecords = 100;
    this.flushMaxBytes = 1024 * 1024;
    this.writeInFlight = false;

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
    this.buffer.push(line);
    this.bufferBytes += Buffer.byteLength(line);
    if (this.buffer.length >= this.flushMaxRecords || this.bufferBytes >= this.flushMaxBytes) {
      this.flushBuffer();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushBuffer();
      }, this.flushIntervalMs);
    }
  }

  flushBuffer() {
    if (!this.filePath || this.writeInFlight || this.buffer.length === 0) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const lines = this.buffer;
    const chunk = lines.join('');
    this.buffer = [];
    this.bufferBytes = 0;
    this.writeInFlight = true;
    this.pending = fs.promises.appendFile(this.filePath, chunk, 'utf8')
      .catch((error) => {
        this.failedWrites += 1;
        this.logger?.warn?.('Failed to write async JSONL batch', error.message);
      })
      .finally(() => {
        this.pendingCount = Math.max(0, this.pendingCount - lines.length);
        this.writeInFlight = false;
        if (this.buffer.length > 0) this.flushBuffer();
      });
  }

  async flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    while (this.writeInFlight || this.buffer.length > 0) {
      this.flushBuffer();
      await this.pending;
    }
  }

  getStats() {
    return {
      pending: this.pendingCount,
      bufferedRecords: this.buffer.length,
      bufferedBytes: this.bufferBytes,
      writeInFlight: this.writeInFlight,
      failedWrites: this.failedWrites
    };
  }
}

module.exports = AsyncJsonlWriter;
