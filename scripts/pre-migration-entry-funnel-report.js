#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-entry-funnel-latest.json');
const TARGETED_PARITY_PATH = path.join(ROOT, 'data', 'reports', 'pumpdev-targeted-curve-parity-latest.json');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function repoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function latestTelemetryFile() {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function num(value, digits = null) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return digits === null ? parsed : Number(parsed.toFixed(digits));
}

function pct(part, total, digits = 4) {
  return total > 0 ? num(part / total, digits) : null;
}

function bump(target, key, amount = 1) {
  const label = key || 'unknown';
  target[label] = (target[label] || 0) + amount;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) bump(counts, keyFn(row));
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function topObject(object = {}, limit = 12) {
  return Object.fromEntries(Object.entries(object)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit));
}

function topRows(rows = [], sorter, limit = 12) {
  return rows
    .slice()
    .sort(sorter)
    .slice(0, limit);
}

function bucketReadiness(value) {
  if (value === null || value === undefined || value === '') return 'unknown';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 'unknown';
  if (parsed >= 95) return 'near_95_plus';
  if (parsed >= 80) return 'near_80_95';
  if (parsed >= 50) return 'mid_50_80';
  return 'low_under_50';
}

function bucketAge(seconds) {
  if (seconds === null || seconds === undefined || seconds === '') return 'unknown';
  const parsed = Number(seconds);
  if (!Number.isFinite(parsed)) return 'unknown';
  if (parsed <= 5) return 'fresh_0_5s';
  if (parsed <= 15) return 'watch_5_15s';
  if (parsed <= 60) return 'stale_15_60s';
  return 'very_stale_60s_plus';
}

function addSample(samples, sample, limit = 5) {
  if (!Array.isArray(samples) || samples.length >= limit) return;
  samples.push(sample);
}

function walletTouchCount(context = {}, predicate) {
  if (!Array.isArray(context.wallets)) return 0;
  return context.wallets.filter(predicate).length;
}

function positiveWalletTouchCount(context = {}) {
  const explicit = num(context.positiveTouchCount ?? context.provenTouchCount ?? context.provenBuyCount);
  if (Number.isFinite(explicit)) return explicit;
  return walletTouchCount(context, (wallet = {}) => {
    const label = String(wallet.label || wallet.classification || wallet.category || wallet.bucket || '').toLowerCase();
    return label.includes('positive') || label.includes('proven') || label.includes('alpha');
  });
}

function avoidWalletTouchCount(context = {}) {
  const explicit = num(context.avoidTouchCount ?? context.negativeTouchCount ?? context.riskTouchCount);
  if (Number.isFinite(explicit)) return explicit;
  return walletTouchCount(context, (wallet = {}) => {
    const label = String(wallet.label || wallet.classification || wallet.category || wallet.bucket || '').toLowerCase();
    return label.includes('avoid') || label.includes('negative') || label.includes('risk') || label.includes('sniper');
  });
}

function hasWalletContext(payload = {}) {
  const context = payload.walletClassificationContext || null;
  const proof = payload.walletBridgeProof || null;
  return Boolean(context)
    || Boolean(proof)
    || Number(payload.requiredWalletContextTouchCount || 0) > 0
    || Number(payload.avoidWalletContextTouchCount || 0) > 0
    || Number(payload.highCurveWalletQualityPositiveTouchCount || 0) > 0
    || Number(proof?.walletTouchCount || 0) > 0;
}

function getMintRow(rowsByMint, mint, seed = {}) {
  let row = rowsByMint.get(mint);
  if (!row) {
    row = {
      mint,
      symbol: seed.symbol || null,
      firstSeenAtMs: null,
      lastSeenAtMs: null,
      eventTypes: {},
      observedRows: 0,
      firstCurveNearMissRows: 0,
      firstCurveFailedChecks: {},
      flaggedRows: 0,
      confirmedFlagRows: 0,
      flagReasons: {},
      guardRows: 0,
      flaggedGuardRows: 0,
      unflaggedGuardRows: 0,
      shadowGuardRows: 0,
      wouldEnterRows: 0,
      shadowWouldEnterRows: 0,
      wouldSkipRows: 0,
      guardReasons: {},
      shadowGuardReasons: {},
      guardOverrides: {},
      guardFailedChecks: {},
      shadowGuardFailedChecks: {},
      decisionRows: 0,
      skipDecisionRows: 0,
      skipReasons: {},
      entries: 0,
      exits: 0,
      maxScore: null,
      maxCurveProgress: null,
      maxRecentVolumeSol: null,
      maxTradeVelocityPerMin: null,
      maxCurveProgressDelta: null,
      maxCurveProgressDelta60s: null,
      bestReadinessPct: null,
      bestReadinessReason: null,
      curveNotAdvancingRows: 0,
      curveNotAdvancingReadinessBuckets: {},
      curveNotAdvancingNearThresholdRows: 0,
      curveNotAdvancingNegativeDeltaRows: 0,
      curveNotAdvancingPositive60sRows: 0,
      curveNotAdvancingMaxReadinessPct: null,
      curveNotAdvancingMinDeltaGap: null,
      curveNotAdvancingSamples: [],
      staleCurveRows: 0,
      firstCurveStaleRows: 0,
      highCurveStaleRows: 0,
      curveSnapshotAgeBuckets: {},
      noTrackedFirstTouchRows: 0,
      noTrackedFirstTouchWithWalletContextRows: 0,
      noTrackedFirstTouchWithPositiveTouchRows: 0,
      noTrackedFirstTouchWithAvoidTouchRows: 0,
      walletContextRows: 0,
      positiveWalletTouchRows: 0,
      avoidWalletTouchRows: 0,
      targetedParity: null
    };
    rowsByMint.set(mint, row);
  }
  if (!row.symbol && seed.symbol) row.symbol = seed.symbol;
  return row;
}

