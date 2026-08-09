#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  collectTargets,
  forEachRecentJsonlSync,
  redactEndpoint,
  sanitizeProbeError
} = require('./probe-solana-rpc-transport');

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectre-rpc-probe-'));
  const telemetryPath = path.join(tempDir, 'telemetry.jsonl');
  const missingParityPath = path.join(tempDir, 'missing-parity.json');
  const wrappedSolMint = 'So11111111111111111111111111111111111111112';
  const tokenProgramMint = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

  try {
    const rows = [];
    for (let index = 0; index < 80; index += 1) {
      rows.push({
        type: 'unrelated.event',
        payload: { index, padding: 'x'.repeat(120) }
      });
    }
    rows.push({
      type: 'provider.pumpdev.runtime_trade',
      payload: { mint: wrappedSolMint }
    });
    rows.push({
      type: 'provider.helius_pumpfun.runtime_trade',
      payload: { mint: tokenProgramMint }
    });
    fs.writeFileSync(telemetryPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

    const reverseOrder = [];
    const scan = forEachRecentJsonlSync(telemetryPath, (row) => {
      reverseOrder.push(row.type);
      return reverseOrder.length < 2;
    }, {
      chunkBytes: 37,
      maxBytes: 4096
    });
    assert.deepStrictEqual(reverseOrder, [
      'provider.helius_pumpfun.runtime_trade',
      'provider.pumpdev.runtime_trade'
    ]);
    assert.strictEqual(scan.stoppedEarly, true);
    assert(scan.bytesRead < scan.fileSizeBytes);

    const collected = collectTargets(2, {
      telemetryPath,
      targetedParityPath: missingParityPath,
      scanChunkBytes: 41,
      scanMaxBytes: 4096
    });
    assert.strictEqual(collected.targets.length, 2);
    assert.strictEqual(collected.telemetryScan.stoppedEarly, true);
    assert(collected.telemetryScan.bytesRead < collected.telemetryScan.fileSizeBytes);

    const endpoint = 'https://rpc.example.test/private/DO_NOT_LEAK_PATH?api-key=DO_NOT_LEAK_QUERY';
    const redacted = redactEndpoint(endpoint);
    assert.strictEqual(redacted, 'https://rpc.example.test/<redacted-path>?<redacted>');
    assert(!redacted.includes('DO_NOT_LEAK'));

    const sanitized = sanitizeProbeError(
      new Error(`request to ${endpoint} failed for DO_NOT_LEAK_QUERY and DO_NOT_LEAK_PATH`),
      [endpoint]
    );
    assert(!sanitized.includes(endpoint));
    assert(!sanitized.includes('DO_NOT_LEAK_QUERY'));
    assert(!sanitized.includes('DO_NOT_LEAK_PATH'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('Solana RPC transport probe smoke passed.');
}

main();
