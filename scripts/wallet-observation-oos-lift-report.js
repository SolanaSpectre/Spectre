#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const SHADOW_WALLET_PATH = path.join(ROOT, 'data', 'wallet-watchlists', 'shadow-untracked-wallets.json');
const REPORT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-observation-oos-lift');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-observation-oos-lift-latest.json');

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function compact(value, digits = 6) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function payloadOf(event = {}) {
  return event.payload || event.data || {};
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function walletOf(payload = {}) {
  return payload.wallet || payload.walletAddress || payload.traderPublicKey || payload.account || payload.address || null;
}

function curveOf(payload = {}) {
  const curve = Number(payload.providerCurveProgress ?? payload.curveProgress ?? payload.bondingCurveProgress ?? payload.progress);
  if (!Number.isFinite(curve)) return null;
  return curve > 1 && curve <= 100 ? curve / 100 : curve;
}

function isBuy(payload = {}) {
  return String(payload.txType || payload.side || payload.tradeType || '').toLowerCase() === 'buy';
}

function latestTelemetryFiles(limit = 8) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((item) => item.filePath);
}

function telemetryFromBattlefield() {
  const report = readJson(BATTLEFIELD_PATH, {});
  return report.files?.telemetryPath || report.telemetryPath || null;
}

function selectedWallets() {
  const watchlist = readJson(SHADOW_WALLET_PATH, { wallets: [] });
  const rows = Array.isArray(watchlist.wallets) ? watchlist.wallets : [];
  return {
    updatedAt: watchlist.updatedAt || null,
    era: watchlist.era || null,
    wallets: rows
      .filter((row) => row.profile === 'observation_only_v2' || (row.flags || []).includes('OBSERVATION_ONLY_V2'))
      .map((row) => ({
        wallet: row.walletAddress || row.wallet,
        score: row.score ?? null,
        evidence: row.evidence || {},
        flags: Array.isArray(row.flags) ? row.flags : []
      }))
      .filter((row) => row.wallet)
  };
}

function firstCrossAfter(snapshots = [], startMs, threshold = 0.9, windowMs = 300000) {
  return snapshots.find((snapshot) => (
    snapshot.atMs >= startMs
    && snapshot.atMs <= startMs + windowMs
    && Number(snapshot.curveProgress) >= threshold
  )) || null;
}

function scanTelemetry(filePath, walletSet, startMs) {
  const snapshotsByMint = new Map();
  const touches = [];
  const eventCounts = {};
  const stats = forEachJsonlSync(filePath, (event) => {
    const type = event.type || event.event || 'unknown';
    eventCounts[type] = (eventCounts[type] || 0) + 1;
    const payload = payloadOf(event);
    const atMs = timestampMs(payload.timestamp || event.timestamp);
    if (!Number.isFinite(atMs) || atMs < startMs) return;

    if (type === 'pump_bonding_curve.provider_snapshot' || type === 'pre_migration.observed') {
      const mint = mintOf(payload);
      const curveProgress = curveOf(payload);
      if (!mint || !Number.isFinite(Number(curveProgress))) return;
      if (!snapshotsByMint.has(mint)) snapshotsByMint.set(mint, []);
      snapshotsByMint.get(mint).push({ atMs, curveProgress });
      return;
    }

    if (type !== 'wallet.trade_gate_diagnostic' && type !== 'wallet.trade_observed') return;
    const wallet = walletOf(payload);
    if (!wallet || !walletSet.has(wallet)) return;
    const mint = mintOf(payload);
    if (!mint) return;
    const curveProgress = curveOf(payload);
    touches.push({
      atMs,
      at: new Date(atMs).toISOString(),
      telemetryType: type,
      wallet,
      mint,
      symbol: payload.symbol || null,
      side: payload.txType || payload.side || null,
      isBuy: isBuy(payload),
      pre85: !Number.isFinite(Number(curveProgress)) || Number(curveProgress) < 0.85,
      curveProgress,
      dropReason: payload.dropReason || null,
      shadowWalletProfileMatch: payload.shadowWalletProfileMatch === true,
      ledgerRecord: payload.ledgerRecord === true
    });
  });

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  for (const touch of touches) {
    const cross90 = firstCrossAfter(snapshotsByMint.get(touch.mint) || [], touch.atMs, 0.9);
    touch.cross90Within300s = Boolean(cross90);
    touch.cross90At = cross90 ? new Date(cross90.atMs).toISOString() : null;
    touch.secondsToCross90 = cross90 ? compact((cross90.atMs - touch.atMs) / 1000, 3) : null;
  }

  return {
    filePath,
    rowsRead: stats.rows,
    malformedLines: stats.malformedLines,
    eventCounts,
    touches
  };
}

