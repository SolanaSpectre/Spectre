#!/usr/bin/env node
'use strict';

const {
  PUMP_LIVE_READINESS,
  getPumpLiveReadinessReport,
  validatePumpLiveReadinessManifest,
} = require('../src/lib/pump-live-readiness');

function hasArg(name) {
  return process.argv.includes(name);
}

function printSection(title, lines = []) {
  console.log(`\n${title}`);
  for (const line of lines) {
    console.log(`- ${line}`);
  }
}

function main() {
  const report = getPumpLiveReadinessReport({
    directPumpExecutor: hasArg('--direct-pump-executor'),
    directPumpSwapExecutor: hasArg('--direct-pumpswap-executor'),
  });
  const validation = validatePumpLiveReadinessManifest();

  console.log('Pump live-readiness check');
  console.log(`Posture: ${report.posture}`);
  console.log(`Upgrade: ${PUMP_LIVE_READINESS.upgrade.name}`);
  console.log(`Effective UTC: ${PUMP_LIVE_READINESS.upgrade.effectiveAtUtc}`);
  console.log(`Current Spectre use: ${report.note}`);

  printSection('Programs', [
    `Pump bonding curve: ${PUMP_LIVE_READINESS.programs.pumpBondingCurve.programId}`,
    `PumpSwap AMM: ${PUMP_LIVE_READINESS.programs.pumpSwapAmm.programId}`,
  ]);

  printSection('Required upgraded fee recipients', PUMP_LIVE_READINESS.feeRecipients);

  printSection('Future direct-executor rules', PUMP_LIVE_READINESS.liveExecutorRules);

  if (!validation.ok) {
    printSection('Manifest issues', validation.issues);
  }
  if (report.blockers.length > 0) {
    printSection('Live-readiness blockers', report.blockers);
  }

  console.log(`\nResult: ${report.ok ? 'manifest-ok' : 'live-readiness-blocked'}`);
  process.exitCode = report.ok ? 0 : 1;
}

main();
