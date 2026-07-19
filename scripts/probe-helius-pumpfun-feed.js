#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const Config = require('../src/config');
const {
  decodePumpTradeEventLog,
  isPumpTradeEventLog
} = require('../src/lib/pump-trade-event-decoder');

const ROOT = path.join(__dirname, '..');
const DEFAULT_REPORT_DIR = path.join(ROOT, 'data', 'reports', 'helius-pumpfun-feed-probe');
const DEFAULT_LATEST_PATH = path.join(ROOT, 'data', 'reports', 'helius-pumpfun-feed-probe-latest.json');
const DEFAULT_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

const PREREGISTERED = Object.freeze({
  id: 'helius_pumpfun_two_arm_probe_v1_2026-07-18',
  purpose: 'Measure whether the existing Helius Developer plan can supply broad Pump.fun tape without strategy or live-path changes.',
  durationMs: 1800000,
  arms: {
    transactionConfirmed: {
      method: 'transactionSubscribe',
      commitment: 'confirmed',
      encoding: 'jsonParsed',
      transactionDetails: 'full',
      failed: false,
      vote: false
    },
    logsProcessed: {
      method: 'logsSubscribe',
      commitment: 'processed',
      failed: false
    }
  },
  samplePolicy: {
    maxSamplesPerArm: 10,
    maxRawSamplesPerArm: 2,
    maxRawSampleBytes: 131072,
    aggregateOnlyBeyondSamples: true
  },
  plannedEvidenceProgram: {
    paperRuns: 10,
    minutesPerRun: 60,
    monthlyCredits: 10000000,
    maxCreditFraction: 0.20,
    sessionBoundedOnly: true
  },
  pass: {
    maxReconnectsPerArm: 2,
    maxTotalGapMsPerArm: 10000,
    maxEventLoopLagP99Ms: 100,
    minTradeDecodePct: 99,
    requireCurveReserveFields: true,
    maxTradeLatencyP90Ms: 3000,
    maxPlannedProgramCredits: 2000000
  },
  fail: {
    tradeDecodePctBelow: 95,
    sustainedEventLoopLag: true,
    missingCurveReserveFields: true,
    plannedProgramCreditsAbove: 2000000
  },
  inconclusive: {
    minNotificationsPerArm: 20000,
    creditMeasurementRequired: true,
    partialDecodeRequiresRevision: true
  },
  prohibitions: [
    'no trading, scoring, entries, exits, gate changes, or live changes',
    'no adapter promotion without a graded PASS',
    'no continuous-stream affordability claim from session-bounded evidence'
  ]
});

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  if (positional.length > 0 && args.durationMs === undefined) args.durationMs = positional[0];
  return args;
}

function nowIso() {
  return new Date().toISOString();
}

function compact(value, decimals = 4) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(decimals)) : null;
}

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return compact(sorted[index], 3);
}

function sanitizeUrl(url) {
  return String(url || '')
    .replace(/([?&](?:api-key|apikey|key|token|access_token)=)[^&]+/gi, '$1<redacted>');
}