function summarizeWallet(wallet, touches = []) {
  const buyTouches = touches.filter((row) => row.isBuy);
  const pre85BuyTouches = buyTouches.filter((row) => row.pre85);
  const uniqueMints = new Set(touches.map((row) => row.mint));
  const cross90Mints = new Set(touches.filter((row) => row.cross90Within300s).map((row) => row.mint));
  const firstByMint = new Map();
  for (const touch of touches.slice().sort((a, b) => a.atMs - b.atMs)) {
    if (!firstByMint.has(touch.mint)) firstByMint.set(touch.mint, touch);
  }
  const firstTouches = Array.from(firstByMint.values());
  const firstBuyTouches = firstTouches.filter((row) => row.isBuy);
  return {
    wallet,
    rows: touches.length,
    buyRows: buyTouches.length,
    pre85BuyRows: pre85BuyTouches.length,
    uniqueMints: uniqueMints.size,
    cross90Mints300s: cross90Mints.size,
    cross90MintRate300s: uniqueMints.size ? compact(cross90Mints.size / uniqueMints.size, 6) : null,
    firstTouchBuyRate: firstTouches.length ? compact(firstBuyTouches.length / firstTouches.length, 6) : null,
    samples: touches.slice(0, 10)
  };
}

function summarizeCoTouchClusters(touches = []) {
  const byMint = new Map();
  for (const touch of touches) {
    if (!touch.mint) continue;
    if (!byMint.has(touch.mint)) byMint.set(touch.mint, []);
    byMint.get(touch.mint).push(touch);
  }
  const clusters = Array.from(byMint.entries()).map(([mint, rows]) => {
    const wallets = new Set(rows.map((row) => row.wallet).filter(Boolean));
    const buyRows = rows.filter((row) => row.isBuy);
    const pre85BuyRows = buyRows.filter((row) => row.pre85);
    return {
      mint,
      symbol: rows.find((row) => row.symbol)?.symbol || null,
      rows: rows.length,
      wallets: wallets.size,
      buyRows: buyRows.length,
      pre85BuyRows: pre85BuyRows.length,
      cross90Within300s: rows.some((row) => row.cross90Within300s),
      firstTouchAt: rows.slice().sort((a, b) => a.atMs - b.atMs)[0]?.at || null,
      sampleWallets: Array.from(wallets).slice(0, 8)
    };
  }).sort((a, b) => (
    Number(b.wallets || 0) - Number(a.wallets || 0)
    || Number(b.rows || 0) - Number(a.rows || 0)
    || Number(b.cross90Within300s) - Number(a.cross90Within300s)
  ));
  const uniqueMints = clusters.length;
  const totalTouchWalletMintPairs = clusters.reduce((sum, row) => sum + Number(row.wallets || 0), 0);
  const maxWalletsOnSingleMint = clusters[0]?.wallets || 0;
  const multiWalletMints = clusters.filter((row) => Number(row.wallets || 0) > 1).length;
  const cross90Mints = clusters.filter((row) => row.cross90Within300s).length;
  return {
    summary: {
      uniqueMints,
      totalTouchWalletMintPairs,
      averageWalletsPerMint: uniqueMints ? compact(totalTouchWalletMintPairs / uniqueMints, 6) : null,
      maxWalletsOnSingleMint,
      multiWalletMints,
      multiWalletMintRate: uniqueMints ? compact(multiWalletMints / uniqueMints, 6) : null,
      cross90Mints300s: cross90Mints,
      cross90MintRate300s: uniqueMints ? compact(cross90Mints / uniqueMints, 6) : null,
      independenceWarning: maxWalletsOnSingleMint >= 5 || (uniqueMints > 0 && totalTouchWalletMintPairs / uniqueMints >= 2)
        ? 'CO_TOUCH_CONCENTRATION_PRESENT_READ_LIFT_BY_MINT_NOT_WALLET'
        : 'NO_LARGE_CO_TOUCH_CONCENTRATION_DETECTED'
    },
    topClusters: clusters.slice(0, 25)
  };
}