function recordCurveNotAdvancing(row, payload = {}) {
  if (payload.reason !== 'CURVE_NOT_ADVANCING' && payload.guardReason !== 'CURVE_NOT_ADVANCING') return;
  const delta = num(payload.curveProgressDelta);
  const delta60s = num(payload.curveProgressDelta60s);
  const threshold = num(payload.threshold ?? payload.curveProgressDeltaThreshold);
  const readinessRatio = ratio(delta, threshold, 'min');
  const readinessPct = Number.isFinite(readinessRatio) ? num(readinessRatio * 100, 2) : null;
  const deltaGap = Number.isFinite(delta) && Number.isFinite(threshold) ? num(threshold - delta, 6) : null;

  row.curveNotAdvancingRows += 1;
  bump(row.curveNotAdvancingReadinessBuckets, bucketReadiness(readinessPct));
  if (Number.isFinite(readinessPct)) {
    row.curveNotAdvancingMaxReadinessPct = row.curveNotAdvancingMaxReadinessPct === null
      ? readinessPct
      : Math.max(row.curveNotAdvancingMaxReadinessPct, readinessPct);
  }
  if (Number.isFinite(deltaGap)) {
    row.curveNotAdvancingMinDeltaGap = row.curveNotAdvancingMinDeltaGap === null
      ? deltaGap
      : Math.min(row.curveNotAdvancingMinDeltaGap, deltaGap);
  }
  if (Number.isFinite(readinessPct) && readinessPct >= 80) row.curveNotAdvancingNearThresholdRows += 1;
  if (Number.isFinite(delta) && delta < 0) row.curveNotAdvancingNegativeDeltaRows += 1;
  if (Number.isFinite(delta60s) && Number.isFinite(threshold) && delta60s >= threshold) row.curveNotAdvancingPositive60sRows += 1;

  addSample(row.curveNotAdvancingSamples, {
    reason: payload.reason || payload.guardReason || null,
    score: num(payload.score, 2),
    curveProgress: num(payload.curveProgress, 6),
    curveProgressDelta: num(delta, 6),
    curveProgressDelta60s: num(delta60s, 6),
    threshold: num(threshold, 6),
    readinessPct,
    deltaGap
  });
}

function recordStaleCurve(row, payload = {}) {
  const firstAge = num(payload.firstCurveSnapshotScalpCurveSnapshotAgeSeconds, 2);
  const highAge = num(payload.highCurveStaleSnapshotCurveSnapshotAgeSeconds, 2);
  const checks = Array.isArray(payload.failedChecks) ? payload.failedChecks : [];
  const firstStale = payload.firstCurveSnapshotScalpStaleCurveBlocked === true
    || checks.includes('FIRST_CURVE_SNAPSHOT_SCALP_STALE_CURVE_UPDATE');
  const highStale = payload.highCurveStaleSnapshotBlocked === true
    || checks.includes('HIGH_CURVE_STALE_CURVE_UPDATE');

  if (!firstStale && !highStale) return;
  row.staleCurveRows += 1;
  if (firstStale) {
    row.firstCurveStaleRows += 1;
    bump(row.curveSnapshotAgeBuckets, `first_${bucketAge(firstAge)}`);
  }
  if (highStale) {
    row.highCurveStaleRows += 1;
    bump(row.curveSnapshotAgeBuckets, `high_${bucketAge(highAge)}`);
  }
}

