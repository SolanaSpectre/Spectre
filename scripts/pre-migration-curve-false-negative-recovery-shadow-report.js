#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-curve-false-negative-recovery-shadow-latest.json');
const EVENT_TYPES = new Set([
  'pre_migration_curve_false_negative_recovery_shadow.would_enter',
  'pre_migration_curve_false_negative_recovery_shadow.would_skip'
]);
const PARITY_FAILED_CHECKS = new Set([
  'CURVE_FALSE_NEGATIVE_RECOVERY_SHADOW_MISSING_ONCHAIN_CURVE_PARITY',
  'CURVE_FALSE_NEGATIVE_RECOVERY_SHADOW_CURVE_PARITY_MISMATCH'
]);
const WINDOWS_SECONDS = [120, 300];

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

function telemetryFromBattlefield() {
  try {
    const report = JSON.parse(fs.readFileSync(BATTLEFIELD_PATH, 'utf8').replace(/^\uFEFF/, ''));
    return report.files?.telemetryPath || report.telemetryPath || null;
  } catch {
    return null;
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

function numberOrNull(value, digits = null) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stat(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    median: numberOrNull(pick(0.5), digits),
    p90: numberOrNull(pick(0.9), digits),
    max: numberOrNull(finite[finite.length - 1], digits),
    avg: numberOrNull(sum / finite.length, digits)
  };
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function curveOf(payload) {
  const raw = payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.recovery?.lastCurveProgress
    ?? payload.curveParity?.providerCurveProgress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  return curve > 1 && curve <= 100 ? curve / 100 : curve;
}

function priceOf(payload) {
  const raw = payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function snapshotFromEvent(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceOf(payload), 12),
    eventType: eventType(event)
  };
}

function paritySampleFromEvent(event) {
  if (eventType(event) !== 'pumpdev.targeted_curve_parity_sample') return null;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.onchainFetchedAt || event.timestamp || payload.scheduledAt);
  if (!mint || !Number.isFinite(atMs)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    trigger: payload.trigger || null,
    providerAt: payload.providerAt || null,
    providerCurveProgress: numberOrNull(payload.providerCurveProgress, 6),
    onchainFetchedAt: payload.onchainFetchedAt || null,
    onchainFresh: payload.onchainFresh === true,
    refreshed: payload.refreshed === true,
    accountFound: payload.accountFound === true,
    invalidAccountData: payload.invalidAccountData === true,
    bondingCurveValidated: payload.bondingCurveValidated === true,
    bondingCurveValidationReason: payload.bondingCurveValidationReason || null,
    bondingCurveAccountOwner: payload.bondingCurveAccountOwner || null,
    timedOut: payload.timedOut === true,
    latencyMs: numberOrNull(payload.latencyMs, 0),
    onchainFetchLatencyMs: numberOrNull(payload.onchainFetchLatencyMs, 0),
    onchainCurveProgress: numberOrNull(payload.onchainCurveProgress, 6),
    curveDelta: numberOrNull(payload.curveDelta, 6),
    absCurveDelta: numberOrNull(payload.absCurveDelta, 6),
    lastErrorMessage: payload.lastErrorMessage || payload.error || null
  };
}

function walletDiagnosticFromEvent(event) {
  if (eventType(event) !== 'wallet.trade_gate_diagnostic') return null;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    symbol: payload.symbol || null,
    wallet: payload.wallet || null,
    txType: String(payload.txType || payload.side || '').toLowerCase() || null,
    dropReason: payload.dropReason || null,
    trackedAccountMatch: payload.trackedAccountMatch === true,
    kolWalletProfileMatch: payload.kolWalletProfileMatch === true,
    ledgerRecord: payload.ledgerRecord === true,
    source: payload.source || payload.provider || null
  };
}

