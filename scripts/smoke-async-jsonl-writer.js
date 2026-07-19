#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AsyncJsonlWriter = require('../src/lib/async-jsonl-writer');

async function main() {
  const filePath = path.join(os.tmpdir(), `spectre-async-jsonl-${process.pid}.jsonl`);
  const writer = new AsyncJsonlWriter(filePath);
  try {
    for (let index = 0; index < 1000; index += 1) writer.append({ index, payload: 'x'.repeat(256) });
    await writer.flush();
    const rows = fs.readFileSync(filePath, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.strictEqual(rows.length, 1000);
    assert.strictEqual(rows[0].index, 0);
    assert.strictEqual(rows[999].index, 999);
    assert.strictEqual(writer.getStats().pending, 0);
    assert.strictEqual(writer.getStats().bufferedRecords, 0);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
  console.log('Async JSONL writer smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
