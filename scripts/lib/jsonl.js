'use strict';

const fs = require('fs');

function parseJsonlLine(line) {
  const text = String(line || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function readJsonl(filePath, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const encoding = options.encoding || 'utf8';
  const chunkSize = Number(options.chunkSize || 4 * 1024 * 1024);
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(Math.max(64 * 1024, chunkSize));
  const rows = [];
  let carry = '';

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      const chunk = carry + buffer.toString(encoding, 0, bytesRead);
      const lines = chunk.split(/\r?\n/);
      carry = lines.pop() || '';
      for (const line of lines) {
        const row = parseJsonlLine(line);
        if (row) rows.push(row);
      }
    }
    const tail = parseJsonlLine(carry);
    if (tail) rows.push(tail);
  } finally {
    fs.closeSync(fd);
  }

  return rows;
}

module.exports = {
  parseJsonlLine,
  readJsonl
};
