#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const Config = require('../src/config');
const SolanaRpcRouter = require('../src/lib/solana-rpc-router');
const PumpBondingCurveLane = require('../src/lib/pump-bonding-curve-lane');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pumpdev-targeted-curve-parity-latest.json');
const MAX_TARGETS = Number(process.env.PUMPDEV_TARGETED_CURVE_PARITY_MAX_TARGETS || 25);
const MAX_SNAPSHOT_AGE_MS = Number(process.env.PUMPDEV_TARGETED_CURVE_PARITY_MAX_SNAPSHOT_AGE_MS || 5000);
const PUMP_TOKEN_TOTAL_SUPPLY = 1_000_000_000;
const PUMP_VIRTUAL_TO_REAL_TOKEN_OFFSET = 279_900_000;
const SENTINEL_NON_BONDING_CURVE_ADDRESSES = new Set([
  '11111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
]);

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

function latestFile(pattern) {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => pattern.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function pathsFromBattlefield() {
  try {
    const report = JSON.parse(fs.readFileSync(BATTLEFIELD_PATH, 'utf8').replace(/^\uFEFF/, ''));
    return {
      telemetryPath: report.files?.telemetryPath || null,
      dossierPath: report.files?.dossierPath || null
    };
  } catch {
    return { telemetryPath: null, dossierPath: null };
  }
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function numberOrNull(value, digits = null) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return digits === null ? numeric : Number(numeric.toFixed(digits));
}

function pctDelta(numerator, denominator, digits = 4) {
  const left = Number(numerator);
  const right = Number(denominator);
  if (!Number.isFinite(left) || !Number.isFinite(right) || right === 0) return null;
  return numberOrNull(((left - right) / right) * 100, digits);
}

function curveFromVirtualTokenReserves(virtualTokenReservesTokens) {
  const virtualTokens = Number(virtualTokenReservesTokens);
  if (!Number.isFinite(virtualTokens) || virtualTokens <= 0) return null;
  const realTokenReservesTokens = virtualTokens - PUMP_VIRTUAL_TO_REAL_TOKEN_OFFSET;
  return numberOrNull(Math.max(0, Math.min(1, 1 - (realTokenReservesTokens / PUMP_TOKEN_TOTAL_SUPPLY))), 6);
}

function semanticDiagnosis(row = {}) {
  const absCurveDelta = Number(row.absCurveDelta);
  if (!Number.isFinite(absCurveDelta)) return 'uncomparable';
  if (absCurveDelta <= 0.015) return 'aligned';

  const providerAgeMs = Number(row.providerToOnchainAgeMs);
  const providerTokenDeltaPct = Math.abs(Number(row.providerToOnchainVirtualTokenReserveDeltaPct));
  const providerSolDeltaPct = Math.abs(Number(row.providerToOnchainVirtualSolReserveDeltaPct));
  const providerFormulaDelta = Math.abs(Number(row.providerFormulaCurveDelta));
  const onchainFormulaDelta = Math.abs(Number(row.onchainFormulaCurveDelta));
  const reserveDeltaKnown = Number.isFinite(providerTokenDeltaPct) || Number.isFinite(providerSolDeltaPct);

  if (Number.isFinite(providerFormulaDelta) && providerFormulaDelta > 0.015) {
    return 'provider_formula_mismatch';
  }
  if (Number.isFinite(onchainFormulaDelta) && onchainFormulaDelta > 0.015) {
    return 'onchain_formula_mismatch';
  }
  if (reserveDeltaKnown && (providerTokenDeltaPct > 1 || providerSolDeltaPct > 1)) {
    return Number.isFinite(providerAgeMs) && providerAgeMs > 5000
      ? 'reserve_state_mismatch_with_snapshot_age_gap'
      : 'reserve_state_mismatch';
  }
  if (Number.isFinite(providerAgeMs) && providerAgeMs > 5000) {
    return 'snapshot_age_gap';
  }
  return 'unexplained_validated_delta';
}

function invalidBondingCurveAddressReason(address) {
  if (!address) return 'MISSING_BONDING_CURVE_ADDRESS';
  if (SENTINEL_NON_BONDING_CURVE_ADDRESSES.has(address)) {
    return `SENTINEL_NON_BONDING_CURVE_ADDRESS:${address}`;
  }
  return null;
}

function stat(values, digits = 6) {
  const finite = values
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!finite.length) return { count: 0, min: null, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    min: numberOrNull(finite[0], digits),
    median: numberOrNull(pick(0.5), digits),
    p90: numberOrNull(pick(0.9), digits),
    max: numberOrNull(finite[finite.length - 1], digits),
    avg: numberOrNull(sum / finite.length, digits)
  };
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function curveOf(payload = {}) {
  const raw = payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.market?.maxCurveProgress;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return value > 1 && value <= 100 ? value / 100 : value;
}

function priceOf(payload = {}) {
  const raw = payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol
    ?? payload.market?.priceSol;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function providerSnapshotFromEvent(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(event.timestamp);
  const curveProgress = curveOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress)) return null;
  return {
    mint,
    at: event.timestamp,
    atMs,
    source: event.type,
    pairBase: payload.pairBase || null,
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceOf(payload), 12),
    virtualSolReservesSol: numberOrNull(payload.virtualSolReservesSol),
    virtualTokenReservesTokens: numberOrNull(payload.virtualTokenReservesTokens),
    providerVirtualTokenReservesRaw: payload.providerVirtualTokenReservesRaw ?? null,
    providerVirtualQuoteReservesRaw: payload.providerVirtualQuoteReservesRaw ?? null,
    providerVirtualSolReservesRaw: payload.providerVirtualSolReservesRaw ?? null,
    bondingCurveAddress: payload.bondingCurveAddress || payload.bondingCurveKey || null
  };
}

