'use strict';

const fs = require('fs');

function parseJsonLine(line) {
  if (!line) return null;
  try {
    return JSON.parse(line.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function forEachJsonlSync(filePath, onRow, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) return { rows: 0, malformedLines: 0 };

  const bufferSize = Number(options.bufferSize || 1024 * 1024);
  const buffer = Buffer.allocUnsafe(bufferSize);
  const fd = fs.openSync(filePath, 'r');
  let position = 0;
  let carry = '';
  let rows = 0;
  let malformedLines = 0;

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;

      carry += buffer.toString('utf8', 0, bytesRead);
      const lines = carry.split(/\r?\n/);
      carry = lines.pop() || '';

      for (const rawLine of lines) {
        if (!rawLine) continue;
        const row = parseJsonLine(rawLine);
        if (!row) {
          malformedLines += 1;
          continue;
        }
        rows += 1;
        onRow(row, rawLine);
      }
    }

    if (carry.trim()) {
      const row = parseJsonLine(carry);
      if (row) {
        rows += 1;
        onRow(row, carry);
      } else {
        malformedLines += 1;
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return { rows, malformedLines };
}

function readJsonlSync(filePath, options = {}) {
  const rows = [];
  const stats = forEachJsonlSync(filePath, (row) => rows.push(row), options);
  if (options.withStats) return { rows, ...stats };
  return rows;
}

module.exports = {
  forEachJsonlSync,
  readJsonlSync
};