function resolveRepoPath(filePath, fallback) {
  const selected = filePath || fallback;
  return path.isAbsolute(selected) ? selected : path.join(ROOT, selected);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function buildSubscriptionRequest(arm, id, programId) {
  if (arm.method === 'transactionSubscribe') {
    return {
      jsonrpc: '2.0',
      id,
      method: 'transactionSubscribe',
      params: [
        { vote: false, failed: false, accountInclude: [programId] },
        {
          commitment: arm.commitment,
          encoding: arm.encoding,
          transactionDetails: arm.transactionDetails,
          showRewards: false,
          maxSupportedTransactionVersion: 0
        }
      ]
    };
  }
  return {
    jsonrpc: '2.0',
    id,
    method: 'logsSubscribe',
    params: [
      { mentions: [programId] },
      { commitment: arm.commitment }
    ]
  };
}

function extractLogs(payload) {
  const result = payload?.params?.result;
  const candidates = [
    result?.value?.logs,
    result?.transaction?.meta?.logMessages,
    result?.transaction?.transaction?.meta?.logMessages,
    result?.value?.transaction?.meta?.logMessages,
    result?.value?.transaction?.transaction?.meta?.logMessages
  ];
  return candidates.find(Array.isArray) || [];
}

function extractSlot(payload) {
  const result = payload?.params?.result;
  return result?.context?.slot ?? result?.slot ?? result?.value?.slot ?? null;
}

function extractSignature(payload) {
  const result = payload?.params?.result;
  return result?.value?.signature
    || result?.signature
    || result?.transaction?.signature
    || result?.transaction?.transaction?.signatures?.[0]
    || result?.value?.transaction?.transaction?.signatures?.[0]
    || null;
}

function extractNotificationError(payload) {
  const result = payload?.params?.result;
  return result?.value?.err ?? result?.transaction?.meta?.err ?? null;
}

function instructionNames(logs) {
  return logs
    .map((line) => String(line).match(/^Program log: Instruction:\s*(.+)$/)?.[1] || null)
    .filter(Boolean);
}

function buildArmStats(name, arm, url, durationMs) {
  return {
    name,
    method: arm.method,
    commitment: arm.commitment,
    sanitizedUrl: sanitizeUrl(url),
    durationMs,
    startedAt: nowIso(),
    stoppedAt: null,
    connectionAttempts: 0,
    openEvents: 0,
    reconnects: 0,
    closeEvents: 0,
    errorEvents: 0,
    parseErrors: 0,
    subscriptionAcks: 0,
    subscriptionErrors: [],
    notifications: 0,
    successfulNotifications: 0,
    failedNotifications: 0,
    messages: 0,
    bytes: 0,
    maxMessageBytes: 0,
    logLines: 0,
    programDataLines: 0,
    tradeEventCandidates: 0,
    decodedTradeEvents: 0,
    tradeEventsWithCurveReserveFields: 0,
    tradeEventsWithPositiveLegacySolReserves: 0,
    decodeErrors: 0,
    uniqueMints: 0,
    uniqueWallets: 0,
    instructionCounts: {},
    pingsSent: 0,
    pongsReceived: 0,
    gapsMs: [],
    totalGapMs: 0,
    tradeLatenciesMs: [],
    samples: [],
    rawSamples: [],
    lastMessageAt: null,
    lastCloseCode: null,
    lastCloseReason: null,
    lastErrorMessage: null,
    interpretation: null
  };
}

function finalizeArmStats(stats, mints, wallets, durationMs) {
  stats.stoppedAt = nowIso();
  stats.uniqueMints = mints.size;
  stats.uniqueWallets = wallets.size;
  stats.totalGapMs = stats.gapsMs.reduce((sum, value) => sum + value, 0);
  stats.messagesPerSecond = compact(stats.messages / (durationMs / 1000), 3);
  stats.notificationsPerSecond = compact(stats.notifications / (durationMs / 1000), 3);
  stats.bytesPerSecond = compact(stats.bytes / (durationMs / 1000), 3);
  stats.projectedBytesPerHour = Math.round(stats.bytes * (3600000 / durationMs));
  stats.tradeDecodePct = stats.tradeEventCandidates
    ? compact((stats.decodedTradeEvents / stats.tradeEventCandidates) * 100, 3)
    : null;
  stats.curveReserveFieldCoveragePct = stats.decodedTradeEvents
    ? compact((stats.tradeEventsWithCurveReserveFields / stats.decodedTradeEvents) * 100, 3)
    : null;
  stats.positiveLegacySolReserveCoveragePct = stats.decodedTradeEvents
    ? compact((stats.tradeEventsWithPositiveLegacySolReserves / stats.decodedTradeEvents) * 100, 3)
    : null;
  stats.tradeLatencyMs = {
    samples: stats.tradeLatenciesMs.length,
    p50: percentile(stats.tradeLatenciesMs, 0.50),
    p90: percentile(stats.tradeLatenciesMs, 0.90),
    p99: percentile(stats.tradeLatenciesMs, 0.99),
    max: stats.tradeLatenciesMs.length ? compact(Math.max(...stats.tradeLatenciesMs), 3) : null
  };
  delete stats.tradeLatenciesMs;
  if (!stats.openEvents) stats.interpretation = 'socket never opened';
  else if (stats.subscriptionErrors.length) stats.interpretation = 'subscription returned an error';
  else if (!stats.notifications) stats.interpretation = 'subscription opened but delivered no notifications';
  else stats.interpretation = 'subscription delivered Pump.fun program notifications';
  return stats;
}

function runArm({ name, arm, url, programId, durationMs, pingIntervalMs, samplePolicy }) {
  return new Promise((resolve) => {
    const stats = buildArmStats(name, arm, url, durationMs);
    const mints = new Set();
    const wallets = new Set();
    const deadline = Date.now() + durationMs;
    let socket = null;
    let stopped = false;
    let reconnectTimer = null;
    let pingTimer = null;
    let gapStartedAt = null;
    let requestId = name === 'transactionConfirmed' ? 1101 : 1201;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(reconnectTimer);
      clearInterval(pingTimer);
      if (gapStartedAt !== null) stats.gapsMs.push(Date.now() - gapStartedAt);
      if (socket?.readyState === WebSocket.CONNECTING) socket.terminate();
      else if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CLOSING) {
        socket.close(1000, 'probe complete');
      }
      resolve(finalizeArmStats(stats, mints, wallets, durationMs));
    };

    const scheduleReconnect = () => {
      if (stopped || Date.now() >= deadline) return stop();
      if (gapStartedAt === null) gapStartedAt = Date.now();
      const delay = Math.min(30000, 1000 * (2 ** Math.min(stats.reconnects, 5)));
      stats.reconnects += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    const connect = () => {
      if (stopped || Date.now() >= deadline) return stop();
      stats.connectionAttempts += 1;
      socket = new WebSocket(url, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });

      socket.on('open', () => {
        stats.openEvents += 1;
        if (gapStartedAt !== null) {
          stats.gapsMs.push(Date.now() - gapStartedAt);
          gapStartedAt = null;
        }
        socket.send(JSON.stringify(buildSubscriptionRequest(arm, requestId, programId)));
        clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (socket.readyState !== WebSocket.OPEN) return;
          stats.pingsSent += 1;
          socket.ping();
        }, pingIntervalMs);
      });

      socket.on('pong', () => {
        stats.pongsReceived += 1;
      });

      socket.on('message', (raw) => {
        const bytes = Buffer.byteLength(raw);
        stats.messages += 1;
        stats.bytes += bytes;
        stats.maxMessageBytes = Math.max(stats.maxMessageBytes, bytes);
        stats.lastMessageAt = nowIso();

        let payload;
        try {
          payload = JSON.parse(raw.toString());
        } catch {
          stats.parseErrors += 1;
          return;
        }

        if (payload.id === requestId) {
          if (payload.error) {
            stats.subscriptionErrors.push(String(payload.error.message || payload.error.code || 'unknown subscription error'));
          } else if (payload.result !== undefined) {
            stats.subscriptionAcks += 1;
          }
          return;
        }
        if (!payload.method?.endsWith('Notification')) return;
        stats.notifications += 1;
        if (extractNotificationError(payload) === null) stats.successfulNotifications += 1;
        else stats.failedNotifications += 1;

        const logs = extractLogs(payload);
        stats.logLines += logs.length;
        const names = instructionNames(logs);
        for (const instruction of names) {
          stats.instructionCounts[instruction] = (stats.instructionCounts[instruction] || 0) + 1;
        }

        const decoded = [];
        for (const line of logs) {
          if (String(line).startsWith('Program data:')) stats.programDataLines += 1;
          if (!isPumpTradeEventLog(line)) continue;
          stats.tradeEventCandidates += 1;
          let event = null;
          try {
            event = decodePumpTradeEventLog(line);
          } catch {
            stats.decodeErrors += 1;
          }
          if (!event) continue;
          stats.decodedTradeEvents += 1;
          decoded.push(event);
          mints.add(event.mint);
          wallets.add(event.user);
          if (event.virtualSolReserves !== null && event.virtualTokenReserves !== null) {
            stats.tradeEventsWithCurveReserveFields += 1;
          }
          if (Number(event.virtualSolReserves) > 0 && Number(event.virtualTokenReserves) > 0) {
            stats.tradeEventsWithPositiveLegacySolReserves += 1;
          }
          const eventMs = Number(event.timestamp) * 1000;
          if (Number.isFinite(eventMs) && eventMs > 0) stats.tradeLatenciesMs.push(Math.max(0, Date.now() - eventMs));
        }

        if (stats.samples.length < samplePolicy.maxSamplesPerArm && (decoded.length || names.length)) {
          stats.samples.push({
            receivedAt: nowIso(),
            slot: extractSlot(payload),
            signature: extractSignature(payload),
            bytes,
            instructionNames: names,
            logs,
            decodedTradeEvents: decoded
          });
        }
        if (stats.rawSamples.length < samplePolicy.maxRawSamplesPerArm && bytes <= samplePolicy.maxRawSampleBytes) {
          stats.rawSamples.push(payload);
        }
      });

      socket.on('error', (error) => {
        stats.errorEvents += 1;
        stats.lastErrorMessage = error.message;
      });

      socket.on('close', (code, reason) => {
        stats.closeEvents += 1;
        stats.lastCloseCode = Number(code || 0) || 0;
        stats.lastCloseReason = reason ? reason.toString() : '';
        clearInterval(pingTimer);
        if (!stopped && Date.now() < deadline) scheduleReconnect();
      });
    };

    setTimeout(stop, durationMs);
    connect();
  });
}