function addTarget(targets, target) {
  if (!target?.mint) return;
  const existing = targets.get(target.mint);
  const priority = Number(target.priority || 0);
  if (!existing || priority > Number(existing.priority || 0)) {
    targets.set(target.mint, target);
    return;
  }
  existing.targetClasses = Array.from(new Set([...(existing.targetClasses || []), ...(target.targetClasses || [])]));
  existing.reasons = Array.from(new Set([...(existing.reasons || []), ...(target.reasons || [])]));
}

function targetFromPaperPayload(payload, targetClass, priority) {
  const mint = mintOf(payload);
  if (!mint) return null;
  return {
    mint,
    symbol: payload.symbol || null,
    targetClasses: [targetClass],
    at: payload.entryAt || payload.timestamp || null,
    atMs: timestampMs(payload.entryAt || payload.timestamp),
    priority,
    score: numberOrNull(payload.entryScore ?? payload.score, 2),
    curveProgress: numberOrNull(payload.entryCurveProgress ?? payload.curveProgress, 6),
    recentVolumeSol: numberOrNull(payload.entryRecentVolumeSol ?? payload.recentVolumeSol, 4),
    tradeVelocityPerMin: numberOrNull(payload.entryTradeVelocityPerMin ?? payload.tradeVelocityPerMin, 2),
    reasons: Array.isArray(payload.reasons) ? payload.reasons : []
  };
}

function isInterestingSkip(payload) {
  if (payload.decision !== 'PAPER_SKIPPED') return false;
  const reason = payload.reason || payload.skipReason || null;
  const score = Number(payload.score);
  const curve = Number(payload.curveProgress);
  if (reason === 'RECENT_BAD_EXIT_COOLDOWN') return true;
  if (Number.isFinite(curve) && curve >= 0.8) return true;
  if (Number.isFinite(score) && score >= 80) return true;
  return ['LOW_SCORE', 'FIRST_SIGHT_REQUIRES_GUARD_OVERRIDE', 'NO_PRIOR_CURVE_PROGRESS'].includes(reason)
    && Number.isFinite(curve)
    && curve >= 0.75;
}

function isHighConvictionWatch(dossier) {
  if (dossier?.source !== 'pre_migration_watch') return false;
  const gmgn = dossier.gmgnStyle || {};
  const watch = dossier.watch || {};
  const tags = new Set(Array.isArray(gmgn.tags) ? gmgn.tags : []);
  const verdict = gmgn.verdict || null;
  const score = Number(gmgn.score);
  const curve = Number(dossier.curve?.progress);
  const confirmed = watch.confirmed === true || tags.has('watch_confirmed') || verdict === 'high_conviction_watch';
  if (!confirmed || !['watch', 'high_conviction_watch'].includes(verdict)) return false;
  return Number.isFinite(score) && score >= 70 || Number.isFinite(curve) && curve >= 0.6;
}