function recordWalletCoverage(row, payload = {}) {
  const context = payload.walletClassificationContext || {};
  const proof = payload.walletBridgeProof || {};
  const hasContext = hasWalletContext(payload);
  const positiveTouches = Math.max(
    Number(payload.highCurveWalletQualityPositiveTouchCount || 0),
    positiveWalletTouchCount(context) || 0,
    Number(proof.positiveOrProvenTouchCount || 0)
  );
  const avoidTouches = Math.max(
    Number(payload.avoidWalletContextTouchCount || 0),
    avoidWalletTouchCount(context) || 0,
    Number(proof.avoidTouchCount || 0)
  );
  if (hasContext) row.walletContextRows += 1;
  if (positiveTouches > 0 || payload.highCurveWalletQualityFirstPositiveTouch || proof.positiveFirstTouchBuy) row.positiveWalletTouchRows += 1;
  if (avoidTouches > 0) row.avoidWalletTouchRows += 1;

  const reasons = [payload.reason, payload.guardReason].filter(Boolean);
  const failedChecks = Array.isArray(payload.failedChecks) ? payload.failedChecks : [];
  const noTrackedFirstTouch = reasons.includes('CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY')
    || failedChecks.includes('CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY');
  if (!noTrackedFirstTouch) return;

  row.noTrackedFirstTouchRows += 1;
  if (hasContext) row.noTrackedFirstTouchWithWalletContextRows += 1;
  if (positiveTouches > 0 || payload.highCurveWalletQualityFirstPositiveTouch || proof.positiveFirstTouchBuy) {
    row.noTrackedFirstTouchWithPositiveTouchRows += 1;
  }
  if (avoidTouches > 0) row.noTrackedFirstTouchWithAvoidTouchRows += 1;
}

function paritySummary(row = {}) {
  if (!row || !row.mint) return null;
  return {
    mint: row.mint,
    symbol: row.symbol || null,
    semanticDiagnosis: row.semanticDiagnosis || null,
    absCurveDelta: num(row.absCurveDelta, 6),
    curveDelta: num(row.curveDelta, 6),
    providerCurveProgress: num(row.providerCurveProgress, 6),
    onchainCurveProgress: num(row.onchainCurveProgress, 6),
    providerToOnchainAgeMs: num(row.providerToOnchainAgeMs),
    onchainFresh: row.onchainFresh ?? null,
    accountFound: row.accountFound ?? null,
    complete: row.complete ?? null,
    targetClasses: Array.isArray(row.targetClasses) ? row.targetClasses : []
  };
}

function readTargetedParityIndex(filePath = TARGETED_PARITY_PATH) {
  const report = readJson(filePath, null);
  if (!report) return { report: null, byMint: new Map() };
  const byMint = new Map();
  const rows = []
    .concat(Array.isArray(report.rows) ? report.rows : [])
    .concat(Array.isArray(report.highDeltaRows) ? report.highDeltaRows : []);
  for (const row of rows) {
    if (!row?.mint) continue;
    const existing = byMint.get(row.mint);
    if (!existing || Number(row.absCurveDelta || 0) > Number(existing.absCurveDelta || 0)) {
      byMint.set(row.mint, paritySummary(row));
    }
  }
  return { report, byMint };
}

function updateWindow(row, atMs) {
  if (!Number.isFinite(atMs)) return;
  row.firstSeenAtMs = row.firstSeenAtMs === null ? atMs : Math.min(row.firstSeenAtMs, atMs);
  row.lastSeenAtMs = row.lastSeenAtMs === null ? atMs : Math.max(row.lastSeenAtMs, atMs);
}

function updateMax(row, key, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return;
  row[key] = row[key] === null ? parsed : Math.max(row[key], parsed);
}

function ratio(value, threshold, mode = 'min') {
  const actual = Number(value);
  const target = Number(threshold);
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return null;
  if (mode === 'max') {
    if (target < 0) return null;
    return Math.max(0, actual <= target ? 1 : target / Math.max(actual, 1e-12));
  }
  if (target <= 0) return actual >= target ? 1 : 0;
  return Math.min(1, Math.max(0, actual / target));
}

function decisionReadiness(payload = {}) {
  const candidates = [];
  if (payload.reason === 'LOW_SCORE' && Number(payload.threshold) >= 10) {
    candidates.push(ratio(payload.value ?? payload.score, payload.threshold, 'min'));
  }
  if (payload.reason === 'CURVE_NOT_ADVANCING') {
    candidates.push(ratio(payload.curveProgressDelta, payload.threshold, 'min'));
  }
  const firstCurve = payload.firstCurveSnapshotScalpThresholds || null;
  if (firstCurve) {
    candidates.push(ratio(payload.firstCurveSnapshotScalpScore, firstCurve.minScore, 'min'));
    candidates.push(ratio(payload.firstCurveSnapshotScalpCurveProgress, firstCurve.minCurveProgress, 'min'));
    candidates.push(ratio(payload.firstCurveSnapshotScalpRecentVolumeSol, firstCurve.minRecentVolumeSol, 'min'));
    candidates.push(ratio(payload.firstCurveSnapshotScalpTradeVelocityPerMin, firstCurve.minTradeVelocityPerMin, 'min'));
    candidates.push(ratio(payload.firstCurveSnapshotScalpInterestSignalCount, firstCurve.minInterestCount, 'min'));
    candidates.push(ratio(payload.firstCurveSnapshotScalpUniqueBuyerCount, firstCurve.minUniqueBuyerCount, 'min'));
    candidates.push(ratio(payload.firstCurveSnapshotScalpRiskWalletCount, firstCurve.maxRiskWalletCount, 'max'));
    candidates.push(ratio(payload.firstCurveSnapshotScalpSniperWalletCount, firstCurve.maxSniperWalletCount, 'max'));
    candidates.push(ratio(payload.firstCurveSnapshotScalpBuyRatio, firstCurve.minBuyRatio, 'min'));
  }
  const usable = candidates.filter(Number.isFinite);
  if (!usable.length) return null;
  return num(Math.min(...usable) * 100, 2);
}