function startEventLoopMonitor(intervalMs = 50) {
  const lags = [];
  let expected = Date.now() + intervalMs;
  const timer = setInterval(() => {
    const now = Date.now();
    lags.push(Math.max(0, now - expected));
    expected = now + intervalMs;
  }, intervalMs);
  return {
    stop() {
      clearInterval(timer);
      return {
        intervalMs,
        samples: lags.length,
        p50: percentile(lags, 0.50),
        p90: percentile(lags, 0.90),
        p99: percentile(lags, 0.99),
        max: lags.length ? compact(Math.max(...lags), 3) : null
      };
    }
  };
}

function creditAssessment(report, creditsUsed) {
  const durationHours = Number(report.durationMs || 0) / 3600000;
  if (creditsUsed === null
    || creditsUsed === undefined
    || creditsUsed === ''
    || !Number.isFinite(Number(creditsUsed))
    || Number(creditsUsed) < 0
    || durationHours <= 0) {
    return {
      measured: false,
      creditsUsed: null,
      verdict: 'CREDIT_DELTA_REQUIRED',
      note: 'Record Helius dashboard credits immediately before and after the probe, then grade with --gradeReport and --creditsUsed.'
    };
  }
  const used = Number(creditsUsed);
  const creditsPerHour = used / durationHours;
  const plannedHours = (PREREGISTERED.plannedEvidenceProgram.paperRuns
    * PREREGISTERED.plannedEvidenceProgram.minutesPerRun) / 60;
  const armEntries = Object.entries(report.arms || {}).filter(([, arm]) => Number(arm?.bytes) > 0);
  const totalArmBytes = armEntries.reduce((sum, [, arm]) => sum + Number(arm.bytes), 0);
  const armProjections = Object.fromEntries(armEntries.map(([name, arm]) => {
    const byteShare = totalArmBytes > 0 ? Number(arm.bytes) / totalArmBytes : null;
    const allocatedProbeCredits = byteShare === null ? null : used * byteShare;
    const armCreditsPerHour = allocatedProbeCredits === null ? null : allocatedProbeCredits / durationHours;
    return [name, {
      byteShare: compact(byteShare, 6),
      allocatedProbeCredits: compact(allocatedProbeCredits, 2),
      creditsPerHour: compact(armCreditsPerHour, 2),
      plannedProgramCredits: compact(armCreditsPerHour * plannedHours, 2)
    }];
  }));
  const affordableArm = Object.entries(armProjections)
    .filter(([, projection]) => Number.isFinite(projection.plannedProgramCredits))
    .sort((left, right) => left[1].plannedProgramCredits - right[1].plannedProgramCredits)[0] || null;
  const plannedProgramCredits = affordableArm
    ? affordableArm[1].plannedProgramCredits
    : creditsPerHour * plannedHours;
  return {
    measured: true,
    creditsUsed: used,
    combinedProbeCreditsPerHour: compact(creditsPerHour, 2),
    allocationMethod: armEntries.length
      ? 'dashboard credit delta allocated by observed websocket byte share; production uses one arm'
      : 'combined probe credits; arm byte allocation unavailable',
    armProjections,
    lowestProjectedArm: affordableArm?.[0] || null,
    plannedProgramCredits: compact(plannedProgramCredits, 2),
    monthlyCreditFraction: compact(plannedProgramCredits / PREREGISTERED.plannedEvidenceProgram.monthlyCredits, 6),
    verdict: plannedProgramCredits <= PREREGISTERED.pass.maxPlannedProgramCredits
      ? 'CREDIT_BUDGET_PASS'
      : 'CREDIT_BUDGET_FAIL'
  };
}

