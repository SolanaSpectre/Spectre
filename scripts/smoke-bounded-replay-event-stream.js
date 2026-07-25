#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_STRATEGY,
  buildReport: buildPaperSimReport,
  readReplayEventStream
} = require('./pre-migration-paper-sim-report');
const { buildReport: buildBroadReport } = require('./broad-organic-surge-replay-report');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectre-replay-stream-'));
const telemetryPath = path.join(tempDir, 'telemetry.jsonl');
const at = (seconds) => new Date(Date.parse('2026-07-23T12:00:00.000Z') + seconds * 1000).toISOString();
const events = [
  {
    type: 'noise.event',
    timestamp: at(0),
    payload: { mint: 'NoiseMint', giant: 'x'.repeat(100_000) }
  },
  {
    type: 'pre_migration.flagged',
    timestamp: at(1),
    payload: {
      mint: 'ReplayMint',
      symbol: 'REPLAY',
      bondingCurvePriceSol: 0.000001,
      score: 90,
      curveProgress: 0.8,
      recentVolumeSol: 40,
      tradeVelocityPerMin: 35
    }
  },
  {
    type: 'pre_migration_paper.decision',
    timestamp: at(2),
    payload: {
      mint: 'ReplayMint',
      symbol: 'REPLAY',
      priceSol: 0.000001,
      score: 82,
      curveProgress: 0.8,
      recentVolumeSol: 40,
      tradeVelocityPerMin: 35,
      uniqueBuyerRatio: 0.9,
      sniperWalletCount: 1,
      decision: 'PAPER_SKIPPED',
      reason: 'TEST'
    }
  },
  {
    type: 'provider.price',
    timestamp: at(10),
    payload: {
      mint: 'ReplayMint',
      priceSol: 0.0000016,
      curveProgress: 0.85
    }
  }
];

try {
  fs.writeFileSync(telemetryPath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
  const streamed = readReplayEventStream(telemetryPath);
  assert.strictEqual(streamed.run.sourceRows, 4);
  assert.strictEqual(streamed.run.retainedRows, 3);
  assert.strictEqual(streamed.events.some((event) => event.type === 'noise.event'), false);

  const rawPaper = buildPaperSimReport(events, telemetryPath, DEFAULT_STRATEGY);
  const streamedPaper = buildPaperSimReport(
    streamed.events,
    telemetryPath,
    DEFAULT_STRATEGY,
    streamed.run
  );
  assert.deepStrictEqual(streamedPaper.summary, rawPaper.summary);
  assert.deepStrictEqual(streamedPaper.simulatedTrades, rawPaper.simulatedTrades);

  const broad = buildBroadReport([telemetryPath], [{
    name: 'smoke',
    minScore: 80,
    maxScore: 90,
    minCurveProgress: 0.75,
    maxCurveProgress: 0.9,
    minUniqueBuyerRatio: 0.8,
    maxSniperWallets: 3,
    minRecentVolumeSol: 25,
    minTradeVelocityPerMin: 25,
    takeProfitPct: 0.5,
    stopLossPct: 0.25,
    maxHoldSeconds: 120,
    amountSol: 0.1
  }]);
  assert.strictEqual(broad.variants[0].summary.trades, 1);
  assert.strictEqual(broad.variants[0].summary.wins, 1);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('Bounded replay event stream smoke passed');