function terminalStage(row) {
  if (row.entries > 0) return 'ENTERED';
  if (row.wouldEnterRows > 0) return 'WOULD_ENTER_NO_ENTRY';
  if (row.flaggedGuardRows > 0 || row.decisionRows > 0) return 'EVALUATED_AND_BLOCKED';
  if (row.shadowWouldEnterRows > 0) return 'UNFLAGGED_SHADOW_WOULD_ENTER';
  if (row.shadowGuardRows > 0) return 'UNFLAGGED_SHADOW_EVALUATED';
  if (row.flaggedRows > 0) return 'FLAGGED_NOT_EVALUATED';
  if (row.firstCurveNearMissRows > 0) return 'FIRST_CURVE_NEAR_MISS_ONLY';
  if (row.observedRows > 0) return 'OBSERVED_ONLY';
  return 'UNKNOWN';
}

async function readTelemetry(filePath) {
  const rowsByMint = new Map();
  const eventCounts = {};
  let malformedLines = 0;
  let eventRows = 0;
  let startMs = Infinity;
  let endMs = -Infinity;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line.replace(/^\uFEFF/, ''));
    } catch {
      malformedLines += 1;
      continue;
    }
    eventRows += 1;
    const type = eventType(event);
    const payload = payloadOf(event);
    const mint = mintOf(payload);
    const atMs = timestampMs(payload.timestamp || event.timestamp);
    bump(eventCounts, type);
    if (Number.isFinite(atMs)) {
      startMs = Math.min(startMs, atMs);
      endMs = Math.max(endMs, atMs);
    }
    if (!mint) continue;

    const row = getMintRow(rowsByMint, mint, { symbol: payload.symbol });
    updateWindow(row, atMs);
    bump(row.eventTypes, type);
    row.observedRows += 1;
    updateMax(row, 'maxScore', payload.score ?? payload.entryScore);
    updateMax(row, 'maxCurveProgress', payload.curveProgress ?? payload.providerCurveProgress ?? payload.bondingCurveProgress);
    updateMax(row, 'maxRecentVolumeSol', payload.recentVolumeSol);
    updateMax(row, 'maxTradeVelocityPerMin', payload.tradeVelocityPerMin);
    updateMax(row, 'maxCurveProgressDelta', payload.curveProgressDelta);
    updateMax(row, 'maxCurveProgressDelta60s', payload.curveProgressDelta60s);

    if (type === 'pre_migration_paper.first_curve_snapshot_near_miss') {
      row.firstCurveNearMissRows += 1;
      for (const check of payload.failedChecks || []) bump(row.firstCurveFailedChecks, check);
    } else if (type === 'pre_migration.flagged') {
      row.flaggedRows += 1;
      if (payload.confirmed === true || payload.newlyConfirmed === true) row.confirmedFlagRows += 1;
      for (const reason of payload.reasons || []) bump(row.flagReasons, reason);
    } else if (type === 'pre_migration_paper.guard_attribution') {
      const shadowOnly = payload.shadowOnly === true;
      row.guardRows += 1;
      if (payload.flagged === true) row.flaggedGuardRows += 1;
      if (payload.flagged !== true) row.unflaggedGuardRows += 1;
      if (shadowOnly) row.shadowGuardRows += 1;
      if (payload.outcome === 'PAPER_WOULD_ENTER') {
        if (shadowOnly) {
          row.shadowWouldEnterRows += 1;
        } else {
          row.wouldEnterRows += 1;
        }
      }
      if (payload.outcome === 'PAPER_WOULD_SKIP') row.wouldSkipRows += 1;
      bump(row.guardReasons, payload.guardReason || payload.reason);
      bump(row.guardOverrides, payload.guardOverride || 'none');
      for (const check of payload.failedChecks || []) bump(row.guardFailedChecks, check);
      if (shadowOnly) {
        bump(row.shadowGuardReasons, payload.guardReason || payload.reason);
        for (const check of payload.failedChecks || []) bump(row.shadowGuardFailedChecks, check);
      }
      recordCurveNotAdvancing(row, payload);
      recordStaleCurve(row, payload);
      recordWalletCoverage(row, payload);
    } else if (type === 'pre_migration_paper.decision') {
      row.decisionRows += 1;
      if (payload.decision === 'PAPER_SKIPPED') {
        row.skipDecisionRows += 1;
        bump(row.skipReasons, payload.reason);
      }
      const readinessPct = decisionReadiness(payload);
      if (Number.isFinite(readinessPct) && (row.bestReadinessPct === null || readinessPct > row.bestReadinessPct)) {
        row.bestReadinessPct = readinessPct;
        row.bestReadinessReason = payload.reason || null;
      }
      recordCurveNotAdvancing(row, payload);
      recordStaleCurve(row, payload);
      recordWalletCoverage(row, payload);
    } else if (type === 'pre_migration_paper.entry') {
      row.entries += 1;
    } else if (type === 'pre_migration_paper.exit') {
      row.exits += 1;
    }
  }

  return {
    filePath,
    eventRows,
    malformedLines,
    eventCounts,
    startAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    endAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
    rows: Array.from(rowsByMint.values()).map((row) => ({
      ...row,
      firstSeenAt: row.firstSeenAtMs === null ? null : new Date(row.firstSeenAtMs).toISOString(),
      lastSeenAt: row.lastSeenAtMs === null ? null : new Date(row.lastSeenAtMs).toISOString(),
      terminalStage: terminalStage(row),
      topFlagReasons: topObject(row.flagReasons, 6),
      topGuardReasons: topObject(row.guardReasons, 6),
      topShadowGuardReasons: topObject(row.shadowGuardReasons, 6),
      topGuardFailedChecks: topObject(row.guardFailedChecks, 6),
      topShadowGuardFailedChecks: topObject(row.shadowGuardFailedChecks, 6),
      topSkipReasons: topObject(row.skipReasons, 6),
      topFirstCurveFailedChecks: topObject(row.firstCurveFailedChecks, 6),
      maxScore: num(row.maxScore, 2),
      maxCurveProgress: num(row.maxCurveProgress, 6),
      maxRecentVolumeSol: num(row.maxRecentVolumeSol, 4),
      maxTradeVelocityPerMin: num(row.maxTradeVelocityPerMin, 2),
      maxCurveProgressDelta: num(row.maxCurveProgressDelta, 6),
      maxCurveProgressDelta60s: num(row.maxCurveProgressDelta60s, 6),
      curveNotAdvancingMaxReadinessPct: num(row.curveNotAdvancingMaxReadinessPct, 2),
      curveNotAdvancingMinDeltaGap: num(row.curveNotAdvancingMinDeltaGap, 6)
    }))
  };
}

