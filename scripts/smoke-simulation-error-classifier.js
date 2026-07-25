#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  classifySimulationError,
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