function assessReport(report, creditsUsed = null) {
  const arms = Object.values(report.arms || {});
  const credit = creditAssessment(report, creditsUsed);
  const failures = [];
  const inconclusive = [];
  for (const arm of arms) {
    if (!arm.openEvents || arm.subscriptionErrors?.length) failures.push(`${arm.name}:SUBSCRIPTION_FAILED`);
    if (arm.reconnects > PREREGISTERED.pass.maxReconnectsPerArm) failures.push(`${arm.name}:RECONNECTS`);
    if (arm.totalGapMs > PREREGISTERED.pass.maxTotalGapMsPerArm) failures.push(`${arm.name}:GAPS`);
    if (arm.tradeDecodePct !== null && arm.tradeDecodePct < PREREGISTERED.fail.tradeDecodePctBelow) {
      failures.push(`${arm.name}:DECODE_BELOW_95`);
    }
    const reserveFieldCoverage = arm.curveReserveFieldCoveragePct ?? arm.curveReserveCoveragePct;
    if (arm.decodedTradeEvents > 0 && reserveFieldCoverage < 100) {
      failures.push(`${arm.name}:CURVE_RESERVES_MISSING`);
    }
    if (arm.notifications < PREREGISTERED.inconclusive.minNotificationsPerArm) {
      inconclusive.push(`${arm.name}:QUIET_TAPE`);
    }
    if (!arm.tradeEventCandidates) inconclusive.push(`${arm.name}:NO_TRADE_EVENTS_IDENTIFIED`);
    else if (arm.tradeDecodePct < PREREGISTERED.pass.minTradeDecodePct) {
      inconclusive.push(`${arm.name}:DECODE_BELOW_PASS_BAR`);
    }
    if (arm.tradeLatencyMs?.p90 === null) inconclusive.push(`${arm.name}:LATENCY_UNAVAILABLE`);
    else if (arm.tradeLatencyMs.p90 > PREREGISTERED.pass.maxTradeLatencyP90Ms) {
      failures.push(`${arm.name}:LATENCY_P90`);
    }
  }
  if (report.eventLoopLagMs?.p99 > PREREGISTERED.pass.maxEventLoopLagP99Ms) {
    failures.push('EVENT_LOOP_LAG_P99');
  }
  if (!credit.measured) inconclusive.push('CREDIT_DELTA_REQUIRED');
  else if (credit.verdict === 'CREDIT_BUDGET_FAIL') failures.push('CREDIT_BUDGET');

  let verdict = 'PASS_BUILD_HELIUS_ADAPTER';
  if (failures.length) verdict = 'FAIL_REJECT_OR_REVISE_HELIUS_ROUTE';
  else if (inconclusive.length) verdict = 'INCONCLUSIVE_REVISE_AND_REPROBE';
  return { verdict, failures, inconclusive, credit };
}