function summarize(rows, telemetry, parityReport = null) {
  const observed = rows.length;
  const firstCurve = rows.filter((row) => row.firstCurveNearMissRows > 0);
  const flagged = rows.filter((row) => row.flaggedRows > 0);
  const confirmed = rows.filter((row) => row.confirmedFlagRows > 0);
  const evaluated = rows.filter((row) => row.flaggedGuardRows > 0 || row.decisionRows > 0);
  const unflaggedShadowEvaluated = rows.filter((row) => row.shadowGuardRows > 0);
  const wouldEnter = rows.filter((row) => row.wouldEnterRows > 0);
  const shadowWouldEnter = rows.filter((row) => row.shadowWouldEnterRows > 0);
  const entered = rows.filter((row) => row.entries > 0);
  const guardRows = rows.reduce((sum, row) => sum + row.guardRows, 0);
  const flaggedGuardRows = rows.reduce((sum, row) => sum + row.flaggedGuardRows, 0);
  const unflaggedGuardRows = rows.reduce((sum, row) => sum + row.unflaggedGuardRows, 0);
  const shadowGuardRows = rows.reduce((sum, row) => sum + row.shadowGuardRows, 0);
  const decisionRows = rows.reduce((sum, row) => sum + row.decisionRows, 0);
  const skippedRows = rows.reduce((sum, row) => sum + row.skipDecisionRows, 0);

  const allGuardReasons = {};
  const allShadowGuardReasons = {};
  const allSkipReasons = {};
  const allGuardFailedChecks = {};
  const allShadowGuardFailedChecks = {};
  const allFirstCurveFailedChecks = {};
  const allFlagReasons = {};
  const curveReadinessBuckets = {};
  const curveAgeBuckets = {};
  const parityDiagnosisCounts = {};
  for (const row of rows) {
    Object.entries(row.guardReasons).forEach(([key, value]) => bump(allGuardReasons, key, value));
    Object.entries(row.shadowGuardReasons).forEach(([key, value]) => bump(allShadowGuardReasons, key, value));
    Object.entries(row.skipReasons).forEach(([key, value]) => bump(allSkipReasons, key, value));
    Object.entries(row.guardFailedChecks).forEach(([key, value]) => bump(allGuardFailedChecks, key, value));
    Object.entries(row.shadowGuardFailedChecks).forEach(([key, value]) => bump(allShadowGuardFailedChecks, key, value));
    Object.entries(row.firstCurveFailedChecks).forEach(([key, value]) => bump(allFirstCurveFailedChecks, key, value));
    Object.entries(row.flagReasons).forEach(([key, value]) => bump(allFlagReasons, key, value));
    Object.entries(row.curveNotAdvancingReadinessBuckets || {}).forEach(([key, value]) => bump(curveReadinessBuckets, key, value));
    Object.entries(row.curveSnapshotAgeBuckets || {}).forEach(([key, value]) => bump(curveAgeBuckets, key, value));
    if (row.targetedParity?.semanticDiagnosis) bump(parityDiagnosisCounts, row.targetedParity.semanticDiagnosis);
  }
  const curveRows = rows.filter((row) => row.curveNotAdvancingRows > 0);
  const firstTouchRows = rows.filter((row) => row.noTrackedFirstTouchRows > 0);
  const staleRows = rows.filter((row) => row.staleCurveRows > 0);
  const parityRows = rows.filter((row) => row.targetedParity);
  const parityHighDeltaRows = parityRows.filter((row) => Number(row.targetedParity?.absCurveDelta || 0) > 0.05);

  return {
    telemetryPath: path.relative(ROOT, telemetry.filePath),
    startAt: telemetry.startAt,
    endAt: telemetry.endAt,
    telemetryEvents: telemetry.eventRows,
    malformedLines: telemetry.malformedLines,
    observedMints: observed,
    firstCurveNearMissMints: firstCurve.length,
    flaggedMints: flagged.length,
    confirmedFlagMints: confirmed.length,
    evaluatedMints: evaluated.length,
    unflaggedShadowEvaluatedMints: unflaggedShadowEvaluated.length,
    wouldEnterMints: wouldEnter.length,
    unflaggedShadowWouldEnterMints: shadowWouldEnter.length,
    enteredMints: entered.length,
    guardRows,
    flaggedGuardRows,
    unflaggedGuardRows,
    shadowGuardRows,
    decisionRows,
    skippedRows,
    funnelRates: {
      flaggedPerObserved: pct(flagged.length, observed),
      evaluatedPerFlagged: pct(evaluated.length, flagged.length),
      wouldEnterPerEvaluated: pct(wouldEnter.length, evaluated.length),
      enteredPerEvaluated: pct(entered.length, evaluated.length)
    },
    shadowRates: {
      unflaggedShadowEvaluatedPerObservedNotFlagged: pct(unflaggedShadowEvaluated.length, observed - flagged.length),
      unflaggedShadowWouldEnterPerShadowEvaluated: pct(shadowWouldEnter.length, unflaggedShadowEvaluated.length)
    },
    dropoffs: {
      observedNotFlaggedMints: observed - flagged.length,
      flaggedNotEvaluatedMints: flagged.filter((row) => row.flaggedGuardRows === 0 && row.decisionRows === 0).length,
      evaluatedNeverWouldEnterMints: evaluated.length - wouldEnter.length,
      wouldEnterNoEntryMints: wouldEnter.length - entered.length,
      unflaggedShadowWouldEnterMints: shadowWouldEnter.length
    },
    terminalStageCounts: countBy(rows, (row) => row.terminalStage),
    topFlagReasons: topObject(allFlagReasons),
    topGuardReasons: topObject(allGuardReasons),
    topShadowGuardReasons: topObject(allShadowGuardReasons),
    topSkipReasons: topObject(allSkipReasons),
    topGuardFailedChecks: topObject(allGuardFailedChecks),
    topShadowGuardFailedChecks: topObject(allShadowGuardFailedChecks),
    topFirstCurveFailedChecks: topObject(allFirstCurveFailedChecks),
    curveNotAdvancingDiagnostics: {
      mints: curveRows.length,
      rows: curveRows.reduce((sum, row) => sum + row.curveNotAdvancingRows, 0),
      nearThresholdRows: curveRows.reduce((sum, row) => sum + row.curveNotAdvancingNearThresholdRows, 0),
      negativeDeltaRows: curveRows.reduce((sum, row) => sum + row.curveNotAdvancingNegativeDeltaRows, 0),
      positive60sRows: curveRows.reduce((sum, row) => sum + row.curveNotAdvancingPositive60sRows, 0),
      readinessBuckets: topObject(curveReadinessBuckets),
      topNearThresholdMints: topRows(
        curveRows.filter((row) => Number.isFinite(Number(row.curveNotAdvancingMaxReadinessPct))),
        (a, b) => Number(b.curveNotAdvancingMaxReadinessPct ?? -1) - Number(a.curveNotAdvancingMaxReadinessPct ?? -1),
        10
      ).map((row) => ({
        mint: row.mint,
        symbol: row.symbol,
        rows: row.curveNotAdvancingRows,
        maxReadinessPct: num(row.curveNotAdvancingMaxReadinessPct, 2),
        minDeltaGap: num(row.curveNotAdvancingMinDeltaGap, 6),
        maxScore: num(row.maxScore, 2),
        maxCurveProgress: num(row.maxCurveProgress, 6),
        samples: row.curveNotAdvancingSamples
      }))
    },
    staleCurveDiagnostics: {
      mints: staleRows.length,
      rows: staleRows.reduce((sum, row) => sum + row.staleCurveRows, 0),
      firstCurveStaleRows: staleRows.reduce((sum, row) => sum + row.firstCurveStaleRows, 0),
      highCurveStaleRows: staleRows.reduce((sum, row) => sum + row.highCurveStaleRows, 0),
      ageBuckets: topObject(curveAgeBuckets)
    },
    firstTouchDiagnostics: {
      mints: firstTouchRows.length,
      rows: firstTouchRows.reduce((sum, row) => sum + row.noTrackedFirstTouchRows, 0),
      withWalletContextRows: firstTouchRows.reduce((sum, row) => sum + row.noTrackedFirstTouchWithWalletContextRows, 0),
      withPositiveTouchRows: firstTouchRows.reduce((sum, row) => sum + row.noTrackedFirstTouchWithPositiveTouchRows, 0),
      withAvoidTouchRows: firstTouchRows.reduce((sum, row) => sum + row.noTrackedFirstTouchWithAvoidTouchRows, 0),
      walletContextRows: rows.reduce((sum, row) => sum + row.walletContextRows, 0),
      positiveWalletTouchRows: rows.reduce((sum, row) => sum + row.positiveWalletTouchRows, 0),
      avoidWalletTouchRows: rows.reduce((sum, row) => sum + row.avoidWalletTouchRows, 0),
      topMints: topRows(
        firstTouchRows,
        (a, b) => Number(b.noTrackedFirstTouchRows || 0) - Number(a.noTrackedFirstTouchRows || 0),
        10
      ).map((row) => ({
        mint: row.mint,
        symbol: row.symbol,
        noTrackedFirstTouchRows: row.noTrackedFirstTouchRows,
        withWalletContextRows: row.noTrackedFirstTouchWithWalletContextRows,
        withPositiveTouchRows: row.noTrackedFirstTouchWithPositiveTouchRows,
        withAvoidTouchRows: row.noTrackedFirstTouchWithAvoidTouchRows,
        targetedParity: row.targetedParity
      }))
    },
    targetedParityDiagnostics: {
      sourcePath: fs.existsSync(TARGETED_PARITY_PATH) ? path.relative(ROOT, TARGETED_PARITY_PATH) : null,
      sampledTargets: parityReport?.summary?.sampledTargets ?? null,
      comparableRows: parityReport?.summary?.comparableRows ?? null,
      highDeltaCountGt005: parityReport?.summary?.highDeltaCountGt005 ?? null,
      joinedMints: parityRows.length,
      joinedHighDeltaMints: parityHighDeltaRows.length,
      semanticDiagnosisCounts: topObject(parityDiagnosisCounts),
      topHighDeltaMints: topRows(
        parityRows,
        (a, b) => Number(b.targetedParity?.absCurveDelta || 0) - Number(a.targetedParity?.absCurveDelta || 0),
        10
      ).map((row) => ({
        mint: row.mint,
        symbol: row.symbol,
        absCurveDelta: num(row.targetedParity?.absCurveDelta, 6),
        semanticDiagnosis: row.targetedParity?.semanticDiagnosis || null,
        noTrackedFirstTouchRows: row.noTrackedFirstTouchRows,
        curveNotAdvancingRows: row.curveNotAdvancingRows
      }))
    }
  };
}