function shadowFromEvent(event) {
  const type = eventType(event);
  if (!EVENT_TYPES.has(type)) return null;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  const failedChecks = Array.isArray(payload.failedChecks) ? payload.failedChecks : [];
  return {
    mint,
    symbol: payload.symbol || null,
    atMs,
    at: new Date(atMs).toISOString(),
    eventType: type,
    wouldEnter: type.endsWith('.would_enter') || payload.decision === 'RECOVERY_SHADOW_WOULD_ENTER',
    reason: payload.reason || null,
    failedChecks,
    paperEntryPaused: payload.paperEntryPaused === true,
    sourceReason: payload.sourceReason || null,
    score: numberOrNull(payload.score, 2),
    curveProgress: numberOrNull(curveOf(payload), 6),
    recentVolumeSol: numberOrNull(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: numberOrNull(payload.tradeVelocityPerMin, 2),
    buyRatio: numberOrNull(payload.buyRatio, 4),
    walletTouchCount: numberOrNull(payload.walletTouchCount, 0),
    positiveOrProvenTouchCount: numberOrNull(payload.positiveOrProvenTouchCount, 0),
    avoidTouchCount: numberOrNull(payload.avoidTouchCount, 0),
    trackedFirstTouchBuy: payload.trackedFirstTouchBuy || null,
    recovery: payload.recovery || null,
    noTrackedSellAfterQualifyingBuy: payload.noTrackedSellAfterQualifyingBuy || null,
    curveParity: payload.curveParity || null,
    thresholdDecision: payload.thresholdDecision || null,
    priceSol: numberOrNull(priceOf(payload), 12)
  };
}

async function readTelemetry(filePath) {
  const shadows = [];
  const snapshotsByMint = new Map();
  const paritySamplesByMint = new Map();
  const walletDiagnosticsByMint = new Map();
  let malformedLines = 0;
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
    const snapshot = snapshotFromEvent(event);
    if (snapshot) {
      const rows = snapshotsByMint.get(snapshot.mint) || [];
      rows.push(snapshot);
      snapshotsByMint.set(snapshot.mint, rows);
    }
    const paritySample = paritySampleFromEvent(event);
    if (paritySample) {
      const rows = paritySamplesByMint.get(paritySample.mint) || [];
      rows.push(paritySample);
      paritySamplesByMint.set(paritySample.mint, rows);
    }
    const walletDiagnostic = walletDiagnosticFromEvent(event);
    if (walletDiagnostic) {
      const rows = walletDiagnosticsByMint.get(walletDiagnostic.mint) || [];
      rows.push(walletDiagnostic);
      walletDiagnosticsByMint.set(walletDiagnostic.mint, rows);
    }
    const shadow = shadowFromEvent(event);
    if (shadow) shadows.push(shadow);
  }

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  for (const rows of paritySamplesByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  for (const rows of walletDiagnosticsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  shadows.sort((a, b) => a.atMs - b.atMs);
  return { shadows, snapshotsByMint, paritySamplesByMint, walletDiagnosticsByMint, malformedLines };
}

function windowAnalysis(shadow, snapshots, seconds) {
  const future = snapshots.filter((snapshot) => snapshot.atMs > shadow.atMs && snapshot.atMs <= shadow.atMs + seconds * 1000);
  const curves = future.map((snapshot) => Number(snapshot.curveProgress)).filter(Number.isFinite);
  const prices = future.map((snapshot) => Number(snapshot.priceSol)).filter(Number.isFinite);
  const maxCurve = curves.length ? Math.max(...curves) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const curveDelta = maxCurve !== null && shadow.curveProgress !== null ? maxCurve - Number(shadow.curveProgress) : null;
  const priceDelta = maxPrice !== null && Number.isFinite(Number(shadow.priceSol)) && Number(shadow.priceSol) > 0
    ? ((maxPrice - Number(shadow.priceSol)) / Number(shadow.priceSol)) * 100
    : null;
  return {
    seconds,
    futureSnapshotCount: future.length,
    maxCurveProgress: numberOrNull(maxCurve, 6),
    curveDelta: numberOrNull(curveDelta, 6),
    maxPriceDeltaPct: numberOrNull(priceDelta, 2),
    crossed85: Number.isFinite(Number(maxCurve)) && maxCurve >= 0.85,
    crossed90: Number.isFinite(Number(maxCurve)) && maxCurve >= 0.9,
    crossed95: Number.isFinite(Number(maxCurve)) && maxCurve >= 0.95
  };
}

function nearestParitySample(shadow, samples = []) {
  const future = samples.filter((sample) => sample.atMs >= shadow.atMs && sample.atMs <= shadow.atMs + 30_000);
  if (future.length) return future[0];
  const prior = samples.filter((sample) => sample.atMs < shadow.atMs && shadow.atMs - sample.atMs <= 30_000);
  return prior[prior.length - 1] || null;
}

function parityStatus(shadow, sample = null) {
  const parity = shadow.curveParity || {};
  const maxAbsCurveDelta = Number(parity.maxAbsCurveDelta ?? 0.03);
  const providerCurve = numberOrNull(sample?.providerCurveProgress ?? parity.providerCurveProgress ?? shadow.curveProgress, 6);
  const onchainCurve = numberOrNull(sample?.onchainCurveProgress ?? parity.onchainCurveProgress, 6);
  const sampleCurveDelta = finiteNumber(sample?.curveDelta);
  const providerCurveNumber = finiteNumber(providerCurve);
  const onchainCurveNumber = finiteNumber(onchainCurve);
  const curveDelta = sampleCurveDelta !== null
    ? sampleCurveDelta
    : onchainCurveNumber !== null && providerCurveNumber !== null
      ? onchainCurveNumber - providerCurveNumber
      : null;
  const absCurveDelta = finiteNumber(curveDelta) !== null ? Math.abs(Number(curveDelta)) : null;

  let status = parity.status || null;
  let source = sample ? 'targeted_sample' : 'runtime_payload';
  let detail = parity.reason || shadow.reason || null;

  if (sample) {
    if (sample.timedOut) {
      status = 'RPC_TIMEOUT';
      detail = sample.lastErrorMessage || 'TARGETED_PARITY_TIMEOUT';
    } else if (!sample.accountFound) {
      status = 'MISSING_ONCHAIN';
      detail = sample.lastErrorMessage || 'BONDING_CURVE_ACCOUNT_NOT_FOUND';
    } else if (sample.invalidAccountData) {
      status = 'INVALID_ONCHAIN_DATA';
      detail = sample.lastErrorMessage || 'INVALID_ACCOUNT_DATA';
    } else if (!sample.bondingCurveValidated) {
      status = 'UNVALIDATED_BONDING_CURVE';
      detail = sample.bondingCurveValidationReason || sample.lastErrorMessage || 'UNVALIDATED_BONDING_CURVE_ACCOUNT';
    } else if (!sample.onchainFresh || !sample.refreshed) {
      status = 'STALE_OR_UNREFRESHED_ONCHAIN_SAMPLE';
      detail = sample.lastErrorMessage || 'STALE_OR_UNREFRESHED_ONCHAIN_SAMPLE';
    } else if (onchainCurveNumber === null) {
      status = 'MISSING_ONCHAIN_CURVE';
      detail = sample.lastErrorMessage || 'NO_COMPARABLE_ONCHAIN_CURVE';
    } else if (finiteNumber(absCurveDelta) !== null && absCurveDelta <= maxAbsCurveDelta) {
      status = 'FULL_MATCH';
      detail = null;
    } else if (finiteNumber(curveDelta) !== null && curveDelta > maxAbsCurveDelta) {
      status = 'STALE_WS_OR_ADVANCED_ONCHAIN';
      detail = 'ONCHAIN_CURVE_AHEAD_OF_PROVIDER';
    } else {
      status = 'DIVERGED';
      detail = 'PROVIDER_ONCHAIN_CURVE_MISMATCH';
    }
  } else if (parity.passed === true) {
    status = 'FULL_MATCH';
    detail = null;
  } else if (!status && parity.reason === 'CURVE_FALSE_NEGATIVE_RECOVERY_SHADOW_MISSING_ONCHAIN_CURVE_PARITY') {
    status = 'MISSING_ONCHAIN_UNSAMPLED';
  } else if (!status && parity.reason === 'CURVE_FALSE_NEGATIVE_RECOVERY_SHADOW_CURVE_PARITY_MISMATCH') {
    status = 'DIVERGED';
  } else if (!status) {
    status = 'UNKNOWN';
  }

  return {
    status,
    source,
    detail,
    providerCurveProgress: providerCurve,
    onchainCurveProgress: onchainCurve,
    curveDelta: numberOrNull(curveDelta, 6),
    absCurveDelta: numberOrNull(absCurveDelta, 6),
    maxAbsCurveDelta: numberOrNull(maxAbsCurveDelta, 6),
    sampleAt: sample?.at || null,
    sampleTrigger: sample?.trigger || null,
    sampleLatencyMs: sample?.latencyMs ?? null
  };
}

function untrackedWalletContext(shadow, diagnostics = []) {
  const lookbackMs = 60_000;
  const before = diagnostics.filter((row) => row.atMs <= shadow.atMs && shadow.atMs - row.atMs <= lookbackMs);
  const untracked = before.filter((row) => row.dropReason === 'UNTRACKED_WALLET');
  const untrackedBuys = untracked.filter((row) => row.txType === 'buy');
  const untrackedSells = untracked.filter((row) => row.txType === 'sell');
  const uniqueBuyWallets = Array.from(new Set(untrackedBuys.map((row) => row.wallet).filter(Boolean)));
  const uniqueSellWallets = Array.from(new Set(untrackedSells.map((row) => row.wallet).filter(Boolean)));
  const firstBuy = untrackedBuys[0] || null;
  const lastBuy = untrackedBuys[untrackedBuys.length - 1] || null;
  return {
    lookbackMs,
    untrackedTradeCount: untracked.length,
    untrackedBuyCount: untrackedBuys.length,
    untrackedSellCount: untrackedSells.length,
    uniqueUntrackedBuyWallets: uniqueBuyWallets.length,
    uniqueUntrackedSellWallets: uniqueSellWallets.length,
    firstUntrackedBuyAt: firstBuy?.at || null,
    firstUntrackedBuyWallet: firstBuy?.wallet || null,
    lastUntrackedBuyAt: lastBuy?.at || null,
    lastUntrackedBuyWallet: lastBuy?.wallet || null,
    buyWallets: uniqueBuyWallets.slice(0, 8)
  };
}

function analyzeShadow(shadow, snapshots, paritySamples, walletDiagnostics) {
  const windows = {};
  for (const seconds of WINDOWS_SECONDS) windows[`${seconds}s`] = windowAnalysis(shadow, snapshots, seconds);
  const sample = nearestParitySample(shadow, paritySamples);
  const parityExplain = parityStatus(shadow, sample);
  const nonParityFailedChecks = (shadow.failedChecks || []).filter((check) => !PARITY_FAILED_CHECKS.has(check));
  const wouldEnterIfParityVerified = !shadow.wouldEnter
    && parityExplain.status === 'FULL_MATCH'
    && nonParityFailedChecks.length === 0;
  return {
    ...shadow,
    windows,
    parityExplain,
    nonParityFailedChecks,
    wouldEnterIfParityVerified,
    untrackedWalletContext: untrackedWalletContext(shadow, walletDiagnostics)
  };
}

function summarizeGroup(name, rows) {
  const w120 = rows.map((row) => row.windows['120s'] || {});
  const w300 = rows.map((row) => row.windows['300s'] || {});
  return {
    name,
    rows: rows.length,
    uniqueMints: new Set(rows.map((row) => row.mint)).size,
    crossed85Within120s: w120.filter((row) => row.crossed85).length,
    crossed90Within120s: w120.filter((row) => row.crossed90).length,
    crossed85Within300s: w300.filter((row) => row.crossed85).length,
    crossed90Within300s: w300.filter((row) => row.crossed90).length,
    curveDelta120s: stat(w120.map((row) => row.curveDelta), 6),
    maxPriceDeltaPct120s: stat(w120.map((row) => row.maxPriceDeltaPct), 2),
    curveDelta300s: stat(w300.map((row) => row.curveDelta), 6),
    maxPriceDeltaPct300s: stat(w300.map((row) => row.maxPriceDeltaPct), 2)
  };
}

function walletCoverageSummary(rows = []) {
  const withAnyWalletTouch = rows.filter((row) => Number(row.walletTouchCount || 0) > 0);
  const withPositiveOrProvenTouch = rows.filter((row) => Number(row.positiveOrProvenTouchCount || 0) > 0);
  const withAvoidTouch = rows.filter((row) => Number(row.avoidTouchCount || 0) > 0);
  const withTrackedFirstTouchBuy = rows.filter((row) => row.trackedFirstTouchBuy);
  const recoveryPassed = rows.filter((row) => row.recovery?.passed === true);
  const noSellPassed = rows.filter((row) => row.noTrackedSellAfterQualifyingBuy?.passed === true);
  const thresholdPassed = rows.filter((row) => row.thresholdDecision?.passed === true);
  return {
    rows: rows.length,
    withAnyWalletTouch: withAnyWalletTouch.length,
    withPositiveOrProvenTouch: withPositiveOrProvenTouch.length,
    withAvoidTouch: withAvoidTouch.length,
    withTrackedFirstTouchBuy: withTrackedFirstTouchBuy.length,
    recoveryPassed: recoveryPassed.length,
    noTrackedSellAfterQualifyingBuyPassed: noSellPassed.length,
    thresholdPassed: thresholdPassed.length,
    walletTouchContextRate: rows.length ? numberOrNull(withAnyWalletTouch.length / rows.length, 4) : null,
    positiveOrProvenContextRate: rows.length ? numberOrNull(withPositiveOrProvenTouch.length / rows.length, 4) : null,
    trackedFirstTouchBuyRate: rows.length ? numberOrNull(withTrackedFirstTouchBuy.length / rows.length, 4) : null,
    walletTouchByReason: countBy(rows.filter((row) => Number(row.walletTouchCount || 0) > 0), (row) => row.reason),
    noWalletTouchByReason: countBy(rows.filter((row) => Number(row.walletTouchCount || 0) <= 0), (row) => row.reason)
  };
}

function untrackedWalletCoverageSummary(rows = []) {
  const withUntrackedBuy = rows.filter((row) => Number(row.untrackedWalletContext?.untrackedBuyCount || 0) > 0);
  const withTwoPlusUntrackedBuyWallets = rows.filter((row) => Number(row.untrackedWalletContext?.uniqueUntrackedBuyWallets || 0) >= 2);
  const wallets = new Map();
  for (const row of rows) {
    for (const wallet of row.untrackedWalletContext?.buyWallets || []) {
      const current = wallets.get(wallet) || {
        wallet,
        rows: 0,
        uniqueMints: new Set(),
        fullMatchRows: 0,
        crossed85Within120s: 0,
        crossed90Within120s: 0,
        crossed95Within120s: 0,
        curveDelta120s: [],
        maxPriceDeltaPct120s: []
      };
      current.rows += 1;
      current.uniqueMints.add(row.mint);
      if (row.parityExplain?.status === 'FULL_MATCH') current.fullMatchRows += 1;
      if (row.windows?.['120s']?.crossed85) current.crossed85Within120s += 1;
      if (row.windows?.['120s']?.crossed90) current.crossed90Within120s += 1;
      if (row.windows?.['120s']?.crossed95) current.crossed95Within120s += 1;
      const curveDelta120s = finiteNumber(row.windows?.['120s']?.curveDelta);
      if (curveDelta120s !== null) current.curveDelta120s.push(curveDelta120s);
      const maxPriceDeltaPct120s = finiteNumber(row.windows?.['120s']?.maxPriceDeltaPct);
      if (maxPriceDeltaPct120s !== null) current.maxPriceDeltaPct120s.push(maxPriceDeltaPct120s);
      wallets.set(wallet, current);
    }
  }
  const walletRows = Array.from(wallets.values()).map((row) => ({
    wallet: row.wallet,
    rows: row.rows,
    uniqueMints: row.uniqueMints.size,
    fullMatchRows: row.fullMatchRows,
    crossed85Within120s: row.crossed85Within120s,
    crossed90Within120s: row.crossed90Within120s,
    crossed95Within120s: row.crossed95Within120s,
    crossed85Within120sRate: row.rows ? numberOrNull(row.crossed85Within120s / row.rows, 4) : null,
    crossed90Within120sRate: row.rows ? numberOrNull(row.crossed90Within120s / row.rows, 4) : null,
    curveDelta120s: stat(row.curveDelta120s, 6),
    maxPriceDeltaPct120s: stat(row.maxPriceDeltaPct120s, 2)
  }));
  const byFrequency = walletRows
    .slice()
    .sort((a, b) => b.rows - a.rows || b.crossed90Within120s - a.crossed90Within120s || a.wallet.localeCompare(b.wallet))
    .slice(0, 12);
  const byFollowThrough = walletRows
    .filter((row) => row.rows >= 2 || row.crossed85Within120s > 0 || row.crossed90Within120s > 0)
    .sort((a, b) => (
      b.crossed90Within120s - a.crossed90Within120s
      || b.crossed85Within120s - a.crossed85Within120s
      || Number(b.curveDelta120s?.p90 ?? -Infinity) - Number(a.curveDelta120s?.p90 ?? -Infinity)
      || Number(b.curveDelta120s?.max ?? -Infinity) - Number(a.curveDelta120s?.max ?? -Infinity)
      || b.rows - a.rows
      || a.wallet.localeCompare(b.wallet)
    ))
    .slice(0, 12);
  return {
    rows: rows.length,
    withUntrackedBuy: withUntrackedBuy.length,
    withTwoPlusUntrackedBuyWallets: withTwoPlusUntrackedBuyWallets.length,
    untrackedBuyContextRate: rows.length ? numberOrNull(withUntrackedBuy.length / rows.length, 4) : null,
    twoPlusUntrackedBuyWalletRate: rows.length ? numberOrNull(withTwoPlusUntrackedBuyWallets.length / rows.length, 4) : null,
    untrackedBuyByReason: countBy(withUntrackedBuy, (row) => row.reason),
    topUntrackedBuyWallets: byFrequency,
    topUntrackedBuyWalletsByFollowThrough: byFollowThrough
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry || telemetryFromBattlefield() || latestTelemetryFile());
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error(`Telemetry file not found: ${telemetryPath || '(none)'}`);
  }

  const { shadows, snapshotsByMint, paritySamplesByMint, walletDiagnosticsByMint, malformedLines } = await readTelemetry(telemetryPath);
  const analyzed = shadows.map((shadow) => analyzeShadow(
    shadow,
    snapshotsByMint.get(shadow.mint) || [],
    paritySamplesByMint.get(shadow.mint) || [],
    walletDiagnosticsByMint.get(shadow.mint) || []
  ));
  const wouldEnter = analyzed.filter((row) => row.wouldEnter);
  const wouldSkip = analyzed.filter((row) => !row.wouldEnter);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_curve_false_negative_recovery_shadow',
    telemetryPath,
    malformedLines,
    summary: {
      rows: analyzed.length,
      wouldEnter: wouldEnter.length,
      wouldSkip: wouldSkip.length,
      uniqueMints: new Set(analyzed.map((row) => row.mint)).size,
      paperEntryPausedRows: analyzed.filter((row) => row.paperEntryPaused).length,
      failedCheckCounts: countBy(wouldSkip.flatMap((row) => row.failedChecks || []), (item) => item),
      reasonCounts: countBy(wouldSkip, (row) => row.reason),
      sourceReasonCounts: countBy(analyzed, (row) => row.sourceReason),
      parityStatusCounts: countBy(analyzed, (row) => row.parityExplain?.status),
      paritySourceCounts: countBy(analyzed, (row) => row.parityExplain?.source),
      paritySampledRows: analyzed.filter((row) => row.parityExplain?.source === 'targeted_sample').length,
      wouldEnterIfParityVerified: analyzed.filter((row) => row.wouldEnterIfParityVerified).length,
      fullMatchStillBlockedRows: analyzed.filter((row) => row.parityExplain?.status === 'FULL_MATCH' && !row.wouldEnter && !row.wouldEnterIfParityVerified).length,
      fullMatchStillBlockedCheckCounts: countBy(
        analyzed
          .filter((row) => row.parityExplain?.status === 'FULL_MATCH' && !row.wouldEnter && !row.wouldEnterIfParityVerified)
          .flatMap((row) => row.nonParityFailedChecks || []),
        (item) => item
      ),
      walletCoverage: walletCoverageSummary(analyzed),
      walletCoverageFullMatch: walletCoverageSummary(analyzed.filter((row) => row.parityExplain?.status === 'FULL_MATCH')),
      walletCoverageStaleOrDiverged: walletCoverageSummary(analyzed.filter((row) => ['STALE_WS_OR_ADVANCED_ONCHAIN', 'DIVERGED'].includes(row.parityExplain?.status))),
      untrackedWalletCoverage: untrackedWalletCoverageSummary(analyzed),
      untrackedWalletCoverageFullMatch: untrackedWalletCoverageSummary(analyzed.filter((row) => row.parityExplain?.status === 'FULL_MATCH'))
    },
    groups: {
      all: summarizeGroup('all', analyzed),
      wouldEnter: summarizeGroup('wouldEnter', wouldEnter),
      wouldSkip: summarizeGroup('wouldSkip', wouldSkip)
    },
    topWouldEnterFollowThrough: wouldEnter
      .slice()
      .sort((a, b) => Number(b.windows['120s']?.curveDelta || -Infinity) - Number(a.windows['120s']?.curveDelta || -Infinity))
      .slice(0, 12),
    topParityExplainRows: analyzed
      .slice()
      .sort((a, b) => Number(b.windows['120s']?.curveDelta || -Infinity) - Number(a.windows['120s']?.curveDelta || -Infinity))
      .slice(0, 20)
      .map((row) => ({
        mint: row.mint,
        symbol: row.symbol,
        at: row.at,
        wouldEnter: row.wouldEnter,
        reason: row.reason,
        failedChecks: row.failedChecks,
        score: row.score,
        curveProgress: row.curveProgress,
        sourceReason: row.sourceReason,
        parityExplain: row.parityExplain,
        nonParityFailedChecks: row.nonParityFailedChecks,
        wouldEnterIfParityVerified: row.wouldEnterIfParityVerified,
        untrackedWalletContext: row.untrackedWalletContext,
        window120: row.windows['120s'],
        trackedFirstTouchBuy: row.trackedFirstTouchBuy
      })),
    sampleRows: analyzed.slice(0, 25)
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote recovery shadow report: ${OUTPUT_PATH}`);
  console.log(`Rows: ${report.summary.rows}; wouldEnter=${report.summary.wouldEnter}; wouldSkip=${report.summary.wouldSkip}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