async function readTelemetry(filePath) {
  const targets = new Map();
  const providerByMint = new Map();
  const runtimeSamples = [];
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
    const payload = payloadOf(event);

    if (event.type === 'pumpdev.targeted_curve_parity_sample') {
      const providerAtMs = timestampMs(payload.providerAt || event.timestamp);
      const onchainFetchedAtMs = timestampMs(payload.onchainFetchedAt || event.timestamp);
      const fetchLatencyMs = numberOrNull(payload.onchainFetchLatencyMs ?? payload.fetchLatencyMs ?? payload.latencyMs, 0);
      const maxComparableLatencyMs = Number(payload.onchainComparableLatencyMs || process.env.PUMPDEV_TARGETED_CURVE_PARITY_MAX_COMPARABLE_LATENCY_MS || 2500);
      const bondingCurveAddress = payload.bondingCurveAddress || null;
      const addressValidationReason = invalidBondingCurveAddressReason(bondingCurveAddress);
      const bondingCurveValidated = payload.bondingCurveValidated === true && !addressValidationReason;
      const unvalidatedReason = payload.accountFound === true && !bondingCurveValidated
        ? (payload.bondingCurveValidationReason || addressValidationReason || 'UNVALIDATED_BONDING_CURVE_ACCOUNT')
        : null;
      const slowOnchainReason = Number.isFinite(fetchLatencyMs)
        && Number.isFinite(maxComparableLatencyMs)
        && fetchLatencyMs > maxComparableLatencyMs
        ? `SLOW_ONCHAIN_SAMPLE_${fetchLatencyMs}MS`
        : null;
      const staleAgainstProvider = Number.isFinite(providerAtMs)
        && Number.isFinite(onchainFetchedAtMs)
        && onchainFetchedAtMs < providerAtMs - 1000;
      const errorMessage = payload.lastErrorMessage
        || payload.error
        || unvalidatedReason
        || slowOnchainReason
        || (payload.onchainFresh === false ? 'STALE_OR_UNREFRESHED_ONCHAIN_SAMPLE' : null)
        || (staleAgainstProvider ? 'STALE_ONCHAIN_SAMPLE_BEFORE_PROVIDER_SNAPSHOT' : null)
        || (payload.accountFound === false && payload.onchainCurveProgress !== null && payload.onchainCurveProgress !== undefined
          ? 'UNCOMPARABLE_ONCHAIN_SAMPLE'
          : null);
      runtimeSamples.push({
        mint: mintOf(payload),
        symbol: payload.symbol || null,
        targetClasses: [payload.trigger || 'runtime_targeted_sample'],
        reasons: [payload.reason].filter(Boolean),
        priority: 100,
        targetAt: event.timestamp || payload.providerAt || null,
        targetScore: numberOrNull(payload.score, 2),
        targetCurveProgress: numberOrNull(payload.providerCurveProgress, 6),
        providerAt: payload.providerAt || null,
        providerPairBase: payload.pairBase || null,
        providerCurveProgress: numberOrNull(payload.providerCurveProgress, 6),
        onchainFetchedAt: payload.onchainFetchedAt || event.timestamp || null,
        onchainFetchStartedAt: payload.onchainFetchStartedAt || null,
        onchainFresh: payload.onchainFresh === true,
        onchainFetchLatencyMs: fetchLatencyMs,
        onchainComparableLatencyMs: Number.isFinite(maxComparableLatencyMs) ? maxComparableLatencyMs : null,
        refreshed: payload.refreshed === true,
        accountFound: payload.accountFound === true,
        invalidAccountData: payload.invalidAccountData === true,
        complete: payload.complete === true,
        onchainBondingStage: payload.onchainBondingStage || null,
        onchainCurveProgress: errorMessage ? null : numberOrNull(payload.onchainCurveProgress, 6),
        onchainCurveProgressByRealTokenSupply: numberOrNull(payload.onchainCurveProgressByRealTokenSupply, 6),
        onchainCurveProgressByVirtualTokenReserves: errorMessage ? null : numberOrNull(payload.onchainCurveProgressByVirtualTokenReserves, 6),
        absCurveDelta: errorMessage ? null : numberOrNull(payload.absCurveDelta, 6),
        curveDelta: errorMessage ? null : numberOrNull(payload.curveDelta, 6),
        virtualReserveAbsCurveDelta: errorMessage ? null : numberOrNull(payload.virtualReserveAbsCurveDelta, 6),
        virtualReserveCurveDelta: errorMessage ? null : numberOrNull(payload.virtualReserveCurveDelta, 6),
        providerPriceSol: numberOrNull(payload.providerPriceSol, 12),
        onchainPriceSol: numberOrNull(payload.onchainPriceSol, 12),
        providerVirtualTokenReservesTokens: numberOrNull(payload.providerVirtualTokenReservesTokens ?? payload.virtualTokenReservesTokens),
        providerVirtualSolReservesSol: numberOrNull(payload.providerVirtualSolReservesSol ?? payload.virtualSolReservesSol),
        providerVirtualTokenReservesRaw: payload.providerVirtualTokenReservesRaw ?? null,
        providerVirtualQuoteReservesRaw: payload.providerVirtualQuoteReservesRaw ?? null,
        providerVirtualSolReservesRaw: payload.providerVirtualSolReservesRaw ?? null,
        onchainVirtualTokenReservesTokens: numberOrNull(payload.onchainVirtualTokenReservesTokens),
        onchainVirtualSolReservesSol: numberOrNull(payload.onchainVirtualSolReservesSol),
        onchainRealSolReservesSol: numberOrNull(payload.onchainRealSolReservesSol),
        onchainVirtualTokenReservesRaw: payload.onchainVirtualTokenReservesRaw ?? null,
        onchainVirtualSolReservesRaw: payload.onchainVirtualSolReservesRaw ?? null,
        onchainRealTokenReservesRaw: payload.onchainRealTokenReservesRaw ?? null,
        onchainRealSolReservesRaw: payload.onchainRealSolReservesRaw ?? null,
        onchainTokenTotalSupplyRaw: payload.onchainTokenTotalSupplyRaw ?? null,
        absPriceDeltaPct: numberOrNull(payload.absPriceDeltaPct, 4),
        priceDeltaPct: numberOrNull(payload.priceDeltaPct, 4),
        timedOut: payload.timedOut === true,
        latencyMs: numberOrNull(payload.latencyMs, 0),
        lastErrorMessage: errorMessage,
        bondingCurveAddress,
        expectedBondingCurveAddress: payload.expectedBondingCurveAddress || null,
        providerBondingCurveAddress: payload.providerBondingCurveAddress || null,
        bondingCurveValidated,
        bondingCurveValidationReason: payload.bondingCurveValidationReason || addressValidationReason || null,
        bondingCurveAccountOwner: payload.bondingCurveAccountOwner || null,
        runtimeTrigger: payload.trigger || null,
        runtimeSource: payload.source || null,
        runtimeDecision: payload.decision || null
      });
      continue;
    }

    if (event.type === 'pump_bonding_curve.provider_snapshot') {
      const snapshot = providerSnapshotFromEvent(event);
      if (snapshot) {
        const rows = providerByMint.get(snapshot.mint) || [];
        rows.push(snapshot);
        providerByMint.set(snapshot.mint, rows);
      }
      continue;
    }

    if (event.type === 'pre_migration_paper.entry') {
      addTarget(targets, targetFromPaperPayload(payload, 'actual_entry', 100));
      continue;
    }

    if (event.type === 'pre_migration_paper.decision') {
      if (['PAPER_ELIGIBLE', 'PAPER_SHADOWED'].includes(payload.decision)) {
        addTarget(targets, targetFromPaperPayload(payload, 'eligible_or_shadowed', 90));
      } else if (isInterestingSkip(payload)) {
        const target = targetFromPaperPayload(payload, `interesting_skip:${payload.reason || payload.skipReason || 'unknown'}`, 50);
        if (target) target.reasons = [payload.reason || payload.skipReason || 'unknown'];
        addTarget(targets, target);
      }
    }
  }

  for (const rows of providerByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  return { targets, providerByMint, runtimeSamples, malformedTelemetry: malformedLines };
}