function selectRows(rows) {
  const blocked = rows
    .filter((row) => row.terminalStage === 'EVALUATED_AND_BLOCKED')
    .sort((a, b) => Number(b.bestReadinessPct ?? -1) - Number(a.bestReadinessPct ?? -1))
    .slice(0, 20);
  const highScoreBlocked = rows
    .filter((row) => row.terminalStage === 'EVALUATED_AND_BLOCKED')
    .sort((a, b) => Number(b.maxScore ?? -1) - Number(a.maxScore ?? -1))
    .slice(0, 20);
  const flaggedNotEvaluated = rows
    .filter((row) => row.flaggedRows > 0 && row.flaggedGuardRows === 0 && row.decisionRows === 0)
    .sort((a, b) => Number(b.maxScore ?? -1) - Number(a.maxScore ?? -1))
    .slice(0, 20);
  const unflaggedShadowWouldEnter = rows
    .filter((row) => row.terminalStage === 'UNFLAGGED_SHADOW_WOULD_ENTER')
    .sort((a, b) => Number(b.maxScore ?? -1) - Number(a.maxScore ?? -1))
    .slice(0, 20);
  const unflaggedShadowBlocked = rows
    .filter((row) => row.terminalStage === 'UNFLAGGED_SHADOW_EVALUATED')
    .sort((a, b) => Number(b.maxScore ?? -1) - Number(a.maxScore ?? -1))
    .slice(0, 20);
  const firstCurveOnly = rows
    .filter((row) => row.terminalStage === 'FIRST_CURVE_NEAR_MISS_ONLY')
    .sort((a, b) => Number(b.maxScore ?? -1) - Number(a.maxScore ?? -1))
    .slice(0, 20);
  return { closestBlocked: blocked, highScoreBlocked, flaggedNotEvaluated, unflaggedShadowWouldEnter, unflaggedShadowBlocked, firstCurveOnly };
}