function main() {
  const cohort = selectedWallets();
  const startMs = timestampMs(cohort.updatedAt);
  if (!Number.isFinite(startMs)) throw new Error(`Observation watchlist has no usable updatedAt: ${SHADOW_WALLET_PATH}`);
  const walletSet = new Set(cohort.wallets.map((row) => row.wallet));
  const telemetryPath = telemetryFromBattlefield();
  const telemetryFiles = telemetryPath && fs.existsSync(telemetryPath)
    ? [telemetryPath]
    : latestTelemetryFiles(8);
  const scans = telemetryFiles.map((filePath) => scanTelemetry(filePath, walletSet, startMs));
  const touches = scans.flatMap((scan) => scan.touches);
  const byWallet = new Map();
  for (const touch of touches) {
    if (!byWallet.has(touch.wallet)) byWallet.set(touch.wallet, []);
    byWallet.get(touch.wallet).push(touch);
  }
  const wallets = Array.from(byWallet.entries())
    .map(([wallet, rows]) => summarizeWallet(wallet, rows))
    .sort((a, b) => (
      Number(b.cross90Mints300s || 0) - Number(a.cross90Mints300s || 0)
      || Number(b.pre85BuyRows || 0) - Number(a.pre85BuyRows || 0)
      || Number(b.rows || 0) - Number(a.rows || 0)
    ));
  const coTouch = summarizeCoTouchClusters(touches);
  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    mode: 'report_only_wallet_observation_oos_lift',
    era: cohort.era,
    sources: {
      shadowWalletPath: SHADOW_WALLET_PATH,
      cohortUpdatedAt: cohort.updatedAt,
      telemetryFiles
    },
    note: 'Temporal OOS skeleton for observation-only wallets. Uses only telemetry after the cohort updatedAt. This report does not promote wallets or alter runtime gates.',
    summary: {
      cohortWallets: cohort.wallets.length,
      telemetryFilesRead: scans.length,
      touches: touches.length,
      walletsTouched: wallets.length,
      uniqueMintsTouched: new Set(touches.map((row) => row.mint)).size,
      pre85BuyRows: touches.filter((row) => row.isBuy && row.pre85).length,
      cross90Mints300s: new Set(touches.filter((row) => row.cross90Within300s).map((row) => row.mint)).size,
      coTouchClusters: coTouch.summary,
      status: touches.length >= 10 ? 'OOS_SAMPLES_OBSERVED' : 'OOS_COLLECTING'
    },
    promotionBlocked: true,
    promotionBlockers: [
      'observation_only_v2 has no trust tier',
      'requires disjoint-run OOS lift before shadow_tracked consideration',
      'requires cohort half-life and coalition reports before trust review'
    ],
    coTouchClusters: coTouch.topClusters,
    wallets,
    scanSummaries: scans.map((scan) => ({
      filePath: scan.filePath,
      rowsRead: scan.rowsRead,
      malformedLines: scan.malformedLines,
      touches: scan.touches.length
    }))
  };
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(REPORT_DIR, `wallet-observation-oos-lift-${stamp}.json`);
  writeJson(reportPath, report);
  writeJson(LATEST_PATH, report);
  console.log(`Wrote observation OOS lift report: ${reportPath}`);
  console.log(`Wrote latest observation OOS lift report: ${LATEST_PATH}`);
  console.log(`status=${report.summary.status} touches=${report.summary.touches} wallets=${report.summary.walletsTouched} cross90=${report.summary.cross90Mints300s}`);
}

main();