async function readDossiers(filePath, targets) {
  let malformedDossiers = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });
  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    let dossier;
    try {
      dossier = JSON.parse(line.replace(/^\uFEFF/, ''));
    } catch {
      malformedDossiers += 1;
      continue;
    }
    if (!isHighConvictionWatch(dossier)) continue;
    const mint = dossier.identity?.mint;
    if (!mint) continue;
    addTarget(targets, {
      mint,
      symbol: dossier.identity?.symbol || null,
      targetClasses: ['high_conviction_watch'],
      at: dossier.timestamp || null,
      atMs: timestampMs(dossier.timestamp),
      priority: 70,
      score: numberOrNull(dossier.gmgnStyle?.score, 2),
      curveProgress: numberOrNull(dossier.curve?.progress, 6),
      recentVolumeSol: numberOrNull(dossier.activity?.recentVolumeSol, 4),
      tradeVelocityPerMin: numberOrNull(dossier.activity?.tradeVelocityPerMin, 2),
      reasons: Array.isArray(dossier.gmgnStyle?.reasons) ? dossier.gmgnStyle.reasons : []
    });
  }
  return { malformedDossiers };
}

function latestProviderBefore(rows = [], atMs) {
  const finiteAt = Number(atMs);
  let best = null;
  for (const row of rows) {
    if (Number.isFinite(finiteAt) && row.atMs > finiteAt) break;
    best = row;
  }
  return best || rows[rows.length - 1] || null;
}