function applyTargetedParity(rows, parityByMint) {
  if (!parityByMint || parityByMint.size === 0) return;
  for (const row of rows) {
    const parity = parityByMint.get(row.mint);
    if (parity) row.targetedParity = parity;
  }
}

function printReport(report) {
  const s = report.summary;
  console.log('Pre-Migration Entry Funnel');
  console.log(`Telemetry: ${s.telemetryPath}`);
  console.log(`Observed/flagged/evaluated/wouldEnter/entered mints: ${s.observedMints}/${s.flaggedMints}/${s.evaluatedMints}/${s.wouldEnterMints}/${s.enteredMints}`);
  console.log(`Unflagged shadow evaluated/wouldEnter mints: ${s.unflaggedShadowEvaluatedMints}/${s.unflaggedShadowWouldEnterMints}`);
  console.log(`Guard rows flagged/unflagged-shadow/all: ${s.flaggedGuardRows}/${s.shadowGuardRows}/${s.guardRows}; decision/skipped rows: ${s.decisionRows}/${s.skippedRows}`);
  console.log(`Dropoffs: observedNotFlagged=${s.dropoffs.observedNotFlaggedMints}, flaggedNotEvaluated=${s.dropoffs.flaggedNotEvaluatedMints}, evaluatedNeverWouldEnter=${s.dropoffs.evaluatedNeverWouldEnterMints}`);
  console.log('Top skip reasons:');
  Object.entries(s.topSkipReasons).slice(0, 8).forEach(([key, value]) => console.log(`  - ${key}: ${value}`));
  const curve = s.curveNotAdvancingDiagnostics || {};
  console.log(`CURVE_NOT_ADVANCING diagnostics: rows=${curve.rows || 0}, mints=${curve.mints || 0}, nearThreshold=${curve.nearThresholdRows || 0}, positive60s=${curve.positive60sRows || 0}, negativeDelta=${curve.negativeDeltaRows || 0}`);
  console.log('CURVE_NOT_ADVANCING readiness buckets:');
  Object.entries(curve.readinessBuckets || {}).slice(0, 8).forEach(([key, value]) => console.log(`  - ${key}: ${value}`));
  const touch = s.firstTouchDiagnostics || {};
  console.log(`First-touch proof diagnostics: rows=${touch.rows || 0}, mints=${touch.mints || 0}, withWalletContext=${touch.withWalletContextRows || 0}, withPositiveTouch=${touch.withPositiveTouchRows || 0}, withAvoidTouch=${touch.withAvoidTouchRows || 0}`);
  const stale = s.staleCurveDiagnostics || {};
  console.log(`Stale curve diagnostics: rows=${stale.rows || 0}, firstCurve=${stale.firstCurveStaleRows || 0}, highCurve=${stale.highCurveStaleRows || 0}`);
  const parity = s.targetedParityDiagnostics || {};
  console.log(`Targeted parity join: joined=${parity.joinedMints || 0}, highDelta=${parity.joinedHighDeltaMints || 0}, sampled=${parity.sampledTargets ?? 'n/a'}, comparable=${parity.comparableRows ?? 'n/a'}`);
  Object.entries(parity.semanticDiagnosisCounts || {}).slice(0, 6).forEach(([key, value]) => console.log(`  - ${key}: ${value}`));
  console.log('Top guard failed checks:');
  Object.entries(s.topGuardFailedChecks).slice(0, 8).forEach(([key, value]) => console.log(`  - ${key}: ${value}`));
  console.log('Top unflagged shadow failed checks:');
  Object.entries(s.topShadowGuardFailedChecks).slice(0, 8).forEach(([key, value]) => console.log(`  - ${key}: ${value}`));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry) || latestTelemetryFile();
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    console.error('No telemetry file found. Pass --telemetry <path> or run a paper session first.');
    process.exit(1);
  }

  const telemetry = await readTelemetry(telemetryPath);
  const { report: targetedParityReport, byMint: targetedParityByMint } = readTargetedParityIndex();
  applyTargetedParity(telemetry.rows, targetedParityByMint);
  const summary = summarize(telemetry.rows, telemetry, targetedParityReport);
  const selections = selectRows(telemetry.rows);
  const output = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_pre_migration_entry_funnel',
    note: 'Counts the pre-migration entry funnel from observed mint telemetry through flags, guard evaluation, paper decisions, would-enter rows, and actual paper entries. Unflagged shadow rows are report-only guard attributions and do not create paper entries. Does not change gates or live behavior.',
    summary,
    ...selections
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  printReport(output);
  console.log(`Wrote JSON report: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