function normalizeLegacyReserveMetrics(report) {
  const amendedArms = [];
  for (const [name, arm] of Object.entries(report.arms || {})) {
    if (arm.curveReserveFieldCoveragePct !== undefined || !arm.decodedTradeEvents) continue;
    arm.positiveLegacySolReserveCoveragePct = arm.curveReserveCoveragePct;
    arm.curveReserveFieldCoveragePct = 100;
    arm.reserveMetricNote = 'Post-probe label correction: the decoder emitted both reserve fields on every decoded event; the prior metric measured positive legacy SOL reserve values, not field presence.';
    amendedArms.push(name);
  }
  return amendedArms;
}

async function gradeExistingReport(args) {
  const reportPath = resolveRepoPath(args.gradeReport, DEFAULT_LATEST_PATH);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const originalAssessment = report.assessment ? JSON.parse(JSON.stringify(report.assessment)) : null;
  const reserveMetricAmendments = normalizeLegacyReserveMetrics(report);
  const rawCreditsBefore = report.operatorCreditMeasurement?.creditsBefore;
  const creditsBefore = rawCreditsBefore === null || rawCreditsBefore === undefined
    ? null
    : Number(rawCreditsBefore);
  const creditsAfter = args.creditsAfter === undefined ? null : Number(args.creditsAfter);
  const explicitCreditsUsed = args.creditsUsed === undefined ? null : Number(args.creditsUsed);
  const creditsUsed = explicitCreditsUsed !== null
    ? explicitCreditsUsed
    : Number.isFinite(creditsBefore) && Number.isFinite(creditsAfter)
      ? Math.max(0, creditsAfter - creditsBefore)
      : null;
  report.operatorCreditMeasurement = {
    creditsBefore: Number.isFinite(creditsBefore) ? creditsBefore : null,
    creditsAfter: Number.isFinite(creditsAfter) ? creditsAfter : null,
    creditsUsed: Number.isFinite(creditsUsed) ? creditsUsed : null,
    source: 'Helius dashboard plan credit usage counter'
  };
  report.assessment = assessReport(report, creditsUsed);
  report.gradedAt = nowIso();
  if (reserveMetricAmendments.length) {
    report.assessmentAmendments = [
      ...(report.assessmentAmendments || []),
      {
        at: report.gradedAt,
        kind: 'RESERVE_FIELD_PRESENCE_LABEL_CORRECTION',
        arms: reserveMetricAmendments,
        originalAssessment,
        reason: 'Zero-valued legacy SOL reserves were incorrectly labeled as missing fields. Raw counters and payloads are unchanged; positive legacy reserve coverage remains reported separately.'
      }
    ];
  }
  writeJson(reportPath, report);
  const latestPath = resolveRepoPath(args.latestPath, DEFAULT_LATEST_PATH);
  writeJson(latestPath, report);
  console.log(`Helius Pump.fun probe verdict: ${report.assessment.verdict}`);
  console.log(`Updated Helius Pump.fun probe: ${reportPath}`);
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.gradeReport) return gradeExistingReport(args);

  const durationMs = Number(args.durationMs || PREREGISTERED.durationMs);
  const pingIntervalMs = Number(args.pingIntervalMs || 25000);
  const programId = String(process.env.PUMP_BONDING_CURVE_PROGRAM_ID || DEFAULT_PROGRAM_ID);
  const enhancedUrl = String(args.enhancedUrl || Config.heliusEnhancedWebsocketUrl || '');
  const standardUrl = String(args.standardUrl || Config.heliusStandardWebsocketUrl || enhancedUrl);
  if (!enhancedUrl) throw new Error('HELIUS_ENHANCED_WEBSOCKET_URL is required for transactionSubscribe');
  if (!standardUrl) throw new Error('HELIUS_STANDARD_WEBSOCKET_URL or HELIUS_ENHANCED_WEBSOCKET_URL is required for logsSubscribe');

  const generatedAt = nowIso();
  const creditsBefore = args.creditsBefore === undefined ? null : Number(args.creditsBefore);
  console.log(`Starting read-only Helius Pump.fun two-arm probe: durationMs=${durationMs} programId=${programId}`);
  console.log(`transactionUrl=${sanitizeUrl(enhancedUrl)} logsUrl=${sanitizeUrl(standardUrl)}`);

  const lagMonitor = startEventLoopMonitor();
  const [transactionConfirmed, logsProcessed] = await Promise.all([
    runArm({
      name: 'transactionConfirmed',
      arm: PREREGISTERED.arms.transactionConfirmed,
      url: enhancedUrl,
      programId,
      durationMs,
      pingIntervalMs,
      samplePolicy: PREREGISTERED.samplePolicy
    }),
    runArm({
      name: 'logsProcessed',
      arm: PREREGISTERED.arms.logsProcessed,
      url: standardUrl,
      programId,
      durationMs,
      pingIntervalMs,
      samplePolicy: PREREGISTERED.samplePolicy
    })
  ]);
  const eventLoopLagMs = lagMonitor.stop();

  const report = {
    generatedAt,
    completedAt: nowIso(),
    kind: 'helius_pumpfun_two_arm_probe',
    reportOnly: true,
    durationMs,
    programId,
    preregistered: PREREGISTERED,
    arms: { transactionConfirmed, logsProcessed },
    eventLoopLagMs,
    operatorCreditMeasurement: {
      creditsBefore: Number.isFinite(creditsBefore) ? creditsBefore : null,
      creditsAfter: null,
      creditsUsed: null,
      source: 'Helius dashboard plan credit usage counter'
    },
    byteComparison: {
      transactionBytes: transactionConfirmed.bytes,
      logsBytes: logsProcessed.bytes,
      transactionToLogsRatio: logsProcessed.bytes
        ? compact(transactionConfirmed.bytes / logsProcessed.bytes, 4)
        : null
    },
    estimatedStreamingCreditsAt20PerMb: compact(
      ((transactionConfirmed.bytes + logsProcessed.bytes) / 1000000) * 20,
      2
    ),
    note: 'Read-only probe. It opens Helius subscriptions and aggregates public on-chain notifications; it does not invoke Spectre trading, scoring, AI review, entries, exits, or live execution.'
  };
  report.assessment = assessReport(report, args.creditsUsed);

  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const latestPath = resolveRepoPath(args.latestPath, DEFAULT_LATEST_PATH);
  const reportPath = path.join(reportDir, `helius-pumpfun-feed-probe-${generatedAt.replace(/[:.]/g, '-')}.json`);
  writeJson(reportPath, report);
  writeJson(latestPath, report);

  console.log(`transaction: notifications=${transactionConfirmed.notifications} bytes=${transactionConfirmed.bytes} decoded=${transactionConfirmed.decodedTradeEvents}/${transactionConfirmed.tradeEventCandidates} reconnects=${transactionConfirmed.reconnects}`);
  console.log(`logs: notifications=${logsProcessed.notifications} bytes=${logsProcessed.bytes} decoded=${logsProcessed.decodedTradeEvents}/${logsProcessed.tradeEventCandidates} reconnects=${logsProcessed.reconnects}`);
  console.log(`Helius Pump.fun probe verdict: ${report.assessment.verdict}`);
  console.log(`Wrote Helius Pump.fun probe: ${reportPath}`);
  console.log(`Wrote latest Helius Pump.fun probe: ${latestPath}`);
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Helius Pump.fun probe failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  PREREGISTERED,
  assessReport,
  buildSubscriptionRequest,
  creditAssessment,
  extractNotificationError,
  extractLogs,
  normalizeLegacyReserveMetrics,
  parseArgs,
  percentile,
  sanitizeUrl
};
