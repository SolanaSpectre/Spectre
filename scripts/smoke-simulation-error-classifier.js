#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  classifySimulationError,
  classifySimulationPayload,
  normalizeDryRunReason,
  summarizeSimulationFailureCounts
} = require('../src/lib/simulation-error-classifier');

assert.strictEqual(
  classifySimulationError(
    '{"InstructionError":[4,{"Custom":6005}]}',
    [
      'Program log: Error Code: BondingCurveComplete. Error Number: 6005.',
      'Program failed: custom program error: 0x1775'
    ]
  ),
  'BONDING_CURVE_COMPLETE'
);
assert.strictEqual(
  classifySimulationError('custom program error: 0x1'),
  'SIMULATION_INSUFFICIENT_FUNDS'
);
const historicalMislabeledPayload = {
  simulationOk: false,
  reason: 'SIMULATION_INSUFFICIENT_FUNDS',
  simulationError: 'Transaction simulation failed',
  simulationLogs: [
    'Program log: AnchorError caused by account: bonding_curve. Error Code: BondingCurveComplete.',
    'Program log: Error Number: 6005. Error Message: The bonding curve has completed.',
    'Program failed: custom program error: 0x1775'
  ]
};
assert.strictEqual(
  classifySimulationPayload(historicalMislabeledPayload),
  'BONDING_CURVE_COMPLETE'
);
assert.strictEqual(
  normalizeDryRunReason(historicalMislabeledPayload),
  'BONDING_CURVE_COMPLETE'
);
assert.strictEqual(
  normalizeDryRunReason({ simulationOk: null, reason: 'STALE_ACCOUNT_UPDATE' }),
  'STALE_ACCOUNT_UPDATE'
);
const genuineInsufficientFundsPayload = {
  simulationOk: false,
  reason: 'SIMULATION_FAILED',
  simulationError: 'Transaction simulation failed: insufficient funds for fee',
  simulationLogs: ['Program failed: custom program error: 0x1']
};
assert.strictEqual(
  classifySimulationPayload(genuineInsufficientFundsPayload),
  'SIMULATION_INSUFFICIENT_FUNDS'
);
assert.strictEqual(
  normalizeDryRunReason(genuineInsufficientFundsPayload),
  'SIMULATION_INSUFFICIENT_FUNDS'
);
assert.strictEqual(
  classifySimulationError('custom program error: 0x1776'),
  'custom program error: 0x1776'
);
assert.strictEqual(
  classifySimulationError('insufficient funds for fee'),
  'SIMULATION_INSUFFICIENT_FUNDS'
);
assert.strictEqual(
  classifySimulationError('Error Number: 6004', ['MintDoesNotMatchBondingCurve']),
  'BONDING_CURVE_MINT_MISMATCH'
);
assert.deepStrictEqual(
  summarizeSimulationFailureCounts({
    BONDING_CURVE_COMPLETE: 2,
    SIMULATION_SLIPPAGE: 1,
    SIMULATION_INSUFFICIENT_FUNDS: 3
  }),
  {
    total: 6,
    expectedStateRace: 2,
    critical: 4
  }
);

console.log('Simulation error classifier smoke passed');