function compareTarget(target, provider, onchain) {
  const bondingCurveAddress = onchain?.bondingCurveAddress || provider?.bondingCurveAddress || null;
  const addressValidationReason = invalidBondingCurveAddressReason(bondingCurveAddress);
  const bondingCurveValidated = onchain?.bondingCurveValidated === true && !addressValidationReason;
  const providerCurve = provider?.curveProgress;
  const onchainCurve = bondingCurveValidated ? onchain?.curveProgress : null;
  const onchainVirtualReserveCurve = bondingCurveValidated ? onchain?.curveProgressByVirtualTokenReserves : null;
  const providerPrice = provider?.priceSol;
  const onchainPrice = bondingCurveValidated ? onchain?.priceSol : null;
  const curveDelta = Number.isFinite(Number(providerCurve)) && Number.isFinite(Number(onchainCurve))
    ? Number(onchainCurve) - Number(providerCurve)
    : null;
  const virtualReserveCurveDelta = Number.isFinite(Number(providerCurve)) && Number.isFinite(Number(onchainVirtualReserveCurve))
    ? Number(onchainVirtualReserveCurve) - Number(providerCurve)
    : null;
  const priceDeltaPct = Number.isFinite(Number(providerPrice)) && Number(providerPrice) > 0 && Number.isFinite(Number(onchainPrice)) && Number(onchainPrice) > 0
    ? ((Number(providerPrice) - Number(onchainPrice)) / Number(onchainPrice)) * 100
    : null;
  return {
    mint: target.mint,
    symbol: target.symbol,
    targetClasses: target.targetClasses || [],
    reasons: target.reasons || [],
    priority: target.priority,
    targetAt: target.at,
    targetScore: target.score,
    targetCurveProgress: target.curveProgress,
    providerAt: provider?.at || null,
    providerPairBase: provider?.pairBase || null,
    providerCurveProgress: numberOrNull(providerCurve, 6),
    onchainFetchedAt: onchain?.lastFetchAt || null,
    accountFound: onchain?.accountFound === true,
    invalidAccountData: onchain?.invalidAccountData === true,
    complete: onchain?.complete === true,
    onchainBondingStage: onchain?.bondingStage || null,
    onchainCurveProgress: numberOrNull(onchainCurve, 6),
    onchainCurveProgressByRealTokenSupply: numberOrNull(onchain?.curveProgressByRealTokenSupply, 6),
    onchainCurveProgressByVirtualTokenReserves: numberOrNull(onchainVirtualReserveCurve, 6),
    absCurveDelta: numberOrNull(Math.abs(curveDelta), 6),
    curveDelta: numberOrNull(curveDelta, 6),
    virtualReserveAbsCurveDelta: numberOrNull(Math.abs(virtualReserveCurveDelta), 6),
    virtualReserveCurveDelta: numberOrNull(virtualReserveCurveDelta, 6),
    providerPriceSol: numberOrNull(providerPrice, 12),
    onchainPriceSol: numberOrNull(onchainPrice, 12),
    providerVirtualTokenReservesTokens: numberOrNull(provider?.virtualTokenReservesTokens),
    providerVirtualSolReservesSol: numberOrNull(provider?.virtualSolReservesSol),
    providerVirtualTokenReservesRaw: provider?.providerVirtualTokenReservesRaw ?? null,
    providerVirtualQuoteReservesRaw: provider?.providerVirtualQuoteReservesRaw ?? null,
    providerVirtualSolReservesRaw: provider?.providerVirtualSolReservesRaw ?? null,
    onchainVirtualTokenReservesTokens: numberOrNull(onchain?.virtualTokenReservesTokens),
    onchainVirtualSolReservesSol: numberOrNull(onchain?.virtualSolReservesSol),
    onchainRealSolReservesSol: numberOrNull(onchain?.realSolReservesSol),
    onchainVirtualTokenReservesRaw: onchain?.virtualTokenReserves ?? null,
    onchainVirtualSolReservesRaw: onchain?.virtualSolReserves ?? null,
    onchainRealTokenReservesRaw: onchain?.realTokenReserves ?? null,
    onchainRealSolReservesRaw: onchain?.realSolReserves ?? null,
    onchainTokenTotalSupplyRaw: onchain?.tokenTotalSupply ?? null,
    absPriceDeltaPct: numberOrNull(Math.abs(priceDeltaPct), 4),
    priceDeltaPct: numberOrNull(priceDeltaPct, 4),
    lastErrorMessage: onchain?.lastErrorMessage
      || (!bondingCurveValidated ? (onchain?.bondingCurveValidationReason || addressValidationReason || 'UNVALIDATED_BONDING_CURVE_ACCOUNT') : null),
    bondingCurveAddress,
    expectedBondingCurveAddress: onchain?.bondingCurveAddress || null,
    providerBondingCurveAddress: provider?.bondingCurveAddress || null,
    bondingCurveValidated,
    bondingCurveValidationReason: onchain?.bondingCurveValidationReason || addressValidationReason || null,
    bondingCurveAccountOwner: onchain?.bondingCurveAccountOwner || null
  };
}

