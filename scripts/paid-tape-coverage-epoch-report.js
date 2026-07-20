#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveTelemetryPath, telemetryFromReport } = require('./lib/report-telemetry');
const { scanTelemetryCoverage } = require('./lib/paid-tape-coverage-epochs');

const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'paid-tape-coverage-epoch-latest.json');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else { args[key] = next; index += 1; }
  }
  return args;
}

function coverageVerdict(coverage) {
  if (coverage.tradeSubscriptionMode === 'targeted_curve' && !coverage.paidTapeActivated) {
    if (coverage.targetedTradeSubscriptionRejections > 0) {
      return 'TARGETED_PAID_TAPE_REJECTED';
    }
    if (coverage.targetedTradeSubscriptionsAccepted > 0 && coverage.targetedTradeSubscriptionAcks === 0) {
      return 'TARGETED_PAID_TAPE_UNACKNOWLEDGED';
    }
    if (coverage.targetedTradeSubscriptionAcks > 0 && coverage.pumpPortalTradeEvents === 0) {
      return 'TARGETED_PAID_TAPE_NO_DELIVERY';
    }
    return 'NO_ACTIVE_TARGETED_PAID_TAPE';
  }
  return coverage.paidTapeCapped ? 'MIXED_COVERAGE_PAID_TAPE_CAPPED' : 'FULL_SESSION_PAID_TAPE';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = resolveTelemetryPath(ROOT, { telemetry: args.telemetry, reportTelemetry: telemetryFromReport(ROOT, BATTLEFIELD_PATH) });
  if (!telemetryPath || !fs.existsSync(telemetryPath)) throw new Error(`Telemetry file not found: ${telemetryPath || 'none'}`);
  const coverage = scanTelemetryCoverage(telemetryPath);
  const relativeTelemetryPath = path.relative(ROOT, telemetryPath).replace(/\\/g, '/');
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_paid_tape_coverage_epoch',
    note: 'Separates strategy evidence collected before the PumpPortal paid-event cap from discovery/RPC-only evidence after the cap.',
    telemetryPath: relativeTelemetryPath,
    verdict: coverageVerdict(coverage),
    coverage: { ...coverage, telemetryPath: relativeTelemetryPath },
    evidencePolicy: {
      fullPaidTape: 'Decision and complete outcome window occurred before the paid-event cap.',
      capTruncated: 'Decision occurred before the cap, but the requested outcome window extended beyond it.',
      discoveryRpcOnly: 'Decision occurred after paid token/account streams were disabled; do not compare it directly with full-tape funnel rates.',
      noActiveTargetedTape: 'Targeted mode did not produce acknowledged subscriptions and delivered trades; elapsed session time is not paid-tape coverage.'
    }
  };
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ verdict: report.verdict, coverage: report.coverage }, null, 2));
}

if (require.main === module) main();

module.exports = { coverageVerdict };
