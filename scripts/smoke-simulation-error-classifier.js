#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  DEFAULT_PUMP_PROGRAM_ID,
  SIMULATION_ERROR_CLASSIFIER_EPOCH,
  diagnoseSimulationError,
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
  'SIMULATION_CUSTOM_PROGRAM_ERROR'
);
const pumpPropagatedCustomError = diagnoseSimulationError(
  'Transaction simulation failed',
  [`Program ${DEFAULT_PUMP_PROGRAM_ID} failed: custom program error: 0x1`]
);
assert.strictEqual(
  pumpPropagatedCustomError.failureClass,
  'SIMULATION_CUSTOM_PROGRAM_ERROR'
);
assert.strictEqual(
  pumpPropagatedCustomError.classifierEpoch,
  SIMULATION_ERROR_CLASSIFIER_EPOCH
);
assert.strictEqual(
  pumpPropagatedCustomError.classificationBasis,
  'UNCLASSIFIED_CUSTOM_PROGRAM_ERROR_CODE'
);
assert.strictEqual(pumpPropagatedCustomError.rawProgramErrorCode, '0x1');
assert.strictEqual(
  pumpPropagatedCustomError.rawProgramErrorCodeSource,
  'OUTERMOST_PROGRAM_FAILURE_FRAME'
);
assert.strictEqual(
  pumpPropagatedCustomError.innermostFailingProgramId,
  DEFAULT_PUMP_PROGRAM_ID
);
assert.strictEqual(
  pumpPropagatedCustomError.outermostFailingProgramId,
  DEFAULT_PUMP_PROGRAM_ID
);
assert.strictEqual(pumpPropagatedCustomError.pumpProgramFrameObserved, true);
assert.strictEqual(pumpPropagatedCustomError.pumpProgramFailed, true);
assert.strictEqual(pumpPropagatedCustomError.pumpProgramErrorCode, '0x1');
const systemProgramCustomError = diagnoseSimulationError(
  'Transaction simulation failed',
  [
    `Program ${DEFAULT_PUMP_PROGRAM_ID} invoke [1]`,
    'Program 11111111111111111111111111111111 failed: custom program error: 0x1'
  ]
);
assert.strictEqual(
  systemProgramCustomError.failureClass,
  'SIMULATION_CUSTOM_PROGRAM_ERROR'
);
assert.strictEqual(systemProgramCustomError.rawProgramErrorCode, '0x1');
assert.strictEqual(
  systemProgramCustomError.innermostFailingProgramId,
  '11111111111111111111111111111111'
);
assert.strictEqual(
  systemProgramCustomError.outermostFailingProgramId,
  '11111111111111111111111111111111'
);
assert.strictEqual(systemProgramCustomError.pumpProgramFrameObserved, true);
assert.strictEqual(systemProgramCustomError.pumpProgramFailed, false);
assert.strictEqual(systemProgramCustomError.pumpProgramErrorCode, null);
const propagatedInnerCustomError = diagnoseSimulationError(
  'Transaction simulation failed',
  [
    `Program ${DEFAULT_PUMP_PROGRAM_ID} invoke [1]`,
    'Program 11111111111111111111111111111111 failed: custom program error: 0x1',
    `Program ${DEFAULT_PUMP_PROGRAM_ID} failed: custom program error: 0x1`
  ]
);
assert.strictEqual(
  propagatedInnerCustomError.failureClass,
  'SIMULATION_CUSTOM_PROGRAM_ERROR'
);
assert.strictEqual(
  propagatedInnerCustomError.innermostFailingProgramId,
  '11111111111111111111111111111111'
);
assert.strictEqual(
  propagatedInnerCustomError.outermostFailingProgramId,
  DEFAULT_PUMP_PROGRAM_ID
);
assert.strictEqual(propagatedInnerCustomError.pumpProgramFailed, true);
const completeDiagnostic = diagnoseSimulationError(
  '{"InstructionError":[4,{"Custom":6005}]}',
  [
    'Program log: Error Code: BondingCurveComplete. Error Number: 6005.',
    `Program ${DEFAULT_PUMP_PROGRAM_ID} failed: custom program error: 0x1775`
  ]
);
assert.strictEqual(completeDiagnostic.failureClass, 'BONDING_CURVE_COMPLETE');
assert.strictEqual(completeDiagnostic.rawProgramErrorCode, '0x1775');
assert.strictEqual(completeDiagnostic.anchorErrorNumber, 6005);
assert.strictEqual(completeDiagnostic.innermostFailingProgramId, DEFAULT_PUMP_PROGRAM_ID);
assert.strictEqual(completeDiagnostic.outermostFailingProgramId, DEFAULT_PUMP_PROGRAM_ID);
assert.strictEqual(completeDiagnostic.pumpProgramFailed, true);
assert.strictEqual(completeDiagnostic.pumpProgramErrorCode, '0x1775');
assert.strictEqual(
  classifySimulationError(
    'Transaction simulation failed',
    [`Program ${DEFAULT_PUMP_PROGRAM_ID} failed: custom program error: 0x1`]
  ),
  'SIMULATION_CUSTOM_PROGRAM_ERROR'
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
  'SIMULATION_CUSTOM_PROGRAM_ERROR'
);
assert.strictEqual(
  classifySimulationError('provider returned an unstructured simulation failure'),
  'SIMULATION_UNCLASSIFIED'
);
assert.strictEqual(
  classifySimulationError('insufficient funds for fee'),
  'SIMULATION_INSUFFICIENT_FUNDS'
);
assert.strictEqual(
  classifySimulationError('Error Number: 6004', ['MintDoesNotMatchBondingCurve']),
  'BONDING_CURVE_MINT_MISMATCH'
);
assert.strictEqual(
  classifySimulationError(
    'Error Number: 6002',
    ['Error Code: TooMuchSolRequired', 'slippage: Too much SOL required']
  ),
  'QUOTE_SLIPPAGE_RACE'
);
assert.strictEqual(
  classifySimulationError('custom program error: 0x1772'),
  'QUOTE_SLIPPAGE_RACE'
);
assert.deepStrictEqual(
  summarizeSimulationFailureCounts({
    BONDING_CURVE_COMPLETE: 2,
    QUOTE_SLIPPAGE_RACE: 1,
    SIMULATION_SLIPPAGE: 1,
    SIMULATION_INSUFFICIENT_FUNDS: 3
  }),
  {
    total: 7,
    expectedStateRace: 2,
    expectedQuoteRace: 1,
    critical: 4
  }
);

console.log('Simulation error classifier smoke passed');