function selectTargets(targets) {
  return Array.from(targets.values())
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
    .slice(0, Math.max(1, MAX_TARGETS));
}

function enrichSemanticRow(row = {}) {
  const providerAtMs = timestampMs(row.providerAt);
  const onchainFetchedAtMs = timestampMs(row.onchainFetchedAt);
  const providerToOnchainAgeMs = Number.isFinite(providerAtMs) && Number.isFinite(onchainFetchedAtMs)
    ? onchainFetchedAtMs - providerAtMs
    : null;
  const providerCurveFromVirtualTokenReserves = curveFromVirtualTokenReserves(row.providerVirtualTokenReservesTokens);
  const onchainCurveFromVirtualTokenReserves = curveFromVirtualTokenReserves(row.onchainVirtualTokenReservesTokens);
  const providerFormulaCurveDelta = Number.isFinite(Number(providerCurveFromVirtualTokenReserves)) && Number.isFinite(Number(row.providerCurveProgress))
    ? numberOrNull(Number(providerCurveFromVirtualTokenReserves) - Number(row.providerCurveProgress), 6)
    : null;
  const onchainFormulaCurveDelta = Number.isFinite(Number(onchainCurveFromVirtualTokenReserves)) && Number.isFinite(Number(row.onchainCurveProgressByVirtualTokenReserves ?? row.onchainCurveProgress))
    ? numberOrNull(Number(onchainCurveFromVirtualTokenReserves) - Number(row.onchainCurveProgressByVirtualTokenReserves ?? row.onchainCurveProgress), 6)
    : null;

  const enriched = {
    ...row,
    providerToOnchainAgeMs: numberOrNull(providerToOnchainAgeMs, 0),
    providerCurveFromVirtualTokenReserves,
    onchainCurveFromVirtualTokenReserves,
    providerFormulaCurveDelta,
    onchainFormulaCurveDelta,
    providerToOnchainVirtualTokenReserveDeltaPct: pctDelta(row.providerVirtualTokenReservesTokens, row.onchainVirtualTokenReservesTokens),
    providerToOnchainVirtualSolReserveDeltaPct: pctDelta(row.providerVirtualSolReservesSol, row.onchainVirtualSolReservesSol),
    providerToOnchainPriceDeltaPct: pctDelta(row.providerPriceSol, row.onchainPriceSol)
  };
  enriched.semanticDiagnosis = semanticDiagnosis(enriched);
  return enriched;
}

async function fetchOnchainTargets(targets) {
  const logger = {
    warn: (message, meta) => console.warn(`[WARN] ${message}: ${meta?.error || ''}`.trim()),
    info: () => {}
  };
  const router = new SolanaRpcRouter(Config, logger);
  const reportConfig = Object.create(Config);
  Object.defineProperties(reportConfig, {
    pumpBondingCurveMaxFetchesPerCycle: { value: 1 },
    pumpBondingCurveFailureCooldownMs: { value: 0 },
    pumpBondingCurveGlobalBackoffMs: { value: 0 }
  });
  const lane = new PumpBondingCurveLane(reportConfig, logger, router);
  const byMint = new Map();
  for (const target of targets) {
    const state = await lane.observeMint(target.mint, { symbol: target.symbol, source: 'targeted_curve_parity_report' }, {
      forceRefresh: true,
      bypassFailureCooldown: true,
      bypassGlobalBackoff: true
    });
    byMint.set(target.mint, state);
  }
  return { byMint, rpcStatus: router.getStatus(), laneStats: lane.getStats() };
}

