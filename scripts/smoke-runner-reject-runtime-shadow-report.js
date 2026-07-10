#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readTelemetry, FROZEN_PROFILE, ERA } = require('./runner-reject-runtime-shadow-outcome-report');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectre-runner-shadow-'));
  const filePath = path.join(dir, 'telemetry-runner-shadow-fixture.jsonl');
  const mint = 'RunnerRejectFixture1111111111111111111111111111';
  const at = '2026-07-10T12:00:00.000Z';
  const lines = [
    {
      timestamp: '2026-07-10T11:59:59.000Z',
      type: 'pumpdev.token_updated',
      payload: {
        token: mint,
        providerCurveProgress: 0.72,
        providerCurvePriceSol: 0.000001
      }
    },
    {
      timestamp: at,
      type: 'runner_reject_runtime_shadow.would_enter',
      payload: {
        token: mint,
        era: ERA,
        frozenProfile: FROZEN_PROFILE.name,
        rejectReason: 'LOW_PUMP_MOMENTUM',
        pumpFailureReason: 'RUNNER_SCALPER_REQUIRES_MIGRATION',
        curveProgress: 0.73,
        priceSol: 0.0000011
      }
    },
    {
      timestamp: '2026-07-10T12:01:00.000Z',
      type: 'pumpdev.token_updated',
      payload: {
        token: mint,
        providerCurveProgress: 0.91,
        providerCurvePriceSol: 0.0000019
      }
    }
  ];
  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

  try {
    const run = await readTelemetry(filePath);
    if (run.shadows.length !== 1) {
      throw new Error(`expected 1 shadow row, got ${run.shadows.length}`);
    }
    const [shadow] = run.shadows;
    if (shadow.mint !== mint) throw new Error('shadow mint did not parse');
    if (shadow.at !== at) throw new Error(`shadow timestamp fallback failed: ${shadow.at}`);
    if (shadow.frozenProfile !== FROZEN_PROFILE.name) throw new Error('frozen profile did not parse');
    if ((run.snapshotsByMint.get(mint) || []).length < 2) {
      throw new Error('fixture snapshots did not parse');
    }
    console.log('[runner-shadow-smoke] synthetic shadow event parsed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