function redactRpcStatus(status) {
  if (!status) return null;
  return {
    primary: status.primary,
    fallback: status.fallback,
    primaryDegraded: status.primaryDegraded,
    primaryDegradedUntil: status.primaryDegradedUntil,
    lastPrimaryFailureAt: status.lastPrimaryFailureAt,
    lastPrimaryFailureReason: status.lastPrimaryFailureReason,
    lastFallbackSuccessAt: status.lastFallbackSuccessAt,
    lastRecoveryAt: status.lastRecoveryAt,
    circuitBreaker: status.circuitBreaker,
    queue: status.queue,
    stats: status.stats
  };
}

function buildReport({ telemetryPath, dossierPath, telemetry, malformedDossiers, selectedTargets, fetched }) {
  const runtimeRows = (telemetry.runtimeSamples || []).filter((row) => row.mint);
  const rows = (runtimeRows.length
    ? runtimeRows
    : selectedTargets.map((target) => {
      const provider = latestProviderBefore(telemetry.providerByMint.get(target.mint) || [], target.atMs);
      const onchain = fetched.byMint.get(target.mint) || null;
      return compareTarget(target, provider, onchain);
    })).map(enrichSemanticRow);
  const rowsWithOnchain = rows.filter((row) => row.accountFound || row.invalidAccountData || row.lastErrorMessage);
  const comparableRows = rows.filter((row) => (
    row.absCurveDelta !== null
    && row.absCurveDelta !== undefined
    && Number.isFinite(Number(row.absCurveDelta))
  ));
  const missingProvider = rows.filter((row) => !row.providerAt).length;
  const accountFound = rows.filter((row) => row.accountFound).length;
  const errors = rows.filter((row) => row.lastErrorMessage).length;
  const validatedBondingCurveRows = rows.filter((row) => row.bondingCurveValidated === true).length;
  const invalidBondingCurveRows = rows.filter((row) => {
    const reason = row.bondingCurveValidationReason || '';
    return row.bondingCurveValidated !== true && (
      reason.startsWith('SENTINEL_NON_BONDING_CURVE_ADDRESS:')
      || reason.startsWith('INVALID_BONDING_CURVE_ADDRESS:')
      || reason.startsWith('UNEXPECTED_OWNER:')
      || row.invalidAccountData === true
    );
  }).length;
  const unvalidatedBondingCurveRows = rows.filter((row) => (
    row.accountFound === true
    && row.bondingCurveValidated !== true
    && !row.invalidAccountData
  )).length;
  const highDeltaRows = comparableRows
    .filter((row) => Number(row.absCurveDelta) > 0.05)
    .sort((a, b) => Number(b.absCurveDelta) - Number(a.absCurveDelta));
  const freshComparableRows = comparableRows.filter((row) => {
    const ageMs = Number(row.providerToOnchainAgeMs);
    return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= MAX_SNAPSHOT_AGE_MS;
  });
  const staleComparableRows = comparableRows.filter((row) => !freshComparableRows.includes(row));
  const freshHighDeltaRows = freshComparableRows
    .filter((row) => Number(row.absCurveDelta) > 0.05)
    .sort((a, b) => Number(b.absCurveDelta) - Number(a.absCurveDelta));
  const byClass = {};
  const semanticDiagnosisCounts = {};
  for (const row of rows) {
    const diagnosis = row.semanticDiagnosis || 'unknown';
    semanticDiagnosisCounts[diagnosis] = (semanticDiagnosisCounts[diagnosis] || 0) + 1;
    for (const klass of row.targetClasses || ['unknown']) {
      byClass[klass] = (byClass[klass] || 0) + 1;
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    mode: runtimeRows.length ? 'report_only_runtime_decision_time_sample' : 'report_only_post_run_current_onchain_sample',
    inputs: {
      telemetryPath: path.relative(ROOT, telemetryPath),
      dossierPath: dossierPath ? path.relative(ROOT, dossierPath) : null,
      maxTargets: MAX_TARGETS,
      malformedTelemetry: telemetry.malformedTelemetry,
      malformedDossiers,
      runtimeSamples: runtimeRows.length
    },
    summary: {
      candidateTargets: runtimeRows.length ? runtimeRows.length : telemetry.targets.size,
      sampledTargets: rows.length,
      accountFound,
      rowsWithOnchainSignal: rowsWithOnchain.length,
      comparableRows: comparableRows.length,
      freshComparableRows: freshComparableRows.length,
      staleComparableRows: staleComparableRows.length,
      maxFreshProviderToOnchainAgeMs: Number.isFinite(MAX_SNAPSHOT_AGE_MS) ? MAX_SNAPSHOT_AGE_MS : null,
      missingProvider,
      fetchErrors: errors,
      validatedBondingCurveRows,
      invalidBondingCurveRows,
      unvalidatedBondingCurveRows,
      targetClassCounts: byClass,
      semanticDiagnosisCounts,
      absCurveDelta: stat(comparableRows.map((row) => row.absCurveDelta), 6),
      freshAbsCurveDelta: stat(freshComparableRows.map((row) => row.absCurveDelta), 6),
      virtualReserveAbsCurveDelta: stat(comparableRows.map((row) => row.virtualReserveAbsCurveDelta), 6),
      freshVirtualReserveAbsCurveDelta: stat(freshComparableRows.map((row) => row.virtualReserveAbsCurveDelta), 6),
      absPriceDeltaPct: stat(comparableRows.map((row) => row.absPriceDeltaPct), 4),
      freshAbsPriceDeltaPct: stat(freshComparableRows.map((row) => row.absPriceDeltaPct), 4),
      providerToOnchainAgeMs: stat(comparableRows.map((row) => row.providerToOnchainAgeMs), 0),
      providerToOnchainVirtualTokenReserveDeltaPct: stat(comparableRows.map((row) => row.providerToOnchainVirtualTokenReserveDeltaPct), 4),
      providerToOnchainVirtualSolReserveDeltaPct: stat(comparableRows.map((row) => row.providerToOnchainVirtualSolReserveDeltaPct), 4),
      providerFormulaCurveDelta: stat(comparableRows.map((row) => row.providerFormulaCurveDelta), 6),
      onchainFormulaCurveDelta: stat(comparableRows.map((row) => row.onchainFormulaCurveDelta), 6),
      highDeltaCountGt005: highDeltaRows.length,
      freshHighDeltaCountGt005: freshHighDeltaRows.length
    },
    rpc: fetched ? redactRpcStatus(fetched.rpcStatus) : null,
    bondingCurveSampler: fetched ? fetched.laneStats : null,
    highDeltaRows: highDeltaRows.slice(0, 20),
    freshHighDeltaRows: freshHighDeltaRows.slice(0, 20),
    rows,
    note: runtimeRows.length
      ? 'Report-only targeted PumpDev/on-chain parity sample captured during runtime for high-interest candidates. It does not change runtime decisions.'
      : 'Report-only targeted PumpDev/on-chain parity sample for high-interest candidates. Fetches current on-chain state after the run and does not change runtime decisions.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fromBattlefield = pathsFromBattlefield();
  const telemetryPath = repoPath(args.telemetry) || repoPath(fromBattlefield.telemetryPath) || latestFile(/^telemetry-.*\.jsonl$/i);
  const dossierPath = repoPath(args.dossiers) || repoPath(fromBattlefield.dossierPath) || latestFile(/^candidate-dossiers-.*\.jsonl$/i);
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  if (!telemetryPath || !fs.existsSync(telemetryPath)) throw new Error('No telemetry file found.');

  const telemetry = await readTelemetry(telemetryPath);
  let malformedDossiers = 0;
  if (dossierPath && fs.existsSync(dossierPath)) {
    const dossierResult = await readDossiers(dossierPath, telemetry.targets);
    malformedDossiers = dossierResult.malformedDossiers;
  }
  const selectedTargets = selectTargets(telemetry.targets);
  const fetched = telemetry.runtimeSamples.length ? null : await fetchOnchainTargets(selectedTargets);
  const report = buildReport({
    telemetryPath,
    dossierPath,
    telemetry,
    malformedDossiers,
    selectedTargets,
    fetched
  });
  writeJson(outputPath, report);
  console.log('PumpDev Targeted Curve Parity Report');
  console.log(`Telemetry: ${telemetryPath}`);
  console.log(`Dossiers: ${dossierPath || 'none'}`);
  console.log(`Targets sampled: ${report.summary.sampledTargets}/${report.summary.candidateTargets}`);
  console.log(`Comparable rows: ${report.summary.comparableRows}; high deltas >0.05: ${report.summary.highDeltaCountGt005}`);
  console.log(`Wrote JSON report: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
